---
name: mushi-setup
description: Set up Mushi Mushi in a new project — install SDK, configure API keys, connect to the admin console, map user stories from a live app, and generate TDD tests. Use when the user asks to "set up mushi", "add mushi to my project", "connect mushi", "configure mushi", "install mushi sdk", "map my user stories", or "start using mushi tdd".
---

# Mushi Mushi Setup

## Overview

Mushi Mushi is a TDD/PDCA engine for web apps: it captures bugs, maps user stories from your live app, auto-generates Playwright tests, and continuously improves them via PDCA loops.

## Console URLs

| Environment | Base URL |
| --- | --- |
| Hosted (default) | `https://kensaur.us/mushi-mushi/admin` |
| Local monorepo | `http://localhost:6464` after `pnpm dev` |
| Override | `MUSHI_CONSOLE_URL` (CLI + browser opens) |

Resolution order: env → saved `consoleUrl` in `~/.config/mushi/config.json` → localhost probe → monorepo heuristic → hosted.

## Command matrix

| Command | Use when |
| --- | --- |
| `npx mushi-mushi` / `mushi init` | First SDK install — framework detect, packages, `.env.local` |
| `mushi connect --project-id <uuid> --endpoint <url> --write-env --wire-ide --wait` | Have ID + key; want env + Cursor MCP + heartbeat proof |
| `mushi login` | Save credentials before other commands |
| `mushi setup` | MCP-only wiring from saved config (not SDK install) |

**Do not** mint SDK keys under Settings → BYOK. Use **Setup → Verify → Generate API key** (`report:write`).

## Quick Start (5 steps)

### 1. Get your project credentials

Open the [Mushi admin console](https://kensaur.us/mushi-mushi/admin) (local: `http://localhost:6464`).

1. **Setup → Steps** or **Projects → New project** — create a project.
2. Copy **Project ID** (UUID) from the **success panel** immediately after Create.
3. **Setup → Verify** — **Generate API key** (`report:write`). Shown once.

Or run `npx mushi-mushi` — the wizard opens `/onboarding?tab=steps&setup=cli`, verifies via `whoami`, then installs.

You need:

- `MUSHI_PROJECT_ID` — UUID from success panel or Projects chip
- `MUSHI_API_KEY` — `mushi_…` from Verify tab

### 2. Install the SDK

```bash
# Recommended — wizard handles framework + env
npx mushi-mushi

# Or manual
npm install @mushi-mushi/web
```

### 3. Initialize in your app

```ts
import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: process.env.MUSHI_PROJECT_ID!,
  apiKey: process.env.MUSHI_API_KEY!,
  capture: {
    discoverInventory: {
      enabled: true,
      routeTemplates: ['/items/[id]', '/users/[userId]/profile'],
    },
  },
})
```

### 4. Map user stories from live app (no SDK required)

```bash
npm install -g @mushi-mushi/cli

mushi login --api-key mushi_... --project-id <uuid>
# endpoint defaults to Mushi Cloud when omitted after login

mushi stories map --url https://your-app.vercel.app --wait
```

Review proposals: **Inventory → Discovery → Past proposals**.

### 5. Generate TDD tests from stories

```bash
mushi tdd pending
mushi tdd gen <story-id> --mode review
mushi tdd approve <qa-story-id>
```

## CLI prerequisite step (init wizard)

If no saved config and no `--project-id` / `--api-key` flags:

1. **No — open console** → opens `?setup=cli`
2. **Yes — paste credentials**
3. **Use mushi login first** → exit and re-run init

## Second project

Use `/onboarding?tab=steps&setup=cli` or **Projects → New project** so the create form stays visible when you already have projects.

## BYOK Key Pool (quota-aware failover)

```bash
mushi keys list
MUSHI_BYOK_KEY=sk-ant-... mushi keys add --provider anthropic --label "Backup account"
```

Console: **Settings → API Key Pool** (not the same as SDK ingest keys on Verify).

## MCP Integration (Cursor / Claude)

After `mushi login`:

```bash
mushi setup                    # writes .cursor/mcp.json
# or full wiring:
mushi connect --project-id <uuid> --endpoint <url> --write-env --wire-ide --wait
```

Manual MCP block:

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["@mushi-mushi/mcp"],
      "env": {
        "MUSHI_API_KEY": "mushi_...",
        "MUSHI_API_ENDPOINT": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api",
        "MUSHI_PROJECT_ID": "<uuid>"
      }
    }
  }
}
```

## Connect Slack (1-click)

**Integrations → Slack → Add to Slack**

```bash
mushi slack status
mushi slack test
```

## Verify Setup

```bash
mushi doctor --server --qa-stories
pnpm smoke:cli-setup   # monorepo: Playwright smoke for create → copy ID (skips if unsigned)
```

Common flags:

- ✗ Firecrawl → **Integrations → BYOK Keys**
- ✗ QA target URL → **QA Coverage → Edit story**
- ✗ Slack → **Integrations → Add to Slack**

## Docs

- [CLI ↔ console loop](https://github.com/kensaurus/mushi-mushi/blob/master/apps/docs/content/quickstart/cli-console-loop.mdx)
- [Admin onboarding](https://github.com/kensaurus/mushi-mushi/blob/master/apps/docs/content/admin/onboarding.mdx)
