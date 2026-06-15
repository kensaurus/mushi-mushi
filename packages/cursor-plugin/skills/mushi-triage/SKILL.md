---
name: mushi-triage
title: Mushi Triage Workflow
description: End-to-end bug triage using Mushi MCP tools. Discover, investigate, and decide on fix dispatch — all without leaving your IDE.
chain_slugs: []
---

# Mushi Triage Workflow

Use this skill to investigate a user-felt bug report end-to-end using the Mushi MCP server.

## When to use

- User reports a bug and you want a complete picture before writing code
- A Mushi report ID is available and you want to understand root cause, evidence, and blast radius
- You want to see whether a similar bug was fixed before and what the fix looked like

## Triage workflow

Run these steps in order. Do **not** call `dispatch_fix` until you have confirmed the fix scope with the user.

### Step 1 — Discover projects (if project ID unknown)

```
list_projects
```

Pick the relevant project from the returned list.

### Step 2 — Get project context

```
get_project_context { project_id: "<id>" }
```

Review SDK heartbeat, ingest status, and open report counts.

### Step 3 — Survey the triage queue

```
get_recent_reports { status: "open", limit: 10 }
```

Identify the report you want to investigate. Note the `id`.

### Step 4 — Deep evidence pull

```
get_report_evidence { report_id: "<id>" }
```

Read screenshot URL, console logs, network requests, and user comments. Form a working hypothesis.

### Step 5 — Full triage orchestration

```
triage_issue { report_id: "<id>", project_id: "<id>", include_logs: true }
```

This combines report detail, similar bugs, fix context, blast radius, and recent pipeline logs into one packet. Read `recommended_actions` carefully.

### Step 6 — Fix context (if a previous fix attempt exists)

```
get_fix_context { reportId: "<id>" }
```

Check what the previous fix attempt did and why it may have failed.

### Step 7 — Pipeline logs (if something looks broken on the Mushi side)

```
get_pipeline_logs { project_id: "<id>", level: "error", limit: 20 }
```

### Step 8 — Dispatch fix (explicit user confirmation required)

Only after discussing findings and getting confirmation:

```
dispatch_fix { reportId: "<id>", autoReadyPr: false }
```

`autoReadyPr: false` keeps the PR as a draft for review before it can merge.

## Safety rules

- All steps above Step 8 are **read-only** — no data is mutated.
- Never call `dispatch_fix`, `close_report`, `reopen_report`, or `reply_to_reporter` without explicit user confirmation.
- If the report is `severity: critical`, also check blast radius before dispatching.
- Never expose the raw `MUSHI_API_KEY` value in chat or commits.
