# Operating (maintainers)

Source: https://kensaur.us/mushi-mushi/docs/operating

---
title: Operating (maintainers)
---

# Operating Mushi

This section is for **maintainers** running Mushi Cloud or shipping the open-source
SDK packages — not for app developers integrating the SDK. If you are integrating
Mushi into your app, start at [Quickstart](/quickstart) instead.

  Mushi is **OSS-first**: the hosted product runs the exact same code in this repo.
  Self-hosters can reuse every deploy path described here. See [Self-hosting](/self-hosting).

## What lives here

| Page | Audience | Covers |
| --- | --- | --- |
| [Deployment & releases](/operating/deployment) | Maintainers | npm SDK publish (Changesets + OIDC), edge functions, admin SPA, docs, DB migrations |

## The four independent deploy paths

Mushi has **four** delivery pipelines that ship independently — a change to one
never blocks the others:

1. **npm SDK packages** — `release.yml` (Changesets version PR → merge → OIDC publish).
2. **Supabase Edge Functions** — `deploy-edge-functions.yml` (path-filtered push to `master`).
3. **Admin console SPA** — `deploy-admin.yml` (S3 + CloudFront).
4. **Docs site** — `deploy-docs.yml` (S3 + CloudFront).

**Database migrations are manual** (`supabase db push`) and are never run by CI.

See [Deployment & releases](/operating/deployment) for the full runbook.
