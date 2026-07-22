/**
 * FILE: packages/mcp/src/catalog.ts
 * PURPOSE: Single source of truth for the MCP tool catalog — names, titles,
 *          descriptions, annotation hints, and short "use case" strings.
 *
 *          Extracted into its own module so two consumers can share it:
 *            • `server.ts` — feeds `title`, `annotations`, and `description`
 *              into `registerTool()` so MCP clients (Cursor, Claude Desktop)
 *              render a proper UI and auto-approve read-only calls.
 *            • The admin `/mcp` page — renders the same catalog visually so
 *              humans see exactly what an agent can do with a given API key
 *              scope, without having to crack open the README.
 *
 *          Because the admin imports from this package (via a type-only
 *          import), anything we add here shows up in both places on the
 *          next build. Don't fork the list in two.
 */

/** Raw-scope vocabulary — must match the CHECK constraint in migration 20260421003000. */
export type McpScope = 'mcp:read' | 'mcp:write'

/** Set of all defined scopes — convenient default when no caller restricts. */
export const ALL_SCOPES: readonly McpScope[] = ['mcp:read', 'mcp:write'] as const

/** How a client should treat a tool. Maps 1:1 to MCP `annotations`. */
export interface ToolHints {
  /** Read-only tool — clients MAY auto-approve. */
  readOnly: boolean
  /** Performs a destructive operation (delete, dismiss). Only meaningful when !readOnly. */
  destructive?: boolean
  /** Running the tool twice with the same args has the same effect. */
  idempotent?: boolean
  /** Tool interacts with an external system whose state can change (the Mushi API). */
  openWorld?: boolean
}

export interface ToolSpec {
  /** Machine name — matches `tools/list` and `tools/call`. Stable contract. */
  name: string
  /** Human-readable title surfaced in MCP clients + the /mcp admin page. */
  title: string
  /** One-paragraph description for the LLM. Explains when to call the tool. */
  description: string
  /** Scope required to call the tool — gates UI rendering and server auth. */
  scope: McpScope
  /** MCP annotation hints. */
  hints: ToolHints
  /**
   * One-liner that tells a human "what problem does calling this tool solve?".
   * Shown on the admin /mcp catalog cards — should be end-user-shaped, not
   * engineer-shaped ("What should I fix next?" not "GET /v1/admin/reports").
   */
  useCase: string
}

