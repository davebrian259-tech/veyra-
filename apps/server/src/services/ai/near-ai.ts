import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { recoverMessageAddress } from "viem";

/**
 * NEAR AI Cloud — private inference in TEEs through an OpenAI-compatible gateway.
 *
 * Before a completion is used Veyra verifies, per https://docs.near.ai/cloud/verification:
 *   1. gateway + model attestation reports for a fresh client nonce
 *   2. each Intel TDX quote with Intel DCAP (via @phala/dcap-qvl, pure JS) and a TCB policy
 *   3. quote report_data binds the signing address and our nonce
 *   4. the RTMR3 event-log replay matches the quote, and MRCONFIGID matches app_compose
 *   5. the completion's response signature over exact request/response bytes, signed by the
 *      verified model (provider_tee) or gateway key
 *
 * What this proves: the request ran inside attested hardware/software with the measured
 * configuration. It does NOT prove the model's financial advice is correct or safe —
 * BODYGUARD and the Agent API policy remain the only authorisation for money movement.
 */

const require = createRequire(import.meta.url);
type Dcap = { getCollateralAndVerify: (q: Buffer) => Promise<{ status: string; advisory_ids: string[]; report: { asTd10(): TdReport | null; asTd15(): { base: TdReport } | null } }> };
interface TdReport { reportData: Uint8Array; rtMr3: Uint8Array; mrConfigId: Uint8Array; mrTd: Uint8Array; tdAttributes: Uint8Array }

const ACCEPTED_TCB = new Set(["UpToDate", "SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded"]);

export interface QuoteCheck {
  role: "gateway" | "model";
  signingAddress: string;
  signingAlgo: string;
  tcbStatus: string | null;
  advisoryIds: string[];
  checks: Record<string, boolean>;
  mrTd?: string;
  composeHash?: string;
  verified: boolean;
  error?: string;
}

export interface Attestation {
  model: string;
  nonce: string;
  fetchedAt: string;
  gateway: QuoteCheck | null;
  models: QuoteCheck[];
  verified: boolean;
}

export interface SignatureCheck {
  available: boolean;
  kind: string | null;
  signingAddress: string | null;
  textMatches: boolean;
  signerRecovered: string | null;
  matchesAttestation: boolean;
  verified: boolean;
  error?: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  chatId: string;
  requestHash: string;
  responseHash: string;
  attestation: Attestation;
  signature: SignatureCheck;
  verified: boolean;
}

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const strip0x = (s: string) => s.replace(/^0x/, "").toLowerCase();

export interface TdxEvent {
  imr: number | string;
  event_type: number | string;
  digest?: string;
  event?: string;
  event_payload?: string;
}

/**
 * RTMR3 replay per NEAR's reference: digest = SHA-384(u32le(event_type) || ":" || event ||
 * ":" || payload); a non-empty reported digest must equal it; RTMR3 = SHA-384(RTMR3 || digest).
 * Returns null when a reported digest disagrees with its recomputed value.
 */
export function replayRtmr3(eventLog: TdxEvent[]): string | null {
  let rtmr = Buffer.alloc(48);
  for (const e of eventLog) {
    if (Number(e.imr) !== 3) continue;
    const type = Buffer.alloc(4);
    type.writeUInt32LE(Number(e.event_type));
    const digest = createHash("sha384")
      .update(Buffer.concat([type, Buffer.from(":"), Buffer.from(e.event ?? "", "utf8"), Buffer.from(":"), Buffer.from(e.event_payload ?? "", "hex")]))
      .digest();
    if (e.digest && e.digest.toLowerCase() !== digest.toString("hex")) return null;
    rtmr = createHash("sha384").update(Buffer.concat([rtmr, digest])).digest();
  }
  return rtmr.toString("hex");
}

