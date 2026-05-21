/**
 * FILE: packages/agents/src/adapters/cursor-cloud.ts
 * PURPOSE: CursorCloudAgent — Path B adapter that dispatches a Cursor Cloud
 *          Agent run via @cursor/sdk for autofix_agent='cursor_cloud'.
 *
 * RUNTIME CONSTRAINT: @cursor/sdk is Node-only. This adapter is invoked
 * exclusively from the Node-side FixOrchestrator in packages/agents/.
 * It MUST NOT be imported inside any Deno edge function — the Marketplace
 * plugin (Path A) talks to Cursor's HTTP REST API directly instead.
 *
 * When @cursor/sdk is not installed (optional peer dep), generateFix returns
 * a deterministic "not configured" failure — same shape as ClaudeCodeAgent
 * when MUSHI_ENABLE_CLAUDE_CODE_AGENT is unset.
 */

import type { RunResult, SDKArtifact } from '@cursor/sdk'
import type { FixAgent, FixContext, FixResult } from '../types.js'
import { loadCursorSdk } from '../cursor-cloud-types.js'

/** DB-serialisable artifact shape stored in fix_attempts.cursor_artifacts. */
interface StoredArtifact {
  kind: 'screenshot' | 'video' | 'log' | 'file'
  path: string
  mime: string
}

export interface CursorCloudAgentConfig {
  apiKey: string
  model: string
  workspaceId: string
  autoCreatePR: boolean
  maxIterations: number
}

/**
 * CursorCloudAgent
 * ==============================================================
 *
 * Wraps @cursor/sdk's Agent.create() to generate a fix via a Cursor
 * Cloud Agent run. The agent is given a structured prompt built from
 * the FixContext, instructed to open a draft PR (when autoCreatePR is
 * true), and the run is awaited synchronously via run.wait().
 *
 * Artifacts (screenshots, videos, logs) are fetched via agent.listArtifacts()
 * and returned in the FixResult.cursorArtifacts field for the FixCard gallery.
 *
 * Override the base URL via CURSOR_API_BASE_URL for staging / tests.
 */
export class CursorCloudAgent implements FixAgent {
  readonly name = 'cursor_cloud' as const

  constructor(private readonly cfg: CursorCloudAgentConfig) {}

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/cursor-cloud-${context.reportId.slice(0, 8)}`

    const sdk = await loadCursorSdk()
    if (!sdk) {
      return failedResult(
        branch,
        '@cursor/sdk is not installed. Add it as a dependency in packages/agents/ ' +
          'or set CURSOR_API_KEY and use the REST-based Marketplace plugin path instead.',
      )
    }

    if (!this.cfg.apiKey) {
      return failedResult(branch, 'cursor_api_key_ref resolved to empty — set the API key in project Settings → Integrations → Cursor Cloud.')
    }

    const prompt = buildPromptFromReport(context)
    const repoUrl = context.config.repoUrl

    try {
      const agent = await sdk.Agent.create({
        apiKey: this.cfg.apiKey,
        model: { id: this.cfg.model },
        cloud: {
          repos: [{ url: repoUrl, startingRef: 'main' }],
          autoCreatePR: this.cfg.autoCreatePR,
          envVars: {
            MUSHI_REPORT_ID: context.reportId,
            MUSHI_PROJECT_ID: context.projectId,
          },
        },
      })

      const run = await agent.send(prompt)
      const result = await run.wait()

      const sdkArtifacts = await agent.listArtifacts().catch(() => [] as SDKArtifact[])
      const artifacts = sdkArtifacts.map(mapArtifact)

      return buildFixResult(result, branch, agent.agentId, run.id, artifacts)
    } catch (err) {
      return failedResult(branch, `Cursor Cloud Agent run failed: ${String(err)}`)
    }
  }
}

/** Build a structured prompt from the FixContext report + reproduction steps. */
function buildPromptFromReport(ctx: FixContext): string {
  const lines: string[] = [
    `You are an expert software engineer. Fix the following bug in the repository.`,
    ``,
    `## Bug Report`,
    `Category: ${ctx.report.category}`,
    `Severity: ${ctx.report.severity}`,
    `Description: ${ctx.report.description}`,
  ]

  if (ctx.report.summary) lines.push(`Summary: ${ctx.report.summary}`)
  if (ctx.report.component) lines.push(`Component: ${ctx.report.component}`)
  if (ctx.report.rootCause) lines.push(`Root Cause: ${ctx.report.rootCause}`)
  if (ctx.report.bugOntologyTags?.length) {
    lines.push(`Tags: ${ctx.report.bugOntologyTags.join(', ')}`)
  }

  if (ctx.reproductionSteps.length > 0) {
    lines.push(``, `## Reproduction Steps`)
    ctx.reproductionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  }

  if (ctx.relevantCode.length > 0) {
    lines.push(``, `## Relevant Code`)
    ctx.relevantCode.slice(0, 5).forEach(f => {
      lines.push(`### ${f.path}`)
      lines.push('```')
      lines.push(f.content.slice(0, 3000))
      lines.push('```')
    })
  }

  if (ctx.inventoryAction) {
    lines.push(``, `## Expected Behaviour (from Inventory)`)
    lines.push(`Action: ${ctx.inventoryAction.actionLabel}`)
    if (ctx.inventoryAction.actionDescription) {
      lines.push(`Spec: ${ctx.inventoryAction.actionDescription}`)
    }
    if (ctx.inventoryAction.expectedOutcome?.summary) {
      lines.push(`Success criterion: ${ctx.inventoryAction.expectedOutcome.summary}`)
    }
  }

  lines.push(
    ``,
    `## Instructions`,
    `1. Fix only the bug described above. Do NOT refactor, rename, or change unrelated code.`,
    `2. Create a branch named \`mushi/cursor-cloud-${ctx.reportId.slice(0, 8)}\`.`,
    `3. Open a draft PR with the fix. Include a brief description of what changed and why.`,
    `4. Do not add new dependencies unless strictly necessary.`,
  )

  return lines.join('\n')
}

