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
 *   - Producer and judge default to Claude Sonnet 5.5 (pdca-models.ts); the
 *     OpenAI fallback is gpt-5.4; overridable only within that priced table
 *   - The critic asks for native structured output (`output_config.format`),
 *     never a forced tool call: Sonnet 5.5 rejects a forced tool_choice
 *   - Monotonicity guard: abort if score regresses (prevents fruitless cycles)
 *   - Each call priced from pdca-models.ts and logged to llm_cost_usd
 *   - Run state persisted in pdca_runs + pdca_iterations (Phase 3b wires the DB)
 */

import { createAnthropic, type AnthropicProviderOptions } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PDCA_MAX_OUTPUT_TOKENS,
  PDCA_OPENAI_FALLBACK_MODEL,
  pdcaCallCostUsd,
  resolvePdcaClaudeModel,
  type PdcaClaudeModel,
  type PdcaPricedModel,
  type PdcaTokenUsage,
} from './pdca-models.js'

// ─── Types ────────────────────────────────────────────────────

export interface PdcaConfig {
  supabaseUrl: string
  supabaseServiceKey: string
  projectId: string
  targetUrl: string
  goal: string
  iterations: number
  targetScore: number  // 0-1; run exits early when reached
  /** Producer model, one of PDCA_CLAUDE_MODELS (default: claude-sonnet-5-5). */
  primaryModel?: string
  /** Critic model, one of PDCA_CLAUDE_MODELS (default: claude-sonnet-5-5). */
  judgeModel?: string
  personaSlug?: string   // must exist in agent_personas table
  openaiApiKey?: string
  anthropicApiKey?: string
  /** HTTP client for the model providers and the page fetch (tests inject one). */
  fetch?: typeof globalThis.fetch
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
  // A list, not a record: structured outputs close every object
  // (additionalProperties: false), so a record could only ever come back empty.
  dimensions: z.array(z.object({
    name: z.string().describe('Rubric dimension name'),
    score: z.number().min(0).max(1).describe('Score 0-1 for this dimension'),
  })).describe(
    'Per-dimension scores matching the persona rubric',
  ),
  critique_text: z.string().max(2000).describe(
    'Specific, actionable feedback for the producer to improve on the next iteration',
  ),
  top_issues: z.array(z.string()).max(5).describe(
    'Top 1-5 specific issues to fix in the next iteration',
  ),
})

/** Native structured output, never a forced tool call (Sonnet 5.5 rejects forced tool_choice). */
const CRITIC_PROVIDER_OPTIONS = {
  anthropic: { structuredOutputMode: 'outputFormat' } satisfies AnthropicProviderOptions,
}

interface PricedCall {
  model: PdcaPricedModel
  usage: PdcaTokenUsage
  costUsd: number
}

function pricedCall(model: PdcaPricedModel, usage: PdcaTokenUsage): PricedCall {
  return { model, usage, costUsd: pdcaCallCostUsd(model, usage) }
}

// ─── PDCA runner ─────────────────────────────────────────────

export class PdcaRunner {
  private db: SupabaseClient
  private config: PdcaConfig
  private anthropic: ReturnType<typeof createAnthropic>
  private openai: ReturnType<typeof createOpenAI>
  private fetchImpl: typeof globalThis.fetch
  private primaryModel: PdcaClaudeModel
  private judgeModel: PdcaClaudeModel