export const TOOL_CATALOG: ToolSpec[] = [
  {
    name: 'get_recent_reports',
    title: 'Recent bug reports',
    description:
      'List recent bug reports for a project, newest first. Returns { reports: [{ id, status, category, severity, summary, created_at }], total }. Optional filters: status (new|classified|grouped|fixing|fixed|verified|reopened|dismissed), category (bug|slow|visual|confusing|other), severity (critical|high|medium|low), limit (default 20, max 100). Use to survey open reports; for one report use get_report_detail, to find a bug by text use search_reports.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What landed in my bug queue today?',
  },
  {
    name: 'get_report_detail',
    title: 'Report detail',
    description:
      'Fetch the full record for one bug report by id: description, console logs, network requests, screenshot URL, classification (stage 1/2), and fix history. Returns { report }. Read-only. Use when you have a reportId and need everything about it; for evidence only use get_report_evidence, for the activity thread use get_report_timeline, for a one-call fix bundle use get_fix_context.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me everything you know about this report.',
  },
  {
    name: 'get_report_timeline',
    title: 'Unified report timeline',
    description:
      'Return the ordered activity timeline for one report (oldest to newest), merging reporter comments, fix events, QA runs, skill-pipeline steps, and Ask Mushi turns into one lane. Returns { events: [{ ts, kind, actor, summary }] }. Read-only. Use to see what happened end-to-end on a report thread; use get_report_detail for the static record or get_fix_timeline to debug one fix attempt.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What happened on this report thread end-to-end?',
  },
  {
    name: 'search_reports',
    title: 'Search reports',
    description:
      'Search reports by meaning and keyword (pgvector similarity server-side; falls back to summary/description substring if embeddings are unavailable). Returns ranked { results: [{ id, summary, similarity }] }. Read-only. Use to find reports by free text ("checkout flakiness"); use get_similar_bugs to dedupe a known component/bug, or get_recent_reports to list without a query.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Find reports mentioning "checkout flakiness".',
  },
  {
    name: 'get_similar_bugs',
    title: 'Similar bugs',
    description:
      'Find existing bugs similar to a component, page, or description via pgvector nearest-neighbour search (same backend as search_reports, tuned for "have we seen this before?"). Returns ranked { reports: [{ id, summary, similarity }] }. Read-only. Use to dedupe before filing or group regressions; use search_reports for general free-text search.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Have we seen a bug like this before?',
  },
  {
    name: 'get_fix_context',
    title: 'Fix context bundle',
    description:
      'Bundle everything an agent needs to fix one bug in a single call: a paste-ready fixPrompt (plain-English diagnosis + reproduction + suggested fix + relevant code + blast radius), plus report detail, repro steps, component, root cause, and ontology tags. Returns { fixPrompt, report, reproduction, component, rootCause, tags }. Read-only; no second LLM key needed. Use before writing a fix; use triage_issue for a multi-report review packet, or suggest_fix for just the Stage-2 hint.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me everything I need to fix this in one payload.',
  },
  {
    name: 'get_fix_timeline',
    title: 'Fix timeline',
    description:
      'Return the ordered lifecycle of one fix attempt: dispatched, started, branch, commit, PR opened, CI, completed/failed, with timestamps and the PR URL. Returns { events: [{ ts, stage, detail }] }. Read-only. Use to debug "why did this fix fail?" after dispatch_fix; use refresh_ci to re-poll GitHub CI, or get_report_timeline for the whole report thread.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Why did this fix attempt fail — show me every step.',
  },
  {
    name: 'get_blast_radius',
    title: 'Blast radius',
    description:
      'Return the other components/pages a bug group touches, via knowledge-graph traversal from the report node. Returns { nodes: [{ id, label, type }], edges }. Read-only. Use before dispatch_fix to scope a change safely; use get_knowledge_graph to traverse from an arbitrary seed, or analyze_codebase_impact for file-level import impact.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What else might break if I change this component?',
  },
  {
    name: 'get_knowledge_graph',
    title: 'Knowledge graph traversal',
    description:
      'Traverse the knowledge graph from a seed component or page. Returns { nodes: [{ id, label, node_type }], edges: [{ source_node_id, target_node_id, edge_type }] } within a depth budget (default 2, max 4 hops). Read-only. Use to see how a component connects to the rest of the app; use get_blast_radius for a bug\'s impact area, or get_graph_neighborhood for a tighter BFS around one node.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me how this component connects to the rest of the app.',
  },
  {
    name: 'run_nl_query',
    title: 'Ask your data (NL → SQL)',
    description:
      'Answer a natural-language question about your project data by generating and running a read-only SQL query (no privileged schemas, rate-limited to 60/hour). Returns { sql, rows }. Use for ad-hoc analytics ("which components had the most critical bugs this week?"); use get_recent_reports/search_reports for plain report lookups, or search_mushi_docs for documentation questions.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which components had the most critical bugs this week?',
  },
  // --- Inventory v2 (whitepaper §6.8) -------------------------------------
  {
    name: 'get_inventory',
    title: 'Inventory snapshot',
    description:
      'Return the current inventory.yaml snapshot for a project: latest ingest, validation errors, and a per-action status summary. Returns { snapshot, validationErrors, actions: [{ id, status }] }. Requires the inventory_v2 plan. Read-only. Use for the full current state; use diff_inventory to compare two commits, or list_gate_findings for the latest gate results.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What does the live inventory claim for this repo right now?',
  },
  {
    name: 'diff_inventory',
    title: 'Inventory diff',
    description:
      'Diff two ingested inventory commits (fromSha to toSha): added/removed nodes and edges. Returns { added, removed, changed }. Requires inventory_v2. Read-only. Use before merging a PR that touches inventory.yaml to see what changed; use get_inventory for the current snapshot.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What changed in inventory between these two SHAs?',
  },
  {
    name: 'list_gate_findings',
    title: 'Gate findings',
    description:
      'List recent inventory gate runs and their findings for a project, newest first. Returns { runs: [{ id, gate, status, findings_count, … }], findings: [{ severity, rule_id, message, file_path, node_id, … }] }. Filter by gate (dead-handler | mock-leak | crawl | status-claim) or minimum severity (low|medium|high|critical). Read-only. Use to see which CI gates failed on the last crawl; use diff_inventory to compare two commits, or get_inventory for the full snapshot.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me what CI gates failed on the last run.',
  },
  {
    name: 'get_graph_neighborhood',
    title: 'Graph neighborhood',
    description:
      'Return the BFS neighborhood around one graph node by id or label: { nodes: [{ id, label, node_type }], edges: [{ source_node_id, target_node_id, edge_type }] } within a depth budget (default 2, max 4). Read-only. Tuned for "what touches this action?"; use get_knowledge_graph to traverse from a component seed, or get_graph_node for a single node\'s row.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What nodes connect to this inventory Action within 2 hops?',
  },
  {
    name: 'get_graph_node',
    title: 'Graph node detail',
    description:
      'Fetch one knowledge-graph node row by id. Returns { node: { id, node_type, label, metadata } } including the v2 derived status on Action nodes (ok | stale | broken). Read-only. Use to inspect a single node\'s status; use get_graph_neighborhood to see what connects to it.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What status does the graph store on this node id?',
  },
  {
    name: 'suggest_fix',
    title: 'Suggested fix (from triage)',
    description:
      'Return the Stage-2 suggested-fix slice for one report: root cause, suggested fix, repro steps, summary, and component — faster than get_report_detail when you only need the human-readable hint. Returns { reportId, rootCause, suggestedFix, reproductionSteps, summary, component }. Read-only; reads the existing classification (run triage_issue first if unclassified). Use for a quick "what should we try?"; use get_fix_context for the full paste-ready bundle.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What did Stage 2 say we should try for this report?',
  },
  // --- Setup / admin -------------------------------------------------------
  {
    name: 'diagnose_setup',
    title: 'Unified setup diagnose',
    description:
      'Diagnose Mushi setup health and return the single best next action. mode=full (default) runs both SDK-ingest and fix-dispatch preflight checks; mode=ingest runs ingest checks only (project exists, active API key, SDK heartbeat, at least one report); mode=dispatch runs dispatch readiness only (GitHub connected, codebase indexed, LLM key present, autofix enabled). Returns { ready, steps: [{ label, complete, required, hint }], nextAction }. Read-only. The one setup-diagnosis entry point — use this instead of separate connection/ingest checks.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Why is Mushi setup broken — one call, clear next step.',
  },
  {
    name: 'search_mushi_docs',
    title: 'Search Mushi documentation',
    description:
      'Search the official Mushi documentation (guides, MCP setup, inventory, QA, skills) by keyword. Returns ranked { results: [{ title, url, excerpt }] }. Read-only. Use before guessing API shapes, tool names, or RPC names; use run_nl_query for questions about your own project data, not the docs.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: false },
    useCase: 'How do I configure MCP scopes / dispatch a fix / wire QA stories?',
  },
  // --- Write / agentic ----------------------------------------------------
  {
    name: 'submit_fix_result',
    title: 'Record a fix outcome',
    description:
      'Record a fix outcome from an external agent (e.g. your own Cursor/Claude run): branch, PR URL, files changed, lines added/removed. Creates a fix_attempt row then patches it to completed and links it to the report. Returns { fixAttemptId }. Write; NOT idempotent — each call creates a new fix_attempt, so call once per PR. Use after you opened a PR outside Mushi; use dispatch_fix to have Mushi open the PR instead, or merge_fix once CI is green.',
    scope: 'mcp:write',
    // Not idempotent: re-running creates a second fix_attempt row.
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'I just opened a PR — log it against the report.',
  },
  {
    name: 'dispatch_fix',
    title: 'Dispatch Mushi fix agent',
    description:
      'Start a Mushi fix agent for a classified report; it writes a branch and opens a signed draft PR. Set agent="cursor_cloud" to dispatch a Cursor Cloud Agent (default uses the in-repo worker). Requires GitHub connected + an LLM key (run diagnose_setup mode=dispatch first). Returns { fixAttemptId }; poll get_fix_timeline for progress and merge_fix when CI is green. Write; NOT idempotent — each call starts a new attempt. Report must be classified — run triage_issue if not.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Let the in-repo agent attempt this fix for me (or: dispatch a Cursor Cloud Agent).',
  },
  {
    name: 'trigger_judge',
    title: 'Run Sonnet-as-Judge',
    description:
      'Queue the Sonnet-as-Judge to grade recent fix quality across accessible projects. Returns { dispatched: number } — one judge-batch job per project; scores land asynchronously in judge_results (read back with run_nl_query). Write; consumes LLM budget. Idempotent within a short window. Use before shipping to vet fix quality; use get_fix_timeline to inspect a single attempt instead.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'Grade the latest batch of fixes before I ship.',
  },
  {
    name: 'test_gen_from_report',
    title: 'Generate Playwright test from report',
    description:
      'Generate a Playwright regression test from a classified report using your project LLM key, then open a draft GitHub PR with the spec. Requires the inventory_v2 plan plus GitHub and LLM keys configured. Returns { qaStoryId, prUrl }. Write; consumes LLM budget; NOT idempotent — each call opens a new PR. Use to lock in a regression as an E2E test; use generate_tdd_from_story to build a test from a mapped user story instead.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Turn this regression report into an E2E test PR.',
  },
  {
    name: 'transition_status',
    title: 'Move report between states',
    description:
      'Move a report to a new workflow state, enforcing the same transition rules as the admin UI. Valid targets: classified, grouped, fixing, fixed, verified, reopened, dismissed. Returns { report } with the updated status. Write; idempotent (setting the current status is a no-op); rejects illegal transitions. Use to dismiss a duplicate or mark fixed; use merge_fix to mark fixed via a merged PR, or reopen_report for the reopened path.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Dismiss this duplicate / mark it fixed.',
  },
  {
    name: 'merge_fix',
    title: 'Merge fix PR',
    description:
      'Squash-merge the GitHub PR for a fix attempt, mark the linked report fixed, and notify the reporter. Re-readies the PR first if it is still a draft. Returns { merged, reportStatus }. Write; destructive and irreversible from Mushi\'s side — once GitHub merges into the target repo\'s default branch there is no unmerge endpoint, only a manual revert PR outside this tool. Idempotent — re-running an already-merged attempt is a safe no-op. Prerequisite: CI green (check with refresh_ci); confirm the diff and CI status with the user before calling on a PR you have not reviewed. Use to ship a fix opened by dispatch_fix; use transition_status to change state without merging.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Merge the draft PR and notify the reporter.',
  },
  {
    name: 'refresh_ci',
    title: 'Refresh fix CI status',
    description:
      'Re-poll GitHub for the latest check-run status of a fix attempt\'s PR and persist it on the fix_attempt row (does not merge or mutate GitHub). Returns { check_run_status, check_run_conclusion, check_run_updated_at }. Write; idempotent. Use right before merge_fix to confirm CI is green; use get_fix_timeline for the full attempt lifecycle.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'Check whether CI is green before merging.',
  },
  {
    name: 'reopen_report',
    title: 'Reopen report (operator)',
    description:
      'Move a previously fixed/verified/dismissed report back to the reopened state for regression review, recording an operator note. Returns { report } with status=reopened. Write; idempotent — reopening an already-reopened report is a no-op. Use when a reporter says "still broken" after a fix shipped; use transition_status for any other state change.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'Reopen a regression the reporter flagged as not fixed.',
  },
  // --- Rewards (P3) -------------------------------------------------------
  {
    name: 'list_top_contributors',
    title: 'Top contributors leaderboard',
    description:
      'Return the top N contributors for the organization, ranked by points in a time window (30d | 90d | all). Each row includes display name, tier, total points, report count, and anti-fraud flag. ' +
      'Use this to identify your most engaged power users, write them a thank-you message, or decide who deserves a bonus.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Who are my top 10 contributors this month?',
  },
  {
    name: 'award_bonus_points',
    title: 'Award bonus points',
    description:
      'Award ad-hoc bonus points (1-50000, positive only — there is no way to subtract via this tool) to a contributor by their external user id (as passed to Mushi.identify()). ' +
      'Points post immediately to their total and are audit-logged as bonus_manual. Destructive and effectively irreversible: there is no reversal endpoint, so confirm the amount and recipient with the user before calling. ' +
      'Tier re-evaluation (and any host-side reward_webhooks grant tied to crossing a threshold) is NOT immediate — it only runs on the contributor\'s next tracked activity, not on this call. ' +
      'Requires mcp:write scope. Use this to thank a contributor who found a critical bug or to run a one-off promotional campaign.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: false, openWorld: true },
    useCase: 'Give this contributor 500 bonus points for the critical bug they found.',
  },
  {
    name: 'set_tier',
    title: 'Override contributor tier',
    description:
      'Override a contributor\'s tier by tier slug (e.g. "champion"), bypassing the normal points-threshold logic entirely. This is an admin escape hatch for manual promotions — ' +
      'normal tier transitions happen automatically via point thresholds instead. ' +
      'Destructive: it is a label-only override that does NOT replay the automatic tier-evaluation path, so any host_credit_payload grant (Stripe perk, badge, etc.) normally tied to reaching that tier via points will NOT fire — confirm with the user whether they also need the perk granted another way. ' +
      'The override persists until another set_tier call changes it; the prior override stays in the end_user_activity audit trail either way, logged as tier_override_manual. ' +
      'Requires mcp:write scope.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Manually promote this user to Champion tier as a thank-you.',
  },
  {
    name: 'setup_repo_for_mushi',
    title: 'Bootstrap repo for Mushi',
    description:
      'Writes the three Mushi bootstrap files into the current repo root: ' +
      '`.cursorrules` (Cursor evolution-loop coding rules), ' +
      '`.mushi/lessons.json` (initial empty lesson cache), ' +
      'and `MUSHI.md` (one-page project contract for agents). ' +
      'Idempotent — safe to re-run after lessons sync. ' +
      'Requires mcp:write scope. ' +
      'Call this once after connecting the repo; subsequently use `mushi sync-lessons` from CI to keep lessons current.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    useCase: 'Set up this repo for the Mushi evolution loop in one step.',
  },
  // ── Sentry-like triage and project context ────────────────────────────────
  {
    name: 'list_projects',
    title: 'List accessible projects',
    description:
      'List all Mushi projects accessible to this API key. ' +
      'For project-scoped keys returns a single-item list; for org-scoped keys (account mode) returns every project owned by this account. ' +
      'Call this first when MUSHI_PROJECT_ID is not configured — use the returned id with subsequent tool calls. ' +
      'If multiple projects are returned, pass the target projectId explicitly to project-scoped tools. ' +
      'Multi-project tip: run `mushi setup --all-projects` in your terminal to create one named MCP server entry per project in .cursor/mcp.json.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which projects can I access with this API key?',
  },
  {
    name: 'get_account_overview',
    title: 'Account overview — all projects',
    description:
      'Return an enriched summary of every Mushi project accessible to this API key: id, name, ' +
      'recent report count (last 30 days), number of connected MCP keys, and last-seen heartbeat timestamp. ' +
      'For project-scoped keys this is a one-item list; for org-scoped (account) keys it lists every owned project. ' +
      'Also includes toolCount, resourceCount, promptCount so agents know how many tools are available. ' +
      'Call this at the start of a multi-repo or multi-app triage session to orient yourself.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me all my Mushi projects and their health at a glance.',
  },
  {
    name: 'get_project_context',
    title: 'Project context snapshot',
    description:
      'Return a rich context snapshot for a project: name, repo URL, SDK heartbeat, ingest status, ' +
      'open report count, autofix readiness, your LLM key config, plan tier, and active integration health. ' +
      'Equivalent to a merged preflight + activation + settings read. ' +
      'Agents should call this at the start of a review session to orient themselves.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me a status overview of this project before I start reviewing bugs.',
  },
  {
    name: 'get_pipeline_logs',
    title: 'Recent pipeline logs',
    description:
      'Pull recent log entries from the Mushi pipeline services: fix-worker, qa-story-runner, pipeline, or all. ' +
      'Accepts project_id, service, since (ISO-8601), limit (max 200), and level ' +
      '(info | warn | error | fatal) filters. Returns structured log rows with timestamp, level, service, message, ' +
      'and a trace_id/report_id when available. ' +
      'Use this when a fix failed, a QA story keeps erroring, or an ingest pipeline went silent.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Why did the last fix attempt fail? Show me recent pipeline errors.',
  },
  {
    name: 'get_report_evidence',
    title: 'Bug report evidence',
    description:
      'Return the full evidence package for a single bug report: screenshot URL, console logs, network excerpts, ' +
      'browser environment (user agent, URL, viewport, SDK version), user replay link if available, ' +
      'breadcrumb trail, and the reporter\'s own comments thread. ' +
      'This is the same data an engineer would collect for a root-cause investigation. ' +
      'Faster than calling get_report_detail + report timeline separately.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'I need all the evidence for this bug report to diagnose the root cause.',
  },
  {
    name: 'triage_issue',
    title: 'Triage issue end-to-end',
    description:
      'Read-only combined tool: merges report detail, evidence, similar bugs, fix context, blast radius, ' +
      'and recent pipeline logs for a report into a single structured review packet. ' +
      'Returns a prioritised list of recommended next actions (investigate, dispatch_fix, group_with, dismiss). ' +
      'Equivalent to a Sentry "Analyze with Seer" flow grounded in user-felt reports. ' +
      'Pass report_id to kick off review. Call this before dispatch_fix.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Analyze this bug report end-to-end and tell me what to do.',
  },
  // ── Lessons / evolution loop ─────────────────────────────────────────────
  {
    name: 'query_lessons',
    title: 'Query lessons for diff context',
    description:
      'Retrieve the learning rules ("lessons") most relevant to a given code diff or PR context, packed within a token budget. Uses bi-encoder retrieval + severity-weighted scoring; pass the diff/description as the query and max_tokens (default 2000). Returns ranked { lessons: [{ title, rule, severity }] }. Read-only. Use before writing a fix or opening a PR; use list_lessons to browse all lessons unfiltered.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What past mistakes should I avoid when making this change?',
  },
  {
    name: 'list_lessons',
    title: 'List project lessons',
    description:
      'List promoted learning rules ("lessons") for the current project, highest-frequency first. Returns { lessons: [{ id, rule_text, severity, frequency, anti_pattern, … }] }. Read-only. Use to browse the full catalog of encoded heuristics; use query_lessons to retrieve only lessons relevant to a specific diff or PR within a token budget.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What systemic patterns has Mushi identified for this project?',
  },
  {
    name: 'activation_status',
    title: 'Activation cockpit status',
    description:
      'Return the unified activation posture — SDK heartbeat, ingested reports, GitHub, MCP readiness, QA stories, and the next best action. ' +
      'Read this before guessing which onboarding step is blocking the user. ' +
      'Also available as the mushi://activation resource for resource-reader clients. ' +
      'Returns { sdkActive, reportsIngested, githubConnected, mcpConnected, qaStoriesCreated, nextBestAction }.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is Mushi fully set up and active for this project?',
  },
]

