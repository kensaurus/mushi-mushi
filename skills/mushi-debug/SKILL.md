---
name: mushi-debug
description: "Debug a Mushi Mushi install that is not working: SDK reports not arriving, MCP tools failing, LLM key exhaustion, story mapping or generated-test failures, or the auto-improve loop not running. Use when something in Mushi is broken or silent."
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

# Mushi Mushi — debug guide

Work top to bottom and stop at the first thing that is wrong. Every step uses
the CLI, the MCP server or the console, so it works the same on Mushi Cloud and
on a self-hosted install.

## Diagnostic checklist

### 1. Check credentials and connectivity

```bash
mushi doctor
```

Every line should read `OK`. Each `FAIL` line is followed by a `→ Fix:` hint;
`mushi doctor --json` carries the same hints. If the key or endpoint is wrong,
run `mushi login` again (it opens the browser).

Inside an editor, the MCP tool `diagnose_setup` runs a setup diagnosis from the
agent's side (ingest and fix-dispatch readiness) and names the next action.

### 2. Reports are not arriving

**Symptom:** you click the widget, nothing shows in the console.

1. Send a report from the CLI to split "SDK problem" from "pipeline problem":

   ```bash
   mushi test
   ```

2. If `mushi test` arrives but the app's reports do not, the SDK is the
   problem: check that `Mushi.init` runs once, before the first navigation,
   with the framework-prefixed env vars the wizard wrote (`VITE_MUSHI_*`,
   `NEXT_PUBLIC_MUSHI_*`, …), and that your build actually inlines them.
3. If neither arrives, check the newest report and its status:

   ```bash
   mushi reports list --limit 1
   ```

   A report stuck in `pending` for more than a minute means classification
   failed — see step 7.

### 3. Story mapping failures

**Symptom:** "Map from live app" shows `failed`.

1. Console → **Inventory → Discovery → Recent crawls**, expand the failed run
   and read `error_message`.
2. Common causes:
   - No Firecrawl key: **Settings → LLM keys → add a Firecrawl key**.
   - The URL is behind a login: use the Browserbase provider and configure
     session cookies.
   - Claude quota exhausted: add a backup Anthropic key (step 6).

### 4. Generated-test failures

**Symptom:** `mushi tdd gen <storyId>` returns an error.

```bash
mushi tdd pending   # lists generated tests pending review
```

- The story id is not in an accepted inventory → accept the proposal first
  (**Inventory → Discovery → Past proposals → Accept**).
- All LLM keys are exhausted → `mushi keys list`, then add a backup key.

### 5. QA stories not running

**Symptom:** tests never execute on schedule.

```bash
mushi qa stories            # every story, its last run, and whether it is disabled
mushi qa runs <story-id>    # recent runs for one story
mushi tdd pending           # stories stuck in pending_review
```

- `pending_review` → approve with `mushi tdd approve <id>`.
- Disabled → enable it in **QA Coverage → story detail**.
- `automation_mode = approve` → the story needs a manual enable.
- Run one immediately: `mushi qa run <story-id>`.

### 6. LLM key quota or rate limit

**Symptom:** fix attempts fail with "All LLM keys exhausted".

```bash
mushi keys list
```

Look for `status=quota_exhausted` and its cooldown. Add a backup key. Pass it
through `MUSHI_BYOK_KEY` so it stays out of shell history:

```bash
MUSHI_BYOK_KEY="$ANTHROPIC_API_KEY" mushi keys add --provider anthropic --label backup2 --priority 200

# Or an OpenAI key as a fallback provider
MUSHI_BYOK_KEY="$OPENAI_API_KEY" mushi keys add --provider openai --label openai-backup --priority 300
```

### 7. Inventory not showing up after you accept a proposal

Console → **Inventory**. If the proposal shows `accepted` but no active
inventory appears, the accept step failed: retry the accept, and if it fails
again, open an issue with the proposal id and the time you accepted it.

### 8. Auto-improve not rewriting failing tests

1. Only generated stories (`source=test_gen_from_story`) with automation mode
   `auto` or `review` are eligible.
2. Trigger it by hand and read the output: `mushi tdd improve`.
3. Rewritten tests land in **QA Coverage** with `source=pdca`.

### 9. Pipeline health at a glance

```bash
mushi deploy check   # pings each edge function
mushi status         # project overview, autofix agent, billing warnings
```

## Common error messages

| Error | Cause | Fix |
|-------|-------|-----|
| `No Firecrawl API key configured` | Missing BYOK key | Add one in Settings → LLM keys |
| `All LLM keys exhausted` | Every Anthropic/OpenAI key hit quota | Add a backup key with `mushi keys add` |
| `Story not found` in test generation | Story id not in an accepted inventory | Accept the inventory proposal first |
| `byok_keys_provider_slug_check` | Invalid provider slug | Use one of: anthropic, openai, firecrawl, browserbase, cursor |
| `relation … does not exist` | A self-hosted database is missing migrations | Apply them as described in [`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md) |

## Self-hosting

On your own Supabase project you also own the database, the edge functions and
their logs. Migrations, function deploys and log access are covered in
[`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md).

Still stuck? [Open an issue](https://github.com/kensaurus/mushi-mushi/issues/new/choose)
with the `mushi doctor --json` output (it masks your API key; check it before
pasting anyway).
