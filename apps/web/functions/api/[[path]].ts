/**
 * Cloudflare Pages Function: proxies /api/* to the Veyra server, so the console and the API
 * share one origin and the session cookie stays first-party. Set API_ORIGIN on the Pages
 * project (for example the public URL of a Cloudflare Tunnel that reaches `pnpm dev:server`).
 */
interface Env {
  API_ORIGIN: string;
}

export const onRequest = async (context: { request: Request; env: Env; params: { path?: string[] } }) => {
  const { request, env } = context;
  if (!env.API_ORIGIN) return new Response(JSON.stringify({ error: "not_configured", message: "Set API_ORIGIN on the Pages project." }), { status: 503, headers: { "content-type": "application/json" } });
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname.replace(/^\/api/, "") + incoming.search, env.API_ORIGIN.replace(/\/$/, "") + "/");
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  headers.delete("host");
  // the visitor's own address, so per-player limits are not shared by everyone behind this proxy
  const client = request.headers.get("cf-connecting-ip");
  if (client) { headers.set("x-veyra-client-ip", client); headers.set("x-forwarded-for", client); }
  const read = request.method === "GET" || request.method === "HEAD";
  // A free Render instance answers 502/503 while it boots; ride that out here for reads.
  let res: Response | null = null;
  for (let attempt = 0; attempt < (read ? 6 : 1); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 6000)));
    try {
      res = await fetch(target, { method: request.method, headers, body: read ? undefined : request.body, redirect: "manual" });
    } catch {
      res = null;
      continue;
    }
    if (!read || ![502, 503, 504].includes(res.status)) break;
  }
  if (!res) return new Response(JSON.stringify({ error: "waking", message: "Veyra is waking up." }), { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } });
  const out = new Headers(res.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, headers: out });
};
