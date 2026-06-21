// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
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
  /** Cursor API key (crsr_…). */
  apiKey: string
  /** @deprecated No longer required by Cursor Cloud Agents API. */
  workspaceId?: string
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
  /**
   * Standard Webhooks secret for inbound Mushi events. Required for
   * self-hosted installs — never derive this from workspaceId.
   */
  webhookSecret?: string
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
  cfg: Required<Pick<CursorCloudPluginConfig, 'apiKey' | 'model' | 'autoCreatePR' | 'maxIterations'>>,
  opts: { repoUrl: string; prompt: string; branchName?: string },
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
        prompt: { text: opts.prompt },
        model: cfg.model || 'default',
        source: {
          repository: opts.repoUrl,
          ref: 'main',
        },
        target: {
          autoCreatePr: cfg.autoCreatePR,
          branchName: opts.branchName ?? `mushi/cursor-${Date.now()}`,
          skipReviewerRequest: true,
        },
      }),
    })
    if (!res.ok) {
      // Throw the Response itself so withRetry can read status / Retry-After.
      // This is the contract documented in @mushi-mushi/plugin-sdk/retry.ts.
      throw res
    }
    const body = (await res.json()) as { agentId?: string; id?: string; status?: string; prUrl?: string }
    return {
      agentId: body.agentId ?? body.id ?? '',
      status: body.status ?? 'queued',
      prUrl: body.prUrl,
    }
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

function buildPromptFromQaStoryFailed(
  envelope: MushiEventEnvelope,
  data: { storyId?: string; title?: string; failureReason?: string },
): string {
  return [
    `A QA story failed in project ${envelope.projectId}.`,
    ``,
    `Story ID: ${data.storyId ?? 'unknown'}`,
    `Title: ${data.title ?? '(untitled)'}`,
    data.failureReason ? `Failure: ${data.failureReason}` : '',
    ``,
    `Please investigate the failing assertion, identify the root cause in the codebase, ` +
      `and open a draft PR with a minimal fix. Do not refactor unrelated code.`,
  ].filter((line) => line !== '').join('\n')
}

