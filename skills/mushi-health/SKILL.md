---
name: mushi-health
description: "Pass/fail health check across a Mushi Mushi install: CLI credentials, API reachability, edge functions, the BYOK key pool and scheduled QA runs. Use when asked 'is mushi working', 'mushi health check', 'check mushi pipeline' or 'mushi deploy check', when the pipeline stops responding, or right after setup."
triggers:
  - "is mushi working"
  - "mushi health check"
  - "check mushi pipeline"
  - "mushi deploy check"
  - "pipeline not responding"
  - "mushi status check"
  - "verify mushi running"
  - "mushi health"
license: MIT
---

# Mushi health check

Run these checks in order. Stop and fix at the first ❌ before continuing.
Every step uses the CLI or the MCP server, so it works the same on Mushi Cloud
and on a self-hosted install.

## Component map

| # | Component | How to check |
|---|-----------|-------------|
| 1 | CLI credentials | `mushi doctor` |
| 2 | API + edge functions | `mushi deploy check` |
| 3 | Project overview | `mushi status` |
| 4 | BYOK key pool | `mushi keys list` or MCP `list_byok_keys` |
| 5 | Report pipeline | `mushi test`, then `mushi reports list --limit 1` |
| 6 | Scheduled QA runs | `mushi qa stories`, then `mushi qa runs <story-id>` |

---

## Step 1 — CLI credentials

```bash
mushi doctor
```

Expected output — every check prefixed `OK` (the CLI prints `OK` / `WARN` /
`FAIL` text markers, not checkmarks):

```
OK CLI config file
OK API key configured
OK Project ID configured
OK Endpoint reachable
```

Exit codes: `0` all pass · `2` advisory warnings only · `1` any hard failure.
Each `FAIL` line is followed by a `→ Fix:` hint; `mushi doctor --json` includes
the same hints in a `hint` field.

**Fix if FAIL:** follow the printed `→ Fix:` hint, or run `mushi login` again
(it opens the browser; `mushi login --api-key mushi_... --project-id <uuid>` is
the non-interactive form for CI).

---

## Step 2 — API + edge functions

```bash
mushi deploy check
```

Probes each edge function with a lightweight ping. Healthy output:

```
✓  api
✓  classify-report
✓  fix-worker
✓  story-mapper
✓  test-gen-from-story
✓  pdca-runner
✓  qa-story-runner
```

A `✗` on any line means that function is down. On Mushi Cloud, open an issue
with the output; if you self-host, read that function's logs (see
[`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md)).

---

## Step 3 — Project overview

```bash
mushi status
```

Confirm:
- Report count is non-zero (or expected zero for a brand-new project).
- `autofix_agent` shows the expected agent (`cursor_cloud`, `mcp`, etc.).
- No `billing: quota_exceeded` warning.

---

## Step 4 — BYOK key pool

Via CLI:

```bash
mushi keys list
```

Via MCP (if the Mushi MCP server is active in your editor):

```
list_byok_keys(projectId)
```

**Healthy:** at least one `anthropic` key with `status=active`, and at least
one `firecrawl` key with `status=active` if you use story mapping.

**Fix:** add a missing or exhausted key. Pass it through `MUSHI_BYOK_KEY` so it
stays out of shell history and the process list:

```bash
MUSHI_BYOK_KEY="$ANTHROPIC_API_KEY" mushi keys add --provider anthropic --label primary --priority 100
MUSHI_BYOK_KEY="$FIRECRAWL_API_KEY" mushi keys add --provider firecrawl --label primary --priority 100
```

---

## Step 5 — Report pipeline

Send a test report and watch it get classified:

```bash
mushi test
mushi reports list --limit 1
```

**Healthy:** the newest report reaches `classified` with a severity and
category within about 30 seconds. Still `pending` after a minute means
classification failed — continue with [`mushi-debug`](../mushi-debug/SKILL.md).

---

## Step 6 — Scheduled QA runs

Skip this step if you have no enabled QA stories.

```bash
mushi qa stories              # last run per story; [disabled] marks paused ones
mushi qa runs <story-id>      # recent runs for one story
```

**Healthy:** each enabled story shows a recent run.

If nothing has run:
1. Check the story is approved: `mushi tdd pending` lists stories still waiting.
2. Check it is enabled in **QA Coverage → story detail**.
3. Trigger one run by hand: `mushi qa run <story-id>`, then re-check.

---

## Pass/fail summary template

After running all steps, record results:

| Component | Status | Notes |
|-----------|--------|-------|
| CLI credentials | ✅ / ❌ | |
| Edge functions | ✅ / ❌ | Which ones failed? |
| Project overview | ✅ / ❌ | Billing ok? |
| BYOK key pool | ✅ / ❌ | Missing providers? |
| Report pipeline | ✅ / ❌ | Classified within a minute? |
| Scheduled QA runs | ✅ / ❌ | Last run at? |

If all ✅ → the pipeline is healthy.
If any ❌ → use [`mushi-debug`](../mushi-debug/SKILL.md) for targeted diagnosis.

---

## Common causes of all-red

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `mushi doctor` can't reach the endpoint | Wrong endpoint in `~/.config/mushi/config.json` | Run `mushi login` again (add `--endpoint https://...` if you self-host) |
| Every edge function ❌ on a self-hosted install | Supabase project paused (free tier) | Restore the project in the Supabase dashboard |
| BYOK keys all `quota_exhausted` | Rate limits hit on every key | Add a backup key for each provider |
