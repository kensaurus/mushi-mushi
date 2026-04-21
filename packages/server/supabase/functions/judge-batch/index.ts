import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { createTrace } from '../_shared/observability.ts'
import { sendSlackNotification } from '../_shared/slack.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { recordPromptResult, checkPromotionEligibility, promoteCandidate } from '../_shared/prompt-ab.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { dispatchPluginEvent } from '../_shared/plugins.ts'

/**
 * OpenRouter / Together / Fireworks expect `vendor/model` slugs. Operators
 * commonly type bare names (`gpt-4.1`, `claude-opus-4-6`) inherited from the
 * direct-API config. This helper prefixes the most common families so the
 * call doesn't 400 with "model not found" the first time someone enables a
 * gateway. If the model already contains a `/`, we leave it alone.
 */
function normalizeGatewayModel(model: string): string {
  if (!model || model.includes('/')) return model
  const m = model.toLowerCase()
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return `openai/${model}`
  }
  if (m.startsWith('claude')) return `anthropic/${model}`
  if (m.startsWith('gemini')) return `google/${model}`
  if (m.startsWith('llama')) return `meta-llama/${model}`
  if (m.startsWith('mistral') || m.startsWith('mixtral')) return `mistralai/${model}`
  if (m.startsWith('qwen')) return `qwen/${model}`
  if (m.startsWith('deepseek')) return `deepseek/${model}`
  return model
}

// OpenAI's "strict" structured-outputs mode rejects optional fields — every
// property must appear in `required` and use `nullable` instead of `optional`.
// Use `.nullable()` everywhere so the schema is portable across:
//   - Anthropic (tolerant of optional)
//   - OpenAI strict mode (the original failure)
//   - OpenRouter (passes the schema through to upstream verbatim)
const judgeSchema = z.object({
  accuracy: z.number().min(0).max(1).describe('Does the category match the described issue?'),
  severity_calibration: z.number().min(0).max(1).describe('Is severity proportional to impact?'),
  component_tagging: z.number().min(0).max(1).describe('Is the component correctly identified?'),
  repro_quality: z.number().min(0).max(1).describe('Are reproduction steps actionable?'),
  classification_agreed: z.boolean().describe('Would you agree with the overall classification?'),
  reasoning: z.string().max(500).describe('Brief justification for scores'),
  suggested_correction: z.object({
    category: z.string().nullable().describe('Suggested category, or null if no change'),
    severity: z.string().nullable().describe('Suggested severity, or null if no change'),
    component: z.string().nullable().describe('Suggested component, or null if no change'),
  }).nullable().describe('If classification_agreed is false, suggest corrections; otherwise null'),
  // Wave E §4: short failure-mode tag for prompt-auto-tune bucketing.
  // Constrained to a small vocabulary so the auto-tuner can group failures
  // numerically rather than re-running the full reasoning blob through an LLM.
  disagreement_reason: z
    .enum([
      'wrong_category',
      'wrong_severity',
      'wrong_component',
      'missing_component',
      'overconfident',
      'underconfident',
      'vague_repro',
      'noise',
      'other',
    ])
    .nullable()
    .describe('When classification_agreed is false, the dominant failure mode. NULL when agreed.'),
})

