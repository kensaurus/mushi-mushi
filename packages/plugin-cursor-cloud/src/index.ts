/**
 * Cursor Cloud Agent plugin for Mushi Mushi.
 *
 * Path A: Marketplace plugin — subscribes to `report.classified`,
 * `qa_story.failed`, and `fix.requested`. When a qualifying event fires,
 * this plugin calls Cursor's HTTP REST API directly (no @cursor/sdk —
 * runs from Deno edge functions and Node alike) to create a Cloud Agent
 * run, and logs the resulting `agentId` + `prUrl` to the Mushi console.
 *
 * This is the *opt-in* path: teams install it from the Marketplace and
 * configure their Cursor API key + workspace ID in the plugin settings.
 * For the project-wide *default* Cursor agent path, see Path B in
 * packages/agents/src/adapters/cursor-cloud.ts.
 *
 * Cursor REST API docs: https://cursor.com/docs/cloud-agent/api/v0.md
 */

import {
  createPluginHandler,
  withRetry,
  type MushiEventEnvelope,
  type MushiReportClassifiedEvent,
  type MushiFixEvent,
} from '@mushi-mushi/plugin-sdk'

const CURSOR_API_BASE = 'https://api.cursor.com/v0'

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export interface CursorCloudPluginConfig {
  /** Cursor API key (cur_…). */
  apiKey: string
  /** Cursor workspace ID (ws_…). */
  workspaceId: string
  /** Cursor model slug. Defaults to `composer-2.5`. */
  model?: string
  /** Whether the agent should automatically open a draft PR. Defaults to true. */
  autoCreatePR?: boolean
  /** Maximum iterations for the agent. Defaults to 1. */
  maxIterations?: number
  /** Lowest severity that triggers a Cursor agent run. Defaults to `critical`. */
  severityThreshold?: 'low' | 'medium' | 'high' | 'critical'
  /**
   * URL of the target repository the Cursor agent will work in.
   * If not set, the plugin will attempt to read it from the event payload.
   */
  repoUrl?: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

export interface CursorAgentRunResponse {
  agentId: string
  status: string
  prUrl?: string
}

export interface CursorDispatchResult {
  agentId: string
  reportId: string
  model: string
}

/**
 * Call Cursor's REST API to create a Cloud Agent run.
 * Returns the agentId so the caller can track the run in Mushi console.
 *
 * On non-2xx the raw Response is thrown so `withRetry` can inspect
 * `.status` and `Retry-After` and apply the documented retry policy:
 *   - 429 / 5xx        → retry with exponential back-off
 *   - 4xx (not 429)    → throw immediately (no money burned on bad keys)
 *   - network error    → retry
 */
async function createCursorAgentRun(
  cfg: Required<Pick<CursorCloudPluginConfig, 'apiKey' | 'workspaceId' | 'model' | 'autoCreatePR' | 'maxIterations'>>,
  opts: { repoUrl: string; prompt: string; envVars?: Record<string, string> },
  f: typeof fetch,
): Promise<CursorAgentRunResponse> {
  return withRetry(async () => {
    const res = await f(`${CURSOR_API_BASE}/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: { id: cfg.model },
        cloud: {
          workspaceId: cfg.workspaceId,
          repos: [{ url: opts.repoUrl }],
          autoCreatePR: cfg.autoCreatePR,
          maxIterations: cfg.maxIterations,
          envVars: opts.envVars ?? {},
        },
        prompt: opts.prompt,
      }),
    })
    if (!res.ok) {
      // Throw the Response itself so withRetry can read status / Retry-After.
      // This is the contract documented in @mushi-mushi/plugin-sdk/retry.ts.
      throw res
    }
    return res.json() as Promise<CursorAgentRunResponse>
  })
}

function buildPromptFromClassifiedReport(
  envelope: MushiEventEnvelope,
  data: MushiReportClassifiedEvent,
): string {
  const lines = [
    `A bug has been reported in your project and classified as ${data.classification.severity?.toUpperCase()}.`,
    ``,
    `Report ID: ${data.report.id}`,
    `Title: ${data.report.title ?? '(untitled)'}`,
    `Category: ${data.report.category ?? data.classification.category}`,
    `Severity: ${data.classification.severity}`,
    `Project: ${envelope.projectId}`,
  ]

  if (data.classification.tags?.length) {
    lines.push(`Tags: ${data.classification.tags.join(', ')}`)
  }

  lines.push(
    ``,
    `Please investigate this bug, identify the root cause in the codebase, ` +
      `and open a draft PR with a minimal fix. Do not refactor unrelated code.`,
  )

  return lines.join('\n')
}

function buildPromptFromFixRequested(envelope: MushiEventEnvelope, fixData: MushiFixEvent): string {
  return [
    `A fix was requested for report ${fixData.report.id} in project ${envelope.projectId}.`,
    ``,
    `Report title: ${fixData.report.title ?? '(untitled)'}`,
    `Fix ID: ${fixData.fix.id}`,
    ``,
    `Please investigate the reported issue, identify the root cause, ` +
      `and open a draft PR with a minimal fix. Do not refactor unrelated code.`,
  ].join('\n')
}

/** Build the plugin handler and return a callable function. */
export function createCursorCloudPlugin(cfg: CursorCloudPluginConfig) {
  const minRank = SEVERITY_RANK[cfg.severityThreshold ?? 'critical']!
  const model = cfg.model ?? 'composer-2.5'
  const autoCreatePR = cfg.autoCreatePR ?? true
  const maxIterations = cfg.maxIterations ?? 1
  const f = cfg.fetchImpl ?? fetch

  const resolvedCfg = { apiKey: cfg.apiKey, workspaceId: cfg.workspaceId, model, autoCreatePR, maxIterations }

  return createPluginHandler({
    // The Cursor plugin is invoked by the Mushi platform's dispatchPluginEvent
    // fan-out. The platform verifies the inbound HMAC before calling this handler,
    // so we supply a dummy secret here — the outbound auth is the Cursor API key.
    secret: `cursor-plugin-secret-${cfg.workspaceId}`,
    on: {
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const rank = SEVERITY_RANK[data.classification.severity ?? ''] ?? 0
        if (rank < minRank) return

        const repoUrl = cfg.repoUrl ?? ''
        if (!repoUrl) return // Silently skip if no repo configured

        const run = await createCursorAgentRun(
          resolvedCfg,
          {
            repoUrl,
            prompt: buildPromptFromClassifiedReport(e, data),
            envVars: {
              MUSHI_REPORT_ID: data.report.id,
              MUSHI_PROJECT_ID: e.projectId,
              MUSHI_EVENT: 'report.classified',
            },
          },
          f,
        )

        // Emit audit log — handler return type is void.
        const result: CursorDispatchResult = { agentId: run.agentId, reportId: data.report.id, model }
        console.warn('[cursor-cloud] dispatched', JSON.stringify(result))
      },

      'fix.requested': async (e) => {
        const data = e.data as MushiFixEvent

        const repoUrl = cfg.repoUrl ?? ''
        if (!repoUrl) return

        const run = await createCursorAgentRun(
          resolvedCfg,
          {
            repoUrl,
            prompt: buildPromptFromFixRequested(e, data),
            envVars: {
              MUSHI_REPORT_ID: data.report.id,
              MUSHI_FIX_ID: data.fix.id,
              MUSHI_PROJECT_ID: e.projectId,
              MUSHI_EVENT: 'fix.requested',
            },
          },
          f,
        )

        // Emit audit log — handler return type is void.
        const result: CursorDispatchResult = { agentId: run.agentId, reportId: data.report.id, model }
        console.warn('[cursor-cloud] fix.requested dispatched', JSON.stringify(result))
      },
    },
  })
}
