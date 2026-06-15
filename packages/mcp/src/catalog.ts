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
      'List recent bug reports with optional filters (status / category / severity). Use this to survey what the triage queue looks like right now.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What landed in my triage queue today?',
  },
  {
    name: 'get_report_detail',
    title: 'Report detail',
    description:
      'Full payload for a single report — description, console logs, network requests, screenshot URL, classification, fix history.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me everything you know about this report.',
  },
  {
    name: 'get_report_timeline',
    title: 'Unified report timeline',
    description:
      'Ordered timeline merging reporter comments, fix events, QA runs, skill pipeline steps, and Ask Mushi turns for one report.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What happened on this report thread end-to-end?',
  },
  {
    name: 'search_reports',
    title: 'Search reports',
    description:
      'Semantic + keyword search over reports. Uses pgvector similarity server-side — falls back to description/summary substring only if embeddings are unavailable for the project.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Find reports mentioning "checkout flakiness".',
  },
  {
    name: 'get_similar_bugs',
    title: 'Similar bugs',
    description:
      'Find bugs related to a component, page, or description via pgvector nearest-neighbour search. Same backend as search_reports but tuned for "have we seen this before?".',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Have we seen a bug like this before?',
  },
  {
    name: 'get_fix_context',
    title: 'Fix context bundle',
    description:
      'Bundle the full context an agent needs to fix a bug: report detail, reproduction steps, component, root cause, ontology tags. One call instead of several.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me everything I need to fix this in one payload.',
  },
  {
    name: 'get_fix_timeline',
    title: 'Fix timeline',
    description:
      'Ordered timeline of a fix attempt — dispatched → started → branch → commit → PR opened → CI → completed/failed. Use this to debug "why did this fix fail?".',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Why did this fix attempt fail — show me every step.',
  },
  {
    name: 'get_blast_radius',
    title: 'Blast radius',
    description:
      'Graph traversal showing other components / pages a bug group touches. Use before dispatching a fix so the agent can scope its changes.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What else might break if I change this component?',
  },
  {
    name: 'get_knowledge_graph',
    title: 'Knowledge graph traversal',
    description:
      'Traverse the knowledge graph from a seed component or page. Returns nodes + edges within a depth budget (max 4 hops).',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me how this component connects to the rest of the app.',
  },
  {
    name: 'run_nl_query',
    title: 'Ask your data (NL → SQL)',
    description:
      'Natural-language question → SQL query run against your project data. Read-only, 60/hour rate-limited, no privileged schemas.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which components had the most critical bugs this week?',
  },
  // --- Inventory v2 (whitepaper §6.8) -------------------------------------
  {
    name: 'inventory_get',
    title: 'Inventory snapshot',
    description:
      'Current inventory.yaml snapshot for a project (latest ingest, validation errors, per-action status summary). Requires inventory_v2 on the project plan.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What does the live inventory claim for this repo right now?',
  },
  {
    name: 'inventory_diff',
    title: 'Inventory diff',
    description:
      'Diff two ingested inventory commits (fromSha → toSha) — added/removed nodes and edges. Use before merging a PR that touches inventory.yaml.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What changed in inventory between these two SHAs?',
  },
  {
    name: 'inventory_findings',
    title: 'Gate findings',
    description:
      'Latest gate runs + findings (dead-handler, mock-leak, crawl, status-claim, …). Filter by gate name or severity.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Show me what CI gates failed on the last run.',
  },
  {
    name: 'graph_neighborhood',
    title: 'Graph neighborhood',
    description:
      'BFS neighborhood around a graph node id or label — nodes + edges within a depth budget (max 4). Same backend as knowledge-graph traversal, tuned for "what touches this action?".',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What nodes connect to this inventory Action within 2 hops?',
  },
  {
    name: 'graph_node_status',
    title: 'Graph node detail',
    description:
      'Fetch a single graph node row (label, type, metadata — includes v2 derived status on Action nodes).',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What status does the graph store on this node id?',
  },
  {
    name: 'fix_suggest',
    title: 'Suggested fix (from triage)',
    description:
      'Read-only slice of a report focused on Stage 2 suggested fix + root cause + reproduction — faster than pulling the full blob when you only need the human-readable hint.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What did Stage 2 say we should try for this report?',
  },
  // --- Setup / admin -------------------------------------------------------
  {
    name: 'setup_check',
    title: 'Dispatch preflight check',
    description:
      'Run the 4 **dispatch-readiness** checks for a project and return their pass/fail status ' +
      '(GitHub repo connected, codebase indexed, Anthropic BYOK key present, autofix enabled). ' +
      'Also returns the target repo URL when GitHub is connected. ' +
      'Use this before calling dispatch_fix to understand why a dispatch might fail. ' +
      'For SDK ingest health (API key → heartbeat → first report), call ingest_setup_check instead.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is this project ready to auto-fix bugs? What is blocking dispatch?',
  },
  {
    name: 'ingest_setup_check',
    title: 'Ingest setup check',
    description:
      'Run the 4 **required ingest** checks for the project tied to this API key: ' +
      'project exists, active API key, SDK heartbeat (or real report), and at least one ingested report. ' +
      'Returns per-step pass/fail plus last_sdk_seen_at and endpoint host diagnostics. ' +
      'Use after wiring env vars or pasting the SDK snippet to confirm the banner will work.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is the SDK installed and ingesting reports? Why is my banner still missing?',
  },
  {
    name: 'diagnose_connection',
    title: 'Connection diagnose (CLI + MCP + SDK)',
    description:
      'Validate the MCP server credentials (endpoint, API key, projectId), ping /health, ' +
      'run ingest-setup and dispatch preflight, and return the single best next action when ' +
      'anything fails. Use when the user asks "why aren\'t my reports showing up?".',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Why is my Mushi setup broken — what exact step should I fix next?',
  },
  // --- Write / agentic ----------------------------------------------------
  {
    name: 'submit_fix_result',
    title: 'Record a fix outcome',
    description:
      'Record a fix outcome (branch, PR, files, lines) from an external agent. Creates a fix_attempt then patches it to completed.',
    scope: 'mcp:write',
    // Not idempotent: re-running creates a second fix_attempt row.
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'I just opened a PR — log it against the report.',
  },
  {
    name: 'dispatch_fix',
    title: 'Dispatch Mushi fix agent',
    description:
      'Dispatch the Mushi agentic fix orchestrator for a classified report. Set agent="cursor_cloud" to dispatch a Cursor Cloud Agent that opens a signed draft PR. Returns a fix_attempt id; poll get_fix_timeline for progress.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Let the in-repo agent attempt this fix for me (or: dispatch a Cursor Cloud Agent).',
  },
  {
    name: 'trigger_judge',
    title: 'Run Sonnet-as-Judge',
    description:
      'Run the Sonnet-as-Judge over a batch of classified reports. Returns a batch id; results land in judge_results.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
    useCase: 'Grade the latest batch of fixes before I ship.',
  },
  {
    name: 'test_gen_from_report',
    title: 'Generate Playwright test from report',
    description:
      'POST to inventory test-gen: uses the project BYOK LLM to author a Playwright spec from a classified report and opens a draft PR (internal service orchestration). Requires inventory_v2 + GitHub + LLM keys.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Turn this regression report into an E2E test PR.',
  },
  {
    name: 'transition_status',
    title: 'Move report between states',
    description:
      'Move a report between workflow states (new → classified → grouped → fixing → fixed → verified → reopened → dismissed). Enforces the same transition rules as the admin UI.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Dismiss this duplicate / mark it fixed.',
  },
  {
    name: 'merge_fix',
    title: 'Merge fix PR',
    description: 'Squash-merge a fix attempt PR and mark the linked report fixed.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Merge the draft PR and notify the reporter.',
  },
  {
    name: 'refresh_ci',
    title: 'Refresh fix CI status',
    description: 'Pull the latest GitHub check-run status for a fix attempt.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Check whether CI is green before merging.',
  },
  {
    name: 'reopen_report',
    title: 'Reopen report (operator)',
    description: 'Move a report to reopened for regression triage.',
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
      'Award ad-hoc bonus points to a contributor by their external user id (as passed to Mushi.identify()). ' +
      'Points are applied server-side, audit-logged, and trigger tier re-evaluation. ' +
      'Requires mcp:write scope. Use this to thank a contributor who found a critical bug or to run a one-off promotional campaign.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Give this contributor 500 bonus points for the critical bug they found.',
  },
  {
    name: 'set_tier',
    title: 'Override contributor tier',
    description:
      'Override a contributor\'s tier by tier slug (e.g. "champion"). This is an admin escape hatch for manual promotions — ' +
      'normal tier transitions happen automatically via point thresholds. ' +
      'The override is logged in end_user_activity with action=tier_override_manual. ' +
      'Requires mcp:write scope.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: true, openWorld: true },
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
      'List the Mushi projects accessible to this API key. For project-scoped keys (the typical case), ' +
      'returns a single-item list with the bound project\'s id, name, slug, plan tier, and ingest status. ' +
      'For org-level tokens, returns all projects in the org. ' +
      'Use this when MUSHI_PROJECT_ID is not configured — call list_projects first, then pass the id to other tools.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which projects can I access with this API key?',
  },
  {
    name: 'get_project_context',
    title: 'Project context snapshot',
    description:
      'Return a rich context snapshot for a project: name, repo URL, SDK heartbeat, ingest status, ' +
      'open report count, autofix readiness, BYOK LLM config, plan tier, and active integration health. ' +
      'Equivalent to a merged preflight + activation + settings read. ' +
      'Agents should call this at the start of a triage session to orient themselves.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Give me a status overview of this project before I start triaging.',
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
      'Read-only orchestration tool: combines report detail, evidence, similar bugs, fix context, blast radius, ' +
      'and recent pipeline logs for a report into a single structured triage packet. ' +
      'Returns a prioritised list of recommended next actions (investigate, dispatch_fix, group_with, dismiss). ' +
      'Equivalent to a Sentry "Analyze with Seer" flow grounded in user-felt reports. ' +
      'Pass report_id to kick off triage. Call this before dispatch_fix.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Analyze this bug report end-to-end and tell me what to do.',
  },
  // ── Lessons / evolution loop ─────────────────────────────────────────────
  {
    name: 'query_lessons',
    title: 'Query lessons for diff context',
    description:
      'Token-budget retrieval of relevant learning rules (lessons) for a given code diff or PR context. ' +
      'Returns ranked lessons packed within max_tokens using bi-encoder retrieval + severity-weighted scoring. ' +
      'Use this before opening a PR, writing a fix, or asking "what mistakes should I avoid in this area of code?"',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What past mistakes should I avoid when making this change?',
  },
  {
    name: 'list_lessons',
    title: 'List project lessons',
    description:
      'List promoted learning rules (lessons) for the current project. Each lesson represents a named pattern ' +
      'of mistakes that has been encoded from bug reports. Use this to understand what systemic issues have ' +
      'been identified and encoded as heuristics.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What systemic patterns has Mushi identified for this project?',
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
    title: 'PDCA dashboard snapshot',
    description: 'PDCA health snapshot — stage counts, bottleneck, recent activity (same payload the admin console polls).',
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
      'Returns the privacy posture for this project: storage region, LLM provider, whether BYOK is configured, ' +
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
      'or stalling (flat scores, same bugs re-appearing). Use before triage to understand which bug classes ' +
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
      'Live health status of every configured BYOK channel (Sentry, GitHub, LangFuse, PagerDuty, …). ' +
      'Orchestrators should check this before dispatching a fix to fail-fast on broken channels ' +
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
      'Crawl a live application URL with Firecrawl/Browserbase and ask Claude to draft an inventory.yaml with pages and user stories. ' +
      'Creates a story_map_run row for progress tracking, then writes an inventory_proposals row (source=live_crawl). ' +
      'Optionally dispatches a Cursor Cloud agent to refine the draft and open a PR. ' +
      'Returns { runId, status: "pending" } immediately — poll get_map_run_status for progress.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Map the user stories in my live app automatically without writing YAML by hand.',
  },
  {
    name: 'get_map_run_status',
    title: 'Story map run status',
    description:
      'Get the status and results of a story_map_run (pending → running → completed/failed). ' +
      'Returns pages_crawled, proposal_id (once done), and cursor_pr_url if Cursor Cloud refined the draft.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is my story mapping crawl done yet?',
  },
  {
    name: 'generate_tdd_from_story',
    title: 'Generate TDD test from user story',
    description:
      'Given a user story id (from the accepted inventory), ask Claude to write a full Playwright TypeScript test. ' +
      'Inserts a qa_stories row (source=test_gen_from_story) with approval_status driven by automation_mode. ' +
      'Optionally opens a draft GitHub PR. Returns { qaStoryId, prUrl, approvalStatus, needsHumanReview }.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Generate a Playwright test for this user story.',
  },
  {
    name: 'improve_qa_story',
    title: 'PDCA auto-improve a failing QA story',
    description:
      'Trigger the PDCA improver for a specific project. Finds recently failed qa_story_runs and uses Claude to write improved test scripts. ' +
      'New tests are created with source=pdca and approval gated by the original story\'s automation_mode.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Fix my failing QA tests automatically.',
  },
  {
    name: 'run_qa_story',
    title: 'Trigger a manual QA story run',
    description:
      'Queue a manual run for an enabled + approved qa_story. Returns the run id immediately; ' +
      'poll qa_story_runs or use get_report_detail for progress. Equivalent to "Run now" in the console.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Run the login flow test right now.',
  },
  {
    name: 'list_byok_keys',
    title: 'List BYOK API key pool',
    description:
      'List all BYOK API keys for the project, grouped by provider. Shows label, priority, status, and cooldown. ' +
      'Never returns the raw key value — only metadata. Use this to see which keys are active or exhausted.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Which API keys are active and which are rate-limited?',
  },
  {
    name: 'add_byok_key',
    title: 'Add a BYOK API key',
    description:
      'Add a new API key to the project\'s BYOK pool for a given provider (anthropic, openai, firecrawl, browserbase, cursor). ' +
      'Specify label and priority for ordering. The key is stored encrypted in Supabase Vault.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Add a backup Anthropic key to the pool.',
  },
  {
    name: 'list_pending_review_stories',
    title: 'List QA stories pending review',
    description:
      'Get the queue of TDD tests that were auto-generated and are waiting for human approval before they run in the QA schedule.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What TDD tests need my approval today?',
  },
  {
    name: 'approve_qa_story',
    title: 'Approve or reject a pending QA story',
    description:
      'Approve or reject a qa_story that is in pending_review. Approved stories are enabled in the QA schedule immediately.',
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

  // ── Skill Pipeline tools ─────────────────────────────────────────────────────

  {
    name: 'list_skills',
    title: 'List agent skills',
    description:
      'List the agent skills available in the catalog, optionally filtered by category. ' +
      'Returns slug, title, description, category, and chain_slugs for each skill. ' +
      'Use before start_skill_pipeline to find the right skill slug for a given type of work.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What skills are available for debugging production errors?',
  },
  {
    name: 'get_skill',
    title: 'Get skill detail',
    description:
      'Fetch the full detail for a single agent skill by slug, including the complete SKILL.md body and resolved chain. ' +
      'Use before executing a step to understand what the skill expects you to do.',
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
      'Fetch the full detail for a skill pipeline run: status, context_packet, and all step statuses. ' +
      'Call to retrieve the context_packet after a pipeline was started from the console or another agent.',
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

  {
    name: 'get_activation_status',
    title: 'Activation cockpit status',
    description:
      'Unified setup posture for the active project: required steps, SDK heartbeat, dispatch preflight, and the next best action. ' +
      'Use this first when the user says setup is broken or they cannot connect.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What is blocking this project from going live?',
  },
  {
    name: 'get_reporter_thread',
    title: 'Reporter feedback thread',
    description:
      'Fetch the unified timeline for a report — the reporter/admin comment thread ' +
      '(including verify/reopen signals) plus fix, QA, and status lanes. ' +
      'Use when triaging whether an end user still sees a bug as unfixed.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'What did the reporter say after we marked this fixed?',
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
]
