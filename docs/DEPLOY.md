# Deploying Veyra from the Cloudflare dashboard

Veyra has two parts.

- **The console** is static files. It runs on Cloudflare Pages, free, deployed from GitHub.
- **The server** is a Node process with a SQLite database and a scheduler. It cannot run inside
  a Cloudflare Worker, so it runs on your machine (WSL) and Cloudflare reaches it through a
  Cloudflare Tunnel, also free. A Pages Function in the repo proxies `/api/*` to the tunnel, so
  the browser talks to one origin and the session cookie stays first-party.

```
browser ──▶ https://veyra.pages.dev  (Pages: static console + /api proxy)
                                     └──▶ API_ORIGIN = https://api.<your-domain>  (Tunnel)
                                                                     └──▶ WSL: pnpm dev:server on :8787
```

Everything below is done in the browser except two pasted commands: starting the server and
installing the tunnel connector.

## Part 1: the server on WSL

1. In WSL, from the repository root, start the server and leave the terminal open:

```bash
cd apps/server && cp -n .env.example .env; pnpm dev
```

2. Check it answers: open http://localhost:8787/config in Windows. You should see JSON with
   `"mode": "sim"`.

## Part 2: the tunnel (Cloudflare dashboard)

1. Go to **dash.cloudflare.com** → **Zero Trust** (left menu). The first visit asks you to pick
   a team name and the **Free** plan.
2. **Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `veyra`. Save.
3. On the **Install and run a connector** page, choose **Debian / 64-bit**. Copy the single
   command it shows (it starts with `curl -L --output cloudflared.deb …` and ends with
   `cloudflared service install <token>`). Paste it into a second WSL terminal. The page shows
   the connector as **Connected** within a minute.
4. **Next** → **Public hostname**:
   - **Subdomain:** `api`. **Domain:** pick one of yours. If you have none, buy or transfer one
     under **Domain Registration**, or use a free quick tunnel (step 6).
   - **Type:** `HTTP`. **URL:** `localhost:8787`.
   - Save the tunnel.
5. Open `https://api.<your-domain>/config` in a browser. The same JSON as before means the
   tunnel works. That URL is your **API_ORIGIN**.
6. No domain? Run `cloudflared tunnel --url http://localhost:8787` in WSL instead of steps
   2–4. It prints a temporary `https://….trycloudflare.com` URL. Use that as `API_ORIGIN`; it
   changes each time you restart it.

## Part 3: the console on Pages (Cloudflare dashboard)

1. **Workers & Pages → Create → Pages → Connect to Git**. Authorise GitHub and choose the
   `veyra-` repository.
2. **Set up builds and deployments**:
   - **Production branch:** `claude/ecstatic-allen-5p20bs` (or `main` once merged).
   - **Framework preset:** None.
   - **Build command:** `pnpm install && pnpm build`
   - **Build output directory:** `dist`
   - **Root directory (advanced):** `apps/web`
   - **Environment variables (advanced):** add
     - `NODE_VERSION` = `22`
     - `SKIP_DEPENDENCY_INSTALL` = `true`
     - `API_ORIGIN` = the URL from Part 2, for example `https://api.yourdomain.com`
3. **Save and Deploy**. The first build takes two to three minutes. The site is at
   `https://veyra-<something>.pages.dev`; rename the project under **Settings** if you like.
4. Open the site. The landing page loads from Pages; **Enter the simulator** calls
   `/api/sim/session`, which the Pages Function forwards to your tunnel. The dot matrix shows
   your server's latest Watchtower scan once one has run.

Every push to the production branch redeploys the console. The server picks up changes when
you restart `pnpm dev`.

## Part 4: make the server public-ready

Set these in `apps/server/.env`, then restart `pnpm dev`:

- `VEYRA_ENCRYPTION_KEY`: 32 random bytes as hex. Generate one in WSL with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `PUBLIC_API_URL`: the API URL from Part 2, so the KYA credential and agent card name the
  public endpoints.
- `PUBLIC_WEB_ORIGIN`: the Pages URL, for CORS on direct API calls.
- `NODE_ENV=production`: makes the session cookie `Secure`. The dev command still works.

## What to check

- `https://<pages>/api/config` returns the mode and integrations.
- `https://<pages>/api/.well-known/agent-card.json` names your public API URL.
- `claude mcp add --transport http veyra https://api.<your-domain>/mcp` works from any machine.
- In the Pages dashboard, **Functions** shows invocations for `/api/*`.

## Alternatives

- Terminal deploy of the console: `pnpm deploy:web` (uses Wrangler; log in once with
  `pnpm --filter @veyra/web exec wrangler login`).
- Hosting the server elsewhere: `Dockerfile` at the repository root builds it for Fly.io,
  Railway, Render or a VPS. Mount a volume at `/data` and point `API_ORIGIN` at that host.