export interface ResourceSpec {
  name: string
  uri: string
  title: string
  description: string
  scope: McpScope
}

export const RESOURCE_CATALOG: ResourceSpec[] = [
  {
    name: 'project_dashboard',
    uri: 'project://dashboard',
    title: 'Loop dashboard snapshot',
    description: 'Loop health snapshot — stage counts, bottleneck, recent activity (same payload the admin console polls).',
    scope: 'mcp:read',
  },
  {
    name: 'project_stats',
    uri: 'project://stats',
    title: 'Project stats',
    description: 'Report counts, category breakdown, severity distribution.',
    scope: 'mcp:read',
  },
  {
    name: 'project_settings',
    uri: 'project://settings',
    title: 'Project settings',
    description: 'Project configuration — autofix agent, plugins enabled, ontology, LLM budgets.',
    scope: 'mcp:read',
  },
  {
    name: 'privacy_status',
    uri: 'privacy://status',
    title: 'Privacy posture',
    description:
      'Returns the privacy posture for this project: storage region, LLM provider, whether your own LLM key is configured, ' +
      'data retention window, and last audit timestamp. ' +
      'Agents should read this before dispatching a fix to confirm that client data stays within the expected boundary. ' +
      'Reads as project data does not leave the project\'s own LLM account when byok_configured=true.',
    scope: 'mcp:read',
  },
  {
    name: 'evolution_history',
    uri: 'evolution://history',
    title: 'Evolution history',
    description:
      'Returns the project\'s last 30 days of judge scores, prompt promotions, fixed-bug count, and lesson inductions. ' +
      'Agents can read this to see whether the loop is converging (rising judge scores, falling recurrence) ' +
      'or stalling (flat scores, same bugs re-appearing). Use before review to understand which bug classes ' +
      'the loop has already learned to handle, and which still need human attention.',
    scope: 'mcp:read',
  },
  {
    name: 'activation_status',
    uri: 'mushi://activation',
    title: 'Activation cockpit status',
    description:
      'Unified setup posture — SDK heartbeat, reports, GitHub, MCP readiness, QA stories, and the next best action. ' +
      'Agents should read this before guessing which onboarding step is blocking the user.',
    scope: 'mcp:read',
  },
  {
    name: 'project_integration_health',
    uri: 'project://integration-health',
    title: 'Integration health',
    description:
      'Live health status of every configured integration channel (Sentry, GitHub, LangFuse, PagerDuty, …). ' +
      'Check this before dispatching a fix to fail-fast on broken channels ' +
      'rather than burning LLM budget and discovering the failure mid-run.',
    scope: 'mcp:read',
  },
  {
    name: 'inventory_current',
    uri: 'inventory://current',
    title: 'Current inventory snapshot',
    description:
      'Current inventory snapshot for the active project — all Action nodes with their ' +
      'spec contract (expected_outcome), build-gate status, linked reports, and fix attempts. ' +
      'Subscribe to this resource to receive notifications/resources/updated when the inventory ' +
      'is re-crawled. Orchestrators can use this to enumerate work items and pick the next Action to fix.',
    scope: 'mcp:read',
  },
]

