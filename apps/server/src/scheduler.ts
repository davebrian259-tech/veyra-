import type { AppContext } from "./context.js";

/**
 * Background loop. Nothing is assumed done because it was submitted: contracts advance,
 * new market hires are picked up, owner intents and vault withdrawals are reconciled with the
 * Agent API, the spend-key pool is kept topped up, and receipts are anchored.
 */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private tick = 0;
  lastRun: { at: string; errors: string[] } | null = null;

  constructor(private readonly ctx: AppContext, private readonly intervalMs: number) {}

  start() {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce() {
    if (this.busy) return;
    this.busy = true;
    this.tick++;
    const errors: string[] = [];
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const { engine, agents, execution, spend, receipts } = this.ctx;
    try {
      if (this.tick === 1 || this.tick % 12 === 0) await safe("spend pool", () => spend.ensurePool());
      await safe("market assignments", () => engine.pollAssignments());
      await safe("contracts", () => engine.tick());
      if (agents.configured) {
        for (const i of agents.pendingOwnerIntents()) await safe(`intent ${i.correlation_id}`, () => agents.refreshOwnerIntent(i.correlation_id));
        for (const op of execution.pendingAgentOps()) await safe(`vault op ${op.id}`, async () => execution.applyStatus(op.id, await agents.api().getStatus(op.correlation_id!)));
      }
      if (this.tick % 60 === 0) await safe("anchor", () => receipts.anchorPending());
    } finally {
      this.busy = false;
      this.lastRun = { at: new Date().toISOString(), errors };
    }
  }
}
