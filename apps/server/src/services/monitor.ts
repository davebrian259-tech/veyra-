import type { AgentService } from "./agents.js";
import type { ChainSignatureService } from "./chain-signatures.js";
import type { EscrowService } from "./escrow.js";
import type { ExecutionService } from "./execution.js";
import type { GoalService } from "./goals.js";
import type { IntentsService } from "./intents.js";
import type { NearTxTracker } from "./near-tx.js";

/**
 * Background reconciliation. Nothing is assumed to have succeeded because it was submitted:
 * every pending owner intent, agent execution, 1Click swap, wallet transaction, escrow and
 * external-chain transaction is polled until it reaches a final state.
 */
export class Monitor {
  private timer?: NodeJS.Timeout;
  private running = false;
  private tick = 0;
  lastRun: { at: string; errors: string[] } | null = null;

  constructor(
    private readonly s: { agents: AgentService; execution: ExecutionService; intents: IntentsService; tracker: NearTxTracker; escrow: EscrowService; chainSigs: ChainSignatureService; goals: GoalService },
    private readonly intervalMs: number,
  ) {}

  start() {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    this.tick++;
    const errors: string[] = [];
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    try {
      if (this.s.agents.configured) {
        for (const i of this.s.agents.pendingOwnerIntents()) await safe(`intent ${i.correlation_id}`, () => this.s.agents.refreshOwnerIntent(i.correlation_id));
        for (const op of this.s.execution.pendingAgentOps()) {
          await safe(`op ${op.id}`, async () => this.s.execution.applyStatus(op.id, await this.s.agents.api().getStatus(op.correlation_id!)));
        }
      }
      for (const sw of this.s.intents.pendingManualSwaps()) await safe(`swap ${sw.id}`, () => this.s.intents.refresh(sw.id));
      for (const tx of this.s.tracker.pending()) await safe(`tx ${tx.id}`, () => this.s.tracker.refresh(tx.id));
      for (const c of this.s.chainSigs.pending()) await safe(`chainsig ${c.id}`, () => this.s.chainSigs.refresh(c.id));
      if (this.tick % 6 === 0) for (const e of this.s.escrow.activeEscrows()) await safe(`escrow ${e.id}`, () => this.s.escrow.sync(e.id));
      if (this.tick % 60 === 0 && this.s.agents.configured) await safe("goals", () => this.s.goals.evaluateAll());
    } finally {
      this.running = false;
      this.lastRun = { at: new Date().toISOString(), errors };
    }
  }
}
