# Admin SPA deploy

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/admin-spa

---
title: Admin SPA deploy
description: Build and deploy the Mushi Mushi admin console yourself. A static Vite and React app that talks to your Supabase project, and the env vars it needs.
---

# Admin SPA deploy

The admin console is a Vite + React SPA that talks directly to your Supabase project and the `api` edge function. It has no server runtime — any static host works.

## Build

From the repo root:

```bash
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ… \
VITE_API_URL=https://YOUR-REF.supabase.co/functions/v1/api \
pnpm --filter "@mushi-mushi/admin..." build
```

The trailing `...` also builds the workspace packages the console imports (`@mushi-mushi/web`, `@mushi-mushi/mcp` and others) first; a fresh clone has none of their `dist/` folders yet. The output lands in `apps/admin/dist/`.

  `VITE_API_URL` must point to the `api` edge function (`…/functions/v1/api`), **not** your database URL. All console API calls are proxied through that function.

## Deploy options

| Host | Command / workflow |
| --- | --- |
| **Cloudflare Pages** | `wrangler pages deploy apps/admin/dist --project-name mushi-admin` |
| **Vercel** | `vercel apps/admin/dist` |
| **S3 + CloudFront** | See `.github/workflows/deploy-admin.yml` in the repo |
| **Netlify** | `netlify deploy --dir apps/admin/dist --prod` |

## SPA routing

All hosts need to serve `index.html` for every path under the console root. The repo's reference S3 + CloudFront deploy does this with CloudFront functions (`scripts/cloudfront-mushi-spa-router.js` and `cloudfront-mushi-spa-response.js`) in front of a private bucket. For Cloudflare Pages and Netlify, a `_redirects` file or `netlify.toml` with `/* /index.html 200` is sufficient.

## First-run setup

After deploy, open the console and complete the **Onboarding** wizard (`/onboarding`). It will:
1. Generate your first API key.
2. Connect your GitHub OAuth app.
3. Show the SDK snippet for your first project.

If `/onboarding` returns a blank screen, confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked into the build. Vite inlines them at build time, so environment variables on the server that serves `dist/` have no effect.

A build with `VITE_INSTANCE_TYPE=self-hosted` and no `VITE_SUPABASE_URL` opens a setup screen instead. It asks for the Supabase URL and anon key and keeps them in that browser. The published Docker image (`ghcr.io/kensaurus/mushi-mushi-admin`) works this way. To bake the values in, build your own image: `docker build -f deploy/Dockerfile.admin --build-arg VITE_SUPABASE_URL=… --build-arg VITE_SUPABASE_ANON_KEY=… .` (nginx serves it on port 3000 with the SPA fallback).

Point the CLI at the console, so `mushi login` signs in there instead of on Mushi Mushi Cloud: `mushi config consoleUrl https://your-console.example.com`. Alternatively, pass `--console-url` to `mushi selfhost up`.
