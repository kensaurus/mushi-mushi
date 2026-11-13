---
name: mushi-mushi
description: "Find out what is broken in your live app and get it fixed, in plain words, with Mushi Mushi. Start here: it explains the loop and routes to the right Mushi Mushi skill for setup, triage, debugging, tests, SDK upgrades or a free check of a live site. Use when a user says the app is broken or a button does nothing, when you want to check a live Lovable, Bolt, Cursor or Claude Code app for broken pages, or to install the Mushi Mushi report button, MCP server or keys."
triggers:
  - "mushi mushi"
  - "setup mushi"
  - "install mushi"
  - "mushi api key"
  - "mushi sdk"
  - "mushi mcp"
  - "byok key"
  - "tdd scenario"
  - "story mapper"
license: MIT
---

# Mushi Mushi — start here

Mushi Mushi sits between your users and your editor. A user reports a bug from
inside your app (a sentence, plus the screenshot, console and network tail
Mushi Mushi captures for them). Mushi Mushi turns that report into a
plain-English diagnosis and a fix prompt scoped to the files involved, and
your agent pulls it into Cursor or Claude Code over MCP.

## Pick the skill

| The user wants to… | Skill |
|--------------------|-------|
| Know what visitors hit on a live site, before any install (free, no sign-up) | [`mushi-check-live-app`](../mushi-check-live-app/SKILL.md) |
| Add Mushi Mushi to this app and wire the editor | [`mushi-setup`](../mushi-setup/SKILL.md) |
| Triage a report: evidence, diagnosis, fix here or dispatch | [`mushi-triage`](../mushi-triage/SKILL.md) |
| Check that the install works, or find what is broken in it | [`mushi-debug`](../mushi-debug/SKILL.md) |
| Map user stories, generate and run tests, or smoke-test the whole loop | [`mushi-test`](../mushi-test/SKILL.md) |
| Upgrade the SDK, or move from `@mushi-mushi/*` to `mushi-mushi` | [`mushi-sdk-upgrade`](../mushi-sdk-upgrade/SKILL.md) |

## Quick start

### 1. Add the SDK to your app

The wizard detects your framework, installs `mushi-mushi`, signs you in
through the browser and writes the env vars. From an agent's terminal, pass
`--yes`:

```bash
npx mushi-mushi --yes
```

Or by hand, for any browser app:

```bash
npm install mushi-mushi
```

```ts
import { Mushi } from 'mushi-mushi'

Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: import.meta.env.VITE_MUSHI_API_KEY, // or your framework's public env var
})
```

React, Vue, Svelte, Angular and Node import from `mushi-mushi/react`, `/vue`,
`/svelte`, `/angular` and `/node`; [`mushi-setup`](../mushi-setup/SKILL.md)
has the full table.

### 2. Connect your editor

```bash
npx mushi-mushi setup --ide cursor   # or: --ide claude
```

Then ask your agent: *"what's broken in prod?"*

### 3. The CLI (optional)

Every command runs as `npx mushi-mushi <command>` with no install. If you use
it often, `npm install -g @mushi-mushi/cli` gives you the short `mushi`.

## MCP server

`npx mushi-mushi setup --ide …` writes this for you. By hand, the hosted
server needs no key in the repo: you sign in from the editor's MCP panel, so
the file is safe to commit (`.cursor/mcp.json` for Cursor, `.mcp.json` for
Claude Code):

```json
{
  "mcpServers": {
    "mushi": {
      "type": "http",
      "url": "https://kensaur.us/mushi-mushi/hosted-mcp/"
    }
  }
}
```

The local stdio server is the fallback for editors without remote MCP, or for
a self-hosted API. It needs a project key with the `mcp:read` scope
(`mcp:write` to dispatch fixes); keep a config that holds a real key out of
git:

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

Tools you will reach for first:

| Tool | What it does |
|------|-------------|
| `get_recent_reports` | Survey the bug queue |
| `get_report_detail` | One report with its diagnosis and evidence |
| `get_fix_context` | The fix prompt and the files involved |
| `triage_issue` | Evidence, similar bugs, blast radius and next steps in one packet |
| `dispatch_fix` | Hand a report to a fix agent that opens a draft PR |
| `diagnose_setup` | What is missing from the setup, and the next action |
| `search_mushi_docs` | Search the current docs |

## Environment variables

| Variable | Where | Description |
|----------|-------|-------------|
| `VITE_MUSHI_PROJECT_ID` / `NEXT_PUBLIC_MUSHI_PROJECT_ID` / … | The app's `.env.local` | Project id, with the framework's public prefix (the wizard writes it) |
| `VITE_MUSHI_API_KEY` / `NEXT_PUBLIC_MUSHI_API_KEY` / … | The app's `.env.local` | Ingest-only key: it can send reports, never read them |
| `MUSHI_API_KEY` | stdio MCP server, CI | Project key (starts with `mushi_`) with `mcp:read` or `mcp:write` |
| `MUSHI_PROJECT_ID` | stdio MCP server, CI | Project UUID from the console |
| `MUSHI_API_ENDPOINT` | stdio MCP server, CLI | Self-hosted API URL; leave unset for Mushi Cloud |
| `MUSHI_BYOK_KEY` | Shell | One-shot input for `mushi keys add`, so the key stays out of shell history |

## Console pages

| Page | Path | Use it for |
|------|------|-----------|
| Reports | `/reports` | The bug queue and each diagnosis |
| Inventory | `/inventory` | Accept story proposals, review map runs |
| QA Coverage | `/qa-coverage` | Pending generated tests and run history |
| Settings → AI keys | `/settings?tab=byok` | Your own LLM and Firecrawl keys |

Something not working? [`mushi-debug`](../mushi-debug/SKILL.md) starts with a
pass/fail health check.
