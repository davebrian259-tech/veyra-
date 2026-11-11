import { useState, type ReactNode } from "react";
import { ApiError } from "./api";

/** Shared building blocks; the look lives in styles.css. */

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {note && <p className="note">{note}</p>}
      {children}
    </section>
  );
}

export function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      setResult(r);
      return r;
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.code}: ${e.message}${e.details ? `\n${JSON.stringify(e.details, null, 2)}` : ""}` : e instanceof Error ? e.message : String(e);
      setError(msg);
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  const view = (
    <div className="result">
      {busy && <p className="busy">{busy}…</p>}
      {error && <pre className="error">{error}</pre>}
      <Json value={result} />
    </div>
  );
  return { run, busy, result, setResult, error, view };
}

export function Field({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      {textarea ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} /> : <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </label>
  );
}

export function Btn({ onClick, children, disabled, danger, primary }: { onClick: () => void; children: ReactNode; disabled?: boolean; danger?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={danger ? "danger" : primary ? "btn-dark" : undefined}>
      {children}
    </button>
  );
}

export const toYocto = (near: string) => {
  const [w, f = ""] = near.trim().split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24) || "0")).toString();
};