export interface PromptSpec {
  name: string
  title: string
  description: string
  useCase: string
}

export const PROMPT_CATALOG: PromptSpec[] = [
  {
    name: 'summarize_report_for_fix',
    title: 'Summarize report for fix',
    description: 'Turn a Mushi report into a one-line root cause, smallest file set, repro steps, and blast-radius warnings.',
    useCase: '/summarize_report_for_fix — agent builds a fix plan before coding.',
  },
  {
    name: 'explain_judge_result',
    title: 'Explain judge result',
    description: 'Turn raw Sonnet-as-Judge scores into ship / iterate / dismiss guidance.',
    useCase: '/explain_judge_result — agent gives a verdict after CI/judge runs.',
  },
  {
    name: 'triage_next_steps',
    title: 'What should I focus on?',
    description: 'Five-item priority list drawn from the dashboard + recent classified queue.',
    useCase: '/triage_next_steps — agent tells you where to start your day.',
  },
  {
    name: 'mushi_setup',
    title: 'Diagnose Mushi setup',
    description:
      'Walk through activation status, integration health, and the single next command to unblock setup.',
    useCase: '/mushi_setup — agent diagnoses why setup is stuck without guessing.',
  },
]

// ── Phase 4: TDD / Story-mapping MCP tools ───────────────────────────────

