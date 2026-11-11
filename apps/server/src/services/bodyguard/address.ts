import { isAddress } from "viem";

/** Well-known NEAR accounts that scammers imitate. */
export const WELL_KNOWN_NEAR = [
  "wrap.near",
  "usdt.tether-token.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "intents.near",
  "v1.signer",
  "aurora",
  "token.sweat",
  "meta-pool.near",
  "linear-protocol.near",
  "ref-finance.near",
  "v2.ref-finance.near",
  "wrap.testnet",
  "v1.signer-prod.testnet",
];

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Collapses visually confusable characters so "wrap.neаr"/"wr4p.near"/"vvrap.near" compare equal. */
export function skeleton(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[а]/g, "a")
    .replace(/[е]/g, "e")
    .replace(/[о0]/g, "o")
    .replace(/[р]/g, "p")
    .replace(/[с]/g, "c")
    .replace(/[у]/g, "y")
    .replace(/[х]/g, "x")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[1il|]/g, "l")
    .replace(/[5]/g, "s")
    .replace(/[4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[_-]/g, "");
}

/**
 * Returns the trusted address this one imitates, if any. An exact match is not a lookalike.
 * Short names are compared strictly to avoid flagging unrelated accounts.
 */
export function findLookalike(candidate: string, trusted: string[]): string | null {
  const c = candidate.toLowerCase();
  for (const t of trusted) {
    const tl = t.toLowerCase();
    if (c === tl) return null;
  }
  for (const t of trusted) {
    const tl = t.toLowerCase();
    if (skeleton(c) === skeleton(tl)) return t;
    const d = levenshtein(c, tl);
    const threshold = tl.length >= 12 ? 2 : tl.length >= 6 ? 1 : 0;
    if (d > 0 && d <= threshold) return t;
    // Same name with a different top-level suffix: wrap.near vs wrap.near.io / wrapnear.near
    if (c.replace(/\./g, "") === tl.replace(/\./g, "")) return t;
  }
  return null;
}

export type AddressKind = "near_named" | "near_implicit" | "evm" | "unknown";

const NEAR_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function classifyAddress(addr: string): AddressKind {
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return "evm";
  if (/^[0-9a-f]{64}$/.test(addr)) return "near_implicit";
  if (addr.length >= 2 && addr.length <= 64 && NEAR_RE.test(addr)) return "near_named";
  return "unknown";
}

export function validateForChain(chain: string, addr: string): string | null {
  const evmChains = ["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "bera", "monad", "xlayer", "hood"];
  if (chain === "near") {
    const k = classifyAddress(addr);
    return k === "near_named" || k === "near_implicit" ? null : "not a valid NEAR account id";
  }
  if (evmChains.includes(chain)) return isAddress(addr, { strict: false }) ? null : "not a valid EVM address";
  return null; // other chains are validated by the Agent API / 1Click preview
}
