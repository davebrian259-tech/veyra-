# Putting Veyra online

This guide gets Veyra running on the internet for free, using only web dashboards. You do
not need to install anything. Budget about 25 minutes. You will need a GitHub account with
access to the `veyra-` repository, a Cloudflare account, and a Render account. All three are
free to create.

## What you are setting up

Veyra is two things:

- **The console**, the website people see. It is a set of static files, so it lives on
  **Cloudflare Pages**.
- **The server**, the program that does the work. It needs to run all the time, which
  Cloudflare Pages cannot do, so it lives on **Render**.

The console calls the server through a small forwarder that is already in the repository.
You connect the two by pasting one address into a settings box. That is the whole job.

```
Visitor ──▶ Cloudflare Pages (the console) ──▶ Render (the server)
```

## Part 1: the server on Render (about 5 minutes)

1. Open https://render.com and sign up or sign in. Choose **Sign in with GitHub**.
2. Open this link: https://render.com/deploy?repo=https://github.com/davebrian259-tech/veyra-
   It reads the `render.yaml` file in the repository and fills in everything.
3. Render asks which branch to use. Choose `claude/ecstatic-allen-5p20bs`. This matters: the
   `main` branch does not contain the server's build files yet, and a service built from
   `main` never starts.
4. Click **Deploy Blueprint** (the button may say **Apply**). Render builds the server. This
   takes four to six minutes the first time. Wait for the status to say **Live**.
5. Click the service named **veyra-server**. At the top left is its address, something like
   `https://veyra-server-abcd.onrender.com`. Copy it. This is the **server address**; you
   will paste it twice later.
6. Check it works: open `<server address>/config` in a new tab. You should see text starting
   with `{"mode":"sim"`.

Note: the free plan puts the server to sleep after 15 minutes of no visitors. The first visit
after that takes about a minute to wake it. Everyone after that is instant.

## Part 2: the console on Cloudflare Pages (about 10 minutes)

1. Open https://dash.cloudflare.com and sign up or sign in.
2. In the left menu click **Workers & Pages**, then the **Create** button, then the
   **Pages** tab, then **Connect to Git**.
3. Click **Connect GitHub**, approve access, and select the **veyra-** repository. Click
   **Begin setup**.
4. Fill in the form exactly like this. Leave everything else as it is.

   | Field | Value |
   |---|---|
   | Project name | `veyra` |
   | Production branch | `claude/ecstatic-allen-5p20bs` |
   | Framework preset | None |
   | Build command | `pnpm build` |
   | Build output directory | `dist` |
   | Root directory (under *Advanced*) | `apps/web` |

5. Still under *Advanced*, open **Environment variables** and click **Add variable**:

   | Variable name | Value |
   |---|---|
   | `API_ORIGIN` | the server address from Part 1, for example `https://veyra-server-abcd.onrender.com` |

   Include `https://` and leave off any slash at the end. Type can be **Text** or
   **Secret**; both work.
6. Click **Save and Deploy**. The build takes two to three minutes. When it finishes,
   Cloudflare shows the site address, something like `https://veyra-abc.pages.dev`. Copy it.
   This is the **console address**.
7. Open the console address. You should see the Veyra landing page. Click **Enter the
   simulator**. If the server was asleep, the button may take up to a minute the first time.

From now on, every change pushed to the branch rebuilds the console by itself.

## Part 3: tell the server its public addresses (about 3 minutes)

The server signs an identity document that names its own address. Give it the real ones.

1. Back in Render, open **veyra-server**, then **Environment** in the left menu.
2. Set these two values and click **Save Changes**:

   | Key | Value |
   |---|---|
   | `PUBLIC_API_URL` | the server address from Part 1 |
   | `PUBLIC_WEB_ORIGIN` | the console address from Part 2 |

3. Render restarts the server on its own. Wait for **Live** again.

## Checking everything

- `<console address>/api/config` shows the same text as `<server address>/config`.
- `<console address>/api/.well-known/agent-card.json` mentions your server address.
- In the console: **Enter the simulator**, then **Hire Veyra**. A contract page appears and
  reaches **delivered** within a few seconds.
- **Attack lab**: run any attack. The attacker's balance stays at 0.00.

## If something goes wrong

- **The build on Cloudflare fails.** Open the failed deployment and read the last lines.
  The usual cause is a typo in *Root directory* (`apps/web`) or *Build command*
  (`pnpm build`). Fix it under **Settings → Builds & deployments** and click **Retry**.
- **The variables page says "Only Secrets can be managed via the Dashboard".** The project
  was built from an older version of the repository that contained a Wrangler file. Add
  `API_ORIGIN` with type **Secret**; it works the same way. Builds from the current
  branch no longer show this message.
- **The page loads but "Enter the simulator" shows an error.** `API_ORIGIN` is wrong or the
  server is still waking up. Check **Settings → Environment variables** on the Pages project.
  After changing a variable, go to **Deployments** and **Retry** the latest one.
- **The console says "The Veyra server is not running", or showed "Unexpected token '<'".**
  Render has no live deployment. Open **veyra-server → Settings → Build & Deploy → Branch**,
  set it to `claude/ecstatic-allen-5p20bs`, save, then **Manual Deploy → Deploy latest
  commit**. Wait for **Live**, then reload the console.
- **The server shows "Deploy failed" on Render.** Open the **Logs** tab. Click **Manual
  Deploy → Deploy latest commit** to try again.
- **`/config` on the server address never loads.** The free instance may be waking up. Wait a
  minute and refresh.

## Later: running with real money

The setup above runs the simulator: play money, a local market, no keys. To run Veyra for
real on NEAR mainnet, the server needs secret keys, which should live on a machine the owner
controls, not on a free host. That is the "run it on your own PC behind a Cloudflare Tunnel"
setup; ask the owner for it when the time comes. Nothing in Parts 1 to 3 needs to change
except `API_ORIGIN`.

## For reference

- The forwarder from `/api/*` to the server is `apps/web/functions/api/[[path]].ts`.
- The server image is built from `Dockerfile` in the repository root; `render.yaml`
  describes the Render service.