  constructor(config: PdcaConfig) {
    this.config = config
    // Refuse an unknown model now, before any call is paid for.
    this.primaryModel = resolvePdcaClaudeModel('primaryModel', config.primaryModel)
    this.judgeModel = resolvePdcaClaudeModel('judgeModel', config.judgeModel)
    this.fetchImpl = config.fetch ?? globalThis.fetch
    this.db = createClient(config.supabaseUrl, config.supabaseServiceKey)
    this.anthropic = createAnthropic({
      apiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    })
    this.openai = createOpenAI({
      apiKey: config.openaiApiKey ?? process.env.OPENAI_API_KEY,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    })
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
        const { draft, call: producerCall } = await this.produce(currentInput, iterations, personaPrompt)

        // ── Critic step ────────────────────────────────────────
        const { critique, call: criticCall } = await this.critique(
          draft,
          iterations,
          personaPrompt,
        )

        const iteration: PdcaIteration = {
          iteration: i + 1,
          draftHtml: draft,
          critiqueText: critique.critique_text,
          score: critique.overall_score,
          scoreBreakdown: Object.fromEntries(critique.dimensions.map((d) => [d.name, d.score])),
          costUsd: producerCall.costUsd + criticCall.costUsd,
          msElapsed: Date.now() - iterStart,
        }

        iterations.push(iteration)

        // Persist to pdca_iterations if runId provided
        if (runId) {
          await this.persistIteration(runId, iteration)
        }

        // Log cost: one row per call, priced on the model that served it.
        await this.logCost('pdca-producer', producerCall)
        await this.logCost('pdca-critic', criticCall)

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
  ): Promise<{ draft: string; call: PricedCall }> {
    const primaryModel = this.primaryModel

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
      const { text, usage } = await generateText({
        model: this.anthropic(primaryModel),
        prompt,
        maxOutputTokens: PDCA_MAX_OUTPUT_TOKENS,
      })
      return { draft: text.trim(), call: pricedCall(primaryModel, usage) }
    } catch (err) {
      console.warn(`[pdca] producer ${primaryModel} failed, falling back to ${PDCA_OPENAI_FALLBACK_MODEL}:`, err)
      const { text, usage } = await generateText({
        model: this.openai(PDCA_OPENAI_FALLBACK_MODEL),
        prompt,
        maxOutputTokens: PDCA_MAX_OUTPUT_TOKENS,
      })
      return { draft: text.trim(), call: pricedCall(PDCA_OPENAI_FALLBACK_MODEL, usage) }
    }
  }

  // ─── Critic ───────────────────────────────────────────────

  private async critique(
    draft: string,
    _history: PdcaIteration[],
    personaPrompt: string,
  ): Promise<{ critique: z.infer<typeof rubricSchema>; call: PricedCall }> {
    const judgeModel = this.judgeModel

    const prompt = `${personaPrompt}

Goal: ${this.config.goal}

Page/component to review:
\`\`\`html
${draft.slice(0, 6000)}
\`\`\`

Evaluate this against the persona criteria above. Be specific, critical, and actionable.`

    try {
      const { object, usage } = await generateObject({
        model: this.anthropic(judgeModel),
        schema: rubricSchema,
        prompt,
        maxOutputTokens: PDCA_MAX_OUTPUT_TOKENS,
        providerOptions: CRITIC_PROVIDER_OPTIONS,
      })
      return { critique: object, call: pricedCall(judgeModel, usage) }
    } catch (err) {
      console.warn(`[pdca] critic ${judgeModel} failed, falling back to ${PDCA_OPENAI_FALLBACK_MODEL}:`, err)
      const { object, usage } = await generateObject({
        model: this.openai(PDCA_OPENAI_FALLBACK_MODEL),
        schema: rubricSchema,
        prompt,
        maxOutputTokens: PDCA_MAX_OUTPUT_TOKENS,
      })
      return { critique: object, call: pricedCall(PDCA_OPENAI_FALLBACK_MODEL, usage) }
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
      const res = await this.fetchImpl(url, { headers: { 'Accept': 'text/html' } })
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

  private async logCost(operation: string, call: PricedCall) {
    const { error } = await this.db.from('llm_cost_usd').insert({
      project_id: this.config.projectId,
      operation,
      model: call.model,
      input_tokens: call.usage.inputTokens ?? 0,
      output_tokens: call.usage.outputTokens ?? 0,
      cost_usd: call.costUsd,
    })
    if (error) console.error(`[pdca] llm_cost_usd insert failed for ${operation} (${call.model}):`, error.message)
  }
}

// ─── Factory for edge function ────────────────────────────────

export function createPdcaRunner(config: PdcaConfig): PdcaRunner {
  return new PdcaRunner(config)
}
