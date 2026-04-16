import type { FixAgent, FixContext, FixResult } from '../types.js'

export class GenericMCPAgent implements FixAgent {
  name = 'generic_mcp'
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-mcp-${context.reportId.slice(0, 8)}`

    try {
      const res = await fetch(`${this.serverUrl}/tools/generate_fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: context.report,
          reproductionSteps: context.reproductionSteps,
          relevantCode: context.relevantCode,
          config: { ...context.config, branch },
        }),
      })

      if (!res.ok) {
        return {
          success: false,
          branch,
          filesChanged: [],
          linesChanged: 0,
          summary: 'MCP agent call failed',
          error: `HTTP ${res.status}: ${await res.text()}`,
        }
      }

      const result = await res.json() as FixResult
      return { ...result, branch }
    } catch (err) {
      return {
        success: false,
        branch,
        filesChanged: [],
        linesChanged: 0,
        summary: 'MCP agent connection failed',
        error: String(err),
      }
    }
  }
}
