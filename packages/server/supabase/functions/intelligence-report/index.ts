import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateText } from 'npm:ai@4'
import { getServiceClient } from '../_shared/db.ts'
import { sendSlackNotification } from '../_shared/slack.ts'
import { createTrace } from '../_shared/observability.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun, logLlmInvocation } from '../_shared/telemetry.ts'
import {
  computeWeeklyStats,
  fetchBenchmarks,
  persistIntelligenceReport,
  renderIntelligenceHtml,
} from '../_shared/intelligence.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { mapWithConcurrency } from '../_shared/concurrency.ts'

const intelLog = log.child('intelligence-report')

Deno.serve(withSentry('intelligence-report', async (req) => {
  // SEC-1 (Wave S1 / D-14): unified internal auth — accepts service-role key
  // or MUSHI_INTERNAL_CALLER_SECRET so cron-owned pg_net jobs work.
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const projectId = body.projectId as string | undefined
  const trigger = (body.trigger ?? 'http') as 'cron' | 'manual' | 'http'
  const cronRun = await startCronRun(db, 'intelligence-report', trigger)

  const { data: projects } = projectId
    ? await db.from('projects').select('id, name').eq('id', projectId)
    : await db.from('projects').select('id, name')

  const trace = createTrace('intelligence-report', { projectId })
  const reportIds: string[] = []
  const digests: string[] = []

  // Reporting week = the most recently completed Monday→Sunday window.
  const weekStart = mostRecentMondayUtc()

  // Wave S3 (PERF): process up to 5 projects in parallel. Per-project the
  // only expensive call is a single generateText; DB stats queries are
  // cached / indexed. Weekly digests for 50 projects dropped from ~12 min
  // to ~2.5 min (measured during the 2026-04-21 audit).
  await mapWithConcurrency(projects ?? [], 5, async (project) => {
    const stats = await computeWeeklyStats(db, project.id, weekStart)
    const benchmarks = await fetchBenchmarks(db, project.id)

    const statsContext = `Project: ${project.name}
Week start: ${stats.weekStart}
New reports: ${stats.reports.total}
By category: ${JSON.stringify(stats.reports.byCategory)}
By severity: ${JSON.stringify(stats.reports.bySeverity)}
Top components: ${JSON.stringify(topN(stats.reports.byComponent, 8))}
Fix attempts: ${stats.fixes.total} (${stats.fixes.completed} completed, completion rate ${(stats.fixes.completionRate * 100).toFixed(0)}%)
Judge scores: ${JSON.stringify(stats.judgeScores.slice(0, 2))}
Cross-customer benchmarks available: ${benchmarks.optedIn ? 'yes' : 'no (project not opted in or k-anonymity unmet)'}`

    const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const span = trace.span(`digest.${project.name}`)
    const digestStart = Date.now()
    const { text: digest, usage } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system:
        'You are a bug intelligence analyst. Write a concise weekly digest summarizing bug trends, fix velocity, areas of concern, and 2-3 actionable recommendations. Be specific and data-driven. Use Markdown with short paragraphs and bullet lists. Do NOT mention other tenants by name; benchmarks are anonymised aggregates.',
      prompt: statsContext,
    })
    const digestLatency = Date.now() - digestStart
    span.end({
      model: 'claude-sonnet-4-6',
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
    })

    await logLlmInvocation(db, {
      projectId: project.id,
      functionName: 'intelligence-report',
      stage: 'digest',
      primaryModel: 'claude-sonnet-4-6',
      usedModel: 'claude-sonnet-4-6',
      fallbackUsed: false,
      status: 'success',
      latencyMs: digestLatency,
      inputTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.completionTokens ?? null,
    })

    const renderedHtml = renderIntelligenceHtml({
      projectName: project.name,
      weekStart: stats.weekStart,
      summaryMd: digest,
      stats,
      benchmarks,
    })

    try {
      const { id } = await persistIntelligenceReport(db, {
        projectId: project.id,
        weekStart: stats.weekStart,
        summaryMd: digest,
        stats,
        benchmarks: benchmarks.optedIn ? benchmarks : null,
        llmModel: 'claude-sonnet-4-6',
        llmTokensIn: usage?.promptTokens ?? null,
        llmTokensOut: usage?.completionTokens ?? null,
        generatedBy: trigger,
        renderedHtml,
      })
      reportIds.push(id)
    } catch (e) {
      intelLog.error('Failed to persist intelligence report', {
        err: String(e),
        projectId: project.id,
      })
    }

    digests.push(`## ${project.name}\n\n${digest}`)

    const { data: settings } = await db
      .from('project_settings')
      .select('slack_webhook_url')
      .eq('project_id', project.id)
      .single()
    if (settings?.slack_webhook_url) {
      await sendSlackNotification(settings.slack_webhook_url, {
        text: `Weekly Bug Intelligence — ${project.name}\n\n${digest.slice(0, 2000)}`,
      }).catch((e) => intelLog.error('Slack delivery failed', { err: String(e) }))
    }
  })

  await trace.end()
  await cronRun.finish({
    rowsAffected: reportIds.length,
    metadata: {
      projectIds: (projects ?? []).map((p) => p.id),
      reportIds,
      weekStart: weekStart.toISOString().slice(0, 10),
    },
  })

  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        reports: reportIds.length,
        reportIds,
        digest: digests.join('\n\n---\n\n'),
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}))

function mostRecentMondayUtc(): Date {
  const now = new Date()
  const dow = now.getUTCDay() // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7 // Monday → 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday - 7)
  return monday
}

function topN(map: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  )
}
