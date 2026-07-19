# MCP server for bug fixing

Source: https://kensaur.us/mushi-mushi/docs/use-cases/mcp-bug-fixing-server

---
title: MCP server for bug fixing
description: What an MCP bug-fixing server is and how Mushi's works — Cursor, Claude Code, or Codex read live bug reports, pull fix context, and dispatch fixes.
---

# MCP server for bug fixing

MCP (Model Context Protocol) lets your coding agent call external tools. A
**bug-fixing MCP server** gives the agent eyes on production: instead of you
copying error text into chat, the agent queries live bug reports, pulls the
diagnosis and code context for each one, and dispatches fixes — all from
inside Cursor, Claude Code, or Codex.

Mushi Mushi ships one. No second LLM key required — your editor's model does
the reasoning; Mushi supplies the tools and the data.

## What the agent can do with it

- **List and search reports** — "what's broken in prod?" returns the open
  queue with severity and plain-English causes.
- **Get fix context** — the files, the diagnosis, similar past bugs, and the
  blast radius of a change.
- **Dispatch and submit fixes** — hand a fix back to Mushi, which can open a
  draft PR once GitHub is connected.
- **Query lessons** — past fixes become rules the agent checks before
  repeating a mistake.

## Setup

One command registers the server in your editor's MCP config:

```bash
npx mushi-mushi setup --ide cursor   # or --ide claude
```

Then ask your agent something like *"check Mushi for open bugs and fix the
worst one."* The full tool list and configuration options live in the
[MCP server quickstart](/quickstart/mcp).

## Hosted or self-hosted

Point the server at Mushi Cloud (50 diagnoses a month free) or at your own
self-hosted stack — the MCP surface is identical. Reports come from the
[SDKs](/sdks) your users already trigger; install those with:

```bash
npx mushi-mushi
```

**Next:** [MCP server quickstart](/quickstart/mcp) ·
[Connect your editor](/connect) ·
[Debug Claude Code apps](/use-cases/debug-claude-code-apps)
