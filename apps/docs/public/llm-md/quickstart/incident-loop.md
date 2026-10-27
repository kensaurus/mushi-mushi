# Incident loop — bug to fix prompt

Source: https://kensaur.us/mushi-mushi/docs/quickstart/incident-loop

---
title: Incident loop — bug to fix prompt
description: Run npx mushi-mushi, ship, and turn your first user-reported bug into a plain-English diagnosis and a paste-ready fix for Cursor or Claude Code.
---

# Incident loop

- A user reports a bug in your live app. Mushi explains it in plain English.
- Your editor pulls the diagnosis and a ready fix prompt over MCP.
- Your AI applies the fix; you review and ship. No extra AI key needed.

## No MCP? Copy the fix prompt

Open the report in the console and click **Copy fix prompt** (under **Fix it
with your coding agent**). Paste it into Claude Code, Cursor, Codex or Windsurf.

What the fix prompt contains

One self-contained prompt: the diagnosis, the suggested fix, repro steps, page
and browser, the key console lines, likely files, and what "done" means. No MCP
or editor setup is needed. The steps below are the MCP route, which lets the
agent fetch the details and close the report itself.

## Before you start

- A Mushi project and API key ([credentials](/concepts/credentials)).
- At least one report: from the SDK, the test report `npx mushi-mushi` offers, or a Sentry alert.
- MCP connected to your editor ([MCP quickstart](/quickstart/mcp)). The agent needs write access to mark the report fixed; the default key has it.

## The loop

### Capture or pick a report

New project:

```bash
npx mushi-mushi
# wizard writes .env.local + optional test report
mushi connect --wait
```

Existing report: open **Reports** in the console and copy its ID, or ask the agent *"list recent mushi reports"*.

**You'll see:** a report ID, and the report in the console with a plain-English title.

### Pull the fix context

In Cursor, ask:

> Use Mushi MCP: call `get_fix_context` for report `` and summarize the root cause in plain English.

`get_fix_context` returns the classification, repro steps, blast radius and a
**`fixPrompt`**: a paste-ready fix brief built on the server. For most bugs you
can paste `fixPrompt` straight into Cursor and skip to the last step.

**You'll see:** the root cause in plain English, and a `fixPrompt` you can paste.

### Get a deeper fix plan (optional)

Run the MCP prompt **`summarize_report_for_fix`** with the same report ID, or ask:

> Run the Mushi prompt `summarize_report_for_fix` for report ``. Give me a paste-ready Cursor prompt to fix it.

It combines `get_fix_context`, `get_blast_radius` and `get_similar_bugs` into one plan.

### Paste and ship

Paste the agent's output into a Cursor chat (or keep going in the same thread)
and ask it to implement the fix. When GitHub is linked, `dispatch_fix` can open
a draft PR instead.

**You'll see:** the code change in your editor, ready to review and commit.

## Troubleshooting

## See also

- [MCP server quickstart](/quickstart/mcp)
- [Cursor integration](/integrations/cursor)
- [Fix orchestrator](/concepts/fix-orchestrator) — optional draft PR dispatch
