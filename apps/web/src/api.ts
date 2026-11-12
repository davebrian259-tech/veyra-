/** Thin client for the Veyra backend (proxied at /api; session cookie is httpOnly). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page instead of JSON: a host or proxy answered, not the Veyra server.
    const why = res.status === 502 || res.status === 503 || res.status === 504
      ? "The Veyra server is not running or is still starting."
      : "Something other than the Veyra server answered.";
    throw new ApiError(res.status, "server_unreachable", `${why} (HTTP ${res.status} on ${path}.) If it is hosted on Render, open the service and check that the latest deploy says Live; a free instance can take a minute to wake up.`);
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? res.statusText, data?.details ?? data?.issues);
  return data as T;
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
