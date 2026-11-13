/** Thin client for the Veyra backend (proxied at /api; session cookie is httpOnly). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (status: number) => status === 0 || status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;

/**
 * Reads retry quietly while the server wakes up (a free host can take a while), so a cold start
 * shows a loading state instead of an error. Writes are sent once.
 */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const delays = method === "GET" ? [800, 1600, 3000, 5000, 8000] : [];
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let text = "";
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: init.body !== undefined ? { "content-type": "application/json" } : {},
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        credentials: "same-origin",
      });
      text = await res.text();
    } catch {
      res = null;
    }
    let data: any = null;
    let json = true;
    try { data = text ? JSON.parse(text) : null; } catch { json = false; }
    const status = res?.status ?? 0;
    if ((!res || !json || transient(status)) && attempt < delays.length) { await wait(delays[attempt]!); continue; }
    if (!res || !json) throw new ApiError(status, "server_unreachable", "Veyra is waking up. Try again in a moment.");
    if (!res.ok) throw new ApiError(status, data?.error ?? "error", data?.message ?? res.statusText, data?.details ?? data?.issues);
    return data as T;
  }
}

export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export interface WalletTx {
  receiverId: string;
  actions: { type: string; params: Record<string, unknown> }[];
}

export interface OwnerIntent {
  correlationId: string;
  type: string;
  agentId: string;
  intent: { standard: "nep413" | "nep366" | "eip712" | "webauthn"; payload: any };
  preview: { summary: string; policy?: unknown };
  riskNotice: string;
  policySummary?: string[];
}
