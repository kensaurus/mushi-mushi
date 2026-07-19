# Code health

Source: https://kensaur.us/mushi-mushi/docs/admin/code-health

---
title: Code health
---

# Code health

**Route:** `/code-health`

> **Scenario:** Your mobile CI posts bundle KB and god-file LOC on every push to
> `main`. You want one console view that shows whether the app is getting heavier
> or sprouting unmaintainable files — without opening GitHub Actions logs.

This page **reads only** — it never triggers a scan. Data arrives via
`POST /v1/ingest/metrics` from your repo's CI workflow.

---

## What you see

| Section | Source |
|---------|--------|
| **Summary scorecard** | Error/warn finding count, max LOC, latest bundle KB |
| **Bundle-size trends** | Sparkline per `bundle.*` metric from `metric_series` |
| **God-file findings** | Files over the LOC budget (`code_health.*` gate) |

---

## Wiring CI ingest

1. Mint an SDK **ingest** key on [Projects](/admin/projects).
2. Add repo secrets: `MUSHI_API_URL`, `MUSHI_INGEST_KEY`.
3. Post on every `main` push:

```yaml
- name: Mushi code health ingest
  run: node scripts/scan-god-files.mjs && node scripts/post-metrics.mjs
  env:
    MUSHI_API_URL: ${{ secrets.MUSHI_API_URL }}
    MUSHI_INGEST_KEY: ${{ secrets.MUSHI_INGEST_KEY }}
```

Reference implementation: `kensaurus/yen-yen` — `.github/workflows/bundle-budget.yml`
+ `scripts/scan-god-files.mjs`.

---

## API

```bash
GET /v1/admin/code-health?project_id=
POST /v1/ingest/metrics   # CI push — apiKeyAuth, prefix allow-list bundle.* / code_health.*
```

---

## Related pages

- [Full-stack audit](/admin/fullstack-audit) — DB advisors + gate runs (push-button)
- [Drift scanner](/admin/drift) — schema drift vs previous snapshot
- [Connect](/admin/connect) — wire GitHub + CI secrets in one place
