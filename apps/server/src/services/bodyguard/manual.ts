import { fromAtomic, YOCTO } from "../../lib/amounts.js";
import type { NearRpc } from "../../lib/near-rpc.js";
import type { TokenCatalog } from "../tokens.js";
import { decide, type Bodyguard, type Finding } from "./engine.js";
import { WELL_KNOWN_NEAR } from "./address.js";

/**
 * Manual-mode transaction intelligence. The user's own wallet keeps control: Veyra explains
 * the transaction and reports risk signals, but never signs or routes it through the agent.
 */

export type ManualTx =
  | { type: "transfer"; asset: "NEAR" | string; amount: string; receiver: string }
  | { type: "function_call"; receiver: string; methodName: string; args?: Record<string, unknown>; deposit?: string }
  | { type: "add_key"; publicKey: string; permission: "FullAccess" | { receiverId: string; methodNames?: string[]; allowance?: string | null } }
  | { type: "delete_account"; beneficiary: string };

const EMPTY_CODE = "11111111111111111111111111111111";

export class ManualAnalyzer {
  constructor(private readonly bodyguard: Bodyguard, private readonly rpc: NearRpc, private readonly tokens: TokenCatalog) {}

  async analyze(userId: string, accountId: string, tx: ManualTx) {
    const f: Finding[] = [];
    const explain: string[] = [];
    let usdValue: number | null = null;
    const nearPrice = await this.tokens.nearUsd().catch(() => null);
    const balance = await this.rpc.viewAccount(accountId).then((a) => BigInt(a.amount)).catch(() => null);

    if (tx.type === "transfer") {
      if (tx.asset === "NEAR") {
        const amt = Number(fromAtomic(tx.amount, YOCTO));
        usdValue = nearPrice != null ? amt * nearPrice : null;
        explain.push(`Sends ${amt} NEAR${usdValue != null ? ` (≈ $${usdValue.toFixed(2)})` : ""} from ${accountId} to ${tx.receiver}.`);
        if (balance != null) {
          if (BigInt(tx.amount) > balance) f.push({ rule: "insufficient_balance", severity: "block", message: "The amount exceeds your NEAR balance." });
          else if (BigInt(tx.amount) * 2n > balance) f.push({ rule: "large_share_of_balance", severity: "warn", message: "This sends more than half of your NEAR balance." });
        }
      } else {
        const contract = tx.asset.replace(/^nep141:/, "");
        const token = await this.tokens.findNearContract(contract);
        if (!token) f.push({ rule: "unknown_token", severity: "high", message: `${contract} is not a token NEAR Intents recognises. Check it is the token you expect.` });
        else {
          const look = WELL_KNOWN_NEAR.find((w) => w !== contract && w.replace(/\W/g, "") === contract.replace(/\W/g, ""));
          if (look) f.push({ rule: "lookalike_token", severity: "high", message: `${contract} imitates ${look}.` });
          const amt = Number(fromAtomic(tx.amount, token.decimals));
          usdValue = token.price != null ? amt * token.price : null;
          explain.push(`Transfers ${amt} ${token.symbol}${usdValue != null ? ` (≈ $${usdValue.toFixed(2)})` : ""} to ${tx.receiver} via ${contract}.ft_transfer.`);
          const bal = await this.rpc.view<string>(contract, "ft_balance_of", { account_id: accountId }).catch(() => null);
          if (bal != null && BigInt(tx.amount) > BigInt(bal)) f.push({ rule: "insufficient_balance", severity: "block", message: `The amount exceeds your ${token.symbol} balance.` });
          const registered = await this.rpc.view<unknown>(contract, "storage_balance_of", { account_id: tx.receiver }).catch(() => "unknown");
          if (registered === null) f.push({ rule: "receiver_not_registered", severity: "warn", message: `${tx.receiver} is not registered with ${contract}; a storage deposit is needed first or the transfer fails.` });
        }
      }
      f.push(...(await this.bodyguard.addressFindings(userId, tx.receiver, "near", null, "manual")));
      await this.contractInfo(tx.receiver, explain);
    }

    if (tx.type === "function_call") {
      const dep = tx.deposit ? BigInt(tx.deposit) : 0n;
      const depNear = Number(fromAtomic(dep, YOCTO));
      usdValue = nearPrice != null ? depNear * nearPrice : null;
      explain.push(`Calls ${tx.methodName} on ${tx.receiver}${dep > 0n ? ` attaching ${depNear} NEAR` : ""}.`);
      const isContract = await this.contractInfo(tx.receiver, explain);
      if (isContract === false) f.push({ rule: "not_a_contract", severity: "high", message: `${tx.receiver} has no contract deployed; this call will fail.` });
      if (tx.methodName === "ft_transfer_call") explain.push("ft_transfer_call moves tokens AND lets the receiving contract act on them. Only use it with contracts you trust.");
      if (/approve|allowance|set_owner|add_admin|upgrade|migrate/i.test(tx.methodName)) f.push({ rule: "privileged_method", severity: "high", message: `${tx.methodName} can grant control over funds or a contract.` });
      if (dep > 10n ** 24n * 10n) f.push({ rule: "large_deposit", severity: "warn", message: "This attaches a large NEAR deposit to a contract call." });
      f.push(...(await this.bodyguard.addressFindings(userId, tx.receiver, "near", null, "manual")).filter((x) => x.rule !== "first_time_destination"));
    }

    if (tx.type === "add_key") {
      if (tx.permission === "FullAccess") {
        f.push({ rule: "full_access_key", severity: "block", message: "Adding a full-access key gives whoever holds it complete control of your account. Only do this for a key you created yourself." });
        explain.push("Adds a FULL-ACCESS key to your account.");
      } else {
        const unlimited = tx.permission.allowance == null;
        explain.push(`Adds a function-call key for ${tx.permission.receiverId}${tx.permission.methodNames?.length ? ` (${tx.permission.methodNames.join(", ")})` : " (all methods)"}${unlimited ? " with unlimited gas allowance" : ""}.`);
        if (unlimited) f.push({ rule: "unlimited_allowance", severity: "warn", message: "The key has no gas allowance limit." });
        f.push(...(await this.bodyguard.addressFindings(userId, tx.permission.receiverId, "near", null, "manual")).filter((x) => x.rule !== "first_time_destination"));
      }
    }

    if (tx.type === "delete_account") {
      f.push({ rule: "delete_account", severity: "block", message: `Deleting your account sends its NEAR to ${tx.beneficiary} and destroys the account. Tokens it holds are lost.` });
      explain.push(`Deletes ${accountId} and sends its NEAR to ${tx.beneficiary}.`);
    }

    const verdict = decide(f);
    return {
      ...verdict,
      level: verdict.decision === "block" ? "danger" : f.some((x) => x.severity === "high") ? "danger" : f.some((x) => x.severity === "warn") ? "caution" : "safe",
      usdValue,
      explanation: explain,
      note: "Manual transactions are signed by your own wallet. BODYGUARD warns; the final decision is yours.",
    };
  }

