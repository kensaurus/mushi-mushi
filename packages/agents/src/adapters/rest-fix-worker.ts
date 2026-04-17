/**
 * FILE: packages/agents/src/adapters/rest-fix-worker.ts
 * PURPOSE: HTTP+JSON adapter for self-hosted fix workers (V5.3 §2.10, M7).
 *          NOTE: This was previously misnamed `GenericMCPAgent`; it is NOT
 *          actually MCP — it speaks plain REST. Use {@link McpFixAgent} for
 *          true Model Context Protocol communication.
 *          Kept for backwards compatibility with workers built before V5.3.
 */

import type { FixAgent, FixContext, FixResult } from '../types.js'
import { checkCircuitBreaker, checkFileScope } from '../scope.js'

export class RestFixWorkerAgent implements FixAgent {
  name = 'rest_fix_worker'
  private serverUrl: string
  private bearer?: string

  constructor(serverUrl: string, opts: { bearer?: string } = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.bearer = opts.bearer
  }

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-${context.reportId.slice(0, 8)}`
    try {
      const res = await fetch(`${this.serverUrl}/tools/generate_fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
        },
        body: JSON.stringify({
          report: context.report,
          reproductionSteps: context.reproductionSteps,
          relevantCode: context.relevantCode,
          config: { ...context.config, branch },
        }),
      })

      if (!res.ok) {
        return failedResult(branch, `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
      }
      const result = (await res.json()) as FixResult
      return { ...result, branch }
    } catch (err) {
      return failedResult(branch, String(err))
    }
  }

  validateResult(context: FixContext, result: FixResult): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const lc = checkCircuitBreaker(result.linesChanged, context.config.maxLines)
    if (!lc.allowed && lc.reason) errors.push(lc.reason)
    for (const f of result.filesChanged) {
      const sc = checkFileScope(f, context.report.component, context.config.scopeRestriction)
      if (!sc.allowed && sc.reason) errors.push(sc.reason)
    }
    return { valid: errors.length === 0, errors }
  }
}

function failedResult(branch: string, error: string): FixResult {
  return {
    success: false,
    branch,
    filesChanged: [],
    linesChanged: 0,
    summary: 'rest_fix_worker call failed',
    error,
  }
}
