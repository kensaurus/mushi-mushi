# `@mushi-mushi/cli`

> **The mutation that closes the loop** — run Mushi Mushi bug-intelligence from
> your terminal and CI pipelines, without ever opening a browser.

## What it does

Like DNA repair enzymes that scan a genome for transcription errors and patch
them before the next cell division, `mushi-mushi` scans your live project for
bug patterns, feeds them back into your toolchain, and tells you which ones are
still open. The CLI is the command-line face of that repair loop:

| Before `@mushi-mushi/cli` | After `@mushi-mushi/cli` |
|---|---|
| Open the console to check if the bug you fixed is actually resolved | `mushi reports show <id>` in 1 second |
| Manually copy SDK snippets into each new project | `mushi init` auto-detects your framework and installs everything |
| No idea which mistake rules are active | `mushi lessons list` shows the current rule genome |
| CI doesn't know about lesson files | `mushi sync-lessons` writes `.mushi/lessons.json` every deploy |
| Debug auth failures by staring at headers | `mushi whoami` confirms key + endpoint in one shot |

---

## Quick start

```bash
# 1. Install globally (or use npx without installing)
npm install -g @mushi-mushi/cli   # or: pnpm add -g / yarn global add

# 2. Get your credentials from the Mushi console:
#    Project ID  → https://kensaur.us/mushi-mushi/projects   (copy chip)
#    API key     → https://kensaur.us/mushi-mushi/settings/api-keys

# 3. Save credentials
mushi login \
  --api-key   mushi_xxxxxxxxxxxxxxxxxxxx \
  --endpoint  https://<ref>.supabase.co/functions/v1/api \
  --project-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 4. Verify the connection
mushi whoami

# 5. Set up the SDK in a project
cd my-app && mushi init
```

---

## Environment variables

All credentials can be supplied via environment variables — ideal for CI
where a config file per runner is impractical:

| Variable | Description |
|---|---|
| `MUSHI_API_KEY` | SDK API key, looks like `mushi_...` |
| `MUSHI_PROJECT_ID` | Project UUID, from the Projects page |
| `MUSHI_API_ENDPOINT` | Supabase edge function URL |

Environment variables override `~/.mushirc`. Explicit command-line flags
override both.

```bash
# Example: CI usage without any persistent config file
export MUSHI_API_KEY=mushi_xxxx
export MUSHI_PROJECT_ID=542b34e0-019e-41fe-b900-7b637717bb86
export MUSHI_API_ENDPOINT=https://xyz.supabase.co/functions/v1/api

mushi sync-lessons   # writes .mushi/lessons.json
mushi status         # print project stats
mushi ping           # smoke-test connectivity
```

---

## Finding your credentials

### API key

1. Open the Mushi console → **Settings → API Keys**
   (`https://kensaur.us/mushi-mushi/settings`)
2. Click **Create API key**
3. Copy the value — it starts with `mushi_`

### Project ID

1. Open the Mushi console → **Projects**
   (`https://kensaur.us/mushi-mushi/projects`)
2. On the project card, click the UUID chip to copy it
3. The UUID looks like `542b34e0-019e-41fe-b900-7b637717bb86`

### API endpoint

Unless you are self-hosting, use:
```
https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api
```

---

## Commands

### `mushi init`

Set up the Mushi SDK in the current project. Auto-detects framework, installs
the right package, and writes a minimal config file.

```bash
mushi init
mushi init --project-id <uuid> --api-key <key>   # non-interactive (CI)
mushi init --framework next                       # force a framework
mushi init --skip-install                         # print install command only
mushi init --yes                                  # skip confirmation prompts
```

Supported frameworks: `next`, `react`, `vue`, `nuxt`, `svelte`, `sveltekit`,
`angular`, `expo`, `react-native`, `capacitor`, `vanilla`.

---

### `mushi login`

Save API credentials to `~/.mushirc` (mode `0o600`, readable only by you).

```bash
mushi login \
  --api-key   mushi_xxx \
  --endpoint  https://xyz.supabase.co/functions/v1/api \
  --project-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

### `mushi whoami`

Verify the API key is valid and print which project it belongs to.

```bash
mushi whoami
mushi whoami --json   # machine-readable
```

Example output:
```
✓ Authenticated
  Project:  My App (542b34e0-019e-41fe-b900-7b637717bb86)
  Endpoint: https://xyz.supabase.co/functions/v1/api
  Reports:  47 total · 3 open
