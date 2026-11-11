import { createRequire } from "node:module";
import { createPublicClient, formatEther, http, isAddress, recoverTransactionAddress, type PublicClient } from "viem";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { lastSuccessValue, txSucceeded, type NearRpc } from "../lib/near-rpc.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { Bodyguard } from "./bodyguard/engine.js";
import type { WalletTx } from "./escrow.js";

const require = createRequire(import.meta.url);

/**
 * NEAR Chain Signatures — for external-chain transactions that the standard NEAR Intents flow
 * cannot handle (e.g. paying a provider on an EVM network or testnet Intents does not route).
 * Intents remains the default for supported swaps and transfers.
 *
 * Non-custodial flow: the address is derived from the user's own NEAR account and a path, so
 * only that account can request signatures for it. Veyra prepares the EVM transaction and the
 * MPC `sign` call, the user's wallet sends the call, Veyra verifies the MPC signature recovers
 * to the derived address, then broadcasts and tracks the transaction.
 */

interface ChainsigModule {
  contracts: {
    ChainSignatureContract: new (o: { networkId: "testnet" | "mainnet"; contractId?: string }) => {
      sign(a: { payloads: Uint8Array[] | number[][]; path: string; keyType: "Ecdsa"; signerAccount: { accountId: string; signAndSendTransactions: (t: { transactions: { receiverId: string; actions: { functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[] }[] }) => Promise<unknown[]> } }): Promise<{ r: string; s: string; v: number }[]>;
    };
    utils?: { transaction: { responseToMpcSignature: (o: { signature: unknown }) => { r: string; s: string; v: number } } };
  };
  chainAdapters: { evm: { EVM: new (o: { publicClient: PublicClient; contract: unknown }) => EvmAdapter } };
}
interface EvmAdapter {
  deriveAddressAndPublicKey(predecessor: string, path: string): Promise<{ address: string; publicKey: string }>;
  getBalance(address: string): Promise<{ balance: bigint; decimals: number }>;
  prepareTransactionForSigning(req: { from: `0x${string}`; to: `0x${string}`; value?: bigint; data?: `0x${string}` }): Promise<{ transaction: unknown; hashesToSign: (Uint8Array | number[])[] }>;
  serializeTransaction(t: unknown): `0x${string}`;
  deserializeTransaction(s: `0x${string}`): unknown;
  finalizeTransactionSigning(o: { transaction: unknown; rsvSignatures: { r: string; s: string; v: number }[] }): `0x${string}`;
  broadcastTx(signed: string): Promise<{ hash: `0x${string}` }>;
}

class Captured extends Error {}

export class ChainSignatureService {
  private cs?: ChainsigModule;
  private evmAdapter?: EvmAdapter;
  private contract?: InstanceType<ChainsigModule["contracts"]["ChainSignatureContract"]>;
  readonly publicClient: PublicClient;

  constructor(
    private readonly db: Db,
    private readonly rpc: NearRpc,
    private readonly bodyguard: Bodyguard,
    private readonly audit: AuditLog,
    private readonly opts: { network: "testnet" | "mainnet"; contractId: string; evmRpcUrl: string; evmChainId: number },
  ) {
    this.publicClient = createPublicClient({ transport: http(opts.evmRpcUrl) }) as PublicClient;
  }

  private load() {
    if (!this.cs) {
      this.cs = require("chainsig.js") as ChainsigModule;
      this.contract = new this.cs.contracts.ChainSignatureContract({ networkId: this.opts.network, contractId: this.opts.contractId });
      this.evmAdapter = new this.cs.chainAdapters.evm.EVM({ publicClient: this.publicClient, contract: this.contract });
    }
    return { cs: this.cs, evm: this.evmAdapter!, contract: this.contract! };
  }

  static path(index = 1) {
    return `veyra/evm/${index}`;
  }

  async derive(user: User, index = 1) {
    const { evm } = this.load();
    const path = ChainSignatureService.path(index);
    const { address } = await evm.deriveAddressAndPublicKey(user.accountId, path);
    const bal = await evm.getBalance(address).catch(() => null);
    return { chainId: this.opts.evmChainId, mpcContract: this.opts.contractId, path, predecessor: user.accountId, address, balanceWei: bal?.balance.toString() ?? null, balance: bal ? formatEther(bal.balance) : null };
  }

