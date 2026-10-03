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

/** Producer and critic default for a new PDCA run. */
export const PDCA_DEFAULT_MODEL = ANTHROPIC_SONNET_LATEST

const CLAUDE_MODEL_ID_RE = /^claude-[a-z0-9][a-z0-9.-]{1,60}$/

/**
 * Validation for `primary_model` / `judge_model` on POST /v1/admin/pdca.
 * Absent is fine (the default applies); anything else must be a Claude id.
 */
export function pdcaModelError(field: string, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !CLAUDE_MODEL_ID_RE.test(raw.trim())) {
    return `${field} must be a Claude model id such as ${PDCA_DEFAULT_MODEL}.`
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
