/**
 * FILE: packages/agents/src/adapters/cursor-cloud.ts
 * PURPOSE: CursorCloudAgent — Path B adapter that dispatches a Cursor Cloud
 *          Agent run via Cursor's HTTP REST API for autofix_agent='cursor_cloud'.
 *
 * RUNTIME CONSTRAINT: Node-only. This adapter is invoked exclusively from the
 * Node-side FixOrchestrator in packages/agents/. It MUST NOT be imported inside
 * any Deno edge function — the Marketplace plugin (Path A) uses the same REST
 * surface from Deno via @mushi-mushi/plugin-cursor-cloud.
 *
 * Uses POST https://api.cursor.com/v0/agents with the official v0 payload
 * (prompt + source.repository + target.autoCreatePr). See:
 * https://cursor.com/docs/cloud-agent/api/v0
 *
 * Override the base URL via CURSOR_API_BASE_URL for staging / tests.
 */

import type { FixAgent, FixContext, FixResult } from '../types.js'

/** DB-serialisable artifact shape stored in fix_attempts.cursor_artifacts. */
export interface StoredArtifact {
  kind: 'screenshot' | 'video' | 'log' | 'file'
  path: string
  mime: string
}

export interface CursorCloudAgentConfig {
  apiKey: string
  model: string
  autoCreatePR: boolean
  maxIterations: number
  /** @deprecated Cursor Cloud Agents API no longer requires workspaceId. Kept for back-compat reads. */
  workspaceId?: string
}

const CURSOR_API_BASE = process.env.CURSOR_API_BASE_URL ?? 'https://api.cursor.com/v0'

const TERMINAL_AGENT_STATUSES = new Set(['FINISHED', 'ERROR', 'FAILED', 'CANCELLED', 'STOPPED'])

interface V0AgentRecord {
  id?: string
  agentId?: string
  status: string
  summary?: string
  target?: {
    branchName?: string
    prUrl?: string
  }
}

interface V0ArtifactRecord {
  absolutePath: string
  sizeBytes?: number
  updatedAt?: string
}

/**
 * CursorCloudAgent
 * ==============================================================
 *
 * Creates a Cursor Cloud Agent run via the REST API (same contract as
 * @mushi-mushi/plugin-cursor-cloud), polls until the run reaches a terminal
 * status, and returns artifacts for the FixCard gallery.
 */
export class CursorCloudAgent implements FixAgent {
  readonly name = 'cursor_cloud' as const

  constructor(private readonly cfg: CursorCloudAgentConfig) {}

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `bugfix/MUSHI-${context.reportId}-cursor-cloud`

    if (!this.cfg.apiKey) {
      return failedResult(
        branch,
        'cursor_api_key_ref resolved to empty — set the API key in project Settings → Integrations → Cursor Cloud.',
      )
    }

    const prompt = buildPromptFromReport(context)
    const repoUrl = context.config.repoUrl

    try {
      const created = await createCursorAgentRun({
        apiKey: this.cfg.apiKey,
        model: this.cfg.model,
        autoCreatePR: this.cfg.autoCreatePR,
        repoUrl,
        branchName: branch,
        prompt,
      })

      const agentId = created.agentId ?? created.id
      if (!agentId) {
        return failedResult(branch, 'Cursor API returned no agent id.')
      }

      const agent = await pollCursorAgent(this.cfg.apiKey, agentId)
      const artifacts = await fetchCursorArtifacts(this.cfg.apiKey, agentId)

      return buildFixResultFromV0(agent, branch, agentId, artifacts)
    } catch (err) {
      return failedResult(branch, `Cursor Cloud Agent run failed: ${String(err)}`)
    }
  }
}

async function cursorFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${CURSOR_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Cursor API ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
    )
  }

  return res.json() as Promise<T>
}

async function createCursorAgentRun(opts: {
  apiKey: string
  model: string
  autoCreatePR: boolean
  repoUrl: string
  branchName: string
  prompt: string
}): Promise<V0AgentRecord> {
  return cursorFetch<V0AgentRecord>(opts.apiKey, '/agents', {
    method: 'POST',
    body: JSON.stringify({
      prompt: { text: opts.prompt },
      model: opts.model || 'default',
      source: {
        repository: opts.repoUrl,
        ref: 'main',
      },
      target: {
        autoCreatePr: opts.autoCreatePR,
        branchName: opts.branchName,
        skipReviewerRequest: true,
      },
    }),
  })
}

async function pollCursorAgent(
  apiKey: string,
  agentId: string,
  timeoutMs = 30 * 60 * 1000,
  intervalMs = 5_000,
): Promise<V0AgentRecord> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const agent = await cursorFetch<V0AgentRecord>(apiKey, `/agents/${agentId}`)
    if (TERMINAL_AGENT_STATUSES.has(agent.status.toUpperCase())) {
      return agent
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Cursor agent ${agentId} did not finish within ${timeoutMs}ms`)
}

async function fetchCursorArtifacts(apiKey: string, agentId: string): Promise<StoredArtifact[]> {
  const payload = await cursorFetch<{ artifacts?: V0ArtifactRecord[] }>(
    apiKey,
    `/agents/${agentId}/artifacts`,
  ).catch(() => ({ artifacts: [] as V0ArtifactRecord[] }))

  return (payload.artifacts ?? []).map((artifact) =>
    classifyArtifactPath(artifact.absolutePath),
  )
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
    `2. Create a branch named \`bugfix/MUSHI-${ctx.reportId}-cursor-cloud\`.`,
    `3. Open a draft PR with the fix. Include a brief description of what changed and why.`,
    `4. Do not add new dependencies unless strictly necessary.`,
  )

  return lines.join('\n')
}

function buildFixResultFromV0(
  agent: V0AgentRecord,
  branch: string,
  agentId: string,
  artifacts: StoredArtifact[],
): FixResult & { cursorAgentId: string; cursorRunId: string; cursorArtifacts: StoredArtifact[] } {
  const status = agent.status.toUpperCase()
  const success = status === 'FINISHED'

  return {
    success,
    branch: agent.target?.branchName ?? branch,
    prUrl: agent.target?.prUrl,
    filesChanged: [],
    linesChanged: 0,
    summary: agent.summary ?? (success ? 'Cursor Cloud Agent run finished.' : `Cursor agent ended with status: ${agent.status}.`),
    error: success ? undefined : `Cursor agent ended with status: ${agent.status}`,
    cursorAgentId: agentId,
    // v0 agents are single-run; reuse agent id so FixCard can link to the run.
    cursorRunId: agentId,
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

const IMAGE_MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const

const VIDEO_MIME_BY_EXT = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
} as const

/** Map a filesystem path to the DB-serialisable artifact shape with IANA MIME types. */
export function classifyArtifactPath(filePath: string): StoredArtifact {
  const lower = filePath.toLowerCase()
  const ext = lower.split('.').pop() ?? ''

  if (ext in IMAGE_MIME_BY_EXT) {
    return {
      kind: 'screenshot',
      path: filePath,
      mime: IMAGE_MIME_BY_EXT[ext as keyof typeof IMAGE_MIME_BY_EXT],
    }
  }

  if (ext in VIDEO_MIME_BY_EXT) {
    return {
      kind: 'video',
      path: filePath,
      mime: VIDEO_MIME_BY_EXT[ext as keyof typeof VIDEO_MIME_BY_EXT],
    }
  }

  if (/\.(log|txt)$/.test(lower)) {
    return { kind: 'log', path: filePath, mime: 'text/plain' }
  }

  return { kind: 'file', path: filePath, mime: 'application/octet-stream' }
}
