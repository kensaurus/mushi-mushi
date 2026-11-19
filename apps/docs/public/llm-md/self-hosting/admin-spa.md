# Host the console

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/admin-spa

---
title: Host the console
description: "Serve the Mushi Mushi console yourself: a static build, a Docker image or Compose. Build it with your backend address, or connect it on first open."
---

# Host the console

**Use this when** you put the console on a real domain, or the console opens a "does not know where your Mushi Mushi server is" screen. The console is a static Vite + React app. It talks to your Supabase project and the `api` function, and has no server of its own.

  Vite **inlines** `VITE_*` values at build time. Setting them on the server that serves the files does nothing, and so does restarting it. Change a value, then rebuild. The one exception is `pnpm dev`, which rereads `apps/admin/.env` on restart.

## Pick how you serve it

| You serve it as | Do this |
| --- | --- |
| Files on any static host | Build with the values (below), upload `apps/admin/dist` |
| A Docker image | `docker build -f deploy/Dockerfile.admin` with `--build-arg` values (below) |
| Part of Docker Compose | Nothing: Compose builds it from `deploy/.env`. After changing `MUSHI_PUBLIC_URL` or the anon key: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build admin` |
| A local dev server | Put the values in `apps/admin/.env`, run `pnpm --filter @mushi-mushi/admin dev` (http://localhost:6464) |
| A build without the values | Open it: the setup screen asks for the Supabase URL and anon key and keeps them in that browser (**Connect this browser**) |

The values: your project URL and **anon** key from Supabase → Project Settings → API. The anon key is meant to be public; the service-role key never goes in the console.

### Static build

From the repo root:

```bash
pnpm install
VITE_SUPABASE_URL=https://<your-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon key> \
VITE_API_URL=https://<your-ref>.supabase.co/functions/v1/api \
VITE_INSTANCE_TYPE=self-hosted \
pnpm --filter "@mushi-mushi/admin..." build
```

The trailing `...` also builds the workspace packages the console imports first; a fresh clone has none of their `dist/` folders yet. Output: `apps/admin/dist/`. `VITE_API_URL` is optional (it defaults to `/functions/v1/api`) and must point at the `api` function, never the database URL.

| Host | Command |
| --- | --- |
| Cloudflare Pages | `wrangler pages deploy apps/admin/dist --project-name mushi-admin` |
| Vercel | `vercel apps/admin/dist` |
| Netlify | `netlify deploy --dir apps/admin/dist --prod` |
| S3 + CloudFront | See `.github/workflows/deploy-admin.yml` in the repo |
| Try it locally | `npx serve -s apps/admin/dist -l 6464` |

Every host must serve `index.html` for every path under the console (a SPA fallback). Cloudflare Pages and Netlify: a `_redirects` file with `/* /index.html 200`. The reference S3 + CloudFront deploy uses CloudFront functions (`scripts/cloudfront-mushi-spa-router.js`, `cloudfront-mushi-spa-response.js`).

### Docker image

```bash
docker build -f deploy/Dockerfile.admin \
  --build-arg VITE_SUPABASE_URL=https://<your-ref>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon key> \
  --build-arg VITE_INSTANCE_TYPE=self-hosted \
  -t mushi-admin .
docker run -p 3000:3000 mushi-admin
```

nginx serves it on port 3000 with the SPA fallback. Built without `VITE_SUPABASE_URL`, the image opens the setup screen instead.

## After it is up

1. Point the CLI at it, so `mushi login` signs in on your console, not Mushi Mushi Cloud: `npx mushi-mushi config consoleUrl https://mushi.example.com` (or pass `--console-url` to `selfhost up`).
2. Set the function secrets `ADMIN_BASE_URL` to the same address (links in Slack, Discord and email, and the `mushi login` approval page, open it) and `MUSHI_ADMIN_ORIGIN_ALLOWLIST` to its origin (without it, the browser blocks the console's calls to the API, except on `localhost` dev ports). `selfhost up --console-url` does all three. Compose needs none of this: the console and the API share one origin.
3. Run `npx mushi-mushi selfhost doctor`: its **Console answers** line checks the address responds with the console page.

Every `VITE_*` value is listed on [Environment variables](/self-hosting/environment#console-build-vite_). The console's own Sentry DSN is `VITE_SENTRY_DSN`; see [Observability](/self-hosting/observability).
