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
      'Run the 4 dispatch-readiness checks for a project and return their pass/fail status ' +
      '(GitHub repo connected, codebase indexed, Anthropic BYOK key present, autofix enabled). ' +
      'Also returns the target repo URL when GitHub is connected. ' +
      'Use this before calling dispatch_fix to understand why a dispatch might fail — ' +
      'or to validate that the onboarding wizard is complete.',
    scope: 'mcp:read',
    hints: { readOnly: true, idempotent: true, openWorld: true },
    useCase: 'Is this project ready to auto-fix bugs? What is blocking me?',
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
      'Move a report between workflow states (new → classified → grouped → fixing → fixed → dismissed). Enforces the same transition rules as the admin UI.',
    scope: 'mcp:write',
    // Transitioning to `dismissed` is destructive by intent — it removes the
    // report from triage queues. Flag the whole tool as destructive so the
    // client prompts the user on every call.
    hints: { readOnly: false, destructive: true, idempotent: true, openWorld: true },
    useCase: 'Dismiss this duplicate / mark it fixed.',
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
]
