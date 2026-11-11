import type { MarketAgent } from "../market/types.js";

/**
 * Candidate ranking for a subtask: trust first, then how well the agent's listing matches the
 * work, then price. Pure and deterministic, shared by the engine and the live dry run.
 */
export interface Candidate {
  agent: MarketAgent;
  plan: bigint | null;
  score: number;
  reasons: string[];
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "about", "write", "short", "main", "agent", "agents"]);

export function terms(text: string) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** 0..1: share of the subtask's search terms found in the agent's listing. */
export function relevance(agent: MarketAgent, searchText: string, category: string | null) {
  const want = terms(searchText);
  const have = `${agent.name} ${agent.description ?? ""} ${(agent.tags ?? []).join(" ")} ${agent.category ?? ""}`.toLowerCase();
  const hits = want.filter((w) => have.includes(w.replace(/s$/, ""))).length;
  const base = want.length ? hits / want.length : 0.5;
  return Math.min(1, base + (category && agent.category === category ? 0.25 : 0));
}

export function rankValue(c: Candidate, searchText: string, category: string | null, capAtomic: bigint) {
  const price = c.plan === null ? 1 : Number(c.plan) / Math.max(1, Number(capAtomic));
  return c.score * 0.6 + relevance(c.agent, searchText, category) * 40 - price * 10;
}

export function rank(cands: Candidate[], searchText: string, category: string | null, capAtomic: bigint) {
  return [...cands].sort((a, b) => rankValue(b, searchText, category, capAtomic) - rankValue(a, searchText, category, capAtomic));
}
