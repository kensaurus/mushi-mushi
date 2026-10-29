# Processing jobs

Source: https://kensaur.us/mushi-mushi/docs/admin/queue

---
title: Processing jobs
description: The Processing jobs page in the Mushi Mushi console shows reports waiting to be diagnosed, retries and dead-letter jobs, and lets you retry failed ones.
---

# Processing jobs

**Route:** `/queue` (sidebar: **Account → Processing jobs**)

> **Scenario:** You open Mushi Mushi on a Monday morning and 14 jobs sit in dead letter.
> Your LLM key hit a rate limit overnight and reports piled up without being
> diagnosed. This page is where you find what broke and replay the affected jobs.

Processing jobs is the operational view of the background jobs that read and sort new
reports (the fast filter and classification stages). Use it to monitor throughput, identify failures, retry stuck
items, and recover from outages.

---

## What "dead-letter" means

An item reaches `dead_letter` status after exhausting all automatic retries. Mushi
won't touch it again until you manually retry it. This is intentional — automatic
infinite retries can amplify a misconfiguration into a cost spiral.

When you see dead-letter items:
1. Read the **Last error** on one of the cards to understand why it failed.
2. Fix the root cause (wrong API key, rate limit, misconfigured repo URL).
3. Click **Retry** per item, or use **Retry page** to replay all failed items on the
   current page at once.

---

## KPI tiles (14-day sparklines)

| Tile | Healthy baseline | Warning sign |
|------|-----------------|-------------|
| **Dead letter** | 0 | Any non-zero number |
| **Failed** | Low — occasional transient failures are normal | Rising trend day-over-day |
| **Pending** | Small queue that clears within minutes | Growing pile-up = processing is slow or stuck |
| **Running** | 1–5 at any time | > 20 may indicate a processing loop |
| **Completed** | Rising trend = healthy throughput | Flat + rising failed = systematic failure |

---

## Throughput chart

The **Daily throughput** chart shows created, completed and failed jobs per day over the
last 14 days. A healthy pipeline completes about as many as it creates, with few failures.

**What to look for:**
- A day where failed > completed → something broke that day. Cross-reference the
  **Audit log** for key changes or deploys.
- Flat completed bars for 2+ days → the pipeline may be paused. Check if your BYOK
  keys expired.

---

## Stage breakdown

Counts per pipeline stage, shown as **Fast filter** (`stage1`), **Classify** (`stage2`),
**Judge** and **Fix suggestion**. If one stage has a disproportionate backlog, that's the
bottleneck. Example:

- **Fast filter has 200 pending** → new reports are not being read. Check the LLM key and
  recent AI calls in [Mushi health](/admin/health), and the prompt in [AI prompts](/admin/prompt-lab).

---

## Item cards

Paginated list (25 per page). Each card shows:
- **Stage and status badge**, and the attempt count (for example `2/3 attempts`)
- A **Waiting** chip when a pending or running job has been waiting a while
- The first 150 characters of the report, linked to the report page
- **Last error**, which often tells you exactly what went wrong
- **Timestamps**: created and last attempt
- A **Retry** button on failed and dead-letter jobs

Use the **Status** and **Stage** dropdowns to filter to just the items you care about.

---

## Bulk actions

| Button | When to use it |
|--------|---------------|
| **Retry page** | After fixing the root cause: replay all retryable jobs on the current page |
| **Flush queued** | After a rate-limit incident: replays reports the circuit breaker parked. Shown only when some are parked |
| **Recover stranded** | Re-runs the fast filter for reports stuck as new or queued for more than 5 minutes (up to 50, fewer than 3 attempts) and re-queues failed jobs that still have retries left. Shown only when something is recoverable |

These buttons need edit rights on the project; viewers see the page read-only.

Use **Recover stranded** only when reports have genuinely been stuck for more than
5 minutes. Running it while a slow function is still working can process a report twice.

---

## Common tasks

### Monday morning: 14 dead-letter jobs
1. Set **Status** to dead letter. Read **Last error** on the first card.
2. Example error: a rate limit or a rejected LLM key → fix the key in [Settings](/admin/settings) → **AI keys**.
3. Come back, filter to `dead_letter` → **Retry page** → watch the status column — items should transition to `running` then `completed`.
4. If they fail again: the root cause isn't fixed. Repeat the diagnosis.

### "Reports have been stuck for 30 minutes"
1. Look for the **Waiting** chip on pending or running jobs.
2. Click **Recover stranded**. It re-runs the fast filter for stranded reports and re-queues failed jobs with retries left.
3. Watch the Failed count: they should retry and (if the root cause is gone) complete.

### Monitoring after a deploy
1. After deploying, open the queue and set a 5-minute mental timer.
2. If the **Pending** tile rises and doesn't fall: your classify function may be
   failing. Check recent AI calls in [Mushi health](/admin/health).

---

## API

```bash
GET  /v1/admin/queue?status=&stage=&page=&pageSize=
GET  /v1/admin/queue/stats
GET  /v1/admin/queue/summary
GET  /v1/admin/queue/throughput
POST /v1/admin/queue/:id/retry
POST /v1/admin/queue/flush-queued
POST /v1/admin/queue/recover
```

---

## Related pages

- [Mushi health](/admin/health): LLM provider errors are a common cause of failed jobs
- [Settings](/admin/settings): the AI keys the diagnosis stages use
- [Audit log](/admin/audit) — cross-reference queue failures with admin actions
