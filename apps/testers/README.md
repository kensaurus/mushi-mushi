# `@mushi-mushi/testers` — Mushi Bounties public marketplace

The public-facing Next.js app for the Mushi Bounties crowd-testing marketplace.
Deployed at `kensaur.us/mushi-mushi/testers/` as a CloudFront subpath.

---

## Routes

| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing page — hero, featured apps, value props |
| `/apps/` | `app/apps/page.tsx` | Full catalog with platform + bounty filters |
| `/apps/[slug]/` | `app/apps/[slug]/page.tsx` | App detail — bounty schedule, CTA to join |
| `/how-it-works/` | `app/how-it-works/page.tsx` | Editorial explainer — loop, math, KYC, OFAC |
| `/join/` | `app/join/page.tsx` | Signup landing; optional `?app=<slug>` scopes the CTA |
| `/leaderboard/` | `app/leaderboard/page.tsx` | Top 50 testers (refreshed every 15 min) |

All routes are **server components** that fetch from `NEXT_PUBLIC_API_URL` at render time. The config uses `output: 'export'` for static-export production builds; `next dev` serves them dynamically for local development and testing.

---

## Local dev

```bash
# From repo root (installs all workspaces):
pnpm install

# Start the dev server (Turbopack):
pnpm --filter @mushi-mushi/testers dev
# → http://localhost:3000

# Type-check:
pnpm --filter @mushi-mushi/testers typecheck

# Lint:
pnpm --filter @mushi-mushi/testers lint

# Build (static export — needs env vars):
pnpm --filter @mushi-mushi/testers build
```

The local gateway at `localhost:6464/mushi-mushi/testers/` proxies to this dev server when the unified dev setup is running.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | `https://kensaur.us/mushi-mushi/api` | Mushi API base URL — the edge function origin |
| `NEXT_PUBLIC_ADMIN_URL` | Yes | `https://kensaur.us/mushi-mushi/console` | Admin SPA origin — used for login redirect CTAs |
| `NEXT_PUBLIC_SUPABASE_URL` | No | — | Supabase project URL (for future client-side auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | — | Supabase anon key (for future client-side auth) |
| `MUSHI_BASE_PATH` | CI only | — | CloudFront subpath prefix (e.g. `/mushi-mushi/testers`) |
| `MUSHI_ASSET_PREFIX` | CI only | — | CDN asset prefix for static exports |

For local dev without `.env.local`, the defaults point to the production API. This means the catalog and leaderboard fetch real data.

---

## Architecture notes

- **SSR with server components** — Every page is an async React Server Component that `fetch()`es from the API directly. No client-side fetching on initial load.
- **Static export** — In production CI, `next build` generates a fully-static `out/` directory uploaded to S3. The `revalidate` hints in `fetch()` calls are silently ignored in static export mode; pages are rebuilt on each CI deploy instead.
- **No auth** — This app is entirely public. Authenticated tester flows (dashboard, submissions, wallet) live in `apps/admin/src/pages/tester/`.
- **Design language** — Dark `gray-950` background, violet `#7c3aed` accent, Tailwind v4 via `@tailwindcss/postcss`.

---

## API contract

All data comes from the public Mushi API endpoints in `packages/server/supabase/functions/api/routes/tester-marketplace.ts`:

| Endpoint | Used by |
|---|---|
| `GET /v1/public/marketplace/apps` | Home page, catalog page |
| `GET /v1/public/marketplace/apps?platform=<p>&min_points=<n>` | Catalog page filters |
| `GET /v1/public/marketplace/apps/:slug` | App detail page |
| `GET /v1/public/marketplace/leaderboard` | Leaderboard page |

All endpoints are public (no JWT required) and protected by `published_apps_public_read` RLS policy (`WHERE visibility='public'`).

---

## Related docs

- [Mushi Bounties manifesto](../../docs/BOUNTIES.md)
- [Launch runbook](../../docs/runbooks/tester-marketplace-launch.md)
- [Rewards program](../../docs/REWARDS.md)
