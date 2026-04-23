import { generateObject } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { scrubReport } from '../_shared/pii-scrubber.ts'
import { sendSlackNotification } from '../_shared/slack.ts'
import { sendDiscordNotification } from '../_shared/discord.ts'
import { generateAndStoreEmbedding, suggestGrouping } from '../_shared/embeddings.ts'
import { createTrace } from '../_shared/observability.ts'
import { awardPoints } from '../_shared/reputation.ts'
import { createNotification, buildNotificationMessage } from '../_shared/notifications.ts'
import { buildReportGraph, detectRegression } from '../_shared/knowledge-graph.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { getPromptForStage } from '../_shared/prompt-ab.ts'
import { logLlmInvocation } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { STAGE1_MODEL, STAGE1_FALLBACK } from '../_shared/models.ts'

const stage1Schema = z.object({
  symptom: z.string().describe('What the user observed'),
  action: z.string().describe('What the user was doing'),
  expected: z.string().describe('What the user expected'),
  actual: z.string().describe('What actually happened'),
  emotion: z.string().optional().describe('User emotion/frustration level'),
  category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other']).describe('Issue category'),
  severity: z.enum(['critical', 'high', 'medium', 'low']).describe('Impact severity'),
  confidence: z.number().min(0).max(1).describe('Classification confidence'),
})

type Stage1Result = z.infer<typeof stage1Schema>

interface EvidenceSummary {
  console: { errorCount: number; warnCount: number; topErrorTypes: string[] }
  network: { failureCount: number; statusBuckets: Record<string, number>; topMethods: string[] }
  perf: { lcp: number | null; fcp: number | null; cls: number | null; inp: number | null; ttfb: number | null; longTasks: number | null }
}

/**
 * Build a sanitized, structured evidence summary from a scrubbed report.
 *
 * This is the only telemetry channel Stage 2 sees. It deliberately encodes
 * counts + normalized buckets and never the raw user-controllable strings
 * (.message, .stack, .url, .error). Even if a malicious console payload
 * tries `console.log("ignore prior instructions...")`, Stage 2's prompt
 * receives only `{ errorCount: 1, topErrorTypes: ['Error'] }`.
 */
function buildEvidence(report: Record<string, any>): EvidenceSummary {
  const consoleLogs = (report.console_logs ?? []) as Array<{ level?: string; message?: string }>
  const errorTypes = new Map<string, number>()
  let errorCount = 0
  let warnCount = 0
  for (const l of consoleLogs) {
    if (l.level === 'error') errorCount++
    else if (l.level === 'warn') warnCount++
    else continue
    const m = String(l.message ?? '').match(/^([A-Z][A-Za-z0-9_]*Error)\b/)
    const key = m ? m[1] : 'Other'
    errorTypes.set(key, (errorTypes.get(key) ?? 0) + 1)
  }
  const topErrorTypes = Array.from(errorTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)

  const networkLogs = (report.network_logs ?? []) as Array<{ method?: string; status?: number; error?: string }>
  const statusBuckets: Record<string, number> = {}
  const methods = new Map<string, number>()
  let failureCount = 0
  for (const l of networkLogs) {
    const status = Number(l.status ?? 0)
    if (status >= 400 || l.error) {
      failureCount++
      const bucket = status >= 500 ? '5xx' : status >= 400 ? '4xx' : 'network_error'
      statusBuckets[bucket] = (statusBuckets[bucket] ?? 0) + 1
      const method = String(l.method ?? 'GET').toUpperCase().slice(0, 6)
      methods.set(method, (methods.get(method) ?? 0) + 1)
    }
  }
  const topMethods = Array.from(methods.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k)

  const perf = report.performance_metrics ?? {}
  return {
    console: { errorCount, warnCount, topErrorTypes },
    network: { failureCount, statusBuckets, topMethods },
    perf: {
      lcp: typeof perf.lcp === 'number' ? perf.lcp : null,
      fcp: typeof perf.fcp === 'number' ? perf.fcp : null,
      cls: typeof perf.cls === 'number' ? perf.cls : null,
      inp: typeof perf.inp === 'number' ? perf.inp : null,
      ttfb: typeof perf.ttfb === 'number' ? perf.ttfb : null,
      longTasks: typeof perf.longTasks === 'number' ? perf.longTasks : null,
    },
  }
}

