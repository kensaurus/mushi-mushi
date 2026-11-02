# Code size

Source: https://kensaur.us/mushi-mushi/docs/admin/code-health

---
title: Code size
description: The Code size view in the Mushi Mushi console charts bundle size and oversized files from your CI over time, so you see an app getting heavier before users do.
---

# Code size

**Route:** `/health?view=code` (**Mushi health → Code size**). The old `/code-health` link
redirects there. Until October 2026 this was its own page, called Code health.

> **Scenario:** Your mobile CI posts bundle KB and god-file LOC on every push to
> `main`. You want one console view that shows whether the app is getting heavier
> or sprouting unmaintainable files — without opening GitHub Actions logs.

Mushi Mushi only **reads** here: the view never triggers a scan. Data arrives via
`POST /v1/ingest/metrics` from your repo's CI workflow.

---

## What you see

| Section | Source |
|---------|--------|
| **Status sentence** | How many files are over or close to the 2,000-line budget, the largest file, and the latest bundle KB |
| **Oversized files** | A bar per large file, longest first, against the budget line (`code_health.*` gate) |
| **Bundle size over time** | Sparkline per `bundle.*` metric from `metric_series` |
| **Largest file over time** | The longest file's line count per run, when CI sends it |
| **How to split each file** | Each oversized file with its split hint |

Known security holes in your dependencies are not repeated here: one line links to
[Full-stack audit](/admin/fullstack-audit), where they are listed and managed.

---

## Wiring CI ingest

1. Mint an SDK **ingest** key on [Manage apps](/admin/projects).
2. Add repo secrets: `MUSHI_API_URL`, `MUSHI_INGEST_KEY`.
3. In CI, build a JSON body of `metrics` (names starting `bundle.` or `code_health.`)
   and `findings`, then post it with the key in the `X-Mushi-Api-Key` header:

```yaml
- name: Push code-health metrics to Mushi Mushi
  env:
    MUSHI_API_URL: ${{ secrets.MUSHI_API_URL }}
    MUSHI_INGEST_KEY: ${{ secrets.MUSHI_INGEST_KEY }}
  run: |
    curl -sf -X POST "${MUSHI_API_URL}/v1/ingest/metrics" \n      -H "Content-Type: application/json" \n      -H "X-Mushi-Api-Key: ${MUSHI_INGEST_KEY}" \n      --data-binary @mushi-payload.json
```

Mushi Mushi does not ship the script that writes `mushi-payload.json`; your CI builds it.
Reference implementation: `kensaurus/yen-yen`, `.github/workflows/bundle-budget.yml`
with `scripts/scan-god-files.mjs`.

---

## API

```bash
GET /v1/admin/code-health?project_id=<uuid>
POST /v1/ingest/metrics   # CI push — apiKeyAuth, prefix allow-list bundle.* / code_health.*
```

From your editor, the MCP tool `get_code_health` returns the same data
(trends default to the last 30 days; pass `days` for more). Pass a god file's
`id` to `explain_finding` for its fix in one sentence. A project key reads its
own project; an account-level key needs `projectId` (`project_id` on the API).

---

## Related pages

- [Full-stack audit](/admin/fullstack-audit) — DB advisors + gate runs (push-button)
- [Schema changes](/admin/drift) — schema drift vs previous snapshot
- [Connect](/admin/connect) — wire GitHub + CI secrets in one place
