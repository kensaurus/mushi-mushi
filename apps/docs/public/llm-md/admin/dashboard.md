# Dashboard

Source: https://kensaur.us/mushi-mushi/docs/admin/dashboard

---
title: Dashboard
---

# Dashboard

**Route:** `/dashboard`

> **Scenario:** You've just pushed a release and want to know in 30 seconds whether
> anything broke, whether the overnight fix runs succeeded, and what your users
> reported since you last logged in.

The dashboard answers those questions without clicking into any sub-page. It's your
morning starting point — a live snapshot of what users reported, what's getting fixed,
and what still needs you.

---

## What to look for first

When you land on the dashboard, scan these three things in order:

1. **Flow canvas** (centre) — are reports stuck at one stage? A pile-up at "Plan"
   means the inbox is backed up. A pile-up at "Do" means fix drafts are failing or
   waiting. Click the glowing stage to jump straight there.

2. **KPI tiles** (below the canvas) — if "Fixes failed" is non-zero, open
   [Fix drafts & PRs](/admin/fixes) immediately. If "LLM cost" spiked overnight, check
   the cost chart for the culprit pipeline.

3. **Inbox queue** (bottom-left) — reports waiting for your decision. This is your
   to-do list for the day.

---

## Flow canvas

The animated graph in the centre shows live report counts at each stage:

| Stage | What it counts |
|-------|---------------|
| **Plan** | Reports that have been classified and are awaiting triage |
| **Do** | Fix-worker runs currently in progress |
| **Check** | Fixes awaiting verification |
| **Act** | Merged PRs pending attribution / lesson promotion |

The stage with the most activity glows with an animated gradient edge. **Click any
stage card** to jump to its page.

On mobile the canvas becomes a compact **PDCA Cockpit** — same counts, same links.

---

## KPI tiles (14-day window)

| Tile | What it measures | Why it matters |
|------|-----------------|----------------|
| **Open backlog** | Reports not yet dispatched to a fix | Rising number = triage falling behind |
| **Fixes in flight** | Fix-worker runs currently running | Healthy baseline is 0–3 at any moment |
| **Fixes failed** | Failed runs in the last 14 days | Non-zero means check [Integration health](/admin/health) |
| **LLM calls** | Total calls to your BYOK providers | Baseline for cost budgeting |
| **LLM cost** | Estimated USD spend | Spike after a deploy = PDCA run triggered |

---

## Charts row (14 days)

Two bar charts sit side by side. Both include **event annotation markers** — thin
vertical lines for deploys, cron runs, and BYOK key changes — so you can answer
questions like *"why did cost jump on Tuesday?"* without digging through logs.

- **Reports by day** — inbound volume. A sudden drop may mean the SDK stopped sending (check [SDK health](/admin/sdk-health)).
- **LLM cost by day** — AI spend. A spike after a quiet period usually means a PDCA run or a fine-tuning job fired.

---

## Triage queue

The most recent un-triaged reports, ordered by severity. Click any row to open the
report detail and triage it. **"View all reports →"** goes to the full queue with
all filters.

If the queue is empty, that's a good sign — but if the "Open backlog" KPI is high
while the queue looks empty, check the [Processing queue](/admin/queue) for stuck items.

---

## Insights row

- **Top error-generating components** — shows which parts of the codebase generate the
  most reports. If `CheckoutButton` is top of the list for three weeks running, it's
  time to look at the [Lessons](/admin/lessons) page and see if a recurring pattern
  has been promoted.
- **Integration health** — a compact status badge for each BYOK provider. A red badge
  here means fix-worker and PDCA runs will fail until it's fixed.
- **Activity feed** — recent system events: fix dispatched, PR opened, tier-up, PDCA
  run completed.

---

## Common tasks

### Morning check (2 minutes)
1. Glance at the PDCA canvas — no pile-up at a single stage? Good.
2. Check "Fixes failed" — zero? Move on. Non-zero? Open Fix orchestrator.
3. Scan the bug queue — review the top 2–3 reports before standups.
4. Check integration health badge — all green? You're done.

### After a deploy
1. Open the **Reports by day** chart and look at today's bar.
2. Check if a new deploy annotation appears. If report volume spikes right after
   the annotation, a regression likely shipped.
3. Click the spike bars to drill into the individual reports.

### Investigating a cost spike
1. Find the spike on **LLM cost by day**.
2. Hover the event annotation on that date — was it a PDCA run? A fine-tuning job?
3. If unexplained, open [Integration health](/admin/health) → Recent LLM calls log.

---

A confetti burst and toast appear the first time a fix-worker PR is merged for your
project — the "first merged fix" milestone. After that, the dashboard switches from
the onboarding state to the full production view.

---

## Related pages

- [Inbox](/admin/inbox) — all open actions prioritised in one list
- [Reports](/admin/reports) — the full bug queue
- [Fix orchestrator](/admin/fixes) — fix-worker run detail
- [Integration health](/admin/health) — full LLM health and cron monitoring
