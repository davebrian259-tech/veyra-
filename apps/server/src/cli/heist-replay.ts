/**
 * `pnpm heist:replay <run-id> [api-url]`: fetches a Heist run from any Veyra server and replays
 * it locally with the same referee. A match proves the server reported the outcome honestly.
 */
import { rogueSpecSchema, runDuel } from "../heist/referee.js";

const [id, base = "http://localhost:8787"] = process.argv.slice(2);
if (!id) throw new Error("usage: pnpm heist:replay <run-id> [api-url]");
const res = await fetch(`${base.replace(/\/$/, "")}/heist/runs/${id}`);
if (!res.ok) throw new Error(`could not fetch run ${id}: HTTP ${res.status}`);
const run = (await res.json()) as { vault: number; spec: unknown; outcomeHash: string; cracked: boolean; lootAtomic: string; engine: string };
const again = await runDuel(run.vault, rogueSpecSchema.parse(run.spec));
console.log(`run ${id} on vault ${run.vault} (engine ${run.engine})`);
console.log(`  server says: ${run.cracked ? `cracked, ${(Number(run.lootAtomic) / 1e6).toFixed(2)} USDC` : "held"} · ${run.outcomeHash}`);
console.log(`  local replay: ${again.cracked ? `cracked, ${(Number(again.lootAtomic) / 1e6).toFixed(2)} USDC` : "held"} · ${again.outcomeHash}`);
console.log(again.outcomeHash === run.outcomeHash ? "  ✓ the referee's outcome is reproducible" : "  ✗ MISMATCH: the stored outcome does not match a local replay");
process.exit(again.outcomeHash === run.outcomeHash ? 0 : 1);