const SYSTEM_PROMPT = `You are a bug report triage assistant. Extract structured symptoms from the user's report and classify the issue.

Rules:
1. Extract the core symptom, action, expected behavior, and actual behavior from the description.
2. Classify category based on ALL context (user description + technical signals).
3. Assess severity: critical = app unusable/data loss, high = major feature broken, medium = noticeable issue, low = minor annoyance.
4. Set confidence based on how clear and specific the report is. Vague reports get lower confidence.
5. Be concise. Each field should be 1-2 sentences max.`

Deno.serve(withSentry('fast-filter', async (req) => {
  try {
    // SEC-1: `verify_jwt = false` in config.toml for internal pipeline calls
    // (api -> fast-filter -> classify-report). Without this guard the
    // endpoint is publicly invokable — any caller knowing a (reportId,
    // projectId) could burn Anthropic budget. We require the service-role
    // key that `api` already passes when dispatching.
    const unauthorized = requireServiceRoleAuth(req)
    if (unauthorized) return unauthorized
    const { reportId, projectId } = await req.json()
    if (!reportId || !projectId) {
      return new Response(JSON.stringify({ error: 'reportId and projectId required' }), { status: 400 })
    }
    const log = rootLog.child('fast-filter', { reportId, projectId })

    const db = getServiceClient()

    const { data: report, error: fetchError } = await db
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .single()

    if (fetchError || !report) {
      return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 })
    }

    const { data: settings } = await db
      .from('project_settings')
      .select('stage2_model, stage1_confidence_threshold, slack_webhook_url, discord_webhook_url, reporter_notifications_enabled')
      .eq('project_id', projectId)
      .single()

    const confidenceThreshold = settings?.stage1_confidence_threshold ?? 0.85
    const trace = createTrace('fast-filter', { reportId, projectId })

    // Resolve prompt A/B test for stage1
    const promptSelection = await getPromptForStage(db, projectId, 'stage1')
    const activeSystemPrompt = promptSelection.promptTemplate ?? SYSTEM_PROMPT

    const scrubbedReport = scrubReport(report)

    const consoleErrors = (scrubbedReport.console_logs ?? [])
      .filter((l: any) => l.level === 'error' || l.level === 'warn')
      .slice(0, 10)
      .map((l: any) => `[${l.level}] ${l.message}`)
      .join('\n')

    const failedRequests = (scrubbedReport.network_logs ?? [])
      .filter((l: any) => l.status >= 400 || l.error)
      .slice(0, 5)
      .map((l: any) => `${l.method} ${l.url} → ${l.status || 'FAILED'}`)
      .join('\n')

    const env = scrubbedReport.environment ?? {}

    // Build a sanitized evidence summary that the dual-LLM air-gap allows
    // Stage 2 to consume safely. We deliberately keep this to counts +
    // normalized buckets (never raw user strings), so prompt-injection in
    // a console.log/network URL cannot influence Stage 2's reasoning.
    const evidence = buildEvidence(scrubbedReport)

    const userPrompt = `## User Report
- Category: ${scrubbedReport.user_category}
- Description: ${scrubbedReport.description}
${scrubbedReport.user_intent ? `- Intent: ${scrubbedReport.user_intent}` : ''}

## Context
- URL: ${env.url || 'unknown'}
- Browser: ${env.userAgent || 'unknown'}
${consoleErrors ? `\n## Console Errors\n${consoleErrors}` : ''}
${failedRequests ? `\n## Failed Requests\n${failedRequests}` : ''}`

    const startTime = Date.now()
    let classification: Stage1Result
    const llmSpan = trace.span('stage1.classify')
    const PRIMARY_MODEL = STAGE1_MODEL
    const FALLBACK_MODEL = STAGE1_FALLBACK
    let usedModel = PRIMARY_MODEL
    let fallbackUsed = false
    let fallbackReason: string | null = null

    let tokenUsage: { promptTokens?: number; completionTokens?: number } = {}
    // C9: resolve BYOK first; falls back to env automatically.
    const anthropicResolved = await resolveLlmKey(db, projectId, 'anthropic')
    let keySource: 'byok' | 'env' | null = anthropicResolved?.source ?? null
    try {
      const anthropic = createAnthropic({ apiKey: anthropicResolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY') })
      const { object, usage } = await generateObject({
        model: anthropic(PRIMARY_MODEL),
        schema: stage1Schema,
        messages: [
          {
            role: 'system',
            content: activeSystemPrompt,
            experimental_providerMetadata: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
          { role: 'user', content: userPrompt },
        ],
      })
      classification = object
      tokenUsage = usage ?? {}
    } catch (primaryErr) {
      log.warn('Anthropic Haiku failed, falling back to OpenAI', { err: String(primaryErr) })
      const openaiResolved = await resolveLlmKey(db, projectId, 'openai')
      const openaiKey = openaiResolved?.key ?? Deno.env.get('OPENAI_API_KEY')
      keySource = openaiResolved?.source ?? (openaiKey ? 'env' : keySource)
      if (!openaiKey) {
        await logLlmInvocation(db, {
          projectId, reportId, functionName: 'fast-filter', stage: 'stage1',
          primaryModel: PRIMARY_MODEL, usedModel: PRIMARY_MODEL,
          fallbackUsed: false, status: 'error',
          errorMessage: `Primary failed and no OPENAI_API_KEY: ${String(primaryErr)}`,
          latencyMs: Date.now() - startTime,
          promptVersion: promptSelection.promptVersion,
          langfuseTraceId: trace.id,
        })
        throw primaryErr
      }
      usedModel = FALLBACK_MODEL
      fallbackUsed = true
      fallbackReason = String(primaryErr).slice(0, 500)

      // OpenAI-compatible base URL (OpenRouter, Together, Fireworks…) is the
      // V5.3 §2.7 BYOK extension: a single `openai` ref pointed at any
      // gateway. Falls back to the SDK default (api.openai.com) when unset.
      const openai = createOpenAI({
        apiKey: openaiKey,
        ...(openaiResolved?.baseUrl ? { baseURL: openaiResolved.baseUrl } : {}),
      })
      const { object, usage } = await generateObject({
        model: openai(FALLBACK_MODEL),
        schema: stage1Schema,
        system: activeSystemPrompt,
        prompt: userPrompt,
      })
      classification = object
      tokenUsage = usage ?? {}
    }

    const latencyMs = Date.now() - startTime
    llmSpan.end({ model: usedModel, latencyMs, inputTokens: tokenUsage.promptTokens, outputTokens: tokenUsage.completionTokens })

    await logLlmInvocation(db, {
      projectId, reportId, functionName: 'fast-filter', stage: 'stage1',
      primaryModel: PRIMARY_MODEL, usedModel,
      fallbackUsed, fallbackReason,
      status: 'success',
      latencyMs,
      inputTokens: tokenUsage.promptTokens ?? null,
      outputTokens: tokenUsage.completionTokens ?? null,
      promptVersion: promptSelection.promptVersion,
      keySource: keySource ?? 'env',
      langfuseTraceId: trace.id,
    })

    const { error: stage1WriteError } = await db.from('reports').update({
      extracted_symptoms: {
        symptom: classification.symptom,
        action: classification.action,
        expected: classification.expected,
        actual: classification.actual,
        emotion: classification.emotion,
        evidence,
      },
      stage1_classification: classification,
      stage1_model: usedModel,
      stage1_prompt_version: promptSelection.promptVersion,
      stage1_latency_ms: latencyMs,
      category: classification.category,
      severity: classification.severity,
      confidence: classification.confidence,
      processing_attempts: (report.processing_attempts ?? 0) + 1,
    }).eq('id', reportId)

    // Throw loudly on write failure: a silent UPDATE here means we billed the
    // customer for the LLM call but the report stays status='new' with no
    // visible AI value. See docs/dogfood-glotit-2026-04-17.md for the P0 we
    // shipped because this was just a log.warn.
    if (stage1WriteError) {
      throw new Error(`Stage 1 writeback failed: ${stage1WriteError.message}`)
    }

    log.info('Stage 1 classified', {
      category: classification.category,
      severity: classification.severity,
      confidence: classification.confidence,
      latencyMs,
      model: usedModel,
    })

    // Generate embedding, dedup, regression detection, graph building (fire-and-forget)
    const embeddingText = `${classification.symptom} ${classification.action} ${classification.actual} ${scrubbedReport.description}`
    generateAndStoreEmbedding(reportId, embeddingText, { projectId })
      .then(() => suggestGrouping(reportId, projectId))
      .then(async (group) => {
        if (group.similarCount > 0) {
          log.info('Similar reports found', { similarCount: group.similarCount, groupId: group.groupId })
        }
        // Stage-1 only knows the category and the page URL. The actual
        // `component` is resolved by Stage 2 (classify-report), so we deliberately
        // pass `undefined` here to avoid creating bogus "component" nodes
        // labelled with bug categories like "visual" or "confusing".
        await buildReportGraph(db, projectId, reportId, undefined, env.url, group.groupId)
        // Regression detection
        const regression = await detectRegression(db, projectId, reportId, embeddingText)
        if (regression.isRegression) {
          log.warn('REGRESSION detected', { originalGroupId: regression.originalGroupId })
        }
      })
      .catch((err) => log.error('Embedding/dedup/graph pipeline failed', { err: String(err) }))

    // Award reputation points for submission
    awardPoints(db, projectId, report.reporter_token_hash, { action: 'submit' })
      .catch(err => log.error('Reputation award failed', { action: 'submit', err: String(err) }))

    if (report.screenshot_path) {
      awardPoints(db, projectId, report.reporter_token_hash, { action: 'screenshot' })
        .catch(err => log.error('Reputation award failed', { action: 'screenshot', err: String(err) }))
    }
    if (report.selected_element) {
      awardPoints(db, projectId, report.reporter_token_hash, { action: 'element_select' })
        .catch(err => log.error('Reputation award failed', { action: 'element_select', err: String(err) }))
    }

    if (classification.confidence > confidenceThreshold) {
      const summary = `${classification.symptom} — ${classification.actual}`.slice(0, 200)
      await db.from('reports').update({
        status: 'classified',
        summary,
      }).eq('id', reportId)

      const { data: project } = await db.from('projects').select('name').eq('id', projectId).single()
      const projectName = project?.name ?? 'Unknown'

      if (settings?.slack_webhook_url) {
        log.info('Sending Slack notification', { severity: classification.severity })
      sendSlackNotification(settings.slack_webhook_url, {
          projectName,
          category: classification.category,
          severity: classification.severity,
          summary,
          reporterToken: report.reporter_token_hash,
          pageUrl: env.url ?? '',
          reportId,
        }).catch(e => log.error('Slack notification failed', { err: String(e) }))
      }

      if (settings?.discord_webhook_url) {
        sendDiscordNotification(settings.discord_webhook_url, {
          projectName,
          category: classification.category,
          severity: classification.severity,
          summary,
          reportId,
        }).catch(e => log.error('Discord notification failed', { err: String(e) }))
      }

      if (settings?.reporter_notifications_enabled) {
        const msg = buildNotificationMessage('classified', {
          category: classification.category,
          severity: classification.severity,
        })
        createNotification(db, projectId, reportId, report.reporter_token_hash, 'classified', {
          message: msg,
          category: classification.category,
          severity: classification.severity,
          reportId,
        }).catch(e => log.error('Reporter notification failed', { err: String(e) }))
      }

      return new Response(JSON.stringify({
        ok: true,
        stage: 'stage1_final',
        classification,
        latencyMs,
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Low confidence → forward to Stage 2
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

      await fetch(`${supabaseUrl}/functions/v1/classify-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          reportId,
          projectId,
          stage1Extraction: classification,
          evidence,
          airGap: true,
        }),
      })
    } catch (err) {
      log.error('Stage 2 invocation failed', { err: String(err) })
    }

    return new Response(JSON.stringify({
      ok: true,
      stage: 'forwarded_to_stage2',
      classification,
      latencyMs,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    rootLog.child('fast-filter').error('Unhandled error', { err: String(err) })
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}))
