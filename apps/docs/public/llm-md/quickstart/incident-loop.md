# Incident loop — bug to fix prompt

Source: https://kensaur.us/mushi-mushi/docs/quickstart/incident-loop

---
title: Incident loop — bug to fix prompt
description: Run npx mushi-mushi, ship, and turn your first user-reported bug into a plain-English diagnosis and a paste-ready fix for Cursor or Claude Code.
---

# Incident loop

{INCIDENT_LOOP_LEDE}

{/* TODO(loop-video): drop the recorded asset in and uncomment. Path is the
    canonical slot shared with the README hero + Launch Week thumbnail.
    Storyboard + capture recipe: docs/marketing/STOREFRONTS.md ("Incident loop GIF").

*/}

  **Today:** classification in seconds; fix brief via MCP tools. **Target:** sub-10-second end-to-end diagnosis. MCP needs a Mushi account + project key — not a separate OpenAI/Anthropic key.

## Prerequisites

1. A Mushi project + API key ([credentials](/concepts/credentials))
2. At least one report (SDK capture, test report from `npx mushi-mushi`, or Sentry inbound)
3. MCP wired into Cursor — [MCP quickstart](/quickstart/mcp) or **Connect & Update → Add to Cursor**

## Step 1 — Capture or pick a report

**New project:**

```bash
npx mushi-mushi
# wizard writes .env.local + optional test report
mushi connect --wait
```

**Existing report:** open Admin → Reports and copy a report UUID, or ask the agent: *"list recent mushi reports"*.

## Step 2 — Pull fix context

In Cursor, ask:

> Use Mushi MCP: call `get_fix_context` for report `` and summarize the root cause in plain English.

`get_fix_context` returns classification, repro steps, blast radius, and inventory spec context in one payload — plus a **`fixPrompt`**: a paste-ready, agent-ready fix brief composed server-side (diagnosis + reproduction + suggested fix + relevant code hints). No second LLM key required to build it. For most bugs you can paste `fixPrompt` straight into Cursor and skip to [Step 4](#step-4--paste-and-ship); Step 3 below adds blast-radius and similar-bug context when you want a deeper plan.

## Step 3 — Generate the fix prompt

Run the MCP prompt **`summarize_report_for_fix`** with the same report ID, or ask:

> Run the Mushi prompt `summarize_report_for_fix` for report ``. Give me a paste-ready Cursor prompt to fix it.

The prompt orchestrates `get_fix_context`, `get_blast_radius`, and `get_similar_bugs` into a structured fix plan.

## Step 4 — Paste and ship

Copy the agent's output into a new Cursor chat (or continue in the same thread) and ask it to implement the fix. Optionally dispatch a draft PR later via `dispatch_fix` when GitHub is linked.

## Troubleshooting

## See also

- [MCP server quickstart](/quickstart/mcp)
- [Cursor integration](/integrations/cursor)
- [Fix orchestrator](/concepts/fix-orchestrator) — optional draft PR dispatch
