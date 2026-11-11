import { randomUUID } from "node:crypto";
import type { MarketEndpoints } from "./catalog.js";
import type { A2ATask, X402Challenge, X402Requirement } from "./types.js";

export class X402Error extends Error {
  constructor(readonly code: string | number, message: string, readonly data?: unknown) {
    super(message);
  }
}

export type QuoteResult =
  | { kind: "quote"; challenge: X402Challenge }
  | { kind: "unavailable"; code: number; message: string }
  | { kind: "free"; task: A2ATask };

/**
 * A2A + x402 caller for Agent Market agents: ask for a price, pay with a signed cheque,
 * read the result. https://market.near.ai/skill/x402-caller/SKILL.md
 */
export class X402Caller {
  constructor(private readonly endpoints: MarketEndpoints, private readonly fetcher: typeof fetch = fetch) {}

  private url(handle: string) {
    return `${this.endpoints.agentOrigin(handle)}/a2a/v1`;
  }

  private message(text: string, contextId?: string) {
    return { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text }], ...(contextId ? { contextId } : {}) };
  }

  private async rpc(handle: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 75_000) {
    const res = await this.fetcher(this.url(handle), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** Sends the task without payment. A 402 carries the price; nothing is charged. */
  async quote(handle: string, task: string): Promise<QuoteResult> {
    const r = await this.rpc(handle, { jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: this.message(task), configuration: { historyLength: 0 } } }, {}, 30_000);
    if (r.status === 402) return { kind: "quote", challenge: r.body as X402Challenge };
    if (r.body?.error) return { kind: "unavailable", code: r.body.error.code, message: r.body.error.message };
    if (r.body?.result?.task) return { kind: "free", task: r.body.result.task };
    throw new X402Error(r.status, `unexpected quote response (HTTP ${r.status})`, r.body);
  }

  static paymentHeader(row: X402Requirement, signedDelegateBase64: string) {
    return Buffer.from(JSON.stringify({ x402Version: 2, accepted: row, payload: { signedDelegateAction: signedDelegateBase64 } })).toString("base64");
  }

  /** Repeats the call with the cheque. The market holds it and settles only on delivery. */
  async pay(handle: string, task: string, xPayment: string, opts: { contextId?: string; returnImmediately?: boolean } = {}): Promise<A2ATask> {
    const r = await this.rpc(handle, {
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: { message: this.message(task, opts.contextId), configuration: { historyLength: 0, ...(opts.returnImmediately ? { returnImmediately: true } : {}) } },
    }, { "X-PAYMENT": xPayment });
    if (r.status === 402) throw new X402Error(402, `payment refused: ${r.body?.error ?? "unknown"}`, r.body);
    if (r.body?.error) throw new X402Error(r.body.error.code, r.body.error.message, r.body.error.data);
    const t = r.body?.result?.task ?? r.body?.result;
    if (!t?.id) throw new X402Error(r.status, "no task in response", r.body);
    return t as A2ATask;
  }

  /** Free. Its result is the task itself (not wrapped). */
  async getTask(handle: string, taskId: string): Promise<A2ATask> {
    const r = await this.rpc(handle, { jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: taskId, historyLength: 0 } }, {}, 20_000);
    if (r.body?.error) throw new X402Error(r.body.error.code, r.body.error.message);
    return r.body.result as A2ATask;
  }

  async cancel(handle: string, taskId: string) {
    const r = await this.rpc(handle, { jsonrpc: "2.0", id: 3, method: "CancelTask", params: { id: taskId } }, {}, 20_000);
    if (r.body?.error) throw new X402Error(r.body.error.code, r.body.error.message);
    return r.body.result as A2ATask;
  }
}
