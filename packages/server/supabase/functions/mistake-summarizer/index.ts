/**
 * mistake-summarizer — RECOMP-style hierarchical summarizer for lessons
 *
 * Called by mistake-clusterer when promoting a cluster to a lesson, or
 * triggered manually to refresh a lesson's three summary views:
 *   1. rule_text   — 2-line one-shot for PR injection (≤ 200 chars)
 *   2. summary_paragraph — paragraph for .mushi/lessons.json
 *   3. full_essay  — full prose for the admin console lesson page
 *
 * Token budget:
 *   - 2-line one-shot:   ~40 tokens output
 *   - paragraph:        ~120 tokens output
 *   - full essay:       ~800 tokens output (only generated on demand)
 *
 * POST body: { lesson_id: string, views?: ('rule'|'paragraph'|'essay')[] }
 */

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateText } from 'npm:ai@4'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { ANTHROPIC_SONNET, ANTHROPIC_HAIKU, OPENAI_MINI } from '../_shared/models.ts'

Deno.serve(
  withSentry('mistake-summarizer', async (req: Request) => {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-trigger') !== 'manual') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const lessonId = body.lesson_id as string
    const views: string[] = body.views ?? ['rule', 'paragraph']

    if (!lessonId) {
      return new Response(JSON.stringify({ error: 'lesson_id required' }), { status: 400 })
    }

    const { data: lesson, error: lessonErr } = await db
      .from('lessons')
      .select('*, mistake_clusters(name, summary, suggested_rule, sample_report_ids)')
      .eq('id', lessonId)
      .single()

    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: lessonErr?.message ?? 'not found' }), { status: 404 })
    }

    // Fetch sample reports for context
    const sampleIds = (lesson.sample_report_ids as string[]) ?? []
    const { data: sampleReports } = await db
      .from('reports')
      .select('title, description, category, severity')
      .in('id', sampleIds.slice(0, 5))

    const reportContext = (sampleReports ?? [])
      .map((r) => `- [${r.severity}/${r.category}] ${r.title}: ${(r.description ?? '').slice(0, 300)}`)
      .join('\n')

    const baseContext = `Cluster name: ${lesson.mistake_clusters?.name ?? lesson.id}
Cluster summary: ${lesson.mistake_clusters?.summary ?? 'No summary available'}
Severity: ${lesson.severity}
Sample reports:
${reportContext || '(none available)'}`

    const anthropicFast = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const anthropicSonnet = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
    const openaiMini = createOpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })

    const updates: Record<string, string> = {}
    let totalCostUsd = 0

    async function callLlm(model: 'fast' | 'sonnet', prompt: string): Promise<string> {
      try {
        const { text, usage } = await generateText({
          model: model === 'fast' ? anthropicFast(ANTHROPIC_HAIKU) : anthropicSonnet(ANTHROPIC_SONNET),
          prompt,
          maxTokens: model === 'fast' ? 200 : 1200,
        })
        const costPerInputM = model === 'fast' ? 0.8 : 3
        const costPerOutputM = model === 'fast' ? 2.4 : 15
        totalCostUsd += (usage.promptTokens / 1_000_000) * costPerInputM
          + (usage.completionTokens / 1_000_000) * costPerOutputM
        return text.trim()
      } catch {
        const { text } = await generateText({
          model: openaiMini(OPENAI_MINI),
          prompt,
          maxTokens: model === 'fast' ? 200 : 1200,
        })
        return text.trim()
      }
    }

    if (views.includes('rule')) {
      const ruleText = await callLlm(
        'fast',
        `${baseContext}

Write a 2-line preventive rule (≤ 200 chars total) that a developer should follow to prevent this class of bug. Format:
Line 1: What NOT to do (the anti-pattern)
Line 2: What TO do instead

Keep it concrete and actionable.`,
      )
      updates.rule_text = ruleText
    }

    if (views.includes('paragraph')) {
      const paragraph = await callLlm(
        'fast',
        `${baseContext}

Write a 3-sentence paragraph suitable for a .mushi/lessons.json file. Describe:
1. What pattern of bug this lesson covers
2. Why it keeps recurring
3. How to prevent it

Be specific to the actual reports above.`,
      )
      updates.summary_paragraph = paragraph
    }

    if (views.includes('essay')) {
      const essay = await callLlm(
        'sonnet',
        `${baseContext}

Write a full 400-600 word essay for developers that explains:
1. The root cause of this class of bug
2. How to recognise it early
3. The recommended fix pattern with a concrete code example (pseudo-code is fine)
4. Common edge cases to watch for
5. How to write a test that would catch it

Use clear headings. Be opinionated and specific.`,
      )
      updates.full_essay = essay
    }

    if (Object.keys(updates).length > 0) {
      await db.from('lessons').update(updates).eq('id', lessonId)

      await db.from('llm_cost_usd').insert({
        project_id: lesson.project_id,
        operation: 'lesson-summarise',
        model: ANTHROPIC_HAIKU,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: totalCostUsd,
      })
    }

    return new Response(
      JSON.stringify({ ok: true, lessonId, updated: Object.keys(updates), costUsd: totalCostUsd }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
