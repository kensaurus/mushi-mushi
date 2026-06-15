# Fix a Bug with Mushi

Investigate a Mushi bug report and dispatch an automated fix attempt, with human review at every stage.

## Prerequisites

- `MUSHI_API_KEY` must have `mcp:write` scope (or the project key must include `mcp:write`).
- You must confirm the fix scope with the user before dispatching.

## Steps

1. **Triage first** — run `/triage-mushi-report` for the target report. Do not skip this.
2. After presenting triage findings, ask: "Shall I dispatch a fix attempt? The PR will be a draft for your review."
3. On confirmation, call:
   ```
   dispatch_fix { reportId: "<id>", autoReadyPr: false }
   ```
4. The response includes a `prUrl` (GitHub pull request). Share it with the user.
5. Monitor progress (optional):
   ```
   get_recent_fixes { reportId: "<id>", limit: 1 }
   ```
   Then:
   ```
   get_fix_context { reportId: "<id>" }
   ```
6. Once the fix is reviewed and merged, the report moves to `fixed`. To close it manually:
   ```
   close_report { reportId: "<id>" }
   ```
   Only with explicit user confirmation.

## Safety

- `autoReadyPr: false` is mandatory unless the user explicitly requests auto-ready.
- Never dispatch a fix for `severity: critical` reports without also sharing the blast radius.
- If `dispatch_fix` returns an error, do not retry automatically — surface the error and ask the user what to do next.
