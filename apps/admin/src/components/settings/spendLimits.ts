/**
 * FILE: apps/admin/src/components/settings/spendLimits.ts
 * PURPOSE: Labels, help and parsing for Settings → General → Spend limits.
 *          The server validates the same rules in PATCH /v1/admin/settings
 *          (packages/server/supabase/functions/_shared/autofix-budget.ts).
 */

export type SpendLimitField =
  | 'autofix_max_spend_usd'
  | 'autofix_max_dispatches_per_day'
  | 'autofix_approval_cost_threshold_usd'
  | 'monthly_llm_budget_usd'

export interface SpendLimitMeta {
  field: SpendLimitField
  label: string
  /** Plain-English explanation shown under the field. */
  help: string
  unit: 'usd' | 'count'
  placeholder: string
}

export const SPEND_LIMITS: readonly SpendLimitMeta[] = [
  {
    field: 'monthly_llm_budget_usd',
    label: 'Monthly AI budget ($)',
    help:
      "All of this project's AI calls (triage, fixes, chat) stop once this calendar month's spend reaches it, and start again on the 1st. Calls on your own keys count too. Leave empty for no budget.",
    unit: 'usd',
    placeholder: 'No budget',
  },
  {
    field: 'autofix_max_spend_usd',
    label: 'Auto-fix spend limit, last 30 days ($)',
    help:
      'Mushi stops starting fixes on its own once its fixes have cost this much in the last 30 days. Fixes you start yourself still run. Leave empty for no limit.',
    unit: 'usd',
    placeholder: 'No limit',
  },
  {
    field: 'autofix_max_dispatches_per_day',
    label: 'Automatic fixes per day',
    help:
      'How many fixes Mushi may start on its own each day (UTC). Fixes you start yourself do not count. Leave empty for no limit.',
    unit: 'count',
    placeholder: 'No limit',
  },
  {
    field: 'autofix_approval_cost_threshold_usd',
    label: 'Ask me before fixes that may cost more than ($)',
    help:
      'A high or critical fix estimated above this amount waits for your approval before Mushi opens a pull request. This applies to every fix, including ones you start. Leave empty to never ask.',
    unit: 'usd',
    placeholder: 'Never ask',
  },
] as const

export type SpendLimitValues = Partial<Record<SpendLimitField, number | null>>

/** The text an input shows for a saved value. */
export function formatLimit(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

/**
 * Parse what the user typed. Empty means "no limit".
 * @internal Exported for unit tests only.
 */
export function parseLimit(
  meta: Pick<SpendLimitMeta, 'unit'>,
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const text = raw.trim().replace(/^\$/, '')
  if (text === '') return { ok: true, value: null }
  const n = Number(text)
  if (!Number.isFinite(n)) return { ok: false, message: 'Enter a number, or leave it empty.' }
  if (meta.unit === 'count') {
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return { ok: false, message: 'Enter a whole number from 1 to 1000, or leave it empty.' }
    }
    return { ok: true, value: n }
  }
  if (n <= 0 || n > 100_000) {
    return { ok: false, message: 'Enter an amount above $0 and at most $100,000, or leave it empty.' }
  }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/**
 * The PATCH body for the fields that changed, or the per-field errors when
 * any input is invalid (nothing is sent then).
 */
export function buildLimitsPatch(
  drafts: Partial<Record<SpendLimitField, string>>,
  saved: SpendLimitValues,
): { patch: SpendLimitValues; errors: Partial<Record<SpendLimitField, string>> } {
  const patch: SpendLimitValues = {}
  const errors: Partial<Record<SpendLimitField, string>> = {}
  for (const meta of SPEND_LIMITS) {
    const raw = drafts[meta.field]
    if (raw === undefined) continue
    const parsed = parseLimit(meta, raw)
    if (!parsed.ok) {
      errors[meta.field] = parsed.message
      continue
    }
    if (parsed.value !== (saved[meta.field] ?? null)) patch[meta.field] = parsed.value
  }
  return Object.keys(errors).length > 0 ? { patch: {}, errors } : { patch, errors }
}
