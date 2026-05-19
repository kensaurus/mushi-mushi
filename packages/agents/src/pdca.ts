/**
 * packages/agents/src/pdca.ts
 *
 * PDCA Enhancement Loop — Phase 3a of the closed-loop evolution plan.
 *
 * Producer/Critic autonomous iteration loop:
 *   for (let i = 0; i < config.iterations; i++) {
 *     draft = await producer(input, history)   // edits HTML/CSS/JSX
 *     screenshot = await render(draft)          // browser sandbox
 *     critique = await critic(screenshot, draft, persona)  // judge model
 *     score = await rubric(critique)            // structured score
 *     history.push({ draft, critique, score })
 *     if (score >= config.targetScore) break
 *     if (i > 1 && score < history[i-1].score) break  // monotonicity guard
 *   }
 *
 * Design decisions per plan:
 *   - Producer/Critic pattern (2026 canonical, LangGraph-style)
 *   - Personas defined in agent_personas table (extensible without redeploys)
 *   - Judge defaults to Claude Opus 4.7; fallback GPT-5; operator-overridable
 *   - Monotonicity guard: abort if score regresses (prevents fruitless cycles)
 *   - Cost tracked in llm_cost_usd per iteration
 *   - Run state persisted in pdca_runs + pdca_iterations (Phase 3b wires the DB)
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────

export interface PdcaConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  projectId: string
  targetUrl: string
  goal: string
  iterations: number
  targetScore: number  // 0-1; run exits early when reached
  primaryModel?: string  // producer model (default: claude-sonnet-4-6)
  judgeModel?: string    // critic model (default: claude-opus-4-7)
  personaSlug?: string   // must exist in agent_personas table
  openaiApiKey?: string
  anthropicApiKey?: string
}

export interface PdcaIteration {
  iteration: number
  draftHtml?: string
  screenshotUrl?: string
  critiqueText: string
  score: number
  scoreBreakdown: Record<string, number>
  costUsd: number
  msElapsed: number
}

export interface PdcaResult {
  runId: string
  iterations: PdcaIteration[]
  finalScore: number
  status: 'succeeded' | 'aborted' | 'failed'
  exitReason: 'target_reached' | 'monotonicity_guard' | 'max_iterations' | 'error'
}

// ─── Score schema ─────────────────────────────────────────────

const rubricSchema = z.object({
  overall_score: z.number().min(0).max(1).describe(
    'Overall quality score 0-1 (1 = excellent, 0 = poor)',
  ),
  dimensions: z.record(z.string(), z.number().min(0).max(1)).describe(
    'Per-dimension scores matching the persona rubric',
  ),
  critique_text: z.string().max(2000).describe(
    'Specific, actionable feedback for the producer to improve on the next iteration',
  ),
  top_issues: z.array(z.string()).max(5).describe(
    'Top 1-5 specific issues to fix in the next iteration',
  ),
})

// ─── PDCA runner ─────────────────────────────────────────────

export class PdcaRunner {
  private db: SupabaseClient
  private config: PdcaConfig
  private anthropic: ReturnType<typeof createAnthropic>
  private openai: ReturnType<typeof createOpenAI>

  constructor(config: PdcaConfig) {
    this.config = config
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey)
    this.anthropic = createAnthropic({ apiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY })
    this.openai = createOpenAI({ apiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY })
  }

  async run(runId?: string): Promise<PdcaResult> {
    const iterations: PdcaIteration[] = []
    let lastScore = -1
    let exitReason: PdcaResult['exitReason'] = 'max_iterations'
    let status: PdcaResult['status'] = 'succeeded'

    // Resolve persona prompt
    const personaPrompt = await this.resolvePersonaPrompt()

    // Fetch the current page HTML/screenshot as starting input
    let currentInput = await this.fetchPageContent(this.config.targetUrl)

    for (let i = 0; i < this.config.iterations; i++) {
      const iterStart = Date.now()

      try {
        // ── Producer step ──────────────────────────────────────
        const draft = await this.produce(currentInput, iterations, personaPrompt)

        // ── Critic step ────────────────────────────────────────
        const { critique, costUsd } = await this.critique(
          draft,
          iterations,
          personaPrompt,
        )

        const iteration: PdcaIteration = {
          iteration: i + 1,
          draftHtml: draft,
          critiqueText: critique.critique_text,
          score: critique.overall_score,
          scoreBreakdown: critique.dimensions,
          costUsd,
          msElapsed: Date.now() - iterStart,
        }

        iterations.push(iteration)

        // Persist to pdca_iterations if runId provided
        if (runId) {
          await this.persistIteration(runId, iteration)
        }

        // Log cost
        await this.logCost(
          'pdca-iteration',
          this.config.judgeModel ?? 'claude-opus-4-7',
          costUsd,
        )

        // ── Monotonicity guard ─────────────────────────────────
        if (i > 1 && critique.overall_score < lastScore) {
          exitReason = 'monotonicity_guard'
          break
        }

        // ── Target reached? ────────────────────────────────────
        if (critique.overall_score >= this.config.targetScore) {
          exitReason = 'target_reached'
          break
        }

        lastScore = critique.overall_score
        // Use the draft as input for next iteration if it improved
        if (draft && critique.overall_score > (iterations[i - 1]?.score ?? 0)) {
          currentInput = draft
        }
      } catch (err) {
        console.error(`[pdca] iteration ${i + 1} failed:`, err)
        status = 'failed'
        exitReason = 'error'
        break
      }
    }

    const finalScore = iterations.at(-1)?.score ?? 0

    if (runId) {
      await this.db.from('pdca_runs').update({
        status,
        current_iteration: iterations.length,
        final_score: finalScore,
        finished_at: new Date().toISOString(),
      }).eq('id', runId)
    }

    return { runId: runId ?? 'local', iterations, finalScore, status, exitReason }
  }

  // ─── Producer ─────────────────────────────────────────────

  private async produce(
    input: string,
    history: PdcaIteration[],
    _personaPrompt: string,
  ): Promise<string> {
    const primaryModel = this.config.primaryModel ?? 'claude-sonnet-4-6'

    const historyContext = history.length > 0
      ? `\n\nPrevious critique to address:\n${history.at(-1)!.critiqueText}\n\nTop issues from last review:\n${history.at(-1)!.scoreBreakdown ? JSON.stringify(history.at(-1)!.scoreBreakdown, null, 2) : ''}`
      : ''

    const prompt = `You are a senior UI engineer improving a web page.

Goal: ${this.config.goal}

${historyContext}

Current page content:
\`\`\`html
${input.slice(0, 8000)}
\`\`\`

Produce an improved version of the relevant HTML/CSS/JSX that addresses the critique above.
Return ONLY the improved markup — no explanation, no markdown code fences, just the markup.`

    try {
      const { text } = await generateText({
        model: this.anthropic(primaryModel),
        prompt,
        maxOutputTokens: 4000,
      })
      return text.trim()
    } catch {
      const { text } = await generateText({
        model: this.openai('gpt-5.4'),
        prompt,
        maxOutputTokens: 4000,
      })
      return text.trim()
    }
  }

  // ─── Critic ───────────────────────────────────────────────

  private async critique(
    draft: string,
    _history: PdcaIteration[],
    personaPrompt: string,
  ): Promise<{ critique: z.infer<typeof rubricSchema>; costUsd: number }> {
    const judgeModel = this.config.judgeModel ?? 'claude-sonnet-4-6'

    const prompt = `${personaPrompt}

Goal: ${this.config.goal}

Page/component to review:
\`\`\`html
${draft.slice(0, 6000)}
\`\`\`

Evaluate this against the persona criteria above. Be specific, critical, and actionable.`

    let result: z.infer<typeof rubricSchema>
    let costUsd = 0

    try {
      const { object, usage } = await generateObject({
        model: this.anthropic(judgeModel),
        schema: rubricSchema,
        prompt,
      })
      result = object
      costUsd = ((usage.inputTokens ?? 0) / 1_000_000) * 3 + ((usage.outputTokens ?? 0) / 1_000_000) * 15
    } catch {
      const { object, usage } = await generateObject({
        model: this.openai('gpt-5.4'),
        schema: rubricSchema,
        prompt,
      })
      result = object
      costUsd = ((usage.inputTokens ?? 0) / 1_000_000) * 2.5 + ((usage.outputTokens ?? 0) / 1_000_000) * 10
    }

    return {
      critique: result,
      costUsd,
    }
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async resolvePersonaPrompt(): Promise<string> {
    const slug = this.config.personaSlug ?? 'nng-heuristic'
    const { data } = await this.db
      .from('agent_personas')
      .select('prompt')
      .eq('slug', slug)
      .single()

    return data?.prompt as string ?? 'You are a UX expert. Evaluate the UI for usability, clarity, and visual hierarchy.'
  }

  private async fetchPageContent(url: string): Promise<string> {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'text/html' } })
      return await res.text()
    } catch {
      return `<!-- Could not fetch ${url} — using goal as context only -->`
    }
  }

  private async persistIteration(runId: string, iteration: PdcaIteration) {
    await this.db.from('pdca_iterations').insert({
      run_id: runId,
      iteration_n: iteration.iteration,
      draft_html_url: null, // stored inline for now
      critique_text: iteration.critiqueText,
      score: iteration.score,
      score_breakdown: iteration.scoreBreakdown,
      model_cost_usd: iteration.costUsd,
      ms_elapsed: iteration.msElapsed,
    })
  }

  private async logCost(operation: string, model: string, costUsd: number) {
    await this.db.from('llm_cost_usd').insert({
      project_id: this.config.projectId,
      operation,
      model,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: costUsd,
    })
  }
}

// ─── Factory for edge function ────────────────────────────────

export function createPdcaRunner(config: PdcaConfig): PdcaRunner {
  return new PdcaRunner(config)
}
