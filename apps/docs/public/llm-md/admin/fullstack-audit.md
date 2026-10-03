# Full-stack audit

Source: https://kensaur.us/mushi-mushi/docs/admin/fullstack-audit

---
title: Full-stack audit
description: The Full-stack audit runs one health check across RLS gaps, recent backend errors and API contract drift, and returns a readable scorecard.
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
| **Gate runs** | The newest run of every check in the last 7 days, by name: the inventory gates (G1–G8), schema drift, code health, the recipe drift checks (design, CI, deploy, env vars), Mushi setup checks, the app hole checks and the store review checklist |

If a part of the audit could not be read (the settings, the advisors, the logs,
the table list or the gate runs), the page lists it and the verdict reads
**Incomplete**, never **All clear**. A count Mushi could not read is shown as
`—`, not `0`.

---

## Open findings by check

Below the scorecard, every open finding of each check's newest run is listed
with its rule, file and line. This list is available on **every plan**; it
reads `GET /v1/admin/inventory/:projectId/findings`, the same data as the MCP
tool `list_gate_findings`. Running gates, crawls and test generation still need
a plan with the inventory features.

### Mushi setup checks and "Apply suggested caps"

Once a day Mushi checks its own setup for each app (gate `radar`): a provider
key the provider now rejects, a webhook that never delivered, a stale code
index, and **missing spend caps**. The spend-cap check flags a project with no
monthly AI budget, and auto-fix limits that are not set (a warning while
auto-fix is on, a note while it is off).

That finding has an **Apply suggested caps** button. It shows each cap before
anything changes:

- a monthly AI budget of about twice your last 30 days of AI spend, at least
  $10, so it does not stop triage on the day you apply it;
- $2 of auto-fix spend per 30 days and 3 automatic fixes a day.

The suggestion comes from the last daily check, so the button reads your
current settings first, and again when you confirm. A cap someone set since the
check ran is left as it is, and the dialog names it. If every suggested cap is
already set, nothing is sent. If the current settings cannot be read, nothing is
sent either. The button saves the remaining caps through
`PATCH /v1/admin/settings` and needs a signed-in project admin, so an API key or
MCP client cannot apply them. Change or clear them any time in
**Settings → General → Spend limits**. The finding clears on the next daily
check.

---

## Prerequisites

Add your Supabase PAT under **Settings → API Keys** and set
`supabase_project_ref` on the project. CLI equivalent: `mushi audit`.

---

## CLI

```bash
mushi audit
mushi audit --json
mushi audit --project-id <uuid>
```

---

## Related pages

- [Code health](/admin/code-health) — bundle + god-file trends from CI ingest
- [Drift scanner](/admin/drift) — scheduled schema drift findings
- [Integration health](/admin/health) — Slack / Sentry / GitHub probe status
- [Inventory](/admin/inventory) — the same findings next to the inventory graph (inventory plans)
