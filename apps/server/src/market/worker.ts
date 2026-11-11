import { createHmac, timingSafeEqual } from "node:crypto";

/** Assignment as returned by GET /v1/agents/me/assignments (market OpenAPI `MyAssignmentItem`). */
export interface MarketAssignment {
  assignment: {
    assignmentId: string;
    jobId: string;
    status: "in_progress" | "submitted" | "accepted" | "disputed" | "dispute_resolved" | "cancelled";
    escrowAmount: string;
    escrowToken: string;
    slaDeadlineAt: string;
    startedAt: string | null;
    submittedAt: string | null;
  };
  job: { jobId: string; title: string; description: string; tags: string[]; jobKind: string; status: string };
  autoAcceptAt: string | null;
  latestMessage: { body: string; senderSide: string; createdAt: string } | null;
}

/**
 * Veyra as a seller on the Agent Market. Authenticated with the agent's `aat_` work token, which
 * can find and deliver work but cannot move money, accept deliverables or open disputes.
 * https://market.near.ai/skill/SKILL.md
 */
export class MarketWorker {
  constructor(private readonly origin: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetcher(new URL(path, this.origin), {
      method,
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`market ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async assignments(status: "in_progress" | "submitted" | "accepted" = "in_progress") {
    const r = await this.call<{ assignments: MarketAssignment[] }>("GET", `/v1/agents/me/assignments?status=${status}&limit=50`);
    return r.assignments ?? [];
  }

  start(assignmentId: string) {
    return this.call<{ startedAt: string }>("POST", `/v1/assignments/${assignmentId}/start`);
  }

  progress(assignmentId: string, message: string, percent?: number) {
    return this.call("POST", `/v1/assignments/${assignmentId}/progress`, { message, ...(percent !== undefined ? { percent } : {}) });
  }

  message(assignmentId: string, body: string) {
    return this.call("POST", `/v1/assignments/${assignmentId}/messages`, { body });
  }

  submit(assignmentId: string, deliverableMarkdown: string) {
    return this.call<{ assignmentId: string; status: string; deliverableHash: string | null }>("POST", `/v1/assignments/${assignmentId}/submit`, { deliverableMarkdown, files: [] });
  }
}

/** Verifies `X-Market-Signature` = sha256=HMAC(secret, "<timestamp>.<raw body>"), within 5 minutes. */
export function verifyMarketWebhook(secret: string, headers: { timestamp?: string; signature?: string }, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${headers.timestamp}.`).update(rawBody).digest("hex");
  const provided = headers.signature.replace(/^sha256=/, "");
  return expected.length === provided.length && timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
