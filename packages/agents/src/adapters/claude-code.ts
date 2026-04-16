import type { FixAgent, FixContext, FixResult } from '../types.js'
import { checkFileScope, checkCircuitBreaker } from '../scope.js'

export class ClaudeCodeAgent implements FixAgent {
  name = 'claude_code'

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-${context.reportId.slice(0, 8)}`

    // In production, this would invoke Claude Code via Channels API
    // with full context: report, reproductionSteps, relevantCode, graphContext
    void context.reproductionSteps

    return {
      success: false,
      branch,
      filesChanged: [],
      linesChanged: 0,
      summary: 'Fix generation pending — Claude Code session required',
      error: 'Agent invocation requires Channels API integration (not yet configured)',
    }
  }

  validateResult(context: FixContext, result: FixResult): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Circuit breaker
    const lineCheck = checkCircuitBreaker(result.linesChanged, context.config.maxLines)
    if (!lineCheck.allowed) errors.push(lineCheck.reason!)

    // Scope restriction
    for (const file of result.filesChanged) {
      const scopeCheck = checkFileScope(file, context.report.component, context.config.scopeRestriction)
      if (!scopeCheck.allowed) errors.push(scopeCheck.reason!)
    }

    // Secret check (would need the actual diff content)
    return { valid: errors.length === 0, errors }
  }
}
