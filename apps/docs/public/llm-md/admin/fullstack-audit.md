# Full-stack audit

Source: https://kensaur.us/mushi-mushi/docs/admin/fullstack-audit

---
title: Full-stack audit
---

# Full-stack audit

**Route:** `/fullstack-audit`

> **Scenario:** It's Monday standup. You need a PM-readable health scorecard —
> RLS gaps, recent backend errors, API contract drift — without opening five
> different tabs.

One **Run audit** button fans out to `POST /v1/admin/projects/:id/audit` and
returns a severity-ranked scorecard in ~10 seconds.

---

## Scorecard sections

| Check | What it surfaces |
|-------|------------------|
| **Backend link** | Supabase PAT + project ref configured |
| **DB advisors** | Security + performance findings from Supabase MCP |
| **RLS gaps** | Tables without row-level security |
| **Error log** | Recent backend ERROR-level log count |
| **Gate runs** | G3 API contract, G6 spec drift, G7 orphan endpoints, G8 unknown frontend calls, schema drift, G5 status claim |

---

## Prerequisites

Add your Supabase PAT under **Settings → API Keys** and set
`supabase_project_ref` on the project. CLI equivalent: `mushi audit`.

---

## CLI

```bash
mushi audit
mushi audit --json
mushi audit --project-id 
```

---

## Related pages

- [Code health](/admin/code-health) — bundle + god-file trends from CI ingest
- [Drift scanner](/admin/drift) — scheduled schema drift findings
- [Integration health](/admin/health) — Slack / Sentry / GitHub probe status