Deno.serve(withSentry('judge-batch', async (req) => {
  // Declared outside the try so the catch can mark the run as failed instead
  // of writing a duplicate cron_runs row.
  let cronRun: Awaited<ReturnType<typeof startCronRun>> | null = null
  let db: ReturnType<typeof getServiceClient> | null = null

  try {
    const auth = req.headers.get('Authorization')
    const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth
    if (!token || !expectedKey || token !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Requires valid service_role key' }), { status: 401 })
    }

    db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId = body.projectId as string | undefined
    const trigger = (body.trigger ?? 'http') as 'cron' | 'manual' | 'http'

    cronRun = await startCronRun(db, 'judge-batch', trigger)

    const projectFilter = projectId
      ? db.from('projects').select('id, name').eq('id', projectId)
      : db.from('projects').select('id, name')

    const { data: projects } = await projectFilter
    if (!projects?.length) {
      await cronRun.finish({ rowsAffected: 0, metadata: { reason: 'no projects' } })
      return new Response(JSON.stringify({ ok: true, message: 'No projects' }), { status: 200 })
    }

    let totalEvaluated = 0
    const driftAlerts: string[] = []
    // Capture per-report failures so the operator can see WHY rows_affected=0
    // without fishing through edge-function stdout. Surfaced on cron_runs.metadata.
    const evalErrors: Array<{ reportId: string; err: string }> = []

    for (const project of projects) {
      const { data: settings } = await db
        .from('project_settings')
        .select('judge_enabled, judge_model, judge_sample_size, slack_webhook_url, discord_webhook_url, judge_fallback_provider, judge_fallback_model')
        .eq('project_id', project.id)
        .single()

      if (!settings?.judge_enabled) continue

      const sampleSize = settings.judge_sample_size ?? 50
      // LLM-1/LLM-2 (audit 2026-04-21): default judge flipped from
      // claude-opus-4-6 to claude-sonnet-4-6. Opus is $15/$75 per 1M tokens
      // vs Sonnet's $3/$15 — running Opus as judge of a Sonnet classifier
      // was ~5x over-spec and the audit measured 100% primary-path
      // failure + 62% disagreement, suggesting Opus was being rate-limited
      // under load and silently handing every eval to the OpenAI fallback.
      // Sonnet-on-Sonnet is the same-tier baseline; upgrade to Opus
      // deliberately (not by default) if disagreement trends high.
      const modelId = settings.judge_model ?? 'claude-sonnet-4-6'
      const fallbackProvider = (settings.judge_fallback_provider ?? 'openai') as 'openai' | 'none'
      const fallbackModelId = settings.judge_fallback_model ?? 'gpt-4.1'

      const { data: reports } = await db
        .from('reports')
        .select('id, description, user_category, category, severity, summary, component, confidence, stage1_classification, stage2_analysis, reproduction_steps, environment, console_logs, stage1_prompt_version, stage2_prompt_version')
        .eq('project_id', project.id)
        .in('status', ['classified', 'grouped', 'fixing', 'fixed'])
        .is('judge_evaluated_at', null)
        .order('created_at', { ascending: false })
        .limit(sampleSize)

      if (!reports?.length) continue

      const trace = createTrace('judge-batch', { projectId: project.id, reportCount: reports.length })

      for (const report of reports) {
        const span = trace.span('judge.evaluate')
        const start = Date.now()

        try {
          const SYSTEM_PROMPT = `You are a senior QA engineer evaluating the quality of an automated bug classification. Be strict but fair.`
          const USER_PROMPT = `Evaluate this classification:

**Original Report:**
Description: ${report.description}
User Category: ${report.user_category}
Console Errors: ${JSON.stringify(report.console_logs ?? []).slice(0, 500)}

**LLM Classification:**
Category: ${report.category}
Severity: ${report.severity ?? 'unset'}
Summary: ${report.summary ?? 'none'}
Component: ${report.component ?? 'none'}
Confidence: ${report.confidence ?? 'unknown'}

**Stage 2 Analysis:**
${JSON.stringify(report.stage2_analysis ?? {}).slice(0, 1000)}

**Reproduction Steps:**
${JSON.stringify(report.reproduction_steps ?? []).slice(0, 500)}

Score each dimension 0-1. Be critical of vague components, miscalibrated severity, and non-actionable repro steps.`

          let evaluation: z.infer<typeof judgeSchema>
          let usage: { promptTokens?: number; completionTokens?: number } | undefined
          let usedJudgeModel = modelId
          let judgeFallbackUsed = false

          // Wave C C9: per-project BYOK resolution.
          const anthropicResolved = await resolveLlmKey(db, project.id, 'anthropic')
          // V5.3 §2.7 + §2.18: BYOK-only deployments commonly run on a single
          // OpenAI-compatible gateway (OpenRouter, Together, …) instead of a
          // direct Anthropic key. If we have no Anthropic key at all, skip the
          // primary path entirely — going through `createAnthropic` without a
          // key throws a noisy 401 that pollutes the judge log and wastes a
          // round-trip on every report.
          const tryAnthropic = !!(anthropicResolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY'))
          let primaryErr: unknown = tryAnthropic ? null : new Error('No Anthropic key — skipping primary path')

          if (tryAnthropic) {
            try {
              const anthropic = createAnthropic({ apiKey: anthropicResolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY') })
              const result = await generateObject({
                model: anthropic(modelId),
                schema: judgeSchema,
                messages: [
                  {
                    role: 'system',
                    content: SYSTEM_PROMPT,
                    experimental_providerMetadata: {
                      anthropic: { cacheControl: { type: 'ephemeral' } },
                    },
                  },
                  { role: 'user', content: USER_PROMPT },
                ],
              })
              evaluation = result.object
              usage = result.usage
            } catch (err) {
              // Preserve diagnostic fidelity on the first failure — AI SDK
              // wraps provider errors in AI_APICallError which hides the
              // status code unless inspected. Without this log the audit
              // (LLM-1) couldn't distinguish "529 overloaded" (ok, retry)
              // from "invalid_request_error" (config bug) or "401 auth"
              // (missing BYOK key) — all 3 appeared as "100% fallback".
              const e = err as { statusCode?: number; responseBody?: string; message?: string }
              rootLog.child('judge').warn('Primary judge call failed — falling through to fallback', {
                reportId: report.id,
                model: modelId,
                statusCode: e.statusCode ?? null,
                detail: (e.responseBody ?? e.message ?? String(err)).slice(0, 200),
              })
              primaryErr = err
            }
          }

          if (primaryErr) {
            // M2 (V5.3 §2.7): OpenAI fallback when Anthropic is degraded
            // (529 overloaded, 5xx) OR the deployment is BYOK-only on
            // OpenRouter / Together / Fireworks. Same Zod schema; we never
            // fail the whole batch just because the primary provider is down.
            const openaiResolved = await resolveLlmKey(db, project.id, 'openai')
            const openaiKey = openaiResolved?.key ?? Deno.env.get('OPENAI_API_KEY')
            if (fallbackProvider !== 'openai' || !openaiKey) {
              throw primaryErr
            }
            // OpenRouter (and most OpenAI-compatible gateways) require a
            // `vendor/model` slug. If the operator wrote `gpt-4.1` we map it
            // to `openai/gpt-4.1`; `claude-opus-4-6` -> `anthropic/claude-…`.
            // Only applied when a baseURL is set (i.e., not direct OpenAI).
            const isGateway = !!openaiResolved?.baseUrl
            const normalizedModel = isGateway
              ? normalizeGatewayModel(fallbackModelId)
              : fallbackModelId
            rootLog.child('judge').info('Using OpenAI fallback judge', {
              reportId: report.id,
              gateway: isGateway ? openaiResolved!.baseUrl : null,
              model: normalizedModel,
              skippedPrimary: !tryAnthropic,
            })
            const openai = createOpenAI({
              apiKey: openaiKey,
              ...(openaiResolved?.baseUrl ? { baseURL: openaiResolved.baseUrl } : {}),
            })
            const result = await generateObject({
              model: openai(normalizedModel),
              schema: judgeSchema,
              system: SYSTEM_PROMPT,
              prompt: USER_PROMPT,
            })
            evaluation = result.object
            usage = result.usage
            usedJudgeModel = normalizedModel
            judgeFallbackUsed = tryAnthropic // only "fallback" if primary actually attempted
          }

          const compositeScore = (
            evaluation.accuracy * 0.35 +
            evaluation.severity_calibration * 0.25 +
            evaluation.component_tagging * 0.2 +
            evaluation.repro_quality * 0.2
          )

          await db.from('classification_evaluations').insert({
            project_id: project.id,
            report_id: report.id,
            judge_model: usedJudgeModel,
            judge_fallback_used: judgeFallbackUsed,
            judge_score: compositeScore,
            accuracy_score: evaluation.accuracy,
            severity_score: evaluation.severity_calibration,
            component_score: evaluation.component_tagging,
            repro_score: evaluation.repro_quality,
            judge_reasoning: evaluation.reasoning,
            classification_agreed: evaluation.classification_agreed,
            suggested_correction: evaluation.suggested_correction ?? null,
            // Wave E §4: link the eval back to the prompt that was used so
            // prompt-auto-tune can bucket failures by prompt version. Stage 2
            // wins when both are present (it's the deciding classification).
            prompt_version: report.stage2_prompt_version ?? report.stage1_prompt_version ?? null,
            // Only meaningful when classification_agreed is false; the judge
            // schema enforces null otherwise.
            disagreement_reason: evaluation.classification_agreed ? null : (evaluation.disagreement_reason ?? null),
            langfuse_trace_id: trace.id,
          })

          await db.from('reports').update({
            judge_score: compositeScore,
            judge_model: usedJudgeModel,
            judge_evaluated_at: new Date().toISOString(),
          }).eq('id', report.id)

          // Wave D D1: surface judge scores to webhook plugins (e.g. low-score
          // alerts to Slack/Linear). Async; failures must not affect batch.
          void dispatchPluginEvent(db, project.id, 'judge.score_recorded', {
            report: { id: report.id },
            judge: {
              model: usedJudgeModel,
              fallback: judgeFallbackUsed,
              score: compositeScore,
              accuracy: evaluation.accuracy,
              severity: evaluation.severity_calibration,
              component: evaluation.component_tagging,
              repro: evaluation.repro_quality,
              classificationAgreed: evaluation.classification_agreed,
            },
          }).catch((e) => rootLog.child('judge').warn('Plugin dispatch failed', { event: 'judge.score_recorded', err: String(e) }))

          // V5.3 §2.7 (M-cross-cutting): MUST scope by project_id and stage
          // so two projects sharing a version string don't corrupt each other's
          // running averages.
          if (report.stage1_prompt_version) {
            recordPromptResult(db, report.id, report.stage1_prompt_version, compositeScore, {
              projectId: project.id,
              stage: 'stage1',
            }).catch(e => rootLog.child('judge').error('recordPromptResult stage1 failed', { err: String(e) }))
          }
          if (report.stage2_prompt_version) {
            recordPromptResult(db, report.id, report.stage2_prompt_version, compositeScore, {
              projectId: project.id,
              stage: 'stage2',
            }).catch(e => rootLog.child('judge').error('recordPromptResult stage2 failed', { err: String(e) }))
          }

          totalEvaluated++
          span.end({ model: usedJudgeModel, fallback: judgeFallbackUsed, latencyMs: Date.now() - start, score: compositeScore, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens })
        } catch (err) {
          // AI SDK wraps provider errors in AI_APICallError — pull the raw
          // response body / status when available so the operator can see
          // "model not found" vs "rate limit" vs "invalid key" at a glance.
          const e = err as { responseBody?: string; statusCode?: number; cause?: unknown; message?: string }
          const detail = e.responseBody?.slice(0, 300) ?? e.message ?? String(err)
          const errMsg = `${e.statusCode ? `[${e.statusCode}] ` : ''}${detail}`.slice(0, 400)
          rootLog.child('judge').error('Failed to evaluate report', { reportId: report.id, err: errMsg })
          evalErrors.push({ reportId: report.id, err: errMsg })
          span.end({ error: errMsg })
        }
      }

      // Drift detection
      const { data: drift } = await db.rpc('weekly_judge_scores', {
        p_project_id: project.id,
        p_weeks: 3,
      })

      if (drift && drift.length >= 2) {
        const [current, previous] = drift
        if (previous.avg_score > 0) {
          const dropPct = ((previous.avg_score - current.avg_score) / previous.avg_score) * 100
          if (dropPct > 10) {
            const alert = `Classification drift alert for ${project.name}: score dropped ${dropPct.toFixed(1)}% (${previous.avg_score.toFixed(2)} → ${current.avg_score.toFixed(2)})`
            driftAlerts.push(alert)

            if (settings.slack_webhook_url) {
              await sendSlackNotification(settings.slack_webhook_url, {
                text: `⚠️ ${alert}`,
              }).catch(e => rootLog.child('judge').error('Slack drift alert failed', { err: String(e) }))
            }
          }
        }
      }

      // Auto-promote candidate prompts if eligible
      for (const stage of ['stage1', 'stage2', 'judge'] as const) {
        try {
          const eligibility = await checkPromotionEligibility(db, project.id, stage)
          if (eligibility.shouldPromote) {
            const { data: candidateRow } = await db
              .from('prompt_versions')
              .select('version')
              .eq('project_id', project.id)
              .eq('stage', stage)
              .eq('is_candidate', true)
              .single()

            if (candidateRow) {
              await promoteCandidate(db, project.id, stage, candidateRow.version)
              rootLog.child('judge').info('Auto-promoted candidate prompt', {
                projectId: project.id,
                stage,
                version: candidateRow.version,
                reason: eligibility.reason,
              })
            }
          }
        } catch (e) {
          rootLog.child('judge').error('Promotion check failed', { projectId: project.id, stage, err: String(e) })
        }
      }

      trace.end()
    }

    await cronRun.finish({
      rowsAffected: totalEvaluated,
      metadata: {
        driftAlerts,
        projectsChecked: projects.length,
        // Trim to first few — we only need a fingerprint, not 50 copies of the
        // same error.
        evalErrors: evalErrors.slice(0, 3),
        evalErrorCount: evalErrors.length,
      },
    })

    return new Response(JSON.stringify({
      ok: true,
      data: { totalEvaluated, driftAlerts },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    rootLog.child('judge-batch').fatal('Unhandled error', { err: String(err) })
    try {
      if (cronRun) {
        await cronRun.fail(err)
      } else if (db) {
        // startCronRun never produced a handle (e.g. failed before running) —
        // record a synthetic failed row so the admin console still sees it.
        await db.from('cron_runs').insert({
          job_name: 'judge-batch',
          trigger: 'http',
          finished_at: new Date().toISOString(),
          status: 'error',
          error_message: String(err),
        })
      }
    } catch { /* best-effort */ }
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
}))
