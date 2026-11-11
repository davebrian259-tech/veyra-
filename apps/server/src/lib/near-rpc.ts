/** Minimal NEAR JSON-RPC client (view calls, access keys, transaction status). */
export type TxWait = "NONE" | "INCLUDED" | "EXECUTED_OPTIMISTIC" | "INCLUDED_FINAL" | "EXECUTED" | "FINAL";

export interface AccessKeyInfo {
  public_key: string;
  access_key: {
    nonce: number;
    permission:
      | "FullAccess"
      | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
  };
}

export interface TxOutcome {
  final_execution_status?: TxWait;
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] };
  transaction_outcome: { outcome: { logs: string[]; status: unknown } };
  receipts_outcome: { id: string; outcome: { logs: string[]; status: unknown; executor_id: string } }[];
}

export class RpcError extends Error {
  constructor(message: string, readonly cause?: unknown, readonly name_?: string) {
    super(message);
  }
}

export class NearRpc {
  constructor(readonly url: string, private readonly fetcher: typeof fetch = fetch) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetcher(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "veyra", method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as { result?: T & { error?: string }; error?: { message?: string; cause?: { name?: string }; data?: unknown } };
    if (body.error) {
      throw new RpcError(
        `${method}: ${body.error.cause?.name ?? body.error.message ?? "rpc error"}`,
        body.error,
        body.error.cause?.name,
      );
    }
    if (body.result && typeof body.result === "object" && "error" in body.result && body.result.error) {
      throw new RpcError(`${method}: ${body.result.error}`);
    }
    return body.result as T;
  }

  viewAccount(accountId: string) {
    return this.call<{ amount: string; locked: string; code_hash: string; storage_usage: number; block_height: number }>(
      "query",
      { request_type: "view_account", finality: "final", account_id: accountId },
    );
  }

  async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.viewAccount(accountId);
      return true;
    } catch (e) {
      if (e instanceof RpcError && (e.name_ === "UNKNOWN_ACCOUNT" || /does not exist|UNKNOWN_ACCOUNT/.test(e.message))) return false;
      throw e;
    }
  }

  async latestBlock(): Promise<{ hash: string; height: number }> {
    const b = await this.call<{ header: { hash: string; height: number } }>("block", { finality: "final" });
    return { hash: b.header.hash, height: b.header.height };
  }

  viewAccessKey(accountId: string, publicKey: string) {
    return this.call<AccessKeyInfo["access_key"]>("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    });
  }

  async viewAccessKeyList(accountId: string): Promise<AccessKeyInfo[]> {
    const r = await this.call<{ keys: AccessKeyInfo[] }>("query", {
      request_type: "view_access_key_list",
      finality: "final",
      account_id: accountId,
    });
    return r.keys;
  }

  async view<T>(contractId: string, method: string, args: unknown = {}): Promise<T> {
    const r = await this.call<{ result: number[] }>("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    const text = Buffer.from(r.result).toString("utf8");
    return (text ? JSON.parse(text) : null) as T;
  }

  txStatus(txHash: string, senderId: string, waitUntil: TxWait = "NONE") {
    return this.call<TxOutcome>("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: waitUntil });
  }
}

export interface NearEvent {
  standard: string;
  version: string;
  event: string;
  data: Record<string, unknown>[];
}

/** Extracts NEP-297 events emitted by `contractId` from a transaction outcome. */
export function extractEvents(outcome: TxOutcome, contractId?: string): NearEvent[] {
  const out: NearEvent[] = [];
  for (const r of outcome.receipts_outcome) {
    if (contractId && r.outcome.executor_id !== contractId) continue;
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        out.push(JSON.parse(log.slice("EVENT_JSON:".length)) as NearEvent);
      } catch {
        /* not an event */
      }
    }
  }
  return out;
}

export function txSucceeded(outcome: TxOutcome): boolean | null {
  const s = outcome.status;
  if (typeof s === "string") return null;
  if ("Failure" in s && s.Failure) return false;
  if ("SuccessValue" in s) {
    // A top-level success can still hide a failed receipt.
    return !outcome.receipts_outcome.some(
      (r) => typeof r.outcome.status === "object" && r.outcome.status !== null && "Failure" in (r.outcome.status as object),
    );
  }
  return null;
}

/** Decodes the JSON returned by the last successful receipt (e.g. the MPC signature). */
export function lastSuccessValue<T = unknown>(outcome: TxOutcome): T | null {
  for (let i = outcome.receipts_outcome.length - 1; i >= 0; i--) {
    const st = outcome.receipts_outcome[i].outcome.status as { SuccessValue?: string };
    if (st && typeof st === "object" && typeof st.SuccessValue === "string" && st.SuccessValue.length > 0) {
      return JSON.parse(Buffer.from(st.SuccessValue, "base64").toString("utf8")) as T;
    }
  }
  const top = outcome.status as { SuccessValue?: string };
  if (top && typeof top === "object" && top.SuccessValue) {
    return JSON.parse(Buffer.from(top.SuccessValue, "base64").toString("utf8")) as T;
  }
  return null;
}
