/**
 * pdca-runner — Supabase Edge Function that picks queued PDCA runs and
 * executes the Producer/Critic loop defined in packages/agents/src/pdca.ts.
 *
 * Phase 3b of the closed-loop evolution plan.
 *
 * Trigger: cron picks queued runs + manual trigger via POST.
 * POST body (manual): { run_id: string }
 *
 * A2A: publishes run-started and run-finished events via a2a-push-notify
 * so external agents (Cursor Cloud, Devin) can subscribe to progress.
 */

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateText, generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveLlmKey } from '../_shared/byok.ts'

// Fixed-key dimensions schema so OpenAI structured-output validation passes
// (z.record() generates additionalProperties which OpenAI rejects in strict mode).
// .catch() on numbers clamps any out-of-range values the LLM might return.
const clampedScore = z.number().catch(0.5).transform(v => Math.max(0, Math.min(1, v)))
const rubricSchema = z.object({
  overall_score: clampedScore,
  dimensions: z.object({
    clarity: clampedScore,
    visual_hierarchy: clampedScore,
    usability: clampedScore,
    accessibility: clampedScore,
    consistency: clampedScore,
  }).catch({ clarity: 0.5, visual_hierarchy: 0.5, usability: 0.5, accessibility: 0.5, consistency: 0.5 }),
  critique_text: z.string().catch('').transform(s => s.slice(0, 4000)),
  top_issues: z.array(z.string()).catch([]).transform(a => a.slice(0, 10)),
})