/** Build the plugin handler and return a callable function. */
export function createCursorCloudPlugin(cfg: CursorCloudPluginConfig) {
  const minRank = SEVERITY_RANK[cfg.severityThreshold ?? 'critical']!
  const model = cfg.model ?? 'composer-2.5'
  const autoCreatePR = cfg.autoCreatePR ?? true
  const maxIterations = cfg.maxIterations ?? 1
  const f = cfg.fetchImpl ?? fetch

  const resolvedCfg = { apiKey: cfg.apiKey, model, autoCreatePR, maxIterations }

  const webhookSecret =
    cfg.webhookSecret ??
    (typeof process !== 'undefined' ? process.env.MUSHI_PLUGIN_WEBHOOK_SECRET : undefined)
  if (!webhookSecret) {
    throw new Error(
      'Cursor Cloud plugin requires webhookSecret (or MUSHI_PLUGIN_WEBHOOK_SECRET) for inbound event verification.',
    )
  }

  return createPluginHandler({
    secret: webhookSecret,
    on: {
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const rank = SEVERITY_RANK[data.classification.severity ?? ''] ?? 0
        if (rank < minRank) return

        const repoUrl = cfg.repoUrl ?? ''
        if (!repoUrl) {
          console.warn('[cursor-cloud] report.classified skipped: repoUrl not configured. ' +
            'Set repoUrl in the plugin config so the agent knows which codebase to fix.')
          return
        }

        const run = await createCursorAgentRun(
          resolvedCfg,
          {
            repoUrl,
            prompt: buildPromptFromClassifiedReport(e, data),
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
        if (!repoUrl) {
          console.warn('[cursor-cloud] fix.requested skipped: repoUrl not configured.')
          return
        }

        const run = await createCursorAgentRun(
          resolvedCfg,
          {
            repoUrl,
            prompt: buildPromptFromFixRequested(e, data),
          },
          f,
        )

        // Emit audit log — handler return type is void.
        const result: CursorDispatchResult = { agentId: run.agentId, reportId: data.report.id, model }
        console.warn('[cursor-cloud] fix.requested dispatched', JSON.stringify(result))
      },

      'qa_story.failed': async (e) => {
        const data = e.data as { storyId?: string; title?: string; failureReason?: string }

        const repoUrl = cfg.repoUrl ?? ''
        if (!repoUrl) {
          console.warn('[cursor-cloud] qa_story.failed skipped: repoUrl not configured.')
          return
        }

        const run = await createCursorAgentRun(
          resolvedCfg,
          {
            repoUrl,
            prompt: buildPromptFromQaStoryFailed(e, data),
          },
          f,
        )

        const result: CursorDispatchResult = {
          agentId: run.agentId,
          reportId: data.storyId ?? 'unknown',
          model,
        }
        console.warn('[cursor-cloud] qa_story.failed dispatched', JSON.stringify(result))
      },

      // ── Skill pipeline step dispatch (Phase 5) ───────────────────────────
      // When a pipeline run is started in 'cloud' mode, the skills.ts route
      // fires this event for each step. The plugin creates a Cursor Cloud
      // agent run whose prompt is the pre-composed context_packet for that
      // step, stores the agentId on the step row, and reports back to Mushi
      // via the check-in endpoint.
      'skill_pipeline.step.dispatched': async (e) => {
        const data = e.data as {
          runId: string
          stepIndex: number
          skillSlug: string
          contextPacket: string
          projectId: string
        }

        const repoUrl = cfg.repoUrl ?? ''
        if (!repoUrl) {
          console.warn('[cursor-cloud] skill_pipeline.step.dispatched skipped: repoUrl not configured.')
          return
        }

        let run: CursorAgentRunResponse
        try {
          run = await withRetry(
            () =>
              createCursorAgentRun(
                resolvedCfg,
                {
                  repoUrl,
                  prompt: buildPromptFromSkillStep(data),
                },
                f,
              ),
            { maxAttempts: 3 },
          )
        } catch (err) {
          console.error('[cursor-cloud] skill_pipeline step dispatch failed', String(err))
          const mushiUrl =
            (typeof process !== 'undefined' ? process.env.MUSHI_API_URL : undefined) ?? 'https://api.mushi.ai'
          const mushiKey =
            (typeof process !== 'undefined' ? process.env.MUSHI_API_KEY : undefined) ?? ''
          if (mushiKey) {
            try {
              await f(`${mushiUrl}/v1/admin/skills/pipelines/${data.runId}/steps/${data.stepIndex}/checkin`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Mushi-Api-Key': mushiKey,
                },
                body: JSON.stringify({
                  status: 'failed',
                  notes: `Cursor Cloud dispatch failed: ${String(err).slice(0, 400)}`,
                }),
              })
            } catch { /* best-effort */ }
          } else {
            console.warn(
              `[cursor-cloud] MUSHI_API_KEY unset — cannot report the failed dispatch for run ${data.runId} step ${data.stepIndex}. ` +
              `The step will remain 'running' server-side until it is manually checked in.`,
            )
          }
          return
        }

        console.log('[cursor-cloud] skill_pipeline step dispatched', {
          runId: data.runId,
          stepIndex: data.stepIndex,
          agentId: run.agentId,
        })

        // Report back to Mushi: update the step row with the agentId.
        // The console React Flow canvas will update via Realtime.
        // Use a best-effort POST to the check-in endpoint.
        const mushiUrl =
          (typeof process !== 'undefined' ? process.env.MUSHI_API_URL : undefined) ?? 'https://api.mushi.ai'
        const mushiKey =
          (typeof process !== 'undefined' ? process.env.MUSHI_API_KEY : undefined) ?? ''

        if (mushiKey) {
          try {
            await f(`${mushiUrl}/v1/admin/skills/pipelines/${data.runId}/steps/${data.stepIndex}/checkin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Mushi-Api-Key': mushiKey,
              },
              body: JSON.stringify({
                status: 'running',
                agent_ref: run.agentId,
                notes: `Cursor Cloud agent dispatched (model: ${model})`,
              }),
            })
          } catch (err) {
            console.warn('[cursor-cloud] checkin failed (best-effort)', String(err))
          }
        } else {
          console.warn(
            `[cursor-cloud] MUSHI_API_KEY unset — agent ${run.agentId} was dispatched for run ${data.runId} step ${data.stepIndex} ` +
            `but its agent_ref/running status cannot be reported back. The console flow will not reflect this step until it is manually checked in.`,
          )
        }
      },
    },
  })
}

function buildPromptFromSkillStep(data: {
  runId: string
  stepIndex: number
  skillSlug: string
  contextPacket: string
}): string {
  return [
    `# Mushi Skill Pipeline — Step ${data.stepIndex + 1}`,
    ``,
    `Skill: \`${data.skillSlug}\``,
    `Pipeline run: ${data.runId}`,
    ``,
    `You are executing step ${data.stepIndex + 1} of a Mushi skill pipeline. ` +
      `The full context packet below contains your instructions plus the complete report context.`,
    ``,
    `When you have completed this step, call the Mushi MCP tool \`checkin_pipeline_step\` with:`,
    `  run_id: "${data.runId}"`,
    `  step_index: ${data.stepIndex}`,
    `  status: "passed" (or "failed" if you could not complete it)`,
    `  pr_url: <your PR URL if you opened one>`,
    ``,
    `─── Context Packet ────────────────────────────────────────────────────`,
    ``,
    data.contextPacket.slice(0, 32_000),
  ].join('\n')
}
