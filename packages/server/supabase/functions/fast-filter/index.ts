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

const SYSTEM_PROMPT = `You are a bug report triage assistant. Extract structured symptoms from the user's report and classify the issue.

Rules:
1. Extract the core symptom, action, expected behavior, and actual behavior from the description.
2. Classify category based on ALL context (user description + technical signals).
3. Assess severity: critical = app unusable/data loss, high = major feature broken, medium = noticeable issue, low = minor annoyance.
4. Set confidence based on how clear and specific the report is. Vague reports get lower confidence.
5. Be concise. Each field should be 1-2 sentences max.`

Deno.serve(withSentry('fast-filter', async (req) => {
  try {
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
    const PRIMARY_MODEL = 'claude-haiku-4-5-20251001'
    const FALLBACK_MODEL = 'gpt-4.1-mini'
    let usedModel = PRIMARY_MODEL
    let fallbackUsed = false
    let fallbackReason: string | null = null

    let tokenUsage: { promptTokens?: number; completionTokens?: number } = {}
    // Wave C C9: resolve BYOK first; falls back to env automatically.
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
        })
        throw primaryErr
      }
      usedModel = FALLBACK_MODEL
      fallbackUsed = true
      fallbackReason = String(primaryErr).slice(0, 500)

      const openai = createOpenAI({ apiKey: openaiKey })
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
    })

    await db.from('reports').update({
      extracted_symptoms: {
        symptom: classification.symptom,
        action: classification.action,
        expected: classification.expected,
        actual: classification.actual,
        emotion: classification.emotion,
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

    log.info('Stage 1 classified', {
      category: classification.category,
      severity: classification.severity,
      confidence: classification.confidence,
      latencyMs,
      model: usedModel,
    })

    // Generate embedding, dedup, regression detection, graph building (fire-and-forget)
    const embeddingText = `${classification.symptom} ${classification.action} ${classification.actual} ${scrubbedReport.description}`
    generateAndStoreEmbedding(reportId, embeddingText)
      .then(() => suggestGrouping(reportId, projectId))
      .then(async (group) => {
        if (group.similarCount > 0) {
          log.info('Similar reports found', { similarCount: group.similarCount, groupId: group.groupId })
        }
        // Build knowledge graph relationships
        await buildReportGraph(db, projectId, reportId, classification.category, env.url, group.groupId)
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
