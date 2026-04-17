import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { createTrace } from '../_shared/observability.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'

const synthLog = log.child('synthetic')

const syntheticSchema = z.object({
  description: z.string().describe('Realistic user bug description'),
  category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  component: z.string().optional(),
  console_errors: z.array(z.string()).optional(),
  url: z.string().optional(),
  expected_classification: z.object({
    category: z.enum(['bug', 'slow', 'visual', 'confusing', 'other']),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
  }),
})

Deno.serve(withSentry('generate-synthetic', async (req) => {
  const auth = req.headers.get('Authorization')
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth
  if (!token || !expectedKey || token !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Requires valid service_role key' }), { status: 401 })
  }

  const db = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const projectId = body.projectId as string
  const count = Math.min(body.count ?? 20, 50)

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId required' }), { status: 400 })
  }

  const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  const trace = createTrace('generate-synthetic', { projectId, count })
  const generated: unknown[] = []

  const BATCH_SIZE = 5
  for (let batch = 0; batch < count; batch += BATCH_SIZE) {
    const batchItems = Array.from(
      { length: Math.min(BATCH_SIZE, count - batch) },
      (_, j) => batch + j,
    )
    const results = await Promise.allSettled(
      batchItems.map(async (i) => {
        const span = trace.span(`generate.${i}`)
        const { object, usage } = await generateObject({
          model: anthropic('claude-sonnet-4-6'),
          schema: syntheticSchema,
          system: 'Generate a realistic bug report for a web application. Vary the complexity — some obvious, some ambiguous. Include realistic console errors and URLs.',
          prompt: `Generate bug report #${i + 1} of ${count}. Make each unique in category and complexity.`,
        })
        span.end({ model: 'claude-sonnet-4-6', inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens })
        await db.from('synthetic_reports').insert({
          project_id: projectId,
          generated_report: { description: object.description, category: object.category, severity: object.severity, component: object.component, console_errors: object.console_errors, url: object.url },
          expected_classification: object.expected_classification,
        })
        return object
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled') generated.push(r.value)
      else synthLog.error('Generation failed', { err: String(r.reason) })
    }
  }

  await trace.end()

  return new Response(JSON.stringify({ ok: true, data: { generated: generated.length } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}))
