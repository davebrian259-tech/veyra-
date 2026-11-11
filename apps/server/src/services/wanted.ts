import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { Bodyguard } from "./bodyguard/engine.js";
import type { Notifier } from "./notifications.js";

/**
 * WANTED — discovery of human and AI-agent providers, competing offers and bounded
 * negotiation. Negotiation is deterministic: Veyra never offers above the user's budget, and
 * the budget itself is never revealed to providers.
 *
 * Offers come from three kinds of provider:
 *   - human providers, who log in with their NEAR wallet and respond through the API
 *   - AI-agent providers with an `offer_endpoint`, called with a request-for-quote
 *   - demo providers (SEED_DEMO_PROVIDERS=1), whose offers are SIMULATED and labelled so
 */

export interface ProviderRow {
  id: string;
  kind: "human" | "ai_agent";
  name: string;
  account_id: string;
  description: string;
  skills_json: string;
  base_price_usd: number;
  min_price_usd: number | null;
  rating: number;
  rating_count: number;
  completed_jobs: number;
  disputes: number;
  availability: string;
  offer_endpoint: string | null;
  demo: number;
  owner_user_id: string | null;
}

const SYNONYMS: Record<string, string[]> = {
  "web-development": ["website", "web", "frontend", "react", "nextjs", "landing-page"],
  design: ["ui", "ux", "figma", "graphic-design"],
  branding: ["logo", "brand-identity"],
  "smart-contracts": ["rust", "near", "solidity", "blockchain"],
  writing: ["copywriting", "content", "blog"],
  "ai-automation": ["ai-agent", "chatbot", "automation", "llm"],
  "data-analysis": ["analytics", "dashboard", "data"],
  "security-audit": ["audit", "security"],
};

function expand(skills: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of skills.map((x) => x.toLowerCase())) {
    out.add(s);
    for (const [k, v] of Object.entries(SYNONYMS)) if (k === s || v.includes(s)) { out.add(k); v.forEach((x) => out.add(x)); }
  }
  return out;
}

export function reputation(p: Pick<ProviderRow, "rating" | "rating_count" | "completed_jobs" | "disputes">, polApproved = 0): number {
  // Bayesian-smoothed rating (prior 3.5 with weight 5), completion volume and dispute penalty.
  const smoothed = (p.rating * p.rating_count + 3.5 * 5) / (p.rating_count + 5);
  const volume = Math.min(1, Math.log10(1 + p.completed_jobs + polApproved) / 2);
  const disputeRate = p.completed_jobs ? p.disputes / p.completed_jobs : 0;
  return Math.max(0, Math.min(100, (smoothed / 5) * 70 + volume * 30 - disputeRate * 40));
}

