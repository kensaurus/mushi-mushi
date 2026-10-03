/**
 * FILE: packages/server/supabase/functions/_shared/pdca-models.ts
 * PURPOSE: Which Claude model a PDCA run uses. One rule for the route that
 *          queues a run (`api/routes/pdca.ts`) and the runner that executes
 *          it (`pdca-runner`), so the console dropdown, the stored row and
 *          the actual call cannot disagree.
 *
 * Every pdca-runner Claude call goes through `claude-messages.ts`, so the
 * default is the current Sonnet (see the header of `models.ts`). The runner
 * only talks to Claude (OpenAI is the automatic fallback, not a choice), so a
 * non-Claude id is refused on queue and mapped to the default on run.
 *
 * Pure: no Deno globals and no npm: specifiers, so vitest imports it directly.
 */

import { ANTHROPIC_SONNET_LATEST } from './models.ts'
import { resolveClaudeModel } from './claude-request.ts'
import { LLM_PRICING_PER_M_TOKENS } from './pricing.ts'

/** Producer and critic default for a new PDCA run. */
export const PDCA_DEFAULT_MODEL = ANTHROPIC_SONNET_LATEST

const CLAUDE_MODEL_ID_RE = /^claude-[a-z0-9][a-z0-9.-]{1,60}$/

/**
 * Validation for `primary_model` / `judge_model` on POST /v1/admin/pdca.
 * Absent is fine (the default applies). Anything else must be a Claude id
 * that the runner can call and price: it resolves (retired ids map to the
 * default, dated Haiku to its alias) to a Claude model in the pricing table.
 * So the console's choices pass, and a typo such as `claude-foo` is refused
 * here instead of failing the run later.
 */
export function pdcaModelError(field: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const message = `${field} must be a Claude model id such as ${PDCA_DEFAULT_MODEL}.`
  if (typeof raw !== 'string' || !CLAUDE_MODEL_ID_RE.test(raw.trim())) return message
  const resolved = resolvePdcaModel(raw)
  if (!resolved.startsWith('claude-') || !Object.hasOwn(LLM_PRICING_PER_M_TOKENS, resolved)) {
    return `${field} "${raw.trim().slice(0, 64)}" is not a Claude model Mushi knows. Use ${PDCA_DEFAULT_MODEL}, claude-opus-5-5 or claude-haiku-4-5.`
  }
  return null
}

/**
 * The model a stored run actually calls. Empty, retired (Sonnet/Opus 4.0–4.5,
 * Claude 3) and non-Claude ids (an older console offered `gpt-5.4`, which the
 * runner then sent to Anthropic) fall back to the default.
 */
export function resolvePdcaModel(stored: string | null | undefined): string {
  const raw = (stored ?? '').trim()
  if (!raw || !raw.startsWith('claude-')) return PDCA_DEFAULT_MODEL
  return resolveClaudeModel(raw, PDCA_DEFAULT_MODEL)
}
