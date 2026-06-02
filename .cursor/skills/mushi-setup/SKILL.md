---
name: mushi-setup
description: Set up Mushi Mushi in a new project — install SDK, configure API keys, connect to the admin console, map user stories from a live app, and generate TDD tests. Use when the user asks to "set up mushi", "add mushi to my project", "connect mushi", "configure mushi", "install mushi sdk", "map my user stories", or "start using mushi tdd".
---

# Mushi Mushi Setup

## Overview

Mushi Mushi is a TDD/PDCA engine for web apps: it captures bugs, maps user stories from your live app, auto-generates Playwright tests, and continuously improves them via PDCA loops.

## Quick Start (5 steps)

### 1. Get your project credentials

Go to your [Mushi Console](https://mushi-mushi.app) → Settings → API Keys.  
You need:
- `MUSHI_PROJECT_ID` — your project UUID
- `MUSHI_API_KEY` — a `mushi_...` prefixed key

### 2. Install the SDK

```bash
# npm
npm install @mushi-mushi/web

# or pnpm / yarn
pnpm add @mushi-mushi/web
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
      // Optional: normalize dynamic routes so /items/abc-123 → /items/[id]
      routeTemplates: ['/items/[id]', '/users/[userId]/profile'],
    },
  },
})
```

### 4. Map user stories from live app (no SDK required)

```bash
# Install the CLI
npm install -g @mushi-mushi/cli

# Login
mushi login --api-key mushi_... --endpoint https://<ref>.supabase.co/functions/v1/api --project-id <uuid>

# Crawl and map user stories
mushi stories map --url https://your-app.vercel.app --wait
```

Review the generated proposal in the console: **Inventory → Discovery → Past proposals**.

### 5. Generate TDD tests from stories

```bash
# List accepted user stories (accept a proposal in the console first)
mushi tdd pending

# Generate a Playwright test for a story
mushi tdd gen <story-id> --mode review

# Approve it to enable in QA schedule
mushi tdd approve <qa-story-id>
```

## BYOK Key Pool (quota-aware failover)

Mushi uses multiple API keys with automatic failover. Add backup keys so workflows never stop when one key is rate-limited:

```bash
# List current keys
mushi keys list

# Add a backup Anthropic key
mushi keys add --provider anthropic --key sk-ant-... --label "Backup account"

# Add Firecrawl for story mapping
mushi keys add --provider firecrawl --key fc-... --label "Primary Firecrawl"
```

In the console: **Settings → API Key Pool** shows health and cooldown status.

## MCP Integration (Cursor / Claude)

Add to your MCP config:
```json
{
  "mcpServers": {
    "mushi": {
      "command": "npx",
      "args": ["@mushi-mushi/mcp"],
      "env": {
        "MUSHI_API_KEY": "mushi_...",
        "MUSHI_API_ENDPOINT": "https://<ref>.supabase.co/functions/v1/api",
        "MUSHI_PROJECT_ID": "<uuid>"
      }
    }
  }
}
```

Key TDD MCP tools: `map_user_stories`, `generate_tdd_from_story`, `run_qa_story`, `list_pending_review_stories`, `approve_qa_story`.

## Verify Setup

```bash
mushi doctor
```

Should show: SDK pings ✓, API reachable ✓, story map ready ✓.