```

---

### `mushi ping`

Check that the Mushi backend is reachable. Useful as a CI health gate.

```bash
mushi ping
mushi ping --json   # { ok: true, status: 200, latency_ms: 42 }
```

---

### `mushi status`

Print a project health summary: report counts by status and severity, fix and
lesson totals.

```bash
mushi status
mushi status --json
```

---

### `mushi config`

View or update the config stored in `~/.mushirc`.

```bash
mushi config                                # show all config
mushi config apiKey mushi_xxx               # update a value
mushi config endpoint https://...           # update endpoint
mushi config projectId <uuid>              # update project ID
```

---

### `mushi reports list`

List recent reports for the project.

```bash
mushi reports list
mushi reports list --status new --severity critical
mushi reports list --search "login button"
mushi reports list --limit 50 --json
```

Options:
- `--limit <n>` — max results, 1–100 (default: 20)
- `--status` — filter: `new`, `triaged`, `in_progress`, `resolved`, `dismissed`
- `--severity` — filter: `critical`, `high`, `medium`, `low`
- `--search <query>` — full-text search in summary and description
- `--json` — machine-readable output

---

### `mushi reports show <id>`

Print full details for a single report including environment, breadcrumbs, and
linked fix.

```bash
mushi reports show 7f3e8c20-...
mushi reports show 7f3e8c20-... --json
```

---

### `mushi reports triage <id>`

Update the status and/or severity of a report, and optionally add a note.

```bash
mushi reports triage <id> --status triaged --severity high
mushi reports triage <id> --status in_progress --note "assigned to @alice"
mushi reports triage <id> --severity critical --json
```

---

### `mushi reports resolve <id>`

Mark a report resolved. Shorthand for `triage --status resolved`.

```bash
mushi reports resolve <id>
mushi reports resolve <id> --note "fixed in PR #123"
```

---

### `mushi reports reopen <id>`

Reopen a resolved or dismissed report.

```bash
mushi reports reopen <id>
mushi reports reopen <id> --note "regression in v2.1"
```

---

### `mushi reports dismiss <id>`

Dismiss a report (not a real bug / out of scope).

```bash
mushi reports dismiss <id>
mushi reports dismiss <id> --note "working as intended"
```

---

### `mushi reports search <query>`

Search reports by keyword. Equivalent to `reports list --search <query>`.

```bash
mushi reports search "button not working"
mushi reports search "404" --status new --limit 20 --json
```

---

### `mushi lessons list`

List active mistake rules (lessons) extracted from past bug reports.

```bash
mushi lessons list
mushi lessons list --severity critical
mushi lessons list --limit 100 --json
```

---

### `mushi lessons show <id>`

Print full detail for a lesson: rule text, anti-pattern, and summary paragraph.

```bash
mushi lessons show <lesson-uuid>
mushi lessons show <lesson-uuid> --json
```

---

### `mushi sync-lessons`

Pull all active lessons from the Mushi API and write `.mushi/lessons.json`
into the repo. Used in CI to keep the lesson file fresh for the Mushi MCP
server and Cursor rules.

```bash
mushi sync-lessons               # writes .mushi/lessons.json
mushi sync-lessons --dry-run     # print JSON without writing
mushi sync-lessons --json        # { ok: true, path: "...", count: 12 }
mushi sync-lessons --cwd ./apps/mobile
```

CI example (GitHub Actions):
```yaml
- name: Sync Mushi lessons
  env:
    MUSHI_API_KEY: ${{ secrets.MUSHI_API_KEY }}
    MUSHI_PROJECT_ID: ${{ secrets.MUSHI_PROJECT_ID }}
    MUSHI_API_ENDPOINT: https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api
  run: npx @mushi-mushi/cli sync-lessons
```

---

### `mushi test`

Submit a synthetic test report to verify the ingestion pipeline end-to-end.
Run this after deployment to confirm the SDK → API → DB path is healthy.

```bash
mushi test
mushi test --json
```

---

### `mushi index <path>`

Walk a local repo and upload source code to the Mushi RAG vector index. Used
for private repos that cannot be auto-indexed via the GitHub App integration.

```bash
mushi index ./src
mushi index ./src --language ts --dry-run
mushi index . --json                        # { ok: true, files: 42, bytes: 123456 }
```

---

### `mushi sourcemaps upload`

Upload source map files (`.map`) for stack trace symbolication.

```bash
mushi sourcemaps upload --release 1.0.0
mushi sourcemaps upload --release $(git rev-parse --short HEAD) --dir ./dist
mushi sourcemaps upload --release 1.0.0 --dry-run --silent
```

---

### `mushi migrate`

Suggest the most relevant migration guide based on your `package.json`.

```bash
mushi migrate
mushi migrate --json
```

---

### `mushi deploy check`

Check that the Mushi edge function is healthy and measure round-trip latency.

```bash
mushi deploy check
mushi deploy check --json   # { ok: true, status: 200, latency_ms: 38 }
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | API or runtime error |
| `2` | Configuration error (missing credentials or endpoint) |
| `3` | Not found (report or lesson ID does not exist) |

---

## Self-hosted Mushi

If you run a self-hosted Mushi instance, point the CLI at your edge function:

```bash
mushi login \
  --api-key   mushi_xxx \
  --endpoint  https://your-ref.supabase.co/functions/v1/api \
  --project-id <uuid>
```

Or set `MUSHI_API_ENDPOINT` globally in CI.

---

## Biological evolution analogy

Mushi Mushi is modelled on **cumulative selection** (Dawkins, _The Blind
Watchmaker_) and **closed-loop error correction** (Black Box Thinking, Matthew
Syed):

1. **Variation** — users report bugs via the SDK widget → raw reports accumulate
2. **Selection pressure** — the clustering pipeline groups similar bugs and
   scores them by frequency and severity → weak signals are filtered out
3. **Memory** — high-signal clusters are promoted to _lessons_ (mistake rules)
   → the genome of known failure modes grows
4. **Expression** — the MCP server and CLI inject lessons into AI code review
   → the codebase adapts before the next mutation slips through

The CLI is the **field instrument** for monitoring this loop:
- `mushi status` — read the current fitness of your bug pipeline
- `mushi sync-lessons` — express the latest genome into your repo
- `mushi reports triage` — apply selection pressure manually when the
  automated pipeline needs a nudge

---

## Changelog

See [CHANGELOG.md](../../CHANGELOG.md) for release history.

## License

MIT