export const TDD_TOOL_CATALOG: ToolSpec[] = [
  {
    name: 'map_user_stories',
    title: 'Map user stories from live app',
    description:
      'Crawl a live application URL (Firecrawl/Browserbase) and have Claude draft an inventory.yaml of pages and user stories, written to an inventory_proposals row (source=live_crawl). Optionally dispatches a Cursor Cloud agent to refine the draft and open a PR. Returns { runId, status: "pending" } immediately — poll get_map_run_status. Write; consumes crawl + LLM budget; NOT idempotent. Use to bootstrap test coverage without hand-writing YAML; then generate_tdd_from_story per accepted story.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Map the user stories in my live app automatically without writing YAML by hand.',
  },
  {
    name: 'get_map_run_status',
    title: 'Story map run status',
    description:
      'Poll the status and results of a story_map_run started by map_user_stories. Returns { status: pending|running|completed|failed, pages_crawled, proposal_id (once done), cursor_pr_url (if Cursor Cloud refined the draft) }. Read-only. Use to know when a crawl has finished and which inventory_proposals row to review next.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is my story mapping crawl done yet?',
  },
  {
    name: 'generate_tdd_from_story',
    title: 'Generate TDD test from user story',
    description:
      'Generate a full Playwright TypeScript test from a mapped user story id (from accepted inventory) using Claude, and insert a qa_stories row (source=test_gen_from_story). approval_status follows the project automation_mode (auto = enabled immediately; review/approve = pending_review). Optionally opens a draft GitHub PR. Returns { qaStoryId, prUrl, approvalStatus, needsHumanReview }. Write; consumes LLM budget; NOT idempotent. Run map_user_stories first; use test_gen_from_report to build a test from a bug report instead.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Generate a Playwright test for this user story.',
  },
  {
    name: 'improve_qa_story',
    title: 'Auto-improve a failing QA story',
    description:
      'Analyze recently failed qa_story_runs and use Claude to write improved test scripts that address the failures. New tests are created with source=pdca, parent_story_id chained to the original, and approval gated by the original story\'s automation_mode. Returns { improvedStoryIds }. Write; consumes LLM budget; NOT idempotent. Use to repair flaky/broken tests; use run_qa_story to re-run as-is, or list_qa_story_runs to inspect failures first.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Fix my failing QA tests automatically.',
  },
  {
    name: 'run_qa_story',
    title: 'Trigger a manual QA story run',
    description:
      'Queue an immediate manual run for an enabled + approved qa_story (equivalent to "Run now" in the console). Returns { runId } right away; poll list_qa_story_runs or get_qa_story_run for progress and results. Write; NOT idempotent — each call creates a new run; returns 409 if the story is disabled or pending review. Use to verify a flow on demand; use improve_qa_story to repair a failing story.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Run the login flow test right now.',
  },
  {
    name: 'list_byok_keys',
    title: 'List your API key pool',
    description:
      'List the project\'s BYOK API keys grouped by provider (anthropic | openai | firecrawl | browserbase | cursor). Returns { keys: [{ id, provider, label, priority, status, cooldownUntil }] } — metadata only, never the raw secret. Read-only. Use to see which keys are active vs rate-limited/exhausted; use add_byok_key to add one.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which API keys are active and which are rate-limited?',
  },
  {
    name: 'add_byok_key',
    title: 'Add an API key',
    description:
      'Add a BYOK API key to the project pool for a provider (anthropic | openai | firecrawl | browserbase | cursor), with a label and priority for failover ordering. The raw key is stored encrypted in Supabase Vault and never returned. Returns { id, provider, label }. Write; NOT idempotent — adds a new row each call. Use to register a backup/rotated key; use list_byok_keys to review the pool.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Add a backup Anthropic key to the pool.',
  },
  {
    name: 'list_pending_review_stories',
    title: 'List QA stories pending review',
    description:
      'List auto-generated QA/TDD stories in approval_status=pending_review — the queue waiting for human sign-off before they run on schedule. Returns { stories: [{ id, title, source, target_url, created_at }] }. Read-only. Use to find what needs review today; then approve_qa_story to approve or reject each.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What TDD tests need my approval today?',
  },
  {
    name: 'approve_qa_story',
    title: 'Approve or reject a pending QA story',
    description:
      'Approve or reject a qa_story currently in pending_review (pass approve=true|false and an optional note). Approved stories are enabled in the QA schedule immediately; rejected ones are disabled. Returns { id, approval_status }. Write; idempotent — re-approving an approved story is a no-op. Use to clear the review queue from list_pending_review_stories.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'Approve this auto-generated test.',
  },
  {
    name: 'reply_to_reporter',
    title: 'Reply to a reporter',
    description:
      'Send a visible message to the end-user who filed a bug report. The reply appears in the in-app Mushi widget as an admin comment and creates an unread notification badge so the reporter sees it immediately. Use this to answer questions, request reproduction steps, or confirm a fix — without leaving the Cursor IDE.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    useCase: 'Reply to a reporter asking for more info or confirming a fix.',
  },
  {
    name: 'get_two_way_comms_health',
    title: 'Two-way communication health',
    description:
      'Summarize SDK ↔ admin two-way reporter health for a host app: last SDK heartbeat, ' +
      'app version/platform last seen, unread reporter messages, recent reporter replies, ' +
      'and pending QA/TDD follow-ups. Use after wiring @mushi-mushi/web in a Vite/Capacitor app ' +
      'to confirm reports land in the console and admin/MCP replies reach the in-app widget.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is two-way reporter communication working for this host app?',
  },
  {
    name: 'list_qa_story_runs',
    title: 'Recent QA story runs',
    description:
      'Return the most recent runs for a given QA story, newest first. Each row includes status (passed/failed/error/running), ' +
      'latency_ms, created_at, error_message headline, and assertion_failures (up to 10). ' +
      'Use this to understand whether a story is currently healthy, what the last failure was, ' +
      'and whether a manual run has completed.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me the last 10 runs for the "home page loads" story and why they failed.',
  },
  {
    name: 'get_qa_story_run',
    title: 'QA story run detail',
    description:
      'Fetch the full detail for a single qa_story_run: status, error_message, assertion_failures, ' +
      'latency_ms, provider_session_url (Browserbase replay link when available), and screenshot URLs from qa_story_evidence. ' +
      'Use this to drill into a specific failing run and understand the exact error before deciding whether to improve the story script or fix the app.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What exactly happened in this failed QA run? Show me the error and screenshots.',
  },
  {
    name: 'test_notification_channel',
    title: 'Send a test notification',
    description:
      'Send a test notification to a configured notification channel for the project. ' +
      'Supported channel kinds: "slack" (posts a test Block Kit message to the configured channel), ' +
      '"discord" (posts to the project discord_webhook_url). ' +
      'Returns ok=true if the message was accepted. Use this to verify the integration is working after setup or after changing credentials.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Did "Add to Slack" work? Send a test ping to confirm.',
  },

  // ── Billing / usage tools ─────────────────────────────────────────────────

  {
    name: 'get_usage',
    title: 'Usage & billing summary',
    description:
      'Read-only diagnoses quota and billing summary for the current project: diagnoses used / limit / percentage, spend cap, period start/end, plan name, and whether the project is approaching or over its quota. Use this to answer "how many diagnoses do I have left?" or "am I close to my spend cap?".',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: false },
    useCase: 'How many diagnoses do I have left this month?',
  },

  // ── Skill Pipeline tools ─────────────────────────────────────────────────────

  {
    name: 'list_skills',
    title: 'List agent skills',
    description:
      'List the agent skills in the catalog, optionally filtered by category or search text. Returns { skills: [{ slug, title, description, category, chain_slugs }] }. Read-only. Use to find the right skill slug before start_skill_pipeline; use get_skill to read one skill\'s full instructions.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What skills are available for debugging production errors?',
  },
  {
    name: 'get_skill',
    title: 'Get skill detail',
    description:
      'Fetch one agent skill by slug, including the complete SKILL.md body and the resolved chain of sub-skills. Returns { slug, title, body, chain: [{ slug, title }] }. Read-only. Use to read what a skill instructs before executing a pipeline step; use list_skills to discover slugs.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What does workflow-fix-and-ship actually instruct me to do?',
  },
  {
    name: 'start_skill_pipeline',
    title: 'Start a skill pipeline',
    description:
      'Start a new skill pipeline run for a report. Pass root_skill_slug and optionally report_id. ' +
      'Returns run_id, context_packet (full instructions + report context), and step list. ' +
      'Read the context_packet — it contains skill instructions plus full report context (repro steps, root cause, RAG files). ' +
      'After executing each step, call checkin_pipeline_step. The PM watching the console sees progress live.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Start the workflow-fix-and-ship pipeline for this bug report.',
  },
  {
    name: 'get_pipeline_run',
    title: 'Get pipeline run detail',
    description:
      'Fetch a skill pipeline run by id: { status, context_packet, steps: [{ index, slug, status }] }. Read-only. Use to retrieve the context_packet when a pipeline was started from the console or another agent; then checkin_pipeline_step as you complete each step. Use start_skill_pipeline to begin a new run.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me the context packet and step status for this pipeline run.',
  },
  {
    name: 'checkin_pipeline_step',
    title: 'Check in a pipeline step',
    description:
      'Report the completion status of a pipeline step (passed, failed, running, or skipped). ' +
      'Optionally include notes, a PR URL, or the Cursor agentId. ' +
      'Updates the live React Flow canvas in the Mushi console so PMs see real-time progress.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'I just opened the PR — mark step 2 as passed and link the PR.',
  },

  // ── Full-Stack Audit tools (Phase 5) ────────────────────────────────────────

  {
    name: 'run_fullstack_audit',
    title: 'Run a full-stack health audit',
    description:
      'Fan out a full-stack health audit for the current project: DB schema + advisors, ' +
      'API contract gate results (Gates 3–8), recent backend error logs, and RLS gap detection. ' +
      'Returns a PM-readable scorecard with severity-ranked findings and fix hints. ' +
      'Requires the project to have a Supabase PAT configured (Settings → API Keys, slug: supabase) ' +
      'and supabase_project_ref set in project settings for backend analysis. ' +
      'The audit completes synchronously in ~10 s. Triggers a background gate run for orphan_endpoint ' +
      'and unknown_call gates if they have not run today.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase:
      'Is this project healthy? Run a one-click full-stack audit to find API contract mismatches, ' +
      'unlinked backend features, schema drift, and security gaps.',
  },

  {
    name: 'get_backend_health',
    title: 'Get backend health for a project',
    description:
      'Return the current backend health state for a linked Supabase project: ' +
      'table list (with RLS enabled status), recent API and Postgres error logs, ' +
      'and DB advisor findings. Uses the read-only Supabase MCP client via the stored PAT. ' +
      'Returns { tables, logs, advisors, projectRef } when the backend is linked, ' +
      'or { reason: "no_supabase_pat" | "no_project_ref" } when it is not configured. ' +
      'This is the read-only fast path — use run_fullstack_audit for the full scorecard ' +
      'including gate results.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase:
      'Are there any tables without RLS? Show me recent backend errors for this project.',
  },

  // ── Meta-tool (context-cost reduction) ───────────────────────────────────
  //
  // Sentry ships `use_sentry` (a single meta-tool an agent calls to get a
  // recommended subset of tools for a given intent) as the primary context-
  // cost reduction lever.  We do the same: `use_mushi` returns a curated
  // list of the 6–12 tools most relevant to the caller's stated intent, plus
  // a short orientation block.  Agents that call use_mushi first avoid
  // loading 68 tool descriptions up-front, cutting context cost by ~60% for
  // narrow tasks (fix a bug, check status, start a pipeline).
  {
    name: 'use_mushi',
    title: 'Mushi — where to start',
    description:
      'CALL THIS FIRST if you are new to this Mushi project or unsure which tool to use. ' +
      'Pass your intent as a short natural-language phrase (' +
      '"fix the top bug", "check what I should work on", "run QA tests", "set up Mushi", …). ' +
      'Returns: (1) a curated list of the 5–12 tool names most relevant to that intent, ' +
      '(2) a one-paragraph orientation to the Mushi project and dashboard state, and ' +
      '(3) the single recommended first tool to call. ' +
      'Avoids loading the full 68-tool catalog into context when only a small subset is needed. ' +
      'Read-only; does not call any downstream tools itself.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: false },
    useCase: 'What should I do next with Mushi? / Which tools do I need for this task?',
  },
]

