import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateText } from 'npm:ai@4'
import { getServiceClient } from '../_shared/db.ts'
import { sendSlackNotification } from '../_shared/slack.ts'
import { createTrace } from '../_shared/observability.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun, logLlmInvocation } from '../_shared/telemetry.ts'

const intelLog = log.child('intelligence-report')

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization')
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth
  if (!token || !expectedKey || token !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Requires valid service_role key' }), { status: 401 })
  }

  const db = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const projectId = body.projectId as string
  const trigger = (body.trigger ?? 'http') as 'cron' | 'manual' | 'http'
  const cronRun = await startCronRun(db, 'intelligence-report', trigger)

  const { data: projects } = projectId
    ? await db.from('projects').select('id, name').eq('id', projectId)
    : await db.from('projects').select('id, name')

  const trace = createTrace('intelligence-report', { projectId })
  const reports: string[] = []

  for (const project of projects ?? []) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [reportsRes, fixesRes, judgeRes] = await Promise.all([
      db.from('reports').select('category, severity, component, status, created_at').eq('project_id', project.id).gte('created_at', weekAgo).limit(1000),
      db.from('fix_attempts').select('status, agent, started_at, completed_at').eq('project_id', project.id).gte('started_at', weekAgo).limit(500),
      db.rpc('weekly_judge_scores', { p_project_id: project.id, p_weeks: 2 }),
    ])

    const reportsData = reportsRes.data ?? []
    const fixesData = fixesRes.data ?? []
    const judgeData = judgeRes.data ?? []

    const byCat = reportsData.reduce((acc: Record<string, number>, r) => { acc[r.category] = (acc[r.category] ?? 0) + 1; return acc }, {})
    const bySev = reportsData.reduce((acc: Record<string, number>, r) => { acc[r.severity ?? 'unset'] = (acc[r.severity ?? 'unset'] ?? 0) + 1; return acc }, {})
    const byComp = reportsData.reduce((acc: Record<string, number>, r) => { acc[r.component ?? 'unknown'] = (acc[r.component ?? 'unknown'] ?? 0) + 1; return acc }, {})

    const statsContext = `Project: ${project.name}
New reports: ${reportsData.length}
By category: ${JSON.stringify(byCat)}
By severity: ${JSON.stringify(bySev)}
Top components: ${JSON.stringify(byComp)}
Fix attempts: ${fixesData.length} (${fixesData.filter(f => f.status === 'completed').length} completed)
Judge scores: ${JSON.stringify(judgeData.slice(0, 2))}`

    const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const span = trace.span(`digest.${project.name}`)
    const digestStart = Date.now()
    const { text: digest, usage } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: 'You are a bug intelligence analyst. Write a concise weekly digest summarizing bug trends, fix velocity, areas of concern, and actionable recommendations. Be specific and data-driven.',
      prompt: statsContext,
    })
    const digestLatency = Date.now() - digestStart
    span.end({ model: 'claude-sonnet-4-6', inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens })

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

    reports.push(`## ${project.name}\n\n${digest}`)

    const { data: settings } = await db.from('project_settings').select('slack_webhook_url').eq('project_id', project.id).single()
    if (settings?.slack_webhook_url) {
      await sendSlackNotification(settings.slack_webhook_url, {
        text: `Weekly Bug Intelligence — ${project.name}\n\n${digest.slice(0, 2000)}`,
      }).catch(e => intelLog.error('Slack delivery failed', { err: String(e) }))
    }
  }

  await trace.end()
  await cronRun.finish({ rowsAffected: reports.length, metadata: { projectIds: (projects ?? []).map(p => p.id) } })

  return new Response(JSON.stringify({ ok: true, data: { reports: reports.length, digest: reports.join('\n\n---\n\n') } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
