import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { MarketOAuth } from "./oauth.js";

/**
 * The negotiated hiring rail: post a job, read bids, counter once, award, review the
 * deliverable, then accept / request changes. The market escrows each award until acceptance.
 */
export interface Bid {
  bidId: string;
  agentHandle: string;
  agentId?: string;
  amount: string; // decimal USDC
  proposal: string;
  slaSeconds?: number | null;
}

export interface JobResult {
  status: "in_progress" | "submitted" | "accepted" | "disputed" | "cancelled" | "unknown";
  deliverable: string | null;
}

export interface JobBoard {
  readonly live: boolean;
  postJob(input: { title: string; description: string; budget: string; tags: string[] }): Promise<{ jobId: string }>;
  listBids(jobId: string): Promise<Bid[]>;
  message(jobId: string, bidId: string, body: string): Promise<void>;
  award(jobId: string, bidId: string): Promise<{ assignmentId: string | null }>;
  result(jobId: string): Promise<JobResult>;
  accept(jobId: string): Promise<void>;
  requestChanges(jobId: string, feedback: string): Promise<void>;
  review(jobId: string, rating: number, comment: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
}

type Tool = { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

/** Live implementation over `https://market.near.ai/mcp/pro` with the owner's OAuth token. */
export class McpJobBoard implements JobBoard {
  readonly live = true;
  private client?: Client;
  private tools = new Map<string, Tool>();

  constructor(private readonly origin: string, private readonly oauth: MarketOAuth) {}

  private async connect() {
    if (this.client) return this.client;
    const token = await this.oauth.accessToken();
    const transport = new StreamableHTTPClientTransport(new URL("/mcp/pro", this.origin), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    const client = new Client({ name: "veyra-contractor", version: "1.0.0" });
    await client.connect(transport);
    const list = await client.listTools();
    for (const t of list.tools) this.tools.set(t.name.replace(/^marketplace__/, ""), t as Tool);
    this.client = client;
    return client;
  }

  /** Maps our field names to whatever the tool's schema calls them. */
  private args(tool: string, wanted: Record<string, [string[], unknown]>) {
    const props = Object.keys(this.tools.get(tool)?.inputSchema?.properties ?? {});
    const out: Record<string, unknown> = {};
    for (const [, [candidates, value]] of Object.entries(wanted)) {
      if (value === undefined) continue;
      const name = candidates.find((c) => props.includes(c)) ?? candidates[0];
      out[name] = value;
    }
    return out;
  }

  private async call(tool: string, args: Record<string, unknown>) {
    const client = await this.connect();
    const t = this.tools.get(tool);
    if (!t) throw new Error(`market MCP has no ${tool} tool`);
    const r = (await client.callTool({ name: t.name, arguments: args })) as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
    const text = r.content?.find((c) => c.type === "text")?.text ?? "";
    if (r.isError) throw new Error(`${tool}: ${text.slice(0, 300)}`);
    if (r.structuredContent) return r.structuredContent as Record<string, unknown>;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { text } as Record<string, unknown>;
    }
  }

  async availableTools() {
    await this.connect();
    return [...this.tools.keys()];
  }

  async postJob(i: { title: string; description: string; budget: string; tags: string[] }) {
    const r = await this.call("post_job", this.args("post_job", {
      title: [["title"], i.title],
      description: [["description", "brief", "body"], i.description],
      budget: [["budget_amount", "budget", "budgetAmount", "amount"], i.budget],
      currency: [["currency", "budget_currency"], "USDC"],
      tags: [["tags"], i.tags],
    }));
    const jobId = String(r.job_id ?? r.jobId ?? r.id ?? (r.job as { id?: string } | undefined)?.id ?? "");
    if (!jobId) throw new Error("post_job returned no job id");
    return { jobId };
  }

  async listBids(jobId: string): Promise<Bid[]> {
    const r = await this.call("list_bids", this.args("list_bids", { job: [["job_id", "jobId"], jobId] }));
    const rows = (r.bids ?? r.items ?? r.data ?? []) as Record<string, unknown>[];
    return rows.map((b) => ({
      bidId: String(b.bid_id ?? b.bidId ?? b.id),
      agentHandle: String(b.agent_handle ?? b.handle ?? (b.agent as { handle?: string } | undefined)?.handle ?? b.agentId ?? "unknown"),
      agentId: (b.agent_id ?? b.agentId) as string | undefined,
      amount: String(b.amount ?? b.price ?? "0"),
      proposal: String(b.proposal ?? b.message ?? ""),
      slaSeconds: (b.sla_seconds ?? b.slaSeconds ?? null) as number | null,
    }));
  }

  async message(jobId: string, bidId: string, body: string) {
    await this.call("message_worker", this.args("message_worker", { job: [["job_id", "jobId"], jobId], bid: [["bid_id", "bidId"], bidId], body: [["body", "message", "text"], body] }));
  }

  async award(jobId: string, bidId: string) {
    const r = await this.call("award_bid", this.args("award_bid", { job: [["job_id", "jobId"], jobId], bid: [["bid_id", "bidId"], bidId] }));
    return { assignmentId: (r.assignment_id ?? r.assignmentId ?? null) as string | null };
  }

  async result(jobId: string): Promise<JobResult> {
    const s = await this.call("get_job_status", this.args("get_job_status", { job: [["job_id", "jobId"], jobId] }));
    const status = String(s.assignment_status ?? s.status ?? "unknown") as JobResult["status"];
    if (status !== "submitted" && status !== "accepted") return { status, deliverable: null };
    const r = await this.call("get_job_result", this.args("get_job_result", { job: [["job_id", "jobId"], jobId] }));
    return { status, deliverable: String(r.deliverable_markdown ?? r.deliverableMarkdown ?? r.deliverable ?? r.text ?? "") };
  }

  async accept(jobId: string) {
    await this.call("accept_result", this.args("accept_result", { job: [["job_id", "jobId"], jobId] }));
  }

  async requestChanges(jobId: string, feedback: string) {
    await this.call("request_changes", this.args("request_changes", { job: [["job_id", "jobId"], jobId], feedback: [["feedback", "message", "comment"], feedback] }));
  }

  async review(jobId: string, rating: number, comment: string) {
    await this.call("review_agent", this.args("review_agent", { job: [["job_id", "jobId"], jobId], rating: [["rating", "score", "stars"], rating], comment: [["comment", "text", "review"], comment] }));
  }

  async cancel(jobId: string) {
    await this.call("cancel_job", this.args("cancel_job", { job: [["job_id", "jobId"], jobId] }));
  }
}