function buildFixResult(
  result: RunResult,
  branch: string,
  agentId: string,
  runId: string,
  artifacts: StoredArtifact[],
): FixResult & { cursorAgentId: string; cursorRunId: string; cursorArtifacts: StoredArtifact[] } {
  const prUrl = result.git?.branches?.[0]?.prUrl
  const success = result.status === 'finished'

  return {
    success,
    branch: result.git?.branches?.[0]?.branch ?? branch,
    prUrl,
    filesChanged: [], // Cursor doesn't surface individual file diffs; mark unknown
    linesChanged: 0,
    summary: result.result ?? (success ? 'Cursor Cloud Agent run finished.' : `Cursor agent ended with status: ${result.status}.`),
    error: success ? undefined : `Cursor agent ended with status: ${result.status}`,
    // Cursor-specific fields persisted to fix_attempts by the orchestrator
    cursorAgentId: agentId,
    cursorRunId: runId,
    cursorArtifacts: artifacts,
  }
}

function failedResult(
  branch: string,
  error: string,
): FixResult & { cursorAgentId: undefined; cursorRunId: undefined; cursorArtifacts: [] } {
  return {
    success: false,
    branch,
    filesChanged: [],
    linesChanged: 0,
    summary: 'Cursor Cloud Agent fix failed',
    error,
    cursorAgentId: undefined,
    cursorRunId: undefined,
    cursorArtifacts: [],
  }
}

/** Map an SDKArtifact (path/sizeBytes/updatedAt) to the DB-serialisable shape. */
function mapArtifact(a: SDKArtifact): StoredArtifact {
  const lower = a.path.toLowerCase()
  let kind: StoredArtifact['kind'] = 'file'
  let mime = 'application/octet-stream'

  if (/\.(png|jpe?g|webp|gif)$/.test(lower)) { kind = 'screenshot'; mime = `image/${lower.split('.').pop()}` }
  else if (/\.(mp4|webm|mov)$/.test(lower)) { kind = 'video'; mime = `video/${lower.split('.').pop()}` }
  else if (/\.(log|txt)$/.test(lower)) { kind = 'log'; mime = 'text/plain' }

  return { kind, path: a.path, mime }
}
