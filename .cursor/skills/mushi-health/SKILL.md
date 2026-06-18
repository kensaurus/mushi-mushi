---
name: mushi-health
description: >-
  Pass/fail health check across every Mushi Mushi pipeline component — CLI
  credentials, API reachability, edge functions, BYOK key pool, QA cron.
  Use when "is mushi working", "mushi health check", "check mushi pipeline",
  "mushi deploy check", "pipeline not responding", or right after setup.
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

# Mushi Health Check

Run these checks in order. Stop and fix at the first ❌ before continuing.

## Component map

| # | Component | How to check |
|---|-----------|-------------|
| 1 | CLI credentials | `mushi doctor` |
| 2 | API + edge functions | `mushi deploy check` |
| 3 | Project overview | `mushi status` |
| 4 | BYOK key pool | `mushi keys list` or MCP `list_byok_keys` |
| 5 | Supabase logs | Supabase MCP `get_logs` |
| 6 | QA cron running | DB query on `qa_story_runs` |

---

## Step 1 — CLI credentials

```bash
mushi doctor
```

Expected output — all lines green:

```
✓  ~/.config/mushi/config.json found
✓  MUSHI_API_KEY valid (mushi_...)
✓  MUSHI_API_ENDPOINT reachable (200 OK)
✓  MUSHI_PROJECT_ID matches a live project
✓  Feature flags fetched
```

**Fix if red:** Re-run `mushi login --api-key mushi_... --endpoint https://<ref>.supabase.co/functions/v1/api --project-id <pid>`.

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

A `✗` on any line means that function is down. Check its logs in Step 5.

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

Via MCP (if the Mushi MCP server is active in Cursor):

```
list_byok_keys(projectId)
```

**Healthy:** at least one `anthropic` key with `status=active`, at least one `firecrawl` key with `status=active`.

**Fix:** Add a missing or exhausted key:

```bash
mushi keys add --provider anthropic --key sk-ant-... --label "primary" --priority 100
mushi keys add --provider firecrawl --key fc-...   --label "primary" --priority 100
```

---

## Step 5 — Supabase edge function logs

Use the Supabase MCP (requires `SUPABASE_ACCESS_TOKEN` in MCP config):

```
get_logs(service: 'api')
```

Look for `ERROR` lines in the last 15 minutes, especially from:
- `story-mapper` — Firecrawl timeout or Claude quota
- `test-gen-from-story` — LLM key exhausted
- `pdca-runner` — failed PDCA cycle
- `qa-story-runner` — Browserbase quota or Firecrawl error

If the Supabase MCP is not wired in Cursor, use the CLI:

```bash
supabase functions logs story-mapper --project-ref <ref>
supabase functions logs qa-story-runner --project-ref <ref>
```

---

## Step 6 — QA cron running

Verify scheduled tests are executing (requires Supabase MCP):

```sql
SELECT status, COUNT(*) 
FROM qa_story_runs 
WHERE created_at > NOW() - INTERVAL '2 hours'
GROUP BY status;
```

**Healthy output:** at least one `completed` row in the last 2 hours (if you have enabled stories).

If `qa_story_runs` is empty:
1. Confirm at least one story has `enabled = true` and `approval_status = 'approved'`.
2. Confirm the pg_cron job is registered: `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'qa%';`
3. Manually trigger: `mushi tdd run <qa-story-id>` and re-check.

---

## Pass/Fail Summary Template

After running all steps, record results:

| Component | Status | Notes |
|-----------|--------|-------|
| CLI credentials | ✅ / ❌ | |
| Edge functions | ✅ / ❌ | Which ones failed? |
| Project overview | ✅ / ❌ | Billing ok? |
| BYOK key pool | ✅ / ❌ | Missing providers? |
| Supabase logs | ✅ / ❌ | Any ERRORs? |
| QA cron | ✅ / ❌ | Last run at? |

If all ✅ → pipeline is healthy.  
If any ❌ → use [`mushi-debug`](../mushi-debug/SKILL.md) for targeted diagnosis.

---

## Common causes of all-red

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `mushi doctor` can't reach endpoint | Wrong `MUSHI_API_ENDPOINT` in `~/.config/mushi/config.json` | Re-run `mushi login --endpoint https://...` |
| All edge functions ❌ | Supabase project paused (free tier) | Restore the project in the Supabase dashboard |
| BYOK keys all `quota_exhausted` | Rate limits hit on all keys | Add a backup key for each provider |
| QA cron never fires | pg_cron job missing | Re-run migration `20260602000003_pdca_qa_improve_cron.sql` |
