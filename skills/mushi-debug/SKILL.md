---
name: mushi-debug
description: >-
  Debug Mushi Mushi issues — edge function errors, SDK not reporting, API key
  problems, failed story mapping, failing QA stories, missing inventory, and
  PDCA loop issues. Use when something isn't working in Mushi.
triggers:
  - "mushi not working"
  - "sdk not reporting"
  - "story map failed"
  - "qa story failing"
  - "api key exhausted"
  - "inventory not accepted"
  - "pdca not running"
  - "debug mushi"
  - "fix mushi"
---

# Mushi Mushi — Debug Guide

## Diagnostic Checklist (run in order)

### 1. Check SDK connectivity

```bash
# Run the doctor command — checks connectivity and key validity
mushi doctor
```

Expected output: all checks green. If `MUSHI_API_KEY` fails, re-run `mushi login`.

### 2. Check Sentry for edge function errors

Use the Sentry MCP:
```
get_sentry_issues project=mushi-be
```

Look for errors in `story-mapper`, `test-gen-from-story`, `pdca-runner`, `inventory-propose`.

### 3. Story mapping failures

**Symptom**: "Map from live app" shows `failed` status

**Diagnose**:
1. Open the console → Inventory → Discovery → Recent crawls
2. Expand the failed run to see `error_message`

**Common causes**:
- No Firecrawl API key: go to Settings → API Keys → Add a Firecrawl key
- URL is behind auth: use Browserbase provider + configure session cookies
- Claude quota exhausted: add a backup Anthropic key with `mushi keys add`

### 4. TDD test generation failures

**Symptom**: `mushi tdd gen <storyId>` returns error

**Diagnose**:
```bash
# Check that a story exists in the accepted inventory
mushi tdd pending  # lists qa stories pending review
```

**Common causes**:
- Story id doesn't exist in accepted inventory → accept the inventory proposal first
- All LLM keys exhausted → `mushi keys list` then add a backup key

### 5. QA stories not running

**Symptom**: Tests never execute on schedule

**Diagnose**:
```bash
mushi tdd pending  # check if stories are stuck in pending_review
```

- If `approval_status = pending_review`: approve them with `mushi tdd approve <id>`
- If `enabled = false`: toggle enabled in console → QA Coverage → story detail
- If `automation_mode = approve`: the story requires manual enable

### 6. API key quota / rate limit

**Symptom**: Fix attempts fail with "All LLM keys exhausted"

**Diagnose**:
```bash
mushi keys list
```

Look for `status=quota_exhausted` with a cooldown time.

**Fix**:
```bash
# Add a backup key
mushi keys add --provider anthropic --key sk-ant-... --label "backup2" --priority 200

# Or add an OpenAI key as fallback
mushi keys add --provider openai --key sk-... --label "openai-backup" --priority 300
```

### 7. Inventory not showing up

**Symptom**: Inventory page shows no active inventory after accepting a proposal

**Check in DB** (Supabase MCP):
```sql
SELECT id, status, source, created_at 
FROM inventory_proposals 
WHERE project_id = '<your-project-id>'
ORDER BY created_at DESC LIMIT 5;

SELECT id, status, created_at
FROM inventories
WHERE project_id = '<your-project-id>'
ORDER BY created_at DESC LIMIT 3;
```

If `inventories` is empty but `inventory_proposals` has `accepted` rows, the accept flow failed — check Sentry.

### 8. PDCA auto-improve not triggering

**Symptom**: Failing tests never get rewritten

**Check**:
1. Cron is registered: run `SELECT jobname, schedule FROM cron.job;` in Supabase SQL editor
2. The stories have `source=test_gen_from_story` and `automation_mode` in `['auto', 'review']`
3. Trigger manually: `mushi tdd improve`

### 9. Edge function logs

Use the Supabase MCP:
```
get_logs service=api
get_logs service=postgres
```

Or via CLI:
```bash
supabase functions logs story-mapper
supabase functions logs test-gen-from-story
supabase functions logs pdca-runner
```

## Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `No Firecrawl API key configured` | Missing BYOK key | Add key in Settings → API Keys |
| `All LLM keys exhausted` | All Anthropic/OpenAI keys hit quota | Add backup key with `mushi keys add` |
| `Story not found` in test-gen | Story id not in accepted inventory | Accept the inventory proposal first |
| `byok_keys_provider_slug_check` | Invalid provider slug | Use: anthropic, openai, firecrawl, browserbase, cursor |
| `relation story_map_runs does not exist` | Migration not applied | Run pending migrations on remote |

## Applying Pending Migrations

If you get "relation does not exist" errors, migrations may not be deployed:

```bash
cd packages/server
supabase db push --db-url postgresql://...
```

Or use the Supabase MCP `apply_migration` for each file in order:
1. `20260602000000_byok_multikey_pool.sql`
2. `20260602000001_story_map_runs.sql`
3. `20260602000002_qa_stories_tdd_columns.sql`
4. `20260602000003_pdca_qa_improve_cron.sql`
