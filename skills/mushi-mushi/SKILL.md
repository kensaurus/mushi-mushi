---
name: mushi-mushi
description: >-
  Set up, configure, and use Mushi Mushi — the AI-powered QA platform for
  automatic bug detection, user story mapping, TDD scenario generation, and
  PDCA auto-improvement. Use when setting up Mushi, configuring SDK/CLI/MCP,
  managing API keys, or asking how any Mushi feature works.
triggers:
  - "setup mushi"
  - "install mushi"
  - "mushi api key"
  - "mushi sdk"
  - "map user stories"
  - "tdd scenario"
  - "qa story"
  - "byok key"
  - "story mapper"
---

# Mushi Mushi — AI QA Platform Setup & Usage

Mushi Mushi is an AI-powered quality engineering platform that provides:
- **Bug Intelligence** — capture and triage reports from real users
- **Story Mapping** — automatically discover user stories from a live URL (no YAML required)
- **TDD Generation** — turn user stories into Playwright test specs with one command
- **PDCA Auto-improve** — failing tests are automatically rewritten by Claude
- **Multi-key BYOK** — quota-aware API key pool with automatic failover

## Quick Start

### 1. Install the SDK

```bash
npm install @mushi-mushi/web
```

```ts
import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey: process.env.MUSHI_API_KEY!,
  capture: {
    discoverInventory: { enabled: true },
  },
})
```

### 2. Install the CLI

```bash
npm install -g @mushi-mushi/cli
mushi login --api-key mushi_... --endpoint https://<ref>.supabase.co/functions/v1/api --project-id <pid>
```

### 3. Map user stories from a live URL (no YAML needed)

```bash
mushi stories map --url https://your-app.vercel.app --wait
```

Or in the console: **Inventory → Discovery → "Map from live app"**

### 4. Generate TDD tests from user stories

```bash
# List discovered stories first (from accepted inventory)
# Then generate a test for a specific story
mushi tdd gen login-flow --mode review

# Approve/reject the generated test
mushi tdd pending
mushi tdd approve <qa-story-id>
```

### 5. Auto-improve failing tests (PDCA)

```bash
mushi tdd improve
```

This analyzes recent failures and rewrites the test scripts with Claude. New versions are created with `source=pdca` and gated by the story's `automation_mode`.

### 6. Manage API key pool (BYOK)

```bash
# List all keys and their status
mushi keys list

# Add a backup key (used automatically on quota exhaustion)
mushi keys add --provider anthropic --key sk-ant-... --label "backup" --priority 200
```

## MCP Integration (for Cursor / Claude Desktop)

Add to your `cursor.mcp.json` or `mcp.json`:

```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["@mushi-mushi/mcp"],
      "env": {
        "MUSHI_API_KEY": "mushi_...",
        "MUSHI_API_ENDPOINT": "https://<ref>.supabase.co/functions/v1/api",
        "MUSHI_PROJECT_ID": "<project-id>"
      }
    }
  }
}
```

Available MCP tools:

| Tool | What it does |
|------|-------------|
| `map_user_stories` | Crawl a live URL, draft user stories with Claude |
| `generate_tdd_from_story` | Write a Playwright test from a story id |
| `improve_qa_story` | PDCA auto-improve failing tests |
| `run_qa_story` | Trigger a manual QA run |
| `list_pending_review_stories` | See what TDD tests need approval |
| `approve_qa_story` | Approve or reject a pending test |
| `list_byok_keys` | See API key pool health |
| `add_byok_key` | Add a backup key |
| `get_recent_reports` | Survey the bug triage queue |
| `dispatch_fix` | Auto-fix a report with a Cursor Cloud agent |

## Console Pages

| Page | URL | What to use it for |
|------|-----|-------------------|
| Inventory | `/inventory` | Accept user story proposals, review map runs |
| QA Coverage | `/qa-coverage` | Review pending TDD tests, see test history |
| Settings → API Keys | `/settings/llm-keys` | Manage BYOK key pool |
| Reports | `/reports` | Bug triage queue |

## Automation Modes

When generating TDD tests, set `--mode`:

| Mode | Behaviour |
|------|-----------|
| `auto` | Test is immediately enabled in the QA schedule |
| `review` | Test waits in the "pending review" queue |
| `approve` | Test is created disabled; you manually enable |

## BYOK Key Pool

Mushi uses a priority-ordered pool of API keys per provider. When a key hits its quota:
1. Mushi marks it `quota_exhausted` with a 1-hour cooldown
2. Automatically falls back to the next active key
3. Shows a banner in the console with a "Switch key" CTA

Add multiple keys per provider to avoid interruption:
```bash
mushi keys add --provider anthropic --key sk-ant-primary --label "primary" --priority 100
mushi keys add --provider anthropic --key sk-ant-backup  --label "backup"  --priority 200
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MUSHI_API_KEY` | SDK / CLI API key (prefix: `mushi_`) |
| `MUSHI_API_ENDPOINT` | Full URL to the Mushi API edge function |
| `MUSHI_PROJECT_ID` | Project UUID from the console |
