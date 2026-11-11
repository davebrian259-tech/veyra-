import type { Db } from "../../db.js";
import { json, now } from "../../db.js";
import { randomId, sha256Hex } from "../../lib/crypto.js";
import { redact } from "../audit.js";
import type { NearAiCloud } from "./near-ai.js";

export type Privacy = "private" | "standard";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AiResult {
  content: string;
  provider: "near-ai-cloud" | "standard" | "none";
  model: string | null;
  verified: boolean;
  runId: string;
}

/** Ordinary OpenAI-compatible provider — only ever used for non-sensitive tasks. */
export class StandardAi {
  constructor(private readonly opts: { apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch }) {}
  async chat(messages: ChatMessage[], o: { json?: boolean } = {}) {
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({ model: this.opts.model, messages, temperature: 0.2, ...(o.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return body.choices[0]?.message?.content ?? "";
  }
}

const FORBIDDEN_IN_PROMPT = [/ngt_[A-Za-z0-9_-]{8,}/, /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/, /secp256k1:[1-9A-HJ-NP-Za-km-z]{80,}/];

/**
 * Routes each AI task by sensitivity:
 *   private  → NEAR AI Cloud (TEE, attested) or nothing; never an ordinary provider
 *   standard → ordinary provider if configured, otherwise NEAR AI Cloud
 * When no suitable model is configured the caller uses its deterministic fallback and labels
 * the result as such. Every run is recorded with hashes and verification results.
 */
export class AiRouter {
  constructor(private readonly db: Db, private readonly nearAi: NearAiCloud | null, private readonly standard: StandardAi | null) {}

  available(privacy: Privacy) {
    return privacy === "private" ? Boolean(this.nearAi) : Boolean(this.standard ?? this.nearAi);
  }

  /** Last line of defence: refuse prompts that contain anything key-shaped. */
  static assertNoSecrets(messages: ChatMessage[]) {
    for (const m of messages) for (const p of FORBIDDEN_IN_PROMPT) if (p.test(m.content)) throw new Error("refusing to send credential-like material to an AI model");
  }

  async complete(task: string, privacy: Privacy, messages: ChatMessage[], userId: string | null, o: { json?: boolean } = {}): Promise<AiResult | null> {
    AiRouter.assertNoSecrets(messages);
    const runId = randomId("air_");
    const started = Date.now();
    const useNear = privacy === "private" ? this.nearAi : this.standard ? null : this.nearAi;
    const useStd = privacy === "standard" ? this.standard : null;
    if (!useNear && !useStd) return null;
    try {
      if (useNear) {
        const r = await useNear.chat(messages, { json: o.json });
        this.db.run(
          "INSERT INTO ai_runs (id, user_id, task, privacy, provider, model, request_hash, response_hash, attestation_json, signature_json, verified, latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [runId, userId, task, privacy, "near-ai-cloud", r.model, r.requestHash, r.responseHash, json(r.attestation), json(r.signature), r.verified ? 1 : 0, Date.now() - started, now()],
        );
        return { content: r.content, provider: "near-ai-cloud", model: r.model, verified: r.verified, runId };
      }
      const content = await useStd!.chat(messages, o);
      this.db.run(
        "INSERT INTO ai_runs (id, user_id, task, privacy, provider, model, request_hash, response_hash, verified, latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)",
        [runId, userId, task, privacy, "standard", null, sha256Hex(JSON.stringify(messages)), sha256Hex(content), Date.now() - started, now()],
      );
      return { content, provider: "standard", model: null, verified: false, runId };
    } catch (e) {
      this.db.run("INSERT INTO ai_runs (id, user_id, task, privacy, provider, verified, latency_ms, error, created_at) VALUES (?,?,?,?,?,0,?,?,?)", [
        runId, userId, task, privacy, useNear ? "near-ai-cloud" : "standard", Date.now() - started, String(e instanceof Error ? e.message : e), now(),
      ]);
      return null;
    }
  }

  runs(userId: string, limit = 50) {
    return this.db.all("SELECT * FROM ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, limit]).map((r) => redact(r));
  }
}