  private async contractInfo(accountId: string, explain: string[]): Promise<boolean | null> {
    try {
      const a = await this.rpc.viewAccount(accountId);
      const isContract = a.code_hash !== EMPTY_CODE;
      explain.push(isContract ? `${accountId} is a smart contract.` : `${accountId} is a regular account (no contract code).`);
      return isContract;
    } catch {
      return null;
    }
  }

  /**
   * NEAR's equivalent of token approvals: access keys. Full-access keys can do anything;
   * function-call keys let a dApp call a contract on your behalf and spend gas allowance.
   */
  async analyzeAccessKeys(userId: string, accountId: string) {
    const keys = await this.rpc.viewAccessKeyList(accountId);
    const full = keys.filter((k) => k.access_key.permission === "FullAccess");
    const report = [];
    for (const k of keys) {
      const perm = k.access_key.permission;
      const findings: Finding[] = [];
      if (perm === "FullAccess") {
        if (full.length > 1) findings.push({ rule: "multiple_full_access_keys", severity: "warn", message: "One of several full-access keys. Remove any you no longer use (old wallets, devices)." });
        report.push({ publicKey: k.public_key, kind: "full_access", findings });
        continue;
      }
      const fc = perm.FunctionCall;
      if (fc.allowance == null) findings.push({ rule: "unlimited_allowance", severity: "warn", message: "No gas allowance limit." });
      findings.push(...(await this.bodyguard.addressFindings(userId, fc.receiver_id, "near", null, "manual")).filter((x) => x.rule !== "first_time_destination"));
      report.push({
        publicKey: k.public_key,
        kind: "function_call",
        receiverId: fc.receiver_id,
        methodNames: fc.method_names,
        allowanceNear: fc.allowance == null ? null : fromAtomic(fc.allowance, YOCTO),
        findings,
        // Action the user's wallet can sign to revoke this key.
        revokeAction: { type: "DeleteKey", params: { publicKey: k.public_key } },
      });
    }
    return {
      accountId,
      fullAccessKeys: full.length,
      functionCallKeys: keys.length - full.length,
      keys: report,
      riskScore: decide(report.flatMap((r) => r.findings)).riskScore,
    };
  }
}
