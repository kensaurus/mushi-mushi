/**
 * pdca-runner — Supabase Edge Function that picks queued PDCA runs and
 * executes the Producer/Critic loop defined in packages/agents/src/pdca.ts.
 *
 * Phase 3b of the closed-loop evolution plan.
 *
 * Trigger: cron picks queued runs + manual trigger via POST.
 * POST body (manual): { run_id: string }
 * POST body (TDD improve): { mode: 'qa_story_improve', project_id?: string }
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
import { withAnthropicOrOpenAi } from '../_shared/llm-failover.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rubricSchema = z.object({
  overall_score: z.number().min(0).max(1),
  dimensions: z.record(z.number().min(0).max(1)),
  critique_text: z.string().max(2000),
  top_issues: z.array(z.string()).max(5),
})

// ── QA Story PDCA Improver ────────────────────────────────────────────────
// Analyzes recent failed qa_story_runs and proposes improved test scripts.

const IMPROVE_SYSTEM = `You are a senior test engineer improving a failing Playwright test.

You receive:
- The original Playwright TypeScript test script
- A failure summary (assertion errors, error messages, console logs)

Produce an improved version of the test that:
1. Fixes the identified failures (wrong selectors, timing issues, flow changes)
2. Adds more resilient waits or retry logic where needed
3. Keeps the same user story coverage but makes assertions more robust
4. Stays in TypeScript using @playwright/test

Return ONLY the improved TypeScript test script, no explanation.`

const improveSchema = z.object({
  improved_script: z.string().describe('The full improved Playwright TypeScript test'),
  change_summary: z.string().max(500).describe('Brief description of what was changed and why'),
  confidence: z.number().min(0).max(1).describe('Confidence this will fix the failures (0-1)'),
})

// Same patterns the test-gen path uses — block LLM-emitted credentials from
// landing in an auto-approved (and for automation_mode='auto', auto-enabled)
// script that would then run unattended.
const SECRET_PATTERNS = [
  /sk-(ant-|or-|proj-|live-)?[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
  /AKIA[A-Z0-9]{16}/,
]
function hasSecret(s: string): boolean { return SECRET_PATTERNS.some((p) => p.test(s)) }

async function runQaStoryImprover(
  db: ReturnType<typeof getServiceClient>,
  projectId: string | null,
): Promise<Response> {
  const MAX_PER_RUN = 5

  // Only consider failures from the last 24h so the cron doesn't keep
  // improving stories off stale, long-resolved runs (wasted LLM spend/noise).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Find failed qa_stories with recent runs (last 24h) whose automation_mode allows PDCA
  let q = db
    .from('qa_stories')
    .select('id, project_id, name, prompt, script, automation_mode, pdca_iteration, origin_story_node_id')
    .in('automation_mode', ['auto', 'review'])
    .not('script', 'is', null)
    .eq('source', 'test_gen_from_story')
    .order('updated_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (projectId) q = q.eq('project_id', projectId)

  const { data: stories } = await q
  if (!stories || stories.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: 'no stories to improve', improved: 0 }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  let improved = 0
  for (const story of stories) {
    // Get last 3 failed runs for this story within the 24h window
    const { data: failedRuns } = await db
      .from('qa_story_runs')
      .select('status, error_message, summary, assertion_failures')
      .eq('story_id', story.id as string)
      .in('status', ['failed', 'error'])
      .gte('started_at', since24h)
      .order('started_at', { ascending: false })
      .limit(3)

    if (!failedRuns || failedRuns.length === 0) continue

    // Idempotency: the selector only ever picks the original
    // (source='test_gen_from_story') parent and its updated_at is not bumped
    // by inserting a child, so without this guard every cron tick (every 6h)
    // would clone the same still-failing parent again → unbounded duplicate
    // qa_stories. Improve a given parent at most once; a human can re-trigger
    // by deleting the prior pdca child if a fresh attempt is wanted.
    const { count: existingChildren } = await db
      .from('qa_stories')
      .select('id', { count: 'exact', head: true })
      .eq('parent_story_id', story.id as string)
      .eq('source', 'pdca')
    if ((existingChildren ?? 0) > 0) continue

    const failureSummary = failedRuns
      .map((r, i) => {
        const failures = (r.assertion_failures as Array<{ step?: string; expected?: string; actual?: string }> | null)?.map(f =>
          `  - ${f.step ?? 'unknown step'}: expected ${f.expected ?? '?'}, got ${f.actual ?? '?'}`
        ).join('\n') ?? ''
        return `Run ${i + 1} (${r.status}):\n  Error: ${r.error_message ?? r.summary ?? 'unknown'}\n${failures}`
      })
      .join('\n\n')

    try {
      const { result } = await withAnthropicOrOpenAi(
        db,
        story.project_id as string,
        async (anthropicKey) => {
          const { object } = await generateObject({
            model: createAnthropic({ apiKey: anthropicKey.key })('claude-sonnet-4-5'),
            system: IMPROVE_SYSTEM,
            schema: improveSchema,
            prompt: `ORIGINAL TEST:\n\`\`\`typescript\n${(story.script as string).slice(0, 4000)}\n\`\`\`\n\nRECENT FAILURES:\n${failureSummary}`,
            maxTokens: 6000,
          })
          return object
        },
        async (openaiKey) => {
          const { object } = await generateObject({
            model: createOpenAI({ apiKey: openaiKey.key })('gpt-4.1', { structuredOutputs: false }),
            system: IMPROVE_SYSTEM,
            schema: improveSchema,
            prompt: `ORIGINAL TEST:\n\`\`\`typescript\n${(story.script as string).slice(0, 4000)}\n\`\`\`\n\nRECENT FAILURES:\n${failureSummary}`,
            maxTokens: 6000,
          })
          return object
        },
      )

      if (result.confidence < 0.3) continue // Skip low-confidence improvements

      // Never persist/enable an improved script that contains a credential.
      if (hasSecret(result.improved_script)) {
        console.warn(`[pdca-runner] improved script for story ${story.id} contained a secret — skipped`)
        continue
      }

      const automationMode = story.automation_mode as 'auto' | 'review' | 'approve'
      const approvalStatus = automationMode === 'auto' ? 'approved' : 'pending_review'

      await db.from('qa_stories').insert({
        project_id: story.project_id,
        name: `${story.name as string} (PDCA v${(story.pdca_iteration as number) + 1})`,
        // Preserve the original natural-language prompt so future PDCA
        // iterations stay interpretable; don't overwrite it with the script.
        prompt: story.prompt,
        script: result.improved_script,
        script_lang: 'playwright-ts',
        browser_provider: 'local',
        source: 'pdca',
        approval_status: approvalStatus,
        automation_mode: automationMode,
        origin_story_node_id: story.origin_story_node_id,
        parent_story_id: story.id,
        pdca_iteration: (story.pdca_iteration as number) + 1,
        generation_model: 'claude-sonnet-4-5',
        enabled: approvalStatus === 'approved',
      })

      improved++
    } catch {
      // Non-fatal: continue to next story
    }
  }

  return new Response(
    JSON.stringify({ ok: true, message: `improved ${improved} stories`, improved }),
    { headers: { 'content-type': 'application/json' } },
  )
}

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
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))

    // ── Phase 3: QA story PDCA auto-improve mode ──────────────────────────
    if (body.mode === 'qa_story_improve') {
      return await runQaStoryImprover(db, body.project_id ?? null)
    }

    let runId: string | null = body.run_id ?? null

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
      try {
        // Producer — use multi-key failover
        const historyCtx = iterations.length > 0
          ? `\n\nPrevious critique:\n${iterations.at(-1)!.critique}`
          : ''

        let draft = ''
        const { result: producerResult } = await withAnthropicOrOpenAi(
          db,
          run.project_id as string,
          async (k) => {
            const anthropic = createAnthropic({ apiKey: k.key })
            const { text } = await generateText({
              model: anthropic(primaryModel),
              prompt: `You are a senior UI engineer.\nGoal: ${goal}${historyCtx}\n\nCurrent page:\n${currentInput.slice(0, 6000)}\n\nReturn only improved markup.`,
              maxTokens: 3000,
            })
            return text.trim()
          },
          async (k) => {
            const openai = createOpenAI({ apiKey: k.key, ...(k.baseUrl ? { baseURL: k.baseUrl } : {}) })
            const { text } = await generateText({
              model: openai('gpt-5.4'),
              prompt: `You are a senior UI engineer.\nGoal: ${goal}${historyCtx}\n\nCurrent page:\n${currentInput.slice(0, 6000)}\n\nReturn only improved markup.`,
              maxTokens: 3000,
            })
            return text.trim()
          },
        )
        draft = producerResult

        // Critic — use multi-key failover
        let critiqueResult: z.infer<typeof rubricSchema>
        let costUsd = 0
        const { result: criticResult } = await withAnthropicOrOpenAi(
          db,
          run.project_id as string,
          async (k) => {
            const anthropic = createAnthropic({ apiKey: k.key })
            const { object, usage } = await generateObject({
              model: anthropic(judgeModel),
              schema: rubricSchema,
              prompt: `${personaPrompt}\n\nGoal: ${goal}\n\nPage:\n${draft.slice(0, 5000)}\n\nEvaluate critically.`,
            })
            costUsd = (usage.promptTokens / 1_000_000) * 3 + (usage.completionTokens / 1_000_000) * 15
            return object
          },
          async (k) => {
            const openai = createOpenAI({ apiKey: k.key, ...(k.baseUrl ? { baseURL: k.baseUrl } : {}) })
            const { object, usage } = await generateObject({
              model: openai('gpt-5.4', { structuredOutputs: false }),
              schema: rubricSchema,
              prompt: `${personaPrompt}\n\nGoal: ${goal}\n\nPage:\n${draft.slice(0, 5000)}\n\nEvaluate critically.`,
            })
            costUsd = (usage.promptTokens / 1_000_000) * 2.5 + (usage.completionTokens / 1_000_000) * 10
            return object
          },
        )
        critiqueResult = criticResult

        // Persist iteration
        await db.from('pdca_iterations').insert({
          run_id: runId,
          iteration_n: i + 1,
          critique_text: critiqueResult.critique_text,
          score: critiqueResult.overall_score,
          score_breakdown: critiqueResult.dimensions,
          model_cost_usd: costUsd,
          ms_elapsed: Date.now() - iterStart,
        })

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
        console.error(`[pdca-runner] iteration ${i + 1} error:`, err)
        finalStatus = 'failed'
        exitReason = 'error'
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
