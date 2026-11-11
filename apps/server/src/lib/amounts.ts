/** Atomic-unit helpers. Amounts are always strings of integers in the token's smallest unit. */
export function toAtomic(decimal: string | number, decimals: number): string {
  const s = typeof decimal === "number" ? decimal.toFixed(Math.min(decimals, 18)) : decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${s}`);
  const [whole, frac = ""] = s.split(".");
  const f = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(f || "0")).toString();
}

export function fromAtomic(atomic: string | bigint, decimals: number): string {
  const v = BigInt(atomic);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function atomicToUsd(atomic: string, decimals: number, price: number | null | undefined): number | null {
  if (price == null) return null;
  return Number(fromAtomic(atomic, decimals)) * price;
}

export function usdToAtomic(usd: number, decimals: number, price: number): string {
  if (!(price > 0)) throw new Error("price unavailable");
  const units = usd / price;
  return toAtomic(units.toFixed(Math.min(decimals, 12)), decimals);
}

export const YOCTO = 24;
