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
      'Dispatch the Mushi agentic fix orchestrator for a classified report. Returns a fix_attempt id; poll get_fix_timeline for progress.',
    scope: 'mcp:write',
    hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
    useCase: 'Let the in-repo agent attempt this fix for me.',
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
