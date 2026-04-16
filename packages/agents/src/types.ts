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
}

export interface ScopeCheck {
  allowed: boolean
  reason?: string
}

export interface ReviewResult {
  approved: boolean
  reasoning: string
}
