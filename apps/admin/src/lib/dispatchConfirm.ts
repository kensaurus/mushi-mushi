import { humanizeApiError, type HumanizedApiError } from './humanizeApiError'

/**
 * Copy for the report-detail "Dispatch fix" confirm. One click used to spend
 * LLM budget and open a PR with no pause; the MCP tools already require the
 * agent to confirm first, so the console does too.
 */

/** `owner/repo` from a GitHub URL, else the URL without its scheme. */
export function shortRepoName(repoUrl: string): string {
  const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/i)
  return match?.[1] ?? repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

function lower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function storedCategory(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const c = (value as { category?: unknown }).category
  return typeof c === 'string' && c ? c : null
}

/**
 * Why the console must not dispatch a fix for this report, or null. Mirrors
 * `featureRequestDispatchBlock` in packages/server/supabase/functions/_shared/report-category.ts,
 * which the dispatch route, the shared dispatch helper and fix-worker enforce:
 * a reporter's feature request (user_category 'feature' or the widget's
 * user_intent 'Feature request') needs a human re-categorization first, seen
 * as a non-'other' category that differs from what the classifier stored.
 */
export function featureRequestDispatchBlock(report: {
  user_category?: unknown
  user_intent?: unknown
  category?: string | null
  stage1_classification?: unknown
  stage2_analysis?: unknown
  category_confirmed_at?: string | null
}): string | null {
  const isFeature =
    ['feature', 'feature request', 'feature_request'].includes(lower(report.user_category)) ||
    lower(report.user_intent) === 'feature request'
  if (!isFeature) return null
  if (report.category_confirmed_at && report.category && report.category !== 'other') return null
  const classifierCategory = storedCategory(report.stage2_analysis) ?? storedCategory(report.stage1_classification)
  if (report.category && report.category !== 'other' && report.category !== classifierCategory) return null
  return 'Feature request: set its Category in triage to dispatch a fix.'
}

export function dispatchConfirmBody(input: { repoUrl: string | null | undefined; baseBranch: string | null | undefined }): string {
  const repo = input.repoUrl ? shortRepoName(input.repoUrl) : 'the connected repo'
  const base = input.baseBranch ? `the ${input.baseBranch} branch` : 'its default branch'
  return (
    `The fix agent reads the code, drafts a change with your LLM budget, and opens a draft PR on ${repo} ` +
    `against ${base}. Nothing merges until you review it.`
  )
}

/**
 * Why a fix cannot be dispatched for this report right now, or null when it
 * can. The one gate every "Dispatch fix" / "Retry dispatch" control uses
 * (triage bar, recommendation card, /reports row): the recommendation card
 * used to call dispatch directly, skipping the confirm and this check.
 * `busy` (a dispatch already in flight) blocks without a reason to show.
 */
export function dispatchBlock(input: {
  report: Parameters<typeof featureRequestDispatchBlock>[0] & { status: string }
  preflight?: { loading: boolean; ready: boolean; failing: ReadonlyArray<{ label: string }> } | null
  busy?: boolean
}): { blocked: boolean; reason: string | null } {
  const { report, preflight, busy } = input
  if (report.status === 'fixed' || report.status === 'dismissed') {
    return { blocked: true, reason: `This report is ${report.status === 'fixed' ? 'fixed' : 'dismissed'}; reopen it to dispatch a fix.` }
  }
  const feature = featureRequestDispatchBlock(report)
  if (feature) return { blocked: true, reason: feature }
  if (preflight && !preflight.loading && !preflight.ready) {
    const missing = preflight.failing.map((c) => c.label).join(', ')
    return { blocked: true, reason: missing ? `Set up first: ${missing}.` : 'Finish the dispatch setup first.' }
  }
  if (busy) return { blocked: true, reason: null }
  return { blocked: false, reason: null }
}

/**
 * A failed POST /v1/admin/fixes/dispatch in plain English, through
 * humanizeApiError, with its fix action when there is one. Never shows the
 * error code (the chip used to read "AUTOFIX_DISABLED: Enable Autofix…").
 */
export function humanizeDispatchError(error: { code?: string; message?: string } | null | undefined): HumanizedApiError {
  return (
    humanizeApiError(error?.message || 'Request failed', error?.code ?? null, { action: 'queue the fix' }) ?? {
      title: 'Could not queue the fix.',
      hint: 'Try again in a moment.',
      severity: 'soft',
      raw: '',
    }
  )
}

/** One-line form of {@link humanizeDispatchError} for chips and toasts. */
export function dispatchErrorText(error: { code?: string; message?: string } | null | undefined): string {
  const h = humanizeDispatchError(error)
  return `${h.title} ${h.hint}`
}