// ── Intent → curated tool subset (used by use_mushi handler) ─────────────
//
// Maps broad intent keywords to the curated subset of tool names that
// satisfies 90%+ of requests with that intent. The MCP server uses this to
// build the use_mushi response without a DB round-trip. Keys are checked
// via substring match, so "fix" matches "fix a bug" and "dispatch fix".

export interface UseMushiIntent {
  /** Display label for the intent cluster. */
  label: string
  /** Tool names from TOOL_CATALOG + TDD_TOOL_CATALOG relevant to this intent. */
  tools: string[]
  /** One sentence orienting the agent to start here. */
  hint: string
}

export const USE_MUSHI_INTENTS: Record<string, UseMushiIntent> = {
  fix: {
    label: 'Fix a bug',
    tools: [
      'get_recent_reports',
      'get_report',
      'summarize_report_for_fix',
      'dispatch_fix',
      'start_skill_pipeline',
      'checkin_pipeline_step',
      'get_pipeline_run',
    ],
    hint: 'Call get_recent_reports to find the top unresolved bug, then summarize_report_for_fix before dispatching.',
  },
  status: {
    label: 'Check project status',
    tools: [
      'get_dashboard',
      'triage_next_steps',
      'get_usage',
      'get_backend_health',
      'activation_status',
    ],
    hint: 'Call triage_next_steps for a prioritised list of what to work on today.',
  },
  setup: {
    label: 'Set up Mushi',
    tools: [
      'mushi_setup',
      'activation_status',
      'get_backend_health',
      'list_byok_keys',
      'add_byok_key',
    ],
    hint: 'Call mushi_setup first — it diagnoses setup gaps and returns the next command to run.',
  },
  qa: {
    label: 'Run / review QA tests',
    tools: [
      'list_qa_stories',
      'run_qa_story',
      'list_qa_story_runs',
      'get_qa_story_run',
      'list_pending_review_stories',
      'approve_qa_story',
      'improve_qa_story',
    ],
    hint: 'Call list_qa_stories to see what test coverage exists; run_qa_story to trigger a run.',
  },
  pipeline: {
    label: 'Run an agent pipeline / skill',
    tools: [
      'list_skills',
      'get_skill',
      'start_skill_pipeline',
      'checkin_pipeline_step',
      'get_pipeline_run',
    ],
    hint: 'Call list_skills to find the right skill, then start_skill_pipeline.',
  },
  audit: {
    label: 'Audit / health check',
    tools: [
      'run_fullstack_audit',
      'get_backend_health',
      'get_dashboard',
      'get_usage',
    ],
    hint: 'Call run_fullstack_audit for a full-stack health scorecard.',
  },
}

