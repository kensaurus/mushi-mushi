# Admin SPA deploy

Source: https://kensaur.us/mushi-mushi/docs/self-hosting/admin-spa

---
title: Admin SPA deploy
---

# Admin SPA deploy

The admin console is a Vite + React SPA that talks directly to your Supabase project and the `api` edge function. It has no server runtime — any static host works.

## Build

From the repo root:

```bash
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co \
VITE_SUPABASE_ANON_KEY=eyJ… \
VITE_API_URL=https://YOUR-REF.supabase.co/functions/v1/api \
pnpm --filter @mushi-mushi/admin build
```

The output lands in `apps/admin/dist/`.

  `VITE_API_URL` must point to the `api` edge function (`…/functions/v1/api`), **not** your database URL. All console API calls are proxied through that function.

## Deploy options

| Host | Command / workflow |
| --- | --- |
| **Cloudflare Pages** | `wrangler pages deploy apps/admin/dist --project-name mushi-admin` |
| **Vercel** | `vercel apps/admin/dist` |
| **S3 + CloudFront** | See `.github/workflows/deploy-admin.yml` in the repo |
| **Netlify** | `netlify deploy --dir apps/admin/dist --prod` |

## SPA routing

All hosts need to serve `index.html` for every path under the console root. The repo's reference S3 workflow sets the `ErrorDocument` to `index.html`. For Cloudflare Pages and Netlify, a `_redirects` file or `netlify.toml` with `/* /index.html 200` is sufficient.

## First-run setup

After deploy, open the console and complete the **Onboarding** wizard (`/onboarding`). It will:
1. Generate your first API key.
2. Connect your GitHub OAuth app.
3. Show the SDK snippet for your first project.

If `/onboarding` returns a blank screen, confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked into the build — these cannot be injected after build time.
