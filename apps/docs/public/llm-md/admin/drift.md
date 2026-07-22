# Drift scanner

Source: https://kensaur.us/mushi-mushi/docs/admin/drift

---
title: Drift scanner
---

# Drift scanner

**Route:** `/drift`

> **Scenario:** You shipped a refactor last Friday. It's Monday and two users have
> reported the Settings page is blank. You suspect a route or component broke silently.
> You run the drift scanner and in 45 seconds it shows you exactly what changed between
> your last contract snapshot and what's live right now.

The drift scanner compares your **live app** against the **contract snapshot** the SDK
took when it last crawled your routes and components. Anything that's missing, changed,
or new shows up as a finding — before users report it.

---

## When to run it

- **After every deploy** — especially refactors, route changes, or component renames.
- **Before a PDCA iteration** — confirm there's no pre-existing regression before the
  autonomous loop starts.
- **When reports spike** — users reporting broken pages often correlates with a drift
  finding you haven't seen yet.
- **Weekly** — as a background health check even between deploys.

---

## Tab: Scanner

This is where you trigger a scan. Enter the **Max paths to walk** (10–1000 — start with
50 for a fast check, 500 for a thorough audit) and click **Run scan**.

The scan typically takes 30–90 seconds. When it completes, results show:
- **Findings discovered** — how many drift items were detected
- **New findings stored** — how many are new since the last scan
- **Snapshot ID** — the ID of the baseline contract used for comparison

### If the scan fails

Error banners show a specific code — not a generic 500:

| Error code | What it means | What to do |
|------------|---------------|-----------|
| `BUILDER_FAILED` | The scanner couldn't fetch or parse your app | Check the target URL is publicly reachable, returns valid HTML, and doesn't redirect to a login page |
| `SNAPSHOT_MISSING` | No baseline contract exists for this project | Run a full SDK crawl first via the [Inventory](/admin/inventory) page |
| `UPSTREAM_ERROR` | Unexpected error in the diff engine | Check Supabase edge function logs; retry in a few minutes |

A **Retry** button appears immediately after any error.

---

## Tab: Findings

Your list of detected drift items. The three stat cards at the top tell you the
overall picture: **Open**, **Critical**, **Warn** counts.

Each finding row shows:
- **Severity** — `critical` (broken) or `medium`/`low` (changed or new)
- **Surface** — `route`, `component`, or `endpoint`
- **Path** — which route or component
- **Message** — what specifically changed (e.g. *"Expected `/settings/security` — not found in live crawl"*)

**Click View** on any row to open the detail drawer with:
- The full **Expected vs Actual** JSON diff — the exact values that changed
- **→ Lesson** button (critical findings only) — promotes this finding directly to a
  candidate lesson so the pattern is encoded into future fix runs
- **Dismiss** button — mark as a known/intentional change that isn't a bug

### What to do with a critical finding

1. Click **View** → read the Expected vs Actual diff.
2. Is this intentional (you renamed the route on purpose)? → **Dismiss**.
3. Is this a regression? → Click **→ Lesson** to create a candidate, then go to
   [Fix drafts](/admin/fixes) → dispatch a fix directly.

---

## Tab: Snapshots

A history of contract snapshots — each with its ID, edge count, and timestamp. Use
this to see when the baseline was last updated. If the snapshot is months old, your
findings might be flagging intentional changes made since then.

To refresh the baseline: run a new full SDK crawl from the [Inventory](/admin/inventory)
page, then re-scan.

---

## Common tasks

### Post-deploy check (the fast path)
1. Open the Scanner tab.
2. Set max paths to 50. Click **Run scan**.
3. Tab to Findings. No critical findings? Green light.
4. Critical findings? Click View → check Expected vs Actual → decide: dismiss or fix.

### Investigating a user-reported blank page
1. Run a scan with max paths 500 (thorough).
2. In Findings, filter to `critical` severity.
3. Look for `MISSING_ROUTE` findings that match the page users reported.
4. If found: confirm the route was removed unintentionally → dispatch a fix.

### Keeping the baseline current
After major route additions:
1. Trigger a new SDK crawl from [Inventory](/admin/inventory).
2. Run a drift scan immediately after — the new routes should show 0 findings.
3. If findings appear for your new routes, the snapshot didn't update correctly — check the SDK crawl logs.

---

## API

```bash
POST /v1/admin/drift/scan             { "project_id": "", "max_paths": 50 }
GET  /v1/admin/drift?project_id=&limit=100
GET  /v1/admin/drift/snapshots?project_id=
PATCH /v1/admin/drift/            { "status": "dismissed" }
POST  /v1/admin/drift//create-lesson
```

---

## Related pages

- [Iterate](/admin/iterate) — run a full quality scoring loop after clearing drift findings
- [Inventory & user stories](/admin/inventory) — update the baseline snapshot
- [Fix drafts](/admin/fixes) — act on critical findings
- [Knowledge graph](/admin/graph) — visualise the contract snapshot as a graph
