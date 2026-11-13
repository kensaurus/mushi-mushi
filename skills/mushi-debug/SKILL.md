---
name: mushi-debug
description: "Check whether a Mushi Mushi install works, then find what is broken: a pass/fail health check (CLI sign-in, API, report pipeline, AI key pool, scheduled QA runs), followed by targeted fixes when reports do not arrive, MCP tools fail, LLM keys run out, story mapping or generated tests fail, Slack stays quiet or the auto-improve loop stops. Use when asked 'is mushi working', 'mushi health check', 'check mushi pipeline' or 'mushi deploy check', when Mushi is broken or silent, or right after setup."
triggers:
  - "is mushi working"
  - "mushi health check"
  - "mushi health"
  - "check mushi pipeline"
  - "mushi deploy check"
  - "mushi status check"
  - "verify mushi running"
  - "pipeline not responding"
  - "mushi not working"
  - "sdk not reporting"
  - "story map failed"
  - "qa story failing"
  - "api key exhausted"
  - "inventory not accepted"
  - "pdca not running"
  - "debug mushi"
  - "fix mushi"
license: MIT
---

# Mushi Mushi — health check and debugging

Start with the health check. It is six pass/fail steps; stop at the first
failure and jump to the matching section under **When a step fails**. Every
step uses the CLI, the MCP server or the console, so it works the same on
Mushi Cloud and on a self-hosted install.

Every `mushi <command>` below also runs as `npx mushi-mushi <command>`, with no
install. `npm install -g @mushi-mushi/cli` gives you the short `mushi`.

## Health check

| # | Component | Command | Healthy when |
|---|-----------|---------|--------------|
| 1 | CLI sign-in | `mushi doctor` | Every line reads `OK` |
| 2 | API | `mushi deploy check` | `Health: OK (200)` |
| 3 | Project and plan | `mushi status`, `mushi billing status` | Counts look right; diagnoses under the limit |
| 4 | AI key pool | `mushi keys list` (MCP: `list_byok_keys`) | An `active` key for `anthropic` or `openai` |
| 5 | Report pipeline | `mushi test`, then `mushi reports list --limit 1` | Newest report `classified` within about 30 s |
| 6 | Scheduled QA runs | `mushi qa stories` | Each enabled story has a recent run |

### 1. CLI sign-in

```bash
mushi doctor
```

The CLI prints `OK` / `WARN` / `FAIL` text markers. Exit codes: `0` all pass,
`2` warnings only, `1` any hard failure. Each `FAIL` line is followed by a
`→ Fix:` hint; `mushi doctor --json` carries the same hints in a `hint` field.
`mushi doctor --full` runs every check category at once, and
`mushi doctor --qa-stories` adds the QA-story checks.

Inside an editor, the MCP tool `diagnose_setup` runs the same diagnosis from
the agent's side and names the next action; `activation_status` reports the
phase (`ingest` → `dispatch` → `loop`).

### 2. API

```bash
mushi deploy check
```

Calls the API's `/health` endpoint once and prints `Health: OK (200) — 180ms`.
This checks the API only; steps 5 and 6 exercise the classifier and the QA
runner.

### 3. Project and plan

```bash
mushi status           # reports by status and severity, fixes, lessons
mushi billing status   # plan, diagnoses used against the limit, spend cap
```

Zero reports is fine for a brand-new project. `Diagnoses` must be under its
limit, or new reports stop getting a diagnosis.

### 4. AI key pool

```bash
mushi keys list
```

