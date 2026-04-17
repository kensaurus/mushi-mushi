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
  config: {
    maxLines: number
    scopeRestriction: 'component' | 'directory' | 'none'
    repoUrl: string
  }
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
// Wave D D7: Multi-repo coordination types
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
