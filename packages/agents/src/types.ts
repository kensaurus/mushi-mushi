export interface FixContext {
  reportId: string
  projectId: string
  report: {
    description: string
    category: string
    severity: string
    summary?: string
    component?: string
    rootCause?: string
    bugOntologyTags?: string[]
  }
  reproductionSteps: string[]
  relevantCode: CodeFile[]
  sentryAnalysis?: {
    issueUrl?: string
    rootCause?: string
  }
  graphContext?: {
    relatedBugs: Array<{ id: string; summary: string; status: string }>
    blastRadius: Array<{ nodeType: string; label: string }>
  }
  /**
   * Inventory anchor recovered from the `reports_against` graph edge that
   * `classify-report` writes when it picks an Action candidate. Lets the
   * agent (and `validateResult`) reason against the published spec instead
   * of just the bug report:
   *
   *   - `actionNodeId` / `actionLabel` — what surface the user was using
   *   - `actionDescription` — the `action:` line from the inventory.yaml
   *   - `pagePath` / `pageId` — where in the app it lives
   *   - `storyId` / `storyTitle` — the user story it serves
   *   - `expectedOutcome` — the machine-readable success contract; the
   *     review prompt instructs the agent to preserve every assertion in
   *     it, and the synthetic monitor will probe against it after merge
   *
   * `undefined` means the report was never linked to an inventory Action
   * (legacy report, or project without v2). All downstream code MUST
   * handle that path — adding a HARD requirement here would silently
   * regress every fix dispatched against a project that hasn't ingested
   * an inventory yet.
   */
  inventoryAction?: {
    actionNodeId: string
    actionLabel: string
    actionDescription?: string
    pagePath?: string
    pageId?: string
    storyId?: string
    storyTitle?: string
    expectedOutcome?: ExpectedOutcome
  }
  config: {
    maxLines: number
    scopeRestriction: 'component' | 'directory' | 'none'
    repoUrl: string
  }
}

/**
 * Mirror of `@mushi-mushi/inventory-schema`'s `ExpectedOutcome` type. We
 * duplicate the shape (rather than depending on inventory-schema directly)
 * so the agents package stays buildable from the Edge runtime AND from
 * Node consumers that don't pull the full inventory pipeline. The two
 * definitions are kept in sync by the round-trip test in
 * `packages/agents/src/review.test.ts` which feeds a real
 * `inventory-schema` value through and asserts structural compat.
 */
export interface ExpectedOutcome {
  summary?: string
  response?: {
    status_in?: number[]
    json_path?: Array<{
      path: string
      op: 'exists' | 'equals' | 'not_equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'matches'
      value?: unknown
    }>
  }
  database?: {
    table: string
    schema?: string
    where?: Record<string, unknown>
    expect?: 'row_exists' | 'row_absent' | 'row_count_at_least'
    min_count?: number
  }
  ui?: {
    visible_text?: string
    route_change_to?: string
  }
  extensions?: Record<string, unknown>
}

export interface CodeFile {
  path: string
  content: string
  componentTag?: string
}

export interface FixResult {
  success: boolean
  branch: string
  prUrl?: string
  filesChanged: string[]
  linesChanged: number
  summary: string
  error?: string
}

export interface FixAgent {
  name: string
  generateFix(context: FixContext): Promise<FixResult>
  /**
   * Optional last-line guard. If implemented, the orchestrator MUST call this
   * before pushing a PR and refuse on validation failure (V5.3 §2.10).
   */
  validateResult?(context: FixContext, result: FixResult): { valid: boolean; errors: string[] }
}

export interface ScopeCheck {
  allowed: boolean
  reason?: string
}

export interface ReviewResult {
  approved: boolean
  reasoning: string
}

// ============================================================
// D7: Multi-repo coordination types
// ============================================================
export type RepoRole = 'frontend' | 'backend' | 'mobile' | 'ai' | 'infra' | 'docs' | 'monorepo' | 'other'

export interface ProjectRepo {
  id: string
  repoUrl: string
  role: RepoRole
  defaultBranch: string
  pathGlobs: string[]
  isPrimary: boolean
}

export interface CoordinationTask {
  repoId: string
  role: RepoRole
  description: string
  pathHints: string[]
}

export interface CoordinationPlan {
  tasks: CoordinationTask[]
  rationale: string
}

export interface CoordinatedFixResult {
  coordinationId: string
  status: 'succeeded' | 'partial_success' | 'failed' | 'cancelled'
  attempts: Array<{
    fixId: string
    repoId: string
    role: RepoRole
    success: boolean
    prUrl?: string
    error?: string
  }>
}
