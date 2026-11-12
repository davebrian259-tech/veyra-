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
  const res = await fetch(target, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual" });
  const out = new Headers(res.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, headers: out });
};