export class NearAiCloud {
  private cached?: { model: string; at: number; att: Attestation };

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl: string;
      model: string;
      requireSignature: boolean;
      fetch?: typeof fetch;
      /** Re-attest at most this often; every completion still checks its own signature. */
      attestationTtlMs?: number;
      dcap?: Dcap;
    },
  ) {}

  private get f() {
    return this.opts.fetch ?? fetch;
  }

  private dcap(): Dcap {
    return this.opts.dcap ?? (require("@phala/dcap-qvl") as Dcap);
  }

  async verifyQuote(role: "gateway" | "model", r: Record<string, unknown>, nonce: string): Promise<QuoteCheck> {
    const signingAddress = String(r.signing_address ?? "");
    const out: QuoteCheck = { role, signingAddress, signingAlgo: String(r.signing_algo ?? ""), tcbStatus: null, advisoryIds: [], checks: {}, verified: false };
    try {
      out.checks.nonceEchoed = String(r.request_nonce ?? "").toLowerCase() === nonce;
      const quoteHex = String(r.intel_quote ?? "");
      const verified = await this.dcap().getCollateralAndVerify(Buffer.from(quoteHex, "hex"));
      out.tcbStatus = verified.status;
      out.advisoryIds = verified.advisory_ids;
      out.checks.quoteSignatureValid = true;
      out.checks.tcbAccepted = ACCEPTED_TCB.has(verified.status);
      const td = verified.report.asTd10() ?? verified.report.asTd15()?.base ?? null;
      if (!td) throw new Error("not a TDX quote");
      out.mrTd = Buffer.from(td.mrTd).toString("hex");
      const reportData = Buffer.from(td.reportData).toString("hex");
      const expected = (strip0x(signingAddress).padEnd(64, "0") + nonce).toLowerCase();
      out.checks.reportDataBindsSignerAndNonce = reportData === expected;
      // TD attributes bit 0 is DEBUG: a debuggable TD offers no confidentiality.
      out.checks.notDebugMode = (td.tdAttributes[0] & 1) === 0;
      const log = typeof r.event_log === "string" ? JSON.parse(r.event_log) : (r.event_log as TdxEvent[]);
      out.checks.rtmr3Replayed = replayRtmr3(log) === Buffer.from(td.rtMr3).toString("hex");
      const info = (r.info ?? {}) as { tcb_info?: unknown };
      const tcb = typeof info.tcb_info === "string" ? JSON.parse(info.tcb_info) : (info.tcb_info as { app_compose?: string } | undefined);
      if (tcb?.app_compose) {
        const h = sha256(tcb.app_compose);
        out.composeHash = h;
        out.checks.mrConfigIdMatchesCompose = Buffer.from(td.mrConfigId).toString("hex") === `01${h}${"00".repeat(15)}`;
      }
      if (r.nvidia_payload) out.checks.gpuEvidenceAccepted = await this.verifyGpu(r.nvidia_payload, nonce);
      out.verified = Object.values(out.checks).every(Boolean);
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  /** NVIDIA GPU evidence through NRAS (only sent when the payload nonce matches ours). */
  async verifyGpu(payload: unknown, nonce: string): Promise<boolean> {
    try {
      const obj = (typeof payload === "string" ? JSON.parse(payload) : payload) as { nonce?: string };
      if (String(obj.nonce ?? "").toLowerCase() !== nonce) return false;
      const res = await this.f("https://nras.attestation.nvidia.com/v3/attest/gpu", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return false;
      const arr = (await res.json()) as [string, string][];
      const jwt = arr.find((e) => e[0] === "JWT")?.[1];
      if (!jwt) return false;
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      return claims["x-nvidia-overall-att-result"] === true;
    } catch {
      return false;
    }
  }

  async attest(model = this.opts.model): Promise<Attestation> {
    const ttl = this.opts.attestationTtlMs ?? 5 * 60_000;
    if (this.cached && this.cached.model === model && Date.now() - this.cached.at < ttl) return this.cached.att;
    const nonce = randomBytes(32).toString("hex");
    const url = new URL("/v1/attestation/report", this.opts.baseUrl);
    url.search = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", include_tls_fingerprint: "false", nonce }).toString();
    const res = await this.f(url, { headers: { accept: "application/json", "x-no-aliasing": "true", authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`attestation report: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { gateway_attestation?: Record<string, unknown>; model_attestations?: Record<string, unknown>[] };
    const gateway = body.gateway_attestation ? await this.verifyQuote("gateway", body.gateway_attestation, nonce) : null;
    const models = await Promise.all((body.model_attestations ?? []).map((m) => this.verifyQuote("model", m, nonce)));
    const att: Attestation = {
      model,
      nonce,
      fetchedAt: new Date().toISOString(),
      gateway,
      models,
      verified: Boolean(gateway?.verified) && models.length > 0 && models.every((m) => m.verified),
    };
    this.cached = { model, at: Date.now(), att };
    return att;
  }

  async chat(messages: { role: "system" | "user" | "assistant"; content: string }[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<CompletionResult> {
    const model = this.opts.model;
    const attestation = await this.attest(model);
    // Build the body once; the signature covers these exact bytes.
    const body = JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: opts.maxTokens ?? 1500,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    const res = await this.f(new URL("/v1/chat/completions", this.opts.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}`, "x-no-aliasing": "true", "accept-encoding": "identity" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`NEAR AI completion: HTTP ${res.status} ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(raw) as { id: string; choices: { message: { content: string } }[] };
    const requestHash = sha256(body);
    const responseHash = sha256(raw);
    const signature = await this.checkSignature(parsed.id, model, requestHash, responseHash, attestation);
    const verified = attestation.verified && signature.verified;
    if (this.opts.requireSignature && !verified) throw new Error("NEAR AI response could not be verified; refusing to use it");
    return { content: parsed.choices[0]?.message?.content ?? "", model, chatId: parsed.id, requestHash, responseHash, attestation, signature, verified };
  }

  async checkSignature(chatId: string, model: string, requestHash: string, responseHash: string, att: Attestation): Promise<SignatureCheck> {
    const out: SignatureCheck = { available: false, kind: null, signingAddress: null, textMatches: false, signerRecovered: null, matchesAttestation: false, verified: false };
    const url = new URL(`/v1/signature/${encodeURIComponent(chatId)}`, this.opts.baseUrl);
    url.searchParams.set("signing_algo", "ecdsa");
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.f(url, { headers: { accept: "application/json", authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (res?.status === 404 || !res) {
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
        continue;
      }
      const s = (await res.json()) as { text?: string; signature?: string; signing_address?: string; signature_kind?: string; error_code?: string };
      if (!s.signature || !s.text || s.error_code) {
        out.error = s.error_code ?? "signature unavailable";
        return out;
      }
      out.available = true;
      out.kind = s.signature_kind ?? null;
      out.signingAddress = s.signing_address ?? null;
      const expected = out.kind === "provider_tee" ? `${model}:${requestHash}:${responseHash}` : out.kind === "gateway" ? `${requestHash}:${responseHash}` : null;
      out.textMatches = expected !== null && s.text === expected;
      try {
        out.signerRecovered = (await recoverMessageAddress({ message: s.text, signature: s.signature as `0x${string}` })).toLowerCase();
      } catch (e) {
        out.error = `recover failed: ${e instanceof Error ? e.message : e}`;
      }
      const candidates = out.kind === "provider_tee" ? att.models.filter((m) => m.verified) : out.kind === "gateway" && att.gateway?.verified ? [att.gateway] : [];
      const matching = candidates.filter((c) => c.signingAddress.toLowerCase() === out.signerRecovered && c.signingAlgo === "ecdsa");
      out.matchesAttestation = matching.length === 1;
      out.verified = out.textMatches && out.signerRecovered === out.signingAddress?.toLowerCase() && out.matchesAttestation;
      return out;
    }
    out.error = "signature not found";
    return out;
  }
}