async function notifyA2A(db: ReturnType<typeof getServiceClient>, event: string, payload: unknown) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    await fetch(`${supabaseUrl}/functions/v1/a2a-push-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ event, payload }),
    })
  } catch { /* A2A is best-effort */ }
}

Deno.serve(
  withSentry('pdca-runner', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))

    let runId: string | null = (body.run_id as string) ?? null

    // If no run_id given, pick oldest queued run
    if (!runId) {
      const { data } = await db
        .from('pdca_runs')
        .select('id')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      runId = data?.id as string ?? null
    }

    if (!runId) {
      return new Response(JSON.stringify({ ok: true, message: 'no queued runs' }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    // Lock the run
    const { data: run, error: lockErr } = await db
      .from('pdca_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'queued')
      .select()
      .single()

    if (lockErr || !run) {
      return new Response(JSON.stringify({ ok: false, error: 'Run not found or already taken' }), {
        status: 409, headers: { 'content-type': 'application/json' },
      })
    }

    await notifyA2A(db, 'pdca.run.started', { run_id: runId, target_url: run.target_url })

    // Load persona
    const { data: personaData } = await db
      .from('agent_personas')
      .select('prompt')
      .eq('slug', run.persona as string)
      .maybeSingle()
    const personaPrompt = personaData?.prompt as string ?? 'You are a UX expert. Evaluate the UI for usability, clarity, and visual hierarchy.'

    // Fetch initial page content
    let currentInput = ''
    try {
      const res = await fetch(run.target_url as string, { headers: { Accept: 'text/html' } })
      currentInput = await res.text()
    } catch {
      currentInput = `<!-- Could not fetch ${run.target_url} -->`
    }

    const [anthropicResolved, openaiResolved] = await Promise.all([
      resolveLlmKey(db, run.project_id as string, 'anthropic'),
      resolveLlmKey(db, run.project_id as string, 'openai'),
    ])

    if (!anthropicResolved && !openaiResolved) {
      const noKeyMsg = 'No LLM API keys configured — add Anthropic or OpenAI keys in Settings → LLM Keys'
      await db.from('pdca_runs').update({
        status: 'failed',
        final_score: 0,
        finished_at: new Date().toISOString(),
        error_detail: noKeyMsg,
      }).eq('id', runId)
      return new Response(
        JSON.stringify({ ok: false, error: noKeyMsg }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }

    const anthropic = anthropicResolved
      ? createAnthropic({ apiKey: anthropicResolved.key })
      : null
    const openai = openaiResolved
      ? createOpenAI({
          apiKey: openaiResolved.key,
          ...(openaiResolved.baseUrl ? { baseURL: openaiResolved.baseUrl } : {}),
        })
      : null

    const primaryModel = run.primary_model as string
    const judgeModel = run.judge_model as string
    const goal = run.goal as string
    const targetScore = run.target_score as number
    const iterationsTarget = run.iterations_target as number

    let lastScore = -1
    let exitReason = 'max_iterations'
    let finalStatus = 'succeeded'
    const iterations: Array<{score: number; critique: string}> = []

    for (let i = 0; i < iterationsTarget; i++) {
      const iterStart = Date.now()
      let anthropicCriticErr = ''
      try {
        // Producer
        const historyCtx = iterations.length > 0
          ? `\n\nPrevious critique:\n${iterations.at(-1)!.critique}`
          : ''

        let draft = ''
        try {
          if (!anthropic) throw new Error('No Anthropic key')
          const { text } = await generateText({
            model: anthropic(primaryModel),
            prompt: `You are a senior UI engineer.\nGoal: ${goal}${historyCtx}\n\nCurrent page:\n${currentInput.slice(0, 4000)}\n\nReturn only improved markup (max 800 tokens).`,
            maxTokens: 800,
            abortSignal: AbortSignal.timeout(55_000),
          })
          draft = text.trim()
        } catch (producerErr) {
          const errMsg = producerErr instanceof Error ? producerErr.message : String(producerErr)
          console.error('[pdca-runner] producer Anthropic error:', errMsg)
          if (!openai) throw new Error(`Producer Anthropic failed (${errMsg}) and no OpenAI fallback available`)
          // gpt-5.4 uses max_completion_tokens, not max_tokens — omit maxTokens to avoid SDK param mismatch
          const { text } = await generateText({
            model: openai('gpt-5.4'),
            prompt: `You are a senior UI engineer.\nGoal: ${goal}${historyCtx}\n\nCurrent page:\n${currentInput.slice(0, 4000)}\n\nReturn only improved markup (max 800 tokens).`,
            abortSignal: AbortSignal.timeout(55_000),
          })
          draft = text.trim()
        }

        // Critic
        let critiqueResult: z.infer<typeof rubricSchema>
        let costUsd = 0
        try {
          if (!anthropic) throw new Error('No Anthropic key')
          const { object, usage } = await generateObject({
            model: anthropic(judgeModel),
            schema: rubricSchema,
            prompt: `${personaPrompt}\n\nGoal: ${goal}\n\nPage:\n${draft.slice(0, 4000)}\n\nEvaluate critically.`,
            abortSignal: AbortSignal.timeout(55_000),
          })
          critiqueResult = object
          costUsd = (usage.promptTokens / 1_000_000) * 3 + (usage.completionTokens / 1_000_000) * 15
        } catch (criticErr) {
          anthropicCriticErr = criticErr instanceof Error ? criticErr.message : String(criticErr)
          console.error('[pdca-runner] critic Anthropic error:', anthropicCriticErr)
          if (!openai) throw new Error(`Critic Anthropic failed (${anthropicCriticErr}) and no OpenAI fallback available`)
          const { object, usage } = await generateObject({
            model: openai('gpt-5.4'),
            schema: rubricSchema,
            prompt: `${personaPrompt}\n\nGoal: ${goal}\n\nPage:\n${draft.slice(0, 4000)}\n\nEvaluate critically. Each score is 0.0–1.0.`,
            abortSignal: AbortSignal.timeout(55_000),
          })
          critiqueResult = object
          costUsd = (usage.promptTokens / 1_000_000) * 2.5 + (usage.completionTokens / 1_000_000) * 10
        }

        // Persist iteration
        const { error: iterInsertErr } = await db.from('pdca_iterations').insert({
          run_id: runId,
          iteration_n: i + 1,
          critique_text: critiqueResult.critique_text,
          score: critiqueResult.overall_score,
          score_breakdown: critiqueResult.dimensions ?? {},
          model_cost_usd: costUsd,
          ms_elapsed: Date.now() - iterStart,
        })
        if (iterInsertErr) throw new Error(`pdca_iterations insert failed: ${iterInsertErr.message}`)

        // Update run progress
        await db.from('pdca_runs').update({ current_iteration: i + 1 }).eq('id', runId)

        // Log cost
        await db.from('llm_cost_usd').insert({
          project_id: run.project_id,
          operation: 'pdca-iteration',
          model: judgeModel,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: costUsd,
        })

        iterations.push({ score: critiqueResult.overall_score, critique: critiqueResult.critique_text })

        // Monotonicity guard
        if (i > 1 && critiqueResult.overall_score < lastScore) {
          exitReason = 'monotonicity_guard'
          break
        }

        // Target reached
        if (critiqueResult.overall_score >= targetScore) {
          exitReason = 'target_reached'
          if (critiqueResult.overall_score > lastScore) currentInput = draft
          break
        }

        if (critiqueResult.overall_score > lastScore) currentInput = draft
        lastScore = critiqueResult.overall_score

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const detail = anthropicCriticErr
          ? `${errMsg} [anthropic_critic: ${anthropicCriticErr}]`
          : errMsg
        console.error(`[pdca-runner] iteration ${i + 1} error:`, detail)
        finalStatus = 'failed'
        exitReason = 'error'
        await db.from('pdca_runs').update({ error_detail: detail }).eq('id', runId)
        break
      }
    }

    const finalScore = iterations.at(-1)?.score ?? 0

    await db.from('pdca_runs').update({
      status: finalStatus,
      final_score: finalScore,
      finished_at: new Date().toISOString(),
    }).eq('id', runId)

    await notifyA2A(db, 'pdca.run.finished', {
      run_id: runId,
      final_score: finalScore,
      exit_reason: exitReason,
      status: finalStatus,
    })

    return new Response(
      JSON.stringify({ ok: true, runId, finalScore, exitReason, status: finalStatus }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