  /** Prepares an EVM transfer from the derived address and the MPC request for the wallet. */
  async prepare(user: User, input: { to: string; valueWei: string; index?: number; data?: string }) {
    if (!isAddress(input.to)) throw badRequest("invalid_address", "not a valid EVM address");
    const findings = await this.bodyguard.addressFindings(user.id, input.to, "evm", null, "manual");
    if (findings.some((f) => f.severity === "block")) throw forbidden(`BODYGUARD: ${findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ")}`);
    const { evm, contract } = this.load();
    const path = ChainSignatureService.path(input.index ?? 1);
    const { address } = await evm.deriveAddressAndPublicKey(user.accountId, path);
    const value = BigInt(input.valueWei);
    const bal = await evm.getBalance(address);
    if (bal.balance < value) throw conflict("insufficient_balance", `derived address ${address} holds ${formatEther(bal.balance)} ETH`);
    const { transaction, hashesToSign } = await evm.prepareTransactionForSigning({ from: address as `0x${string}`, to: input.to as `0x${string}`, value, ...(input.data ? { data: input.data as `0x${string}` } : {}) });

    // Let chainsig.js build the exact MPC `sign` call, then hand it to the user's wallet.
    let walletTxs: WalletTx[] = [];
    try {
      await contract.sign({
        payloads: hashesToSign as Uint8Array[],
        path,
        keyType: "Ecdsa",
        signerAccount: {
          accountId: user.accountId,
          signAndSendTransactions: async ({ transactions }) => {
            walletTxs = transactions.map((t) => ({
              receiverId: t.receiverId,
              actions: t.actions.map((a) => ({
                type: "FunctionCall" as const,
                params: { methodName: a.functionCall!.methodName, args: JSON.parse(Buffer.from(a.functionCall!.args).toString("utf8")), gas: a.functionCall!.gas.toString(), deposit: a.functionCall!.deposit.toString() },
              })),
            }));
            throw new Captured();
          },
        },
      });
    } catch (e) {
      if (!(e instanceof Captured)) throw e;
    }
    const id = randomId("csr_");
    this.db.run(
      "INSERT INTO chain_sig_requests (id, user_id, chain, path, derived_address, request_json, unsigned_tx_json, payloads_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, user.id, `evm:${this.opts.evmChainId}`, path, address, json(input), json({ serialized: evm.serializeTransaction(transaction) }), json(hashesToSign.map((h) => Buffer.from(h as Uint8Array).toString("hex"))), "awaiting_signature", now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "user", action: "chain_sig.prepared", subject: id, data: { from: address, to: input.to, valueWei: input.valueWei, chainId: this.opts.evmChainId } });
    return { requestId: id, from: address, to: input.to, valueEth: formatEther(value), chainId: this.opts.evmChainId, findings, walletTransactions: walletTxs };
  }

  /** After the wallet's MPC call executes: verify the signature, assemble, broadcast. */
  async complete(user: User, requestId: string, nearTxHash: string) {
    const r = this.db.get<{ user_id: string; derived_address: string; unsigned_tx_json: string; status: string }>("SELECT * FROM chain_sig_requests WHERE id = ?", [requestId]);
    if (!r || r.user_id !== user.id) throw notFound("signature request");
    if (r.status !== "awaiting_signature") throw conflict("already_completed", `request is ${r.status}`);
    const outcome = await this.rpc.txStatus(nearTxHash, user.accountId, "EXECUTED_OPTIMISTIC");
    if (txSucceeded(outcome) === false) throw badRequest("mpc_failed", "the MPC sign transaction failed");
    if (outcome.transaction.receiver_id !== this.opts.contractId) throw badRequest("wrong_contract", "transaction was not sent to the MPC signer contract");
    const response = lastSuccessValue(outcome);
    if (!response) throw badRequest("no_signature", "no signature in the transaction result");
    const { cs, evm } = this.load();
    const rsv = cs.contracts.utils?.transaction.responseToMpcSignature({ signature: response });
    if (!rsv) throw badRequest("bad_signature", "could not parse the MPC signature");
    const unsigned = evm.deserializeTransaction(parse<{ serialized: `0x${string}` }>(r.unsigned_tx_json).serialized);
    const signed = evm.finalizeTransactionSigning({ transaction: unsigned, rsvSignatures: [rsv] });
    const signer = await recoverTransactionAddress({ serializedTransaction: signed as never });
    if (signer.toLowerCase() !== r.derived_address.toLowerCase()) throw badRequest("signature_mismatch", "MPC signature does not recover to the derived address");
    const { hash } = await evm.broadcastTx(signed);
    this.db.run("UPDATE chain_sig_requests SET near_tx_hash = ?, signed_tx = ?, broadcast_hash = ?, status = 'broadcast', updated_at = ? WHERE id = ?", [nearTxHash, signed, hash, now(), requestId]);
    this.audit.record({ userId: user.id, actor: "user", action: "chain_sig.broadcast", subject: requestId, data: { nearTxHash, evmTxHash: hash, signer } });
    return { requestId, evmTxHash: hash, signerVerified: true };
  }

  /** submitted (broadcast) → confirmed (mined) → settled (≥ 6 confirmations) */
  async refresh(requestId: string) {
    const r = this.db.get<{ broadcast_hash: string | null; status: string }>("SELECT * FROM chain_sig_requests WHERE id = ?", [requestId]);
    if (!r?.broadcast_hash) return r?.status ?? null;
    const receipt = await this.publicClient.getTransactionReceipt({ hash: r.broadcast_hash as `0x${string}` }).catch(() => null);
    if (!receipt) return r.status;
    const head = await this.publicClient.getBlockNumber();
    const confs = Number(head - receipt.blockNumber) + 1;
    const next = receipt.status !== "success" ? "failed" : confs >= 6 ? "settled" : "confirmed";
    this.db.run("UPDATE chain_sig_requests SET status = ?, updated_at = ? WHERE id = ?", [next, now(), requestId]);
    return next;
  }

  pending() {
    return this.db.all<{ id: string }>("SELECT id FROM chain_sig_requests WHERE status IN ('broadcast','confirmed')");
  }

  list(user: User) {
    return this.db.all("SELECT id, chain, path, derived_address, request_json, near_tx_hash, broadcast_hash, status, created_at FROM chain_sig_requests WHERE user_id = ? ORDER BY created_at DESC", [user.id]).map((x) => ({ ...x, request: parse((x as { request_json: string }).request_json), request_json: undefined }));
  }
}
