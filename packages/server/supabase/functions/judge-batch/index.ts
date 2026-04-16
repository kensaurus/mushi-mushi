import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { createTrace } from '../_shared/observability.ts'
import { sendSlackNotification } from '../_shared/slack.ts'
import { log as rootLog } from '../_shared/logger.ts'

const judgeSchema = z.object({
  accuracy: z.number().min(0).max(1).describe('Does the category match the described issue?'),
  severity_calibration: z.number().min(0).max(1).describe('Is severity proportional to impact?'),
  component_tagging: z.number().min(0).max(1).describe('Is the component correctly identified?'),
  repro_quality: z.number().min(0).max(1).describe('Are reproduction steps actionable?'),
  classification_agreed: z.boolean().describe('Would you agree with the overall classification?'),
  reasoning: z.string().max(500).describe('Brief justification for scores'),
  suggested_correction: z.object({
    category: z.string().optional(),
    severity: z.string().optional(),
    component: z.string().optional(),
  }).optional().describe('If classification_agreed is false, suggest corrections'),
})

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get('Authorization')
    if (!auth?.includes('service_role')) {
      return new Response(JSON.stringify({ error: 'Requires service_role key' }), { status: 401 })
    }

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId = body.projectId as string | undefined

    const projectFilter = projectId
      ? db.from('projects').select('id, name').eq('id', projectId)
      : db.from('projects').select('id, name')

    const { data: projects } = await projectFilter
    if (!projects?.length) {
      return new Response(JSON.stringify({ ok: true, message: 'No projects' }), { status: 200 })
    }

    let totalEvaluated = 0
    const driftAlerts: string[] = []

    for (const project of projects) {
      const { data: settings } = await db
        .from('project_settings')
        .select('judge_enabled, judge_model, judge_sample_size, slack_webhook_url, discord_webhook_url')
        .eq('project_id', project.id)
        .single()

      if (!settings?.judge_enabled) continue

      const sampleSize = settings.judge_sample_size ?? 50
      const modelId = settings.judge_model ?? 'claude-opus-4'

      const { data: reports } = await db
        .from('reports')
        .select('id, description, user_category, category, severity, summary, component, confidence, stage1_classification, stage2_analysis, reproduction_steps, environment, console_logs')
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
          const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

          const { object: evaluation, usage } = await generateObject({
            model: anthropic(modelId),
            schema: judgeSchema,
            system: `You are a senior QA engineer evaluating the quality of an automated bug classification. Be strict but fair.`,
            prompt: `Evaluate this classification:

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

Score each dimension 0-1. Be critical of vague components, miscalibrated severity, and non-actionable repro steps.`,
          })

          const compositeScore = (
            evaluation.accuracy * 0.35 +
            evaluation.severity_calibration * 0.25 +
            evaluation.component_tagging * 0.2 +
            evaluation.repro_quality * 0.2
          )

          await db.from('classification_evaluations').insert({
            project_id: project.id,
            report_id: report.id,
            judge_model: modelId,
            judge_score: compositeScore,
            accuracy_score: evaluation.accuracy,
            severity_score: evaluation.severity_calibration,
            component_score: evaluation.component_tagging,
            repro_score: evaluation.repro_quality,
            judge_reasoning: evaluation.reasoning,
            classification_agreed: evaluation.classification_agreed,
            suggested_correction: evaluation.suggested_correction ?? null,
          })

          await db.from('reports').update({
            judge_score: compositeScore,
            judge_model: modelId,
            judge_evaluated_at: new Date().toISOString(),
          }).eq('id', report.id)

          totalEvaluated++
          span.end({ model: modelId, latencyMs: Date.now() - start, score: compositeScore, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens })
        } catch (err) {
          rootLog.child('judge').error('Failed to evaluate report', { reportId: report.id, err: String(err) })
          span.end({ error: String(err) })
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

      trace.end()
    }

    return new Response(JSON.stringify({
      ok: true,
      data: { totalEvaluated, driftAlerts },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    rootLog.child('judge-batch').fatal('Unhandled error', { err: String(err) })
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
