---
name: mushi-debug
description: Debug Mushi Mushi issues — SDK not reporting, API errors, LLM key exhaustion, story mapping failures, QA test failures, PDCA loop not running, edge function errors. Use when "mushi is not working", "sdk not pinging", "story map failed", "tdd test not running", "api key exhausted", "fix-worker failed", "pdca not improving", or any mushi error/failure.
---

# Mushi Debug Guide

## SDK Not Reporting Events

**Symptoms**: Inventory → Discovery shows 0 events.

1. Check the SDK is initialized before any navigation:
   ```ts
   Mushi.init({ projectId: '...', apiKey: '...', capture: { discoverInventory: { enabled: true } } })
   ```
2. Verify the API key starts with `mushi_` and belongs to the correct project.
3. Check browser console for `[Mushi]` errors.
4. Run `mushi doctor` — confirms reachability.

## API Key Exhausted / Rate Limited

**Symptoms**: "ALL_KEYS_EXHAUSTED" error, quota banner in Settings.

```bash
# Check key health
mushi keys list

# Add a backup key
mushi keys add --provider anthropic --key sk-ant-... --label "Backup"
```

In the console: **Settings → API Key Pool** → keys in `quota_exhausted` state show cooldown timer (resets in 1 hour automatically).

## Story Mapping Failed

**Symptoms**: `mushi stories map` returns error or crawl run shows `failed`.

1. Confirm Firecrawl key is configured:
   ```bash
   mushi keys list
   # Should show firecrawl [active]
   ```
2. Verify the URL is publicly reachable (not localhost).
3. Check the console: **Inventory → Discovery → Recent crawls** for the error message.
4. Try with fewer pages: `mushi stories map --url <url> --max-pages 5 --wait`

## TDD Test Not Running

**Symptoms**: Generated test stays in `pending_review`, doesn't appear in QA schedule.

1. Check approval status:
   ```bash
   mushi tdd pending
   ```
2. Approve the test: `mushi tdd approve <id>`
3. Verify `enabled=true` in the console: **QA Coverage** page.
4. Manual run: `mushi tdd run <qa-story-id>`

## Edge Function Errors

Check Supabase logs via MCP:
```
Use the Supabase MCP: get_logs(service: 'edge-functions') to see function errors.
```

Or in Supabase dashboard: Functions → Logs → filter by function name.

Common edge function errors:
- `FIRECRAWL_API_KEY not set` → Add key: `mushi keys add --provider firecrawl --key fc-...`
- `No accepted inventory` → Accept a proposal in Inventory → Discovery first
- `story not found` → The story id must match an `id` in the accepted inventory's `user_stories[]`

## PDCA Improve Not Running

**Symptoms**: Failing tests not getting improved automatically.

1. Check cron is registered:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'pdca-qa-story-improve';
   ```
2. Trigger manually:
   ```bash
   mushi tdd improve
   ```
3. Check that failing stories have `source='test_gen_from_story'` and `automation_mode IN ('auto', 'review')`.

## Fix Worker Not Opening PRs

1. Verify GitHub token is set in **Settings → Integrations → GitHub**.
2. Confirm the repo URL matches exactly (with `.git` stripped).
3. Check `fix_attempts` table for error messages.

## MCP Tool Errors

- `MISSING_PROJECT`: pass `projectId` argument explicitly
- `HTTP 403`: API key lacks `mcp:write` scope — regenerate with correct scopes
- `HTTP 429`: All keys exhausted — add backup keys
