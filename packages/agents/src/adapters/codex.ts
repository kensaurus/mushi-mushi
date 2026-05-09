import type { FixAgent, FixContext, FixResult } from '../types.js'
import { checkFileScope, checkCircuitBreaker } from '../scope.js'

/**
 * CodexAgent
 * ==============================================================
 *
 * Calls the OpenAI Responses API with the `codex-mini-latest` model
 * (the lightweight reasoning model released alongside the 2026 Codex
 * API). The agent sends a structured fix prompt and expects a JSON
 * response envelope identical to ClaudeCodeAgent's output shape so
 * the orchestrator can swap adapters transparently.
 *
 * Gating
 * ------
 * Disabled by default. Enable per-process with:
 *
 *     MUSHI_ENABLE_CODEX_AGENT=1
 *     OPENAI_API_KEY=sk-...   (BYOK — Mushi never stores your key)
 *
 * When disabled, `generateFix` returns a deterministic "not configured"
 * envelope — identical shape to the enabled path — so upgrading the
 * package is non-breaking.
 *
 * Model
 * -----
 * Uses `codex-mini-latest` by default. Override with
 * `MUSHI_CODEX_MODEL=gpt-4.1` (or any Responses-API-compatible model).
 *
 * Timeout
 * -------
 * Default 5 minutes. The Responses API supports long-running reasoning;
 * the 5m wall clock is a safety rail. Raise with
 * `MUSHI_CODEX_TIMEOUT_MS=<ms>` if your use-case needs longer.
 */
export class CodexAgent implements FixAgent {
  name = 'codex'

  async generateFix(context: FixContext): Promise<FixResult> {
    const branch = `mushi/fix-codex-${context.reportId.slice(0, 8)}`

    const enabled =
      process.env.MUSHI_ENABLE_CODEX_AGENT === '1' ||
      process.env.MUSHI_ENABLE_CODEX_AGENT === 'true'

    if (!enabled) {
      return {
        success: false,
        branch,
        filesChanged: [],
        linesChanged: 0,
        summary: 'Codex agent is disabled on this worker',
        error:
          'CodexAgent is gated behind MUSHI_ENABLE_CODEX_AGENT=1. ' +
          'Set the flag on the worker process and provide OPENAI_API_KEY (BYOK) ' +
          'to enable real Responses API sessions.',
      }
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return {
        success: false,
        branch,
        filesChanged: [],
        linesChanged: 0,
        summary: 'Codex agent requires OPENAI_API_KEY (BYOK)',
        error:
          'OPENAI_API_KEY is not set. Mushi never manages your OpenAI key — ' +
          'set it on the worker process environment.',
      }
    }

    const model = process.env.MUSHI_CODEX_MODEL || 'codex-mini-latest'
    const timeoutMs = Number(process.env.MUSHI_CODEX_TIMEOUT_MS ?? String(5 * 60_000))
    const prompt = this.#buildPrompt(context)

    try {
      const result = await this.#callResponsesApi(apiKey, model, prompt, timeoutMs)
      return { ...result, branch }
    } catch (err) {
      return {
        success: false,
        branch,
        filesChanged: [],
        linesChanged: 0,
        summary: 'Codex Responses API call failed',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  validateResult(context: FixContext, result: FixResult): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    const lineCheck = checkCircuitBreaker(result.linesChanged, context.config.maxLines)
    if (!lineCheck.allowed) errors.push(lineCheck.reason!)

    for (const file of result.filesChanged) {
      const scopeCheck = checkFileScope(file, context.report.component, context.config.scopeRestriction)
      if (!scopeCheck.allowed) errors.push(scopeCheck.reason!)
    }

    return { valid: errors.length === 0, errors }
  }

  async #callResponsesApi(
    apiKey: string,
    model: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<Omit<FixResult, 'branch'>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: prompt,
          // Request JSON output so we can parse the envelope reliably.
          text: { format: { type: 'json_object' } },
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI Responses API returned ${res.status}: ${body.slice(0, 400)}`)
    }

    const json = (await res.json()) as {
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
      error?: { message?: string }
    }

    if (json.error?.message) {
      throw new Error(`OpenAI Responses API error: ${json.error.message}`)
    }

    // Extract the text output from the response envelope.
    const textContent = json.output
      ?.flatMap((o) => o.content ?? [])
      .find((c) => c.type === 'output_text' || c.type === 'text')
      ?.text ?? ''

    return this.#parseEnvelope(textContent)
  }

  #buildPrompt(context: FixContext): string {
    const lines: string[] = []
    lines.push('You are an autonomous bug-fix agent. Produce a minimal, safe patch.')
    lines.push('')
    lines.push(`Report: ${context.report.description}`)
    lines.push(`Category: ${context.report.category}  |  Severity: ${context.report.severity}`)
    if (context.report.component) lines.push(`Component: ${context.report.component}`)
    if (context.report.rootCause) lines.push(`Root cause: ${context.report.rootCause}`)
    if (context.reproductionSteps.length > 0) {
      lines.push('')
      lines.push('Reproduction steps:')
      context.reproductionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    }

    if (context.inventoryAction?.expectedOutcome) {
      lines.push('')
      lines.push('Spec contract (from inventory.yaml — every assertion must pass after your fix):')
      lines.push(JSON.stringify(context.inventoryAction.expectedOutcome, null, 2))
    }

    if (context.relevantCode.length > 0) {
      lines.push('')
      lines.push('Relevant code context:')
      for (const file of context.relevantCode.slice(0, 8)) {
        lines.push(`\n// ${file.path}`)
        lines.push(file.content.slice(0, 2_000))
      }
    }

    lines.push('')
    lines.push(`Max lines of diff: ${context.config.maxLines}. Scope restriction: ${context.config.scopeRestriction}.`)
    lines.push('')
    lines.push(
      'Respond with a JSON object only — no prose outside the JSON:\n' +
      '{"success": boolean, "summary": string, "filesChanged": string[], "linesChanged": number, "error"?: string}',
    )
    return lines.join('\n')
  }

  #parseEnvelope(output: string): Omit<FixResult, 'branch'> {
    const trimmed = output.trim()
    if (!trimmed) {
      return { success: false, filesChanged: [], linesChanged: 0, summary: 'Empty response from Codex', error: 'Codex returned empty output' }
    }

    // Strip markdown code fences if the model wrapped the JSON.
    const cleaned = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>
      if (typeof parsed.success !== 'boolean') {
        return { success: false, filesChanged: [], linesChanged: 0, summary: 'Invalid envelope', error: `Missing "success" boolean in: ${cleaned.slice(0, 200)}` }
      }
      return {
        success: parsed.success,
        filesChanged: Array.isArray(parsed.filesChanged)
          ? (parsed.filesChanged.filter((x) => typeof x === 'string') as string[])
          : [],
        linesChanged: typeof parsed.linesChanged === 'number' ? parsed.linesChanged : 0,
        summary: typeof parsed.summary === 'string' ? parsed.summary : (parsed.success ? 'Fix generated by Codex' : 'Codex returned no changes'),
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
      }
    } catch {
      return { success: false, filesChanged: [], linesChanged: 0, summary: 'Could not parse Codex envelope', error: `Parse error: ${cleaned.slice(0, 200)}` }
    }
  }
}
