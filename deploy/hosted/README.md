<!--
  FILE: deploy/hosted/README.md
  PURPOSE: Document how Mushi Cloud (kensaur.us/mushi-mushi) is operated.
  AUDIENCE: Maintainers + security auditors. Not needed by SDK users or self-hosters.
  NOTE: Actual secrets live in Supabase Vault / environment variables — never here.
-->

# Mushi Cloud — Hosted Deployment

This document describes how the Mushi Cloud instance at `kensaur.us/mushi-mushi`
is deployed. It is **not required reading for SDK users** (who need only
`MUSHI_PROJECT_ID` + `MUSHI_API_KEY`) or for self-hosters (see
[`deploy/docker-compose.yml`](../docker-compose.yml) and the
[self-hosting docs](../../apps/docs/content/self-hosting/)).

## Infrastructure overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Compute** | Supabase Edge Functions (Deno) | ~50 functions under `packages/server/supabase/functions/` |
| **Database** | Supabase Postgres (us-west-1) | Row-level security on every public table |
| **Object storage** | Supabase Storage | Session replays; 30-day lifecycle policy |
| **Console hosting** | Vercel (Next.js) | `apps/admin/` |
| **Docs** | Vercel (Nextra/Next.js) | `apps/docs/` |
| **Auth** | Supabase Auth | Email/password + OAuth (GitHub) |
| **Billing** | Stripe | Checkout, Customer Portal, webhooks |
| **CDN / TLS** | Cloudflare | HSTS preload, DDoS, WAF |

## Deployment flow

```
Push to master
  → GitHub Actions (.github/workflows/release.yml)
  → pnpm build
  → supabase functions deploy (all edge functions)
  → vercel --prod (admin + docs)
  → npm publish @mushi-mushi/* (if changesets present)
```

Edge functions are deployed with `supabase functions deploy --project-ref <ref>`.
The Supabase project ref is stored as `SUPABASE_PROJECT_REF` in GitHub Actions secrets.

## Secrets inventory

The following secrets must be configured in the Supabase project and/or
GitHub Actions environment. None are committed to this repository.

| Secret name | Where set | Purpose |
|-------------|-----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Vault + GH Actions | Server-side DB access |
| `SUPABASE_ANON_KEY` | GH Actions / Vercel env | Public client key |
| `STRIPE_SECRET_KEY` | Supabase Vault | Billing API calls |
| `STRIPE_WEBHOOK_SECRET` | Supabase Vault | Webhook signature verification |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Supabase Vault | Default BYOK fallback (hosted) |
| `MUSHI_EE_LICENSE_KEY` | Supabase Vault | Hosted cloud's own EE license |
| `NPM_TOKEN` | GH Actions (OIDC Trusted Publisher) | Package publish |
| `VERCEL_TOKEN` | GH Actions | Console + docs deploy |

> **Rotation policy:** service-role key rotated quarterly; Stripe secret on any
> suspected exposure; all others on personnel change.

## Monitoring & alerting

- **Uptime:** updown.io checks (5-min period) on the API edge function,
  hosted MCP, console, and docs — public status page at
  [updown.io/p/b6lod](https://updown.io/p/b6lod). API key lives in the
  operator's local `.env` as `UPDOWN_API_KEY` (never committed).
- **Error rates:** Supabase log drain → Supabase dashboard; Mushi Mushi
  monitors itself (dogfooding).
- **Billing anomalies:** Stripe Dashboard + webhook-triggered Slack alerts.

## Contact

- Security issues: `kensaurus@gmail.com`
- Operational questions: `kensaurus@gmail.com`
