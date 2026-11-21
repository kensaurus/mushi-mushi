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
import { openAiProvider } from '../_shared/openai-compat.ts'
import { generateText } from 'npm:ai@4'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { ANTHROPIC_HAIKU, MISTAKE_EFFORT, MISTAKE_MODEL, OPENAI_MINI, THINKING_HEADROOM_TOKENS } from '../_shared/models.ts'
import { claudeGenerateText } from '../_shared/claude-messages.ts'
import { UsageByModel } from '../_shared/pricing.ts'
import { recordLlmUsage } from '../_shared/llm-usage.ts'
import { withAnthropicOrOpenAi } from '../_shared/llm-failover.ts'

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const authErr = requireServiceRoleAuth(req)
    if (authErr) return authErr

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

    const updates: Record<string, string> = {}
    // Per-model totals for the response; the spend itself is one
    // llm_invocations row per call, with the source of the key it used.
    const ledger = new UsageByModel()
    const usageWrites: Array<Promise<{ error: string | null }>> = []
    const record = (
      model: string,
      stage: string,
      startedAt: number,
      outcome: { result?: { usage: { promptTokens: number; completionTokens: number } }; error?: unknown },
      primaryModel: string = model,
      keySource: 'byok' | 'env' | null = null,
    ) => {
      if (outcome.result) ledger.record(model, outcome.result.usage.promptTokens, outcome.result.usage.completionTokens)
      usageWrites.push(recordLlmUsage(db, {
        functionName: 'mistake-summarizer',
        stage,
        projectId: lesson.project_id as string,
        model,
        primaryModel,
        keySource,
        startedAt,
      }, outcome))
    }

    // The project's own keys first, then the platform keys through the
    // mistake-summarizer route (provider and model from kenji). Haiku 4.5 on
    // the app's own key still takes the AI SDK v4 call shape; every 5.x model
    // (Sonnet 5.5 rejects temperature and forced tools) goes through
    // claude-messages.ts.
    async function callLlm(model: 'fast' | 'sonnet', prompt: string): Promise<string> {
      const claudeDefault = model === 'fast' ? ANTHROPIC_HAIKU : MISTAKE_MODEL
      const stage = model === 'fast' ? 'lesson-summarise' : 'lesson-essay'
      const maxTokens = model === 'fast' ? 200 : 1200
      const timed = async (
        usedModel: string,
        keySource: 'byok' | 'env',
        call: () => Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }>,
      ) => {
        const startedAt = Date.now()
        try {
          const result = await call()
          record(usedModel, stage, startedAt, { result }, claudeDefault, keySource)
          return result.text.trim()
        } catch (err) {
          record(usedModel, stage, startedAt, { error: err }, claudeDefault, keySource)
          throw err
        }
      }
      const routed = await withAnthropicOrOpenAi(
        db,
        lesson.project_id as string,
        (key) => {
          const usedModel = key.model ?? claudeDefault
          if (!key.model && model === 'fast') {
            const anthropicFast = createAnthropic({ apiKey: key.key })
            return timed(usedModel, key.source, () => generateText({ model: anthropicFast(ANTHROPIC_HAIKU), prompt, maxTokens }))
          }
          return timed(usedModel, key.source, () => claudeGenerateText({
            apiKey: key.key,
            model: usedModel,
            effort: MISTAKE_EFFORT,
            prompt,
            // The essay is ~800 output tokens; adaptive thinking counts toward the cap.
            maxTokens: maxTokens + THINKING_HEADROOM_TOKENS,
          }))
        },
        (key) => {
          const usedModel = key.model ?? OPENAI_MINI
          const openai = openAiProvider({
            apiKey: key.key,
            ...(key.baseUrl ? { baseURL: key.baseUrl } : {}),
          })
          return timed(usedModel, key.source, () => generateText({ model: openai(usedModel), prompt, maxTokens }))
        },
        { feature: 'mistake-summarizer', tier: 'fast' },
      )
      return routed.result
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
      const { error: updateErr } = await db.from('lessons').update(updates).eq('id', lessonId)
      if (updateErr) {
        return new Response(JSON.stringify({ error: `Could not save the lesson views: ${updateErr.message}` }), { status: 500 })
      }

      // One llm_invocations row per call (so a fallback run lands in each
      // model's own cost bucket). These rows feed the per-project LLM budget.
      const costErr = (await Promise.all(usageWrites)).find((w) => w.error)?.error ?? null
      if (costErr) {
        // The spend ledger feeds the per-project LLM budget; an unrecorded
        // spend is a failure, not a success with a missing row.
        return new Response(
          JSON.stringify({ error: `Saved the lesson views but could not record their LLM cost: ${costErr}`, lessonId, updated: Object.keys(updates) }),
          { status: 500 },
        )
      }
    }

    return new Response(
      JSON.stringify({ ok: true, lessonId, updated: Object.keys(updates), costUsd: ledger.totalCostUsd }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
