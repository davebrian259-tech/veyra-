import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import snapshot from "../game/snapshot.json";

/**
 * A small stale-while-revalidate cache for GET requests. Pages render instantly from the last
 * value, refetch in the background, and share one in-flight request per path. `prefetch`
 * warms a page before navigation.
 */
const cache = new Map<string, { value: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
// The vaults and their shields are fixed, so the game renders at once from this and swaps in live numbers.
cache.set("/heist", { value: snapshot, at: 0 });

function notify(path: string) {
  for (const fn of listeners.get(path) ?? []) fn();
}

export function fetchCached<T>(path: string, maxAgeMs = 0): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.value as T);
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = api<T>(path)
    .then((v) => {
      cache.set(path, { value: v, at: Date.now() });
      notify(path);
      return v;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function prefetch(path: string) {
  void fetchCached(path, 5_000).catch(() => undefined);
}

export function invalidate(prefix: string) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
  for (const k of listeners.keys()) if (k.startsWith(prefix)) notify(k);
}

export const describeError = (e: unknown) =>
  e instanceof ApiError ? `${e.message}${e.details ? `\n${JSON.stringify(e.details, null, 2)}` : ""}` : e instanceof Error ? e.message : String(e);

/** Reads a GET endpoint with cache, optional polling, and a manual `reload`. `path` null disables it. */
export function useApi<T = any>(path: string | null, opts: { every?: number; maxAge?: number } = {}) {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path)?.value as T | undefined) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(path) && !(path && cache.has(path)));
  const alive = useRef(true);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(async () => {
    if (!path) return;
    clearTimeout(retry.current);
    try {
      const v = await fetchCached<T>(path, opts.maxAge ?? 0);
      if (alive.current) { setData(v); setError(null); }
    } catch (e) {
      if (alive.current) { setError(describeError(e)); retry.current = setTimeout(() => void reload(), 6_000); }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path, opts.maxAge]);

  useEffect(() => {
    alive.current = true;
    if (!path) return;
    const hit = cache.get(path);
    if (hit) { setData(hit.value as T); setLoading(false); }
    else setLoading(true);
    const fn = () => { const h = cache.get(path); if (h && alive.current) setData(h.value as T); };
    const set = listeners.get(path) ?? new Set();
    set.add(fn);
    listeners.set(path, set);
    void reload();
    const t = opts.every ? setInterval(() => { if (document.visibilityState === "visible") void reload(); }, opts.every) : undefined;
    return () => { alive.current = false; clearTimeout(retry.current); set.delete(fn); if (t) clearInterval(t); };
  }, [path, opts.every, reload]);

  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const usd = (atomic: string | number | bigint | null | undefined, digits = 2) =>
  atomic === null || atomic === undefined ? "—" : (Number(BigInt(String(atomic))) / 1e6).toFixed(digits);
export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));
export const shortId = (s: string | null | undefined, n = 12) => (s ? (s.length > n + 3 ? `${s.slice(0, n)}…` : s) : "—");
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
