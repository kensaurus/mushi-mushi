import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { createTrace } from '../_shared/observability.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { SYNTHETIC_MODEL } from '../_shared/models.ts'
import { getPromptForStage } from '../_shared/prompt-ab.ts'

// Wave T (2026-04-23): fallback template used when `prompt_versions` has no
// `synthetic` row for this project (migration 20260422110000 seeded a global
// `v2-experiment` variant; `v1-baseline` is seeded by
// 20260418002000_phase1_backfill_seed.sql). Keeping this literal lets the
// function boot even if the prompt registry is unreachable — callers still
// get a synthetic report, just without the A/B variant telemetry.
const SYNTHETIC_FALLBACK_PROMPT =
  'Generate a realistic bug report for a web application. Vary the complexity ' +
  '\u2014 some obvious, some ambiguous. Include realistic console errors and URLs.'

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
  // SEC-1 (Wave S1 / D-14): unified internal auth.
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

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

  // Wave T (2026-04-23) — pull the generator's system prompt from
  // `prompt_versions` with the `synthetic` stage so `prompt-auto-tune` /
  // Prompt Lab iterations flow into synthetic generation too. Falls back
  // to the literal string above if the registry is empty so we never
  // fail-open with an unspecified model behaviour.
  const promptSelection = await getPromptForStage(db, projectId, 'synthetic')
  const syntheticSystemPrompt = promptSelection.promptTemplate ?? SYNTHETIC_FALLBACK_PROMPT
  const promptVersion = promptSelection.promptVersion ?? 'fallback-literal'

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
          model: anthropic(SYNTHETIC_MODEL),
          schema: syntheticSchema,
          system: syntheticSystemPrompt,
          prompt: `Generate bug report #${i + 1} of ${count}. Make each unique in category and complexity.`,
        })
        span.end({ model: SYNTHETIC_MODEL, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens, promptVersion })
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
