import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const randomId = (prefix = "") => `${prefix}${randomBytes(12).toString("base64url")}`;
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Deterministic JSON (sorted keys) for hashing agreements, policies and requests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export const hashObject = (v: unknown) => `sha256:${sha256Hex(canonicalJson(v))}`;

function decodeKey(raw: string): Buffer {
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  if (buf.length !== 32) throw new Error("encryption key must be 32 bytes (64 hex chars or base64)");
  return buf;
}

/**
 * AES-256-GCM envelope for secrets at rest (grant tokens). The AAD binds each ciphertext to its
 * context (e.g. the agent id) so a ciphertext cannot be swapped onto another record.
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    this.key = key;
  }

  static fromConfig(opts: { key?: string; production: boolean; devKeyPath: string }): SecretBox {
    if (opts.key) return new SecretBox(decodeKey(opts.key));
    if (opts.production) throw new Error("VEYRA_ENCRYPTION_KEY is required in production");
    // Development only: persist a local key so encrypted grants survive restarts.
    if (opts.devKeyPath === ":memory:") return new SecretBox(randomBytes(32));
    if (!existsSync(opts.devKeyPath)) {
      mkdirSync(dirname(opts.devKeyPath), { recursive: true });
      writeFileSync(opts.devKeyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
      console.warn(`[veyra] generated development encryption key at ${opts.devKeyPath}`);
    }
    return new SecretBox(decodeKey(readFileSync(opts.devKeyPath, "utf8")));
  }

  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
  }

  open(sealed: string, aad: string): string {
    const [v, iv, tag, ct] = sealed.split(":");
    if (v !== "v1") throw new Error("unknown secret format");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  }

  hmac(data: string): string {
    return createHmac("sha256", this.key).update(data).digest("base64url");
  }
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