The hosted free plan diagnoses without a key of your own. If you added keys,
at least one `anthropic` or `openai` key should be `active`, plus a
`firecrawl` key if you use story mapping. A key marked `quota_exhausted` is
cooling down for an hour — see [LLM key quota](#llm-key-quota-or-rate-limit).

### 5. Report pipeline

```bash
mushi test
mushi reports list --limit 1
```

The newest report's `STATUS` should reach `classified`, with its `SEV` column
filled, within about 30 seconds.

### 6. Scheduled QA runs

Skip this step if you have no enabled QA stories.

```bash
mushi qa stories            # last run per story; [disabled] marks paused ones
mushi qa runs <story-id>    # recent runs for one story
```

### Summary

| Component | Status | Notes |
|-----------|--------|-------|
| CLI sign-in | ✅ / ❌ | |
| API | ✅ / ❌ | Status and latency |
| Project and plan | ✅ / ❌ | Diagnoses under the limit? |
| AI key pool | ✅ / ❌ | Missing providers? |
| Report pipeline | ✅ / ❌ | Classified within a minute? |
| Scheduled QA runs | ✅ / ❌ | Last run at? |

All ✅ means the install is healthy. For proof that the whole loop works end
to end (story mapping, generated tests, auto-improve), run
[`mushi-test`](../mushi-test/SKILL.md).

## When a step fails

### CLI sign-in or API fails

- Follow the `→ Fix:` hint, or sign in again with `mushi login` (it opens the
  browser). `mushi login --api-key mushi_... --project-id <uuid>` is the
  non-interactive form for CI.
- Can't reach the endpoint: the saved endpoint in `~/.config/mushi/config.json`
  is wrong. Run `mushi login` again, adding `--endpoint https://...` only if
  you self-host.
- Browser sign-in never completes: `mushi doctor --auth`.
- `mushi deploy check` fails on a self-hosted install: a free-tier Supabase
  project may be paused. Restore it in the Supabase dashboard, then read the
  `api` function's logs (see
  [`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md)).
  On Mushi Cloud, open an issue with the output.

### Reports are not arriving

**Symptom:** you click the widget and nothing shows in the console.

1. `mushi test` splits "SDK problem" from "pipeline problem". If the CLI's
   report arrives but the app's do not, the SDK is the problem: check that
   `Mushi.init` (or `<MushiProvider>`) runs once, before the first navigation,
   with the framework-prefixed env vars the wizard wrote (`VITE_MUSHI_*`,
   `NEXT_PUBLIC_MUSHI_*`, `EXPO_PUBLIC_MUSHI_*`, …), and that the build
   actually inlines them. Look for `[Mushi]` errors in the browser console.
2. `mushi doctor --host-app` checks the app's env vars and editor wiring.
3. If neither report arrives, or one sits in `pending` for more than a minute,
   classification failed. Check the diagnosis limit (step 3) and the key pool
   (step 4).

### LLM key quota or rate limit

**Symptom:** fix attempts or diagnoses fail with "All LLM keys exhausted".

```bash
mushi keys list
```

Look for `status=quota_exhausted` and its cooldown. Add a backup key. Pass it
through `MUSHI_BYOK_KEY` so it stays out of shell history and the process list
(a lower `--priority` number is tried first):

```bash
MUSHI_BYOK_KEY="$ANTHROPIC_API_KEY" mushi keys add --provider anthropic --label backup --priority 200
MUSHI_BYOK_KEY="$OPENAI_API_KEY" mushi keys add --provider openai --label openai-backup --priority 300
```

`mushi keys test <key-id>` probes one key. In the console the pool lives under
**Settings → AI keys** (`/settings?tab=byok`).

### Story mapping failed

**Symptom:** `mushi stories map` errors, or "Map from live app" shows `failed`.

1. Console → **Inventory → Discovery → Recent crawls**: expand the failed run
   and read `error_message`.
2. Common causes:
   - No Firecrawl key: add one under **Settings → AI keys**, or
     `MUSHI_BYOK_KEY="$FIRECRAWL_API_KEY" mushi keys add --provider firecrawl`.
   - The URL is localhost or behind a login: map the public URL, or use the
     Browserbase provider (`--provider browserbase`) with session cookies.
   - The LLM key pool is exhausted: see above.
3. Retry smaller: `mushi stories map --url <url> --max-pages 5 --wait`.

### Generated tests fail or never run

- `mushi tdd gen <story-id>` says the story is not found → the id must come
  from an accepted inventory. Accept the proposal first (**Inventory →
  Discovery → Past proposals → Accept**).
- A test sits in `pending_review` → `mushi tdd pending`, then
  `mushi tdd approve <qa-story-id>`.
- Disabled, or `automation_mode = approve` → enable it in **QA Coverage →
  story detail**.
- Run one now: `mushi qa run <story-id>`, then `mushi qa runs <story-id>`.

| QA run error | Cause | Fix |
|--------------|-------|-----|
| `Firecrawl 401 Unauthorized` | No Firecrawl key on the project | Add one (see story mapping above) |
| `no_target_url: set a Target URL on this story` | The story has no target URL and its prompt names none | **QA Coverage → Edit → Target URL** |
| `No accepted inventory` | No proposal has been accepted | Accept one in **Inventory → Discovery** |

### Auto-improve is not rewriting failing tests

1. Only generated stories (`source=test_gen_from_story`) with automation mode
   `auto` or `review` are eligible.
2. Trigger it by hand and read the output: `mushi tdd improve`.
3. Rewritten tests land in **QA Coverage** with `source=pdca`.

### Inventory missing after you accept a proposal

Console → **Inventory**. If the proposal shows `accepted` but no active
inventory appears, the accept step failed: retry it, and if it fails again,
open an issue with the proposal id and the time you accepted it.

### Slack stays quiet

```bash
mushi slack status
mushi slack test
```

Not connected → **Integrations → Slack → Add to Slack**, pick the channel,
then `mushi slack test` again. Connected but no QA alerts → check that
`qa_story.failed` is on under **Integrations → Notification preferences**.
From the editor, `test_notification_channel` sends the same test ping.

### Fix dispatch does not open a PR

- `mushi integrations test github` checks the GitHub connection.
- The project needs a connected repo and an AI key.
- `get_fix_timeline { fixId }` (MCP) or `mushi fixes tail --report-id <id>`
  shows where the attempt stopped.

### MCP tool errors

| Error | Fix |
|-------|-----|
| `UNAUTHENTICATED` / 401 | Sign in again from the editor's MCP panel, or mint a new `mcp:read` key |
| `INSUFFICIENT_SCOPE` / 403 | The key lacks `mcp:write`; mint one with it for write tools |
| `PROJECT_REQUIRED` | Pass `projectId`, or set `MUSHI_PROJECT_ID` for the stdio server |
| `ALL_KEYS_EXHAUSTED` / 429 | Add a backup LLM key (see above) |

## Common error messages

| Error | Cause | Fix |
|-------|-------|-----|
| `No Firecrawl API key configured` | Missing Firecrawl key | Add one under Settings → AI keys, or `mushi keys add --provider firecrawl` |
| `All LLM keys exhausted` | Every Anthropic/OpenAI key hit quota | Add a backup key with `mushi keys add` |
| `Story not found` in test generation | Story id not in an accepted inventory | Accept the inventory proposal first |
| `byok_keys_provider_slug_check` | Invalid provider slug | Use one of: anthropic, openai, openrouter, firecrawl, browserbase, cursor, supabase |
| `relation … does not exist` | A self-hosted database is missing migrations | Apply them as described in [`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md) |

## Self-hosting

On your own Supabase project you also own the database, the edge functions and
their logs. Migrations, function deploys and log access are covered in
[`SELF_HOSTED.md`](https://github.com/kensaurus/mushi-mushi/blob/master/SELF_HOSTED.md).

Still stuck? [Open an issue](https://github.com/kensaurus/mushi-mushi/issues/new/choose)
with the `mushi doctor --json` output (it masks your API key; check it before
pasting anyway).
