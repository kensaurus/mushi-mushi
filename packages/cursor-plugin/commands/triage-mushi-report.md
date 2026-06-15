# Triage a Mushi Report

Investigate a bug report end-to-end using the Mushi MCP tools, then present findings and recommendations.

## Steps

1. If no project ID is known, call `list_projects` to discover accessible projects.
2. Call `get_project_context` for a health snapshot (SDK heartbeat, ingest status, open reports).
3. If a specific report ID was provided, skip to step 4. Otherwise call `get_recent_reports { status: "open", limit: 10 }` and ask the user to pick one.
4. Call `triage_issue { report_id: "<id>", project_id: "<id>", include_logs: true }` to pull the full triage packet.
5. Present a structured summary:
   - **Severity / Status**: `[CRITICAL] "Login fails on mobile" — open`
   - **Root cause hypothesis**: based on console logs and screenshot
   - **Similar bugs**: list titles and statuses from `similar_reports`
   - **Blast radius**: affected component / user segment
   - **Recommended actions**: from `recommended_actions`
6. Ask the user if they want to dispatch a fix. **Do not call `dispatch_fix` without confirmation.**

## Output format

> ### Triage: [Report Title]
>
> **Severity**: {severity} | **Status**: {status}
>
> **Evidence summary**: {1–2 sentence hypothesis from console logs / screenshot}
>
> **Similar bugs**:
> - {title} — {status}
>
> **Blast radius**: {affected scope}
>
> **Recommended next action**: {top action from recommended_actions}
>
> Ready to dispatch a fix? Reply "yes" to proceed.
