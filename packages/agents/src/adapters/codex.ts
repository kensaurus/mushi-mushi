import type { FixAgent, FixContext, FixResult } from '../types.js'

export class CodexAgent implements FixAgent {
  name = 'codex'

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-codex-${context.reportId.slice(0, 8)}`

    // In production, this would call the Codex Triggers API with:
    // summary, category, severity, component, rootCause, reproductionSteps, constraints
    void context.reproductionSteps

    return {
      success: false,
      branch,
      filesChanged: [],
      linesChanged: 0,
      summary: 'Fix generation pending — Codex task submission required',
      error: 'Codex Triggers API integration not yet configured',
    }
  }
}
