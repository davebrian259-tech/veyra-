# Deploying Veyra

Veyra has two parts. The console is static files and runs on Cloudflare Pages for free. The
server is a long-running Node process with a SQLite database and a scheduler, so it cannot run
inside a Cloudflare Worker. Run it on a machine you control and reach it through a Cloudflare
Tunnel, which is also free. The Pages Function at `apps/web/functions/api/[[path]].ts` proxies
`/api/*` to the server, so the browser talks to one origin and the session cookie stays
first-party.

```
browser ── https://veyra.pages.dev ──▶ Cloudflare Pages (static console)
                                        └─ /api/* ──▶ Pages Function ──▶ API_ORIGIN
                                                                           │
                                     https://api.<your-domain> (Cloudflare Tunnel)
                                                                           │
                                                          your machine: pnpm dev:server
```

## 1. The server, on your machine, behind a tunnel

Install cloudflared on WSL, log in, and create a tunnel:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
```

```bash
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared
```

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create veyra
```

Point a hostname at it (needs a domain on Cloudflare; a free one from the dashboard works):

```bash
cloudflared tunnel route dns veyra api.yourdomain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: veyra
credentials-file: /home/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

Start the server and the tunnel in two terminals:

```bash
cd apps/server && cp .env.example .env && PUBLIC_API_URL=https://api.yourdomain.com PUBLIC_WEB_ORIGIN=https://veyra.pages.dev pnpm dev
```

```bash
cloudflared tunnel run veyra
```

Without a domain, a quick tunnel gives a temporary `trycloudflare.com` URL:

```bash
cloudflared tunnel --url http://localhost:8787
```

Set these in `apps/server/.env` for a public deployment:

- `VEYRA_ENCRYPTION_KEY`: 32 random bytes as hex. Required outside development.
- `PUBLIC_API_URL`: the tunnel hostname, so the KYA credential and agent card name the right endpoints.
- `PUBLIC_WEB_ORIGIN`: the Pages URL, for CORS on direct API calls.
- `NODE_ENV=production`: makes the session cookie `Secure`.

## 2. The console, on Cloudflare Pages

Build and deploy from `apps/web`:

```bash
pnpm --filter @veyra/web build
```

```bash
cd apps/web && pnpm dlx wrangler login
```

```bash
pnpm dlx wrangler pages deploy dist --project-name veyra
```

Then set `API_ORIGIN` to the tunnel URL in the Pages project (Settings → Variables and
secrets), or from the terminal:

```bash
pnpm dlx wrangler pages secret put API_ORIGIN --project-name veyra
```

Redeploy after changing it. For continuous deployment, connect the GitHub repository in the
Pages dashboard with build command `pnpm --filter @veyra/web build` and output directory
`apps/web/dist`; `wrangler.jsonc` carries the rest.

## 3. Alternatives for the server

`Dockerfile` at the repository root builds the server image. It runs on Fly.io, Railway,
Render or any VPS with a persistent volume at `/data`. Put the Pages Function's `API_ORIGIN`
at that URL instead of the tunnel.

## What to check after deploying

- `https://<pages>/api/config` returns the mode and integrations.
- `https://<pages>/api/.well-known/agent-card.json` names `PUBLIC_API_URL` endpoints.
- Sign in from the console. In live mode the wallet signs a NEP-413 message; the cookie is set
  by the proxied response.
- `claude mcp add --transport http veyra https://api.yourdomain.com/mcp` from any machine.
