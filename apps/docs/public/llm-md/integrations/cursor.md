# Cursor integration

Source: https://kensaur.us/mushi-mushi/docs/integrations/cursor

---
title: Cursor integration
description: Wire Mushi Mushi into Cursor with one command. Get fix context, lessons and fix dispatch right from the editor.
---

# Cursor integration

**The short setup:**

```bash
npx mushi-mushi setup --ide cursor
# Restart Cursor. It asks you to sign in the first time the agent calls Mushi.
```

## Step-by-step

### Wire Cursor

```bash
npx mushi-mushi setup --ide cursor
```

This writes `.cursor/mcp.json` with a `mushi` entry that points at the hosted
Mushi Mushi MCP URL. No key is written to the file: Cursor opens a browser
sign-in the first time the agent calls Mushi. If the CLI has no saved login
yet, the command signs you in through your browser first. If the file already
exists, the command merges the block without overwriting other entries.

Self-hosted, or a machine with no browser? Log in with a key, then write a
local entry instead:

```bash
npx mushi-mushi login \
  --api-key mushi_xxx \
  --endpoint https://<ref>.supabase.co/functions/v1/api \
  --project-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npx mushi-mushi setup --ide cursor --stdio
```

Make that key in the console on **Manage apps → Generate API key** with the
**MCP read-only** preset, or **MCP read + write** if the agent should dispatch
fixes. (**Settings → AI keys** is for your own LLM keys, not Mushi keys.)

### (Optional) Add the evolution-loop coding rules

```bash
npx mushi-mushi setup --ide cursor --with-rules
```

Writes `.cursorrules` with rules telling the agent to:
1. Call `get_fix_context` before writing a fix
2. Check the lesson library for patterns
3. Call `submit_fix_result` after pushing a branch

Download the template to inspect it first:
[cursor.cursorrules](/integrations/cursor.cursorrules)

### Restart Cursor

Reload the window (`Ctrl+Shift+P` → "Developer: Reload Window") or quit
and reopen. The Mushi tools appear in the MCP tools picker.

### Verify

In Cursor chat, ask: **"Use the Mushi MCP to list my recent reports"**.
You should see your most recent bug reports from the dashboard.

## Available tools in Cursor

| Tool | What Cursor can do |
|------|--------------------|
| `get_recent_reports` | "What are users hitting right now?" |
| `get_fix_context` | "Give me a fix brief for report abc-123" |
| `search_reports` | "Find all reports about the login button" |
| `get_blast_radius` | "What else does this component touch?" |
| `dispatch_fix` | "Dispatch the agentic fix for this report" |
| `triage_next_steps` | "What should I fix next?" |
| `run_nl_query` | "How many critical bugs landed this week?" |

## Keep lessons current

```bash
# Pull the latest project lessons into .mushi/lessons.json
npx mushi-mushi sync-lessons
```

Run this in CI after each deploy so Cursor agents always have the most
up-to-date anti-patterns from your project's fix history.

## Connecting GitHub for auto-PR

For Cursor to open draft PRs via `dispatch_fix`, install the Mushi GitHub
App on your repo. In the admin console, open **Integrations** and click
**Install GitHub App**. Turn on **Automatic fixes** on the same page:
`dispatch_fix` is refused while it is off.

## Troubleshooting

**Cursor shows no Mushi tools:** Reload the window and check that
`.cursor/mcp.json` exists. Run `npx mushi-mushi whoami` to verify credentials.

**`[INSUFFICIENT_SCOPE]` error:** Your key needs the `mcp:write` scope to
dispatch fixes. Make one with the **MCP read + write** preset on **Manage apps**
(the hosted sign-in uses your role in the project instead).

**Stale lessons:** Run `npx mushi-mushi sync-lessons` to pull the latest rules.

  See the [MCP quickstart](/quickstart/mcp) for a full tool catalog and
  the [security docs](/security/no-leakage-claim) for what data stays
  in your account.
