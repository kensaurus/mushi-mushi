---
name: mushi-mushi
description: "Set up and use Mushi Mushi, the bug mediator for AI-built apps: a user's bug report becomes a plain-English diagnosis and a paste-ready fix in Cursor or Claude Code over MCP. Use when installing the Mushi SDK, wiring the MCP server, managing Mushi keys, or asking how a Mushi feature works."
triggers:
  - "setup mushi"
  - "install mushi"
  - "mushi api key"
  - "mushi sdk"
  - "mushi mcp"
  - "map user stories"
  - "tdd scenario"
  - "qa story"
  - "byok key"
  - "story mapper"
---

# Mushi Mushi — setup and everyday use

Mushi sits between your users and your editor. A user reports a bug from inside
your app (a sentence, plus the screenshot, console and network tail Mushi
captures for them). Mushi turns that report into a plain-English diagnosis and
a fix prompt scoped to the files involved, and your agent pulls it into Cursor
or Claude Code over MCP. The MCP server needs no LLM key of its own.

Beyond that core loop, the same project gives you:

- **Story mapping** — draft user stories from a live URL, no YAML to write.
- **Test generation** — turn an accepted story into a Playwright spec.
- **Auto-improve** — failing generated tests are rewritten and queued for review.
- **BYOK key pool** — priority-ordered LLM keys with automatic failover.

## Quick start

### 1. Add the SDK to your app

The wizard detects your framework, installs the right package and writes the
env vars:

```bash
npx mushi-mushi
```

Or by hand, for any browser app:

```bash
npm install @mushi-mushi/web
```

```ts
import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: import.meta.env.VITE_MUSHI_API_KEY, // or your framework's public env var
  capture: {
    discoverInventory: { enabled: true },
  },
})
```

### 2. Connect your editor

```bash
npx mushi-mushi setup --ide cursor   # or: --ide claude
```

Then ask your agent: *"what's broken in prod?"*

### 3. Install the CLI (optional)

```bash
npm install -g @mushi-mushi/cli
mushi login          # opens the browser; no copy-paste
```

## MCP integration (Cursor, Claude Code, Claude Desktop)

`npx mushi-mushi setup --ide …` writes this for you. To wire it by hand, add to
your MCP config (`.cursor/mcp.json` for Cursor, `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "mushi_...",
        "MUSHI_PROJECT_ID": "<project-id>"
      }
    }
  }
}
```

Replace the two placeholders with the values from the console, and keep a
config that holds a real key out of git. Set `MUSHI_API_ENDPOINT` only if you
self-host; it defaults to Mushi Cloud.

Tools you will reach for first:

| Tool | What it does |
|------|-------------|
| `get_recent_reports` | Survey the bug queue |
| `get_report_detail` | One report with its diagnosis and evidence |
| `get_fix_context` | The fix prompt and the files involved |
| `dispatch_fix` | Hand a report to a sandboxed fix agent that opens a draft PR |
| `map_user_stories` | Crawl a live URL and draft user stories |
| `generate_tdd_from_story` | Write a Playwright test from a story id |
| `improve_qa_story` | Rewrite a failing generated test |
| `run_qa_story` | Trigger a manual QA run |
| `list_pending_review_stories` | Generated tests waiting for approval |
| `approve_qa_story` | Approve or reject a pending test |
| `list_byok_keys` / `add_byok_key` | Inspect or extend the LLM key pool |

## Story mapping and generated tests (CLI)

```bash
# Draft user stories from a live URL
mushi stories map --url https://your-app.vercel.app --wait

# Generate a test for an accepted story, then review it
mushi tdd gen login-flow --mode review
mushi tdd pending
mushi tdd approve <qa-story-id>

# Rewrite recently failing generated tests
mushi tdd improve
```

In the console the same flows live under **Inventory → Discovery → "Map from
live app"** and **QA Coverage**. Rewritten tests are created with
`source=pdca` and gated by the story's automation mode:

| Mode | Behaviour |
|------|-----------|
| `auto` | Enabled in the QA schedule immediately |
| `review` | Waits in the "pending review" queue |
| `approve` | Created disabled; you enable it by hand |

## BYOK key pool

Mushi keeps a priority-ordered pool of LLM keys per provider. When a key hits
its quota, Mushi marks it `quota_exhausted` with a one-hour cooldown, falls back
to the next active key, and shows a "Switch key" banner in the console.

Pass the key through the `MUSHI_BYOK_KEY` environment variable so it never
lands in your shell history or the process list:

```bash
mushi keys list

# Add a backup Anthropic key, read from a variable you already have set
MUSHI_BYOK_KEY="$ANTHROPIC_API_KEY" mushi keys add --provider anthropic --label backup --priority 200
```

## Console pages

| Page | Path | Use it for |
|------|------|-----------|
| Reports | `/reports` | The bug queue and each diagnosis |
| Inventory | `/inventory` | Accept story proposals, review map runs |
| QA Coverage | `/qa-coverage` | Pending generated tests and run history |
| Settings → LLM keys | `/settings/llm-keys` | The BYOK key pool |

## Environment variables

| Variable | Description |
|----------|-------------|
| `MUSHI_API_KEY` | Project API key (starts with `mushi_`) for the CLI and MCP server |
| `MUSHI_PROJECT_ID` | Project UUID from the console |
| `MUSHI_API_ENDPOINT` | Self-hosted API URL; leave unset for Mushi Cloud |
| `MUSHI_BYOK_KEY` | One-shot input for `mushi keys add` |

Something not working? Use [`mushi-health`](../mushi-health/SKILL.md) for a
pass/fail check, then [`mushi-debug`](../mushi-debug/SKILL.md).
