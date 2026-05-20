---
"mushi-mushi": patch
---

fix(seo): add X-Robots-Tag noindex to /mushi-mushi/* 302 redirect responses

CloudFront SPA router now sets `x-robots-tag: noindex, nofollow` on the 302
redirect that bounces bare `/mushi-mushi/<route>` paths to `/mushi-mushi/admin/`.
Google Search Console was indexing 47 redirect-source URLs because the 3xx
response itself carried no hint — even though the destination SPA shell already
has `<meta name="robots" content="noindex">`. Adding the header at the edge
drops those entries on the next crawl without waiting for the destination to
be re-evaluated.

Also adds:
- `scripts/bootstrap-publish-new-packages.mjs` — one-shot npm bootstrap script
  for new `@mushi-mushi/*` packages that can't use OIDC on first publish (npm
  limitation, see npm/cli#8544). Run with `pnpm bootstrap:new-npm-packages`.
- `docs/HANDOVER-2026-05-05-npm-trusted-publisher-bootstrap.md` — step-by-step
  handover guide for configuring Trusted Publisher after first publish.