// ── Codebase Understand tools ────────────────────────────────────────────────

export const CODEBASE_TOOL_CATALOG: ToolSpec[] = [
  {
    name: 'ask_codebase',
    title: 'Ask about the indexed codebase',
    description:
      'Answer a plain-English question about the connected repo, grounded on pgvector retrieval over project_codebase_files. Returns { answer, citations: [{ path, line }] }. Set include_wiki=true to merge docs/wiki knowledge. Requires codebase indexing + your Anthropic or OpenAI key; consumes LLM budget (write scope). Use for "how does X work?"; use search_codebase for raw file matches without synthesis, or get_file_summary for one file.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'How does authentication work in this repo?',
  },
  {
    name: 'get_file_summary',
    title: 'Plain-English file summary',
    description:
      'Return a plain-English summary of one indexed file or symbol (lazily generated on first call, then cached until content_hash changes on re-index). Returns { path, summary, symbols }. Requires codebase indexing. Read-only. Use to understand a single file fast; use ask_codebase for cross-file questions, or get_codebase_tour for an onboarding walkthrough.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Explain what lib/auth.ts does in plain English.',
  },
  {
    name: 'get_codebase_tour',
    title: 'Guided codebase tour',
    description:
      'Return a dependency-ordered onboarding tour of the repo (~6-10 stops); each stop lists node ids, file paths, architectural layer, and why it matters. Returns { stops: [{ title, paths, layer, rationale }] }. Cached per index fingerprint. Requires codebase indexing. Read-only. Use to get oriented in an unfamiliar repo; use get_codebase_domains for a business-domain map, or get_file_summary for one file.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me an onboarding walkthrough of this codebase.',
  },
  {
    name: 'search_codebase',
    title: 'Semantic codebase search',
    description:
      'Search the indexed repo by plain-English meaning via embeddings. Returns { results: [{ file_path, line_start, line_end, content_preview, similarity, … }], query, mode } ordered by similarity. Requires codebase indexing enabled. Read-only. Use to locate where something lives ("where do we verify webhooks?"); use ask_codebase for a synthesized answer with citations, or analyze_codebase_impact to find dependents of a file.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Find files related to authentication or payment handling.',
  },
  {
    name: 'get_codebase_domains',
    title: 'Business domain map',
    description:
      'Extract the business domains, flows, and steps in the repo, each mapped to the file paths that implement it. Returns { domains: [{ name, flows: [{ name, steps, paths }] }] }. Cached per index fingerprint. Requires codebase indexing. Read-only. Use to see what the app does at a product level; use get_codebase_tour for a dependency-ordered code walkthrough instead.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What business domains does this codebase implement?',
  },
  {
    name: 'analyze_codebase_impact',
    title: 'Diff impact analysis',
    description:
      'Find files that depend on a set of changed paths by walking the reverse import graph. Source paths from: manual list, last push, a GitHub compare range, or a fix PR\'s files. Returns { changed_paths, source, affected_file_paths, affected_node_ids, meta }. Requires codebase indexing. Read-only. Use to gauge a diff\'s blast radius before merging; use get_blast_radius for a bug\'s component impact, or search_codebase to locate files.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What breaks if I change lib/auth.ts?',
  },
  {
    name: 'analyze_wiki_knowledge',
    title: 'Wiki knowledge graph',
    description:
      'Return the wiki/docs knowledge-graph nodes and their sources for the project. Returns { nodes: [{ id, label, source_url }], sources }. Read-only. Use to see what doc entities exist; pass include_wiki=true to ask_codebase to merge this corpus into a grounded answer.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What docs entities exist for onboarding?',
  },
]
