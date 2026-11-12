import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Alert02Icon, Cancel01Icon, CheckmarkCircle02Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./brand";
import { describeError } from "./lib/data";

/* ------------------------------------------------------------------ buttons */
type BtnVariant = "default" | "primary" | "accent" | "danger" | "ghost";
export function Button({ children, variant = "default", size, loading, icon, className, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "lg"; loading?: boolean; icon?: boolean }) {
  return (
    <button type={type} className={["btn", variant !== "default" ? variant : "", size ?? "", loading ? "loading" : "", icon ? "icon" : "", className ?? ""].join(" ").trim()} aria-busy={loading || undefined} disabled={rest.disabled || loading} {...rest}>
      {children}
    </button>
  );
}

/** Runs an async action with a busy state and a toast on failure. Returns the result or undefined. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, opts: { success?: string } = {}): Promise<T | undefined> => {
    setBusy(label);
    try {
      const r = await fn();
      if (opts.success) toast.show(opts.success);
      return r;
    } catch (e) {
      toast.show(describeError(e), "bad");
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { run, busy };
}

/* ------------------------------------------------------------------ forms */
export function Field({ label, value, onChange, placeholder, textarea, hint, error, type = "text", inputMode, disabled, rows }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean; hint?: string; error?: string | null; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; disabled?: boolean; rows?: number;
}) {
  const id = useId();
  const describe = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <label htmlFor={id}>{label}</label>
      {textarea
        ? <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows ?? 4} aria-describedby={describe} aria-invalid={Boolean(error) || undefined} disabled={disabled} />
        : <input id={id} type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-describedby={describe} aria-invalid={Boolean(error) || undefined} disabled={disabled} />}
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="err" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

export function Select({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{children}</select>
    </div>
  );
}

/* ------------------------------------------------------------------ layout */
export function Card({ title, note, actions, children, className }: { title?: string; note?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`} aria-label={title}>
      {(title || actions) && (
        <div className="card-head">
          <div>{title && <h2>{title}</h2>}{note && <p>{note}</p>}</div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "accent" | "danger" | "good" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function Pill({ tone, children, title }: { tone?: "good" | "warn" | "bad" | "accent"; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone ?? ""}`} title={title}>{children}</span>;
}

export const statusTone = (s: string): "good" | "warn" | "bad" | undefined =>
  /delivered|ok|passed|settled|paid|anchored|completed|running|free/.test(s) ? "good" : /failed|flagged|blocked|void|abandoned|frozen/.test(s) ? "bad" : /warn|held|pending|locked|active/.test(s) ? "warn" : undefined;

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="alert bad" role="alert">
      <Icon icon={Alert02Icon} size={18} />
      <div style={{ flex: 1 }}>
        <pre>{message}</pre>
      </div>
      {retry && <Button size="sm" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function Note({ tone, children }: { tone?: "good" | "warn" | "bad"; children: ReactNode }) {
  return <div className={`alert ${tone ?? ""}`} role={tone === "bad" ? "alert" : undefined}><Icon icon={tone === "good" ? CheckmarkCircle02Icon : Alert02Icon} size={18} /><div style={{ flex: 1 }}>{children}</div></div>;
}

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: height ?? 16, width: `${100 - (i % 3) * 18}%` }} />)}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Bars({ rows, tone, max }: { rows: { label: string; value: number; display?: string; tone?: "accent" | "bad" }[]; tone?: "accent" | "bad"; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar" key={r.label}>
          <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div className="track" role="img" aria-label={`${r.label}: ${r.display ?? r.value}`}><div className={`fill ${r.tone ?? tone ?? ""}`} style={{ width: `${(r.value / m) * 100}%` }} /></div>
          <span className="n">{r.display ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" aria-label={done ? "Copied" : label} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      <Icon icon={done ? Tick02Icon : Copy01Icon} size={15} /> {done ? "Copied" : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ toasts */
interface Toast { id: number; text: string; tone?: "bad" }
const ToastCtx = createContext<{ show: (text: string, tone?: "bad") => void }>({ show: () => undefined });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const n = useRef(0);
  const show = useCallback((text: string, tone?: "bad") => {
    const id = ++n.current;
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "bad" ? 9000 : 4000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toaster" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ""}`} role={t.tone === "bad" ? "alert" : "status"}>
            <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{t.text}</span>
            <button className="btn ghost sm icon" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}><Icon icon={Cancel01Icon} size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ confirm dialog */
export function Confirm({ open, onOpenChange, title, body, confirmLabel, danger, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
          <Dialog.Description asChild><div>{body}</div></Dialog.Description>
          <div className="btn-row">
            <Dialog.Close asChild><Button>Keep as is</Button></Dialog.Close>
            <Button variant={danger ? "danger" : "primary"} onClick={() => { onConfirm(); onOpenChange(false); }}>{confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Promise-based confirm, so flows that used window.confirm keep their shape. */
const ConfirmCtx = createContext<(o: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean }) => Promise<boolean>>(async () => true);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirmLabel: string; danger?: boolean; resolve: (b: boolean) => void } | null>(null);
  const ask = useCallback((o: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  useEffect(() => { confirmBridge.ask = ask; }, [ask]);
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && <Confirm open onOpenChange={(o) => { if (!o) { state.resolve(false); setState(null); } }} title={state.title} body={state.body} confirmLabel={state.confirmLabel} danger={state.danger} onConfirm={() => { state.resolve(true); setState(null); }} />}
    </ConfirmCtx.Provider>
  );
}
/** Lets non-React code (flows.ts) ask for confirmation through the same dialog. */
export const confirmBridge: { ask: (o: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean }) => Promise<boolean> } = { ask: async () => true };

export const toYocto = (near: string) => {
  const [w, f = ""] = near.trim().split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24) || "0")).toString();
};