export class WantedService {
  constructor(
    private readonly db: Db,
    private readonly bodyguard: Bodyguard,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  // ---------------------------------------------------------------- providers

  registerProvider(user: User, input: { kind: "human" | "ai_agent"; name: string; description: string; skills: string[]; basePriceUsd: number; minPriceUsd?: number; offerEndpoint?: string | null }) {
    if (input.offerEndpoint && !/^https:\/\//.test(input.offerEndpoint)) throw badRequest("invalid_endpoint", "offer endpoints must use HTTPS");
    const existing = this.db.get<{ id: string }>("SELECT id FROM providers WHERE owner_user_id = ? AND name = ?", [user.id, input.name]);
    const id = existing?.id ?? randomId("prv_");
    this.db.run(
      `INSERT OR REPLACE INTO providers (id, kind, name, account_id, description, skills_json, base_price_usd, min_price_usd, offer_endpoint, demo, owner_user_id, created_at,
        rating, rating_count, completed_jobs, disputes, availability)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?, COALESCE((SELECT rating FROM providers WHERE id = ?),0), COALESCE((SELECT rating_count FROM providers WHERE id = ?),0),
        COALESCE((SELECT completed_jobs FROM providers WHERE id = ?),0), COALESCE((SELECT disputes FROM providers WHERE id = ?),0), 'available')`,
      [id, input.kind, input.name, user.accountId, input.description, json(input.skills.map((s) => s.toLowerCase())), input.basePriceUsd, input.minPriceUsd ?? null, input.offerEndpoint ?? null, user.id, now(), id, id, id, id],
    );
    this.audit.record({ userId: user.id, actor: "provider", action: "provider.registered", subject: id, data: { name: input.name, kind: input.kind } });
    return this.provider(id);
  }

  provider(id: string) {
    const p = this.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ?", [id]);
    if (!p) throw notFound("provider");
    return this.publicProvider(p);
  }

  private publicProvider(p: ProviderRow) {
    const pol = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chain_events WHERE standard = 'veyra_pol' AND event = 'submission_approved' AND json_extract(data_json, '$[0].contributor') = ?", [p.account_id])?.n ?? 0;
    // min_price_usd is the provider's private floor and is never exposed.
    return {
      id: p.id, kind: p.kind, name: p.name, accountId: p.account_id, description: p.description, skills: parse<string[]>(p.skills_json),
      basePriceUsd: p.base_price_usd, rating: p.rating, ratingCount: p.rating_count, completedJobs: p.completed_jobs, disputes: p.disputes,
      availability: p.availability, acceptsRfq: Boolean(p.offer_endpoint), demo: Boolean(p.demo), proofOfLifeApprovals: pol, reputation: Number(reputation(p, pol).toFixed(1)),
    };
  }

  search(query: { skills?: string[]; text?: string; maxPriceUsd?: number; kind?: "human" | "ai_agent" }) {
    const want = expand([...(query.skills ?? []), ...((query.text ?? "").toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])]);
    const rows = this.db.all<ProviderRow>(`SELECT * FROM providers ${query.kind ? "WHERE kind = ?" : ""}`, query.kind ? [query.kind] : []);
    return rows
      .map((p) => {
        const have = expand(parse<string[]>(p.skills_json));
        const overlap = [...want].filter((s) => have.has(s)).length;
        const skillScore = want.size ? overlap / Math.min(want.size, Math.max(have.size, 1)) : 0.5;
        const priceFit = query.maxPriceUsd ? (p.base_price_usd <= query.maxPriceUsd ? 1 : Math.max(0, 1 - (p.base_price_usd - query.maxPriceUsd) / query.maxPriceUsd)) : 0.5;
        const pub = this.publicProvider(p);
        const avail = p.availability === "available" ? 1 : p.availability === "busy" ? 0.4 : 0;
        const score = Math.min(1, skillScore) * 50 + (pub.reputation / 100) * 25 + priceFit * 15 + avail * 10;
        return { ...pub, match: { score: Number(score.toFixed(1)), skillOverlap: overlap, priceFit: Number(priceFit.toFixed(2)) } };
      })
      .filter((p) => p.match.skillOverlap > 0 || !want.size)
      .sort((a, b) => b.match.score - a.match.score);
  }

  // ---------------------------------------------------------------- jobs & offers

  createJob(user: User, input: { title: string; description: string; skills: string[]; budgetMaxUsd: number; deadlineDays: number; completionConditions: string[]; goalId?: string | null }) {
    if (!(input.budgetMaxUsd > 0)) throw badRequest("invalid_budget", "budget must be positive");
    const id = randomId("job_");
    this.db.run(
      "INSERT INTO jobs (id, user_id, goal_id, title, description, skills_json, budget_max_usd, deadline, completion_conditions_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, user.id, input.goalId ?? null, input.title, input.description, json(input.skills), input.budgetMaxUsd, new Date(Date.now() + input.deadlineDays * 86_400_000).toISOString(), json(input.completionConditions), "open", now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "user", action: "job.created", subject: id, data: { title: input.title, budgetMaxUsd: input.budgetMaxUsd } });
    return this.job(user, id);
  }

  job(user: User, id: string) {
    const j = this.db.get<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
    if (!j) throw notFound("job");
    const isOwner = j.user_id === user.id;
    const isBidder = Boolean(this.db.get("SELECT 1 FROM offers o JOIN providers p ON p.id = o.provider_id WHERE o.job_id = ? AND p.owner_user_id = ?", [id, user.id]));
    if (!isOwner && !isBidder) throw forbidden("not your job");
    const offers = this.db.all<Record<string, unknown>>("SELECT * FROM offers WHERE job_id = ? ORDER BY price_usd ASC", [id]).map((o) => ({
      ...o, history: parse(o.history_json as string), provider: this.provider(o.provider_id as string), simulated: Boolean(o.simulated), history_json: undefined,
    }));
    return {
      ...j,
      skills: parse(j.skills_json as string),
      completionConditions: parse(j.completion_conditions_json as string),
      budget_max_usd: isOwner ? j.budget_max_usd : undefined, // never shown to providers
      offers: isOwner ? offers : offers.filter((o) => (o.provider as { id: string }).id && this.db.get("SELECT 1 FROM providers WHERE id = ? AND owner_user_id = ?", [(o.provider as { id: string }).id, user.id])),
      skills_json: undefined, completion_conditions_json: undefined,
    };
  }

  listJobs(user: User) {
    return this.db.all("SELECT id, title, status, budget_max_usd, deadline, created_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC", [user.id]);
  }

  /** Open jobs matching a provider's skills, without budgets. */
  openJobsFor(user: User) {
    const mine = this.db.all<ProviderRow>("SELECT * FROM providers WHERE owner_user_id = ?", [user.id]);
    const skills = expand(mine.flatMap((p) => parse<string[]>(p.skills_json)));
    return this.db
      .all<Record<string, string>>("SELECT id, title, description, skills_json, deadline, status FROM jobs WHERE status IN ('open','offers')")
      .filter((j) => parse<string[]>(j.skills_json).some((s) => skills.has(s)))
      .map((j) => ({ ...j, skills: parse(j.skills_json), skills_json: undefined }));
  }

  private insertOffer(jobId: string, providerId: string, price: number, eta: number, message: string, simulated: boolean) {
    const id = randomId("ofr_");
    this.db.run(
      "INSERT INTO offers (id, job_id, provider_id, price_usd, eta_days, message, status, round, history_json, simulated, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, jobId, providerId, price, eta, message, "pending", 1, json([{ at: now(), by: "provider", priceUsd: price, message }]), simulated ? 1 : 0, now(), now()],
    );
    this.db.run("UPDATE jobs SET status = 'offers', updated_at = ? WHERE id = ? AND status = 'open'", [now(), jobId]);
    return id;
  }

  /** Requests competing offers from the best-matching providers. */
  async requestOffers(user: User, jobId: string, limit = 5) {
    const job = this.db.get<{ user_id: string; title: string; description: string; skills_json: string; budget_max_usd: number; deadline: string; status: string }>("SELECT * FROM jobs WHERE id = ?", [jobId]);
    if (!job || job.user_id !== user.id) throw notFound("job");
    if (!["open", "offers"].includes(job.status)) throw conflict("job_closed", `job is ${job.status}`);
    const candidates = this.search({ skills: parse(job.skills_json), maxPriceUsd: job.budget_max_usd }).filter((p) => p.availability !== "unavailable").slice(0, limit);
    const results = [];
    for (const c of candidates) {
      if (this.db.get("SELECT 1 FROM offers WHERE job_id = ? AND provider_id = ?", [jobId, c.id])) continue;
      const p = this.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ?", [c.id])!;
      const days = Math.max(1, Math.round((Date.parse(job.deadline) - Date.now()) / 86_400_000));
      if (p.demo) {
        const price = Math.round(p.base_price_usd * (0.9 + ((hash(p.id + jobId) % 30) / 100)));
        this.insertOffer(jobId, p.id, price, Math.min(days, 3 + (hash(p.id) % 7)), `[simulated demo offer] ${p.name} can deliver "${job.title}".`, true);
        results.push({ provider: c.name, status: "simulated_offer" });
      } else if (p.offer_endpoint) {
        try {
          const res = await this.fetcher(p.offer_endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "veyra.rfq/1", jobId, title: job.title, description: job.description, skills: parse(job.skills_json), deadline: job.deadline }),
            signal: AbortSignal.timeout(15_000),
          });
          const o = (await res.json()) as { priceUsd?: number; etaDays?: number; message?: string };
          if (typeof o.priceUsd !== "number" || !(o.priceUsd > 0)) throw new Error("invalid offer");
          this.insertOffer(jobId, p.id, o.priceUsd, Math.max(1, Math.round(o.etaDays ?? days)), String(o.message ?? "").slice(0, 500), false);
          results.push({ provider: c.name, status: "offer" });
        } catch (e) {
          results.push({ provider: c.name, status: "rfq_failed", error: e instanceof Error ? e.message : String(e) });
        }
      } else if (p.owner_user_id) {
        this.notifier.notify(p.owner_user_id, "wanted.rfq", "New job matches your skills", job.title, { jobId });
        results.push({ provider: c.name, status: "notified" });
      }
    }
    this.audit.record({ userId: user.id, actor: "agent", action: "job.offers_requested", subject: jobId, data: { results } });
    return { requested: results, job: this.job(user, jobId) };
  }

  /** A human provider responds to a job (or counters). */
  submitOffer(user: User, jobId: string, input: { providerId: string; priceUsd: number; etaDays: number; message: string }) {
    const p = this.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ?", [input.providerId]);
    if (!p || p.owner_user_id !== user.id) throw forbidden("not your provider profile");
    const job = this.db.get<{ status: string; user_id: string }>("SELECT status, user_id FROM jobs WHERE id = ?", [jobId]);
    if (!job || !["open", "offers"].includes(job.status)) throw conflict("job_closed", "job is not accepting offers");
    if (job.user_id === user.id) throw forbidden("you cannot bid on your own job");
    const existing = this.db.get<{ id: string; history_json: string; round: number }>("SELECT * FROM offers WHERE job_id = ? AND provider_id = ?", [jobId, p.id]);
    if (existing) {
      const history = [...parse<unknown[]>(existing.history_json), { at: now(), by: "provider", priceUsd: input.priceUsd, message: input.message }];
      this.db.run("UPDATE offers SET price_usd = ?, eta_days = ?, message = ?, status = 'pending', round = ?, history_json = ?, updated_at = ? WHERE id = ?", [input.priceUsd, input.etaDays, input.message, existing.round + 1, json(history), now(), existing.id]);
    } else this.insertOffer(jobId, p.id, input.priceUsd, input.etaDays, input.message, false);
    this.notifier.notify(job.user_id, "wanted.offer", "New offer", `${p.name} offered $${input.priceUsd}.`, { jobId });
    return { ok: true };
  }

  /**
   * One deterministic negotiation round over every pending offer above target. Target is 85%
   * of the budget; counters never exceed the budget. Simulated demo providers accept a counter
   * at or above their floor.
   */
  async negotiate(user: User, jobId: string) {
    const job = this.db.get<{ user_id: string; budget_max_usd: number; title: string }>("SELECT * FROM jobs WHERE id = ?", [jobId]);
    if (!job || job.user_id !== user.id) throw notFound("job");
    const target = Math.round(job.budget_max_usd * 0.85);
    const offers = this.db.all<{ id: string; provider_id: string; price_usd: number; round: number; history_json: string; simulated: number; status: string }>("SELECT * FROM offers WHERE job_id = ? AND status IN ('pending','countered')", [jobId]);
    const out = [];
    for (const o of offers) {
      if (o.price_usd <= target) { out.push({ offerId: o.id, action: "keep", priceUsd: o.price_usd }); continue; }
      if (o.round >= 3) { out.push({ offerId: o.id, action: "max_rounds" }); continue; }
      const counter = Math.min(job.budget_max_usd, Math.max(target, Math.round(o.price_usd * 0.9)));
      const history = parse<unknown[]>(o.history_json);
      history.push({ at: now(), by: "veyra", priceUsd: counter, message: `Counter-offer of $${counter}` });
      const p = this.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ?", [o.provider_id])!;
      let status = "countered";
      let price = o.price_usd;
      if (o.simulated) {
        const floor = p.min_price_usd ?? p.base_price_usd * 0.8;
        if (counter >= floor) { status = "pending"; price = counter; history.push({ at: now(), by: "provider", priceUsd: counter, message: "[simulated] Accepted the counter-offer" }); }
        else { const meet = Math.min(Math.round((o.price_usd + floor) / 2), o.price_usd); price = meet; status = "pending"; history.push({ at: now(), by: "provider", priceUsd: meet, message: "[simulated] Counter-counter" }); }
      } else if (p.offer_endpoint) {
        try {
          const res = await this.fetcher(p.offer_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "veyra.counter/1", jobId, offerId: o.id, counterPriceUsd: counter }), signal: AbortSignal.timeout(15_000) });
          const r = (await res.json()) as { accept?: boolean; priceUsd?: number };
          if (r.accept) { price = counter; status = "pending"; history.push({ at: now(), by: "provider", priceUsd: counter, message: "Accepted" }); }
          else if (typeof r.priceUsd === "number") { price = r.priceUsd; status = "pending"; history.push({ at: now(), by: "provider", priceUsd: r.priceUsd, message: "Counter" }); }
        } catch { /* provider unreachable: leave as countered */ }
      } else if (p.owner_user_id) this.notifier.notify(p.owner_user_id, "wanted.counter", "Counter-offer", `Veyra countered at $${counter} for "${job.title}".`, { jobId, offerId: o.id });
      this.db.run("UPDATE offers SET price_usd = ?, status = ?, round = round + 1, history_json = ?, updated_at = ? WHERE id = ?", [price, status, json(history), now(), o.id]);
      out.push({ offerId: o.id, action: "countered", counterUsd: counter, resultUsd: price, status });
    }
    this.audit.record({ userId: user.id, actor: "agent", action: "job.negotiated", subject: jobId, data: { target, out } });
    return { targetUsd: target, rounds: out, job: this.job(user, jobId) };
  }

  /** Ranks offers on price, reputation and ETA. Pure scoring; the user picks. */
  rankOffers(user: User, jobId: string) {
    const j = this.job(user, jobId) as unknown as { budget_max_usd: number; offers: { id: string; price_usd: number; eta_days: number; status: string; simulated: boolean; provider: { reputation: number } }[] };
    return j.offers
      .filter((o) => o.price_usd <= j.budget_max_usd && o.status !== "rejected")
      .map((o) => ({ offerId: o.id, score: Number(((1 - o.price_usd / j.budget_max_usd) * 40 + (o.provider.reputation / 100) * 45 + Math.max(0, 15 - o.eta_days)).toFixed(1)), ...o }))
      .sort((a, b) => b.score - a.score);
  }

  async select(user: User, jobId: string, offerId: string) {
    const job = this.db.get<{ user_id: string; budget_max_usd: number; status: string }>("SELECT * FROM jobs WHERE id = ?", [jobId]);
    if (!job || job.user_id !== user.id) throw notFound("job");
    const offer = this.db.get<{ id: string; provider_id: string; price_usd: number; eta_days: number }>("SELECT * FROM offers WHERE id = ? AND job_id = ?", [offerId, jobId]);
    if (!offer) throw notFound("offer");
    if (offer.price_usd > job.budget_max_usd) throw badRequest("over_budget", "offer exceeds the job budget");
    const p = this.db.get<ProviderRow>("SELECT * FROM providers WHERE id = ?", [offer.provider_id])!;
    const findings = await this.bodyguard.addressFindings(user.id, p.account_id, "near", null, "manual");
    if (findings.some((f) => f.severity === "block")) throw forbidden(`BODYGUARD: ${findings.filter((f) => f.severity === "block").map((f) => f.message).join(" ")}`);
    this.db.run("UPDATE offers SET status = CASE WHEN id = ? THEN 'accepted' ELSE 'rejected' END, updated_at = ? WHERE job_id = ?", [offerId, now(), jobId]);
    this.db.run("UPDATE jobs SET status = 'selected', selected_offer_id = ?, updated_at = ? WHERE id = ?", [offerId, now(), jobId]);
    this.audit.record({ userId: user.id, actor: "user", action: "job.provider_selected", subject: jobId, data: { offerId, provider: p.account_id, priceUsd: offer.price_usd } });
    return { offer, provider: this.publicProvider(p), securityFindings: findings };
  }

  markEscrowed(jobId: string, escrowId: string) {
    this.db.run("UPDATE jobs SET status = 'escrowed', escrow_ref = ?, updated_at = ? WHERE id = ?", [escrowId, now(), jobId]);
  }

  rate(user: User, jobId: string, rating: number) {
    const job = this.db.get<{ user_id: string; status: string; selected_offer_id: string }>("SELECT * FROM jobs WHERE id = ?", [jobId]);
    if (!job || job.user_id !== user.id) throw notFound("job");
    if (job.status !== "completed") throw conflict("not_completed", "only completed jobs can be rated");
    const offer = this.db.get<{ provider_id: string }>("SELECT provider_id FROM offers WHERE id = ?", [job.selected_offer_id])!;
    const r = Math.max(1, Math.min(5, Math.round(rating)));
    this.db.run("UPDATE providers SET rating = (rating * rating_count + ?) / (rating_count + 1), rating_count = rating_count + 1, completed_jobs = completed_jobs + 1 WHERE id = ?", [r, offer.provider_id]);
    this.db.run("UPDATE jobs SET status = 'rated', updated_at = ? WHERE id = ?", [now(), jobId]);
    return this.provider(offer.provider_id);
  }

  seedDemoProviders() {
    const demo: [string, "human" | "ai_agent", string, string, string[], number, number, number, number][] = [
      ["Ada Web Studio", "human", "ada-web.testnet", "Small-business websites with Next.js, delivered with source and hosting setup.", ["web-development", "design"], 140, 110, 4.8, 23],
      ["PixelForge Agent", "ai_agent", "pixelforge-agent.testnet", "Autonomous AI agent that generates and deploys landing pages from a brief.", ["web-development", "ai-automation"], 60, 45, 4.2, 57],
      ["Nordic Brand Co.", "human", "nordic-brand.testnet", "Logos and brand identity systems.", ["branding", "design"], 220, 180, 4.9, 41],
      ["Rustacean Labs", "human", "rustacean-labs.testnet", "NEAR smart contracts in Rust, with tests and audits.", ["smart-contracts", "security-audit"], 900, 750, 4.7, 12],
      ["Polyglot AI", "ai_agent", "polyglot-ai.testnet", "AI translation agent with human review, 40 languages.", ["translation", "writing"], 35, 25, 4.4, 130],
      ["Copy & Co", "human", "copyandco.testnet", "Website copy and blog content.", ["writing", "marketing"], 90, 70, 4.6, 66],
    ];
    for (const [name, kind, account, desc, skills, price, floor, rating, jobs] of demo) {
      if (this.db.get("SELECT 1 FROM providers WHERE account_id = ? AND demo = 1", [account])) continue;
      this.db.run(
        "INSERT INTO providers (id, kind, name, account_id, description, skills_json, base_price_usd, min_price_usd, rating, rating_count, completed_jobs, availability, demo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
        [randomId("prv_"), kind, `${name} (demo)`, account, desc, json(skills), price, floor, rating, Math.max(3, Math.round(jobs / 2)), jobs, "available", now()],
      );
    }
  }
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
