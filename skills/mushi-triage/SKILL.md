---
name: mushi-triage
description: "Triage a user's bug report end to end from the editor with the Mushi Mushi MCP tools: survey the queue, pull the evidence (screenshot, console, network, the user's words), read the plain-English diagnosis, similar past bugs and blast radius, then decide with the user whether to fix it here or dispatch a fix agent. Use when a user reports a bug, when asked 'what's broken', 'what should I fix next' or 'triage this report', or when a Mushi report id is at hand."
triggers:
  - "triage mushi report"
  - "what's broken in prod"
  - "what should i fix next"
  - "mushi bug report"
  - "investigate mushi report"
  - "fix a mushi report"
license: MIT
---

# Mushi Mushi triage

Investigate a user-felt bug report end to end with the Mushi Mushi MCP server,
then decide on a fix with the user. Do **not** call `dispatch_fix` until the
user has confirmed the fix scope.

The MCP server must be connected. If it is not, run
`npx mushi-mushi setup --ide cursor` (or `--ide claude`) and sign in from the
editor's MCP panel; see [`mushi-setup`](../mushi-setup/SKILL.md).

## When to use

- A user reports a bug and you want the full picture before writing code.
- A report id is available and you want its root cause, evidence and blast
  radius.
- You want to know whether a similar bug was fixed before, and how.

## Triage workflow

Steps 1–7 are read-only; nothing is changed.

### 1. Find the project (if you don't know it)

```
list_projects
```

Single-project keys and sign-ins skip this; every tool below defaults to the
configured project.

### 2. Project context

```
get_project_context { projectId: "<id>" }
```

SDK heartbeat, intake status and open report counts. If reports have stopped
arriving, switch to [`mushi-debug`](../mushi-debug/SKILL.md).

### 3. Survey the queue

```
get_recent_reports { limit: 10 }
```

Newest first. Narrow with `status` (`new`, `classified`, `fixing`, …),
`severity` (`critical`, `high`, `medium`, `low`) or `category`. For a fuzzy
description ("the checkout crash"), use `search_reports`. Note the report `id`.

### 4. Evidence

```
get_report_evidence { reportId: "<id>" }
```

Screenshot URL, console logs, network requests and the user's own words. Form
a working hypothesis. Console and network logs can hold personal data or
tokens: summarise them, don't paste them back verbatim.

### 5. Full triage packet

```
triage_issue { reportId: "<id>", includeLogs: true }
```

Report detail, similar bugs, fix context, blast radius and recent pipeline
logs in one packet. Read `recommended_actions` carefully.

### 6. Fix context

```
get_fix_context { reportId: "<id>" }
query_lessons { diffText: "<the planned change, or the affected code>" }
```

The diagnosis, the files involved and a ready fix prompt; if an earlier fix
attempt exists, what it did and why it may have failed. `query_lessons` brings
in what this project learned from past fixes that touch the same code.
`get_fix_context` on an already-diagnosed report does not use diagnosis quota.

### 7. Pipeline logs (if something looks broken on the Mushi Mushi side)

```
get_pipeline_logs { level: "error", limit: 20 }
```

### 8. Decide the fix (explicit user confirmation required)

Present the findings: severity and status, the root-cause hypothesis, similar
bugs, blast radius and the recommended next action. Then ask the user which
way to go:

- **Fix it here** (usually right for a small change): follow the fix prompt,
  make the smallest change that resolves the root cause, run the repo's tests
  for the touched area, then record it with `submit_fix_result` (`reportId`,
  `branch`, `prUrl`, `filesChanged`, `linesChanged`) so the report links to
  the fix.
- **Dispatch a fix agent**, after the user says yes:

  ```
  dispatch_fix { reportId: "<id>" }
  ```

  It always opens a draft PR, so the change is reviewed before it can merge.
  It returns `{ fixId, status }`; poll `get_fix_timeline { fixId }` for the PR
  link.

## Safety rules

- Never call `dispatch_fix`, `transition_status`, `merge_fix`,
  `reopen_report` or `reply_to_reporter` without the user's explicit go-ahead
  in the same turn.
- For a `critical` report, share the blast radius before dispatching.
- Never mark a report resolved without a merged fix or the user's say-so.
- Never expose an API key value in chat or commits.
