/**
 * Copy for the report-detail "Dispatch fix" confirm. One click used to spend
 * LLM budget and open a PR with no pause; the MCP tools already require the
 * agent to confirm first, so the console does too.
 */

/** `owner/repo` from a GitHub URL, else the URL without its scheme. */
function shortRepoName(repoUrl: string): string {
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
}): string | null {
  const isFeature =
    ['feature', 'feature request', 'feature_request'].includes(lower(report.user_category)) ||
    lower(report.user_intent) === 'feature request'
  if (!isFeature) return null
  const classifierCategory = storedCategory(report.stage2_analysis) ?? storedCategory(report.stage1_classification)
  if (report.category && report.category !== 'other' && report.category !== classifierCategory) return null
  return 'Feature request: set Category to the bug type first to dispatch a fix.'
}

export function dispatchConfirmBody(input: { repoUrl: string | null | undefined; baseBranch: string | null | undefined }): string {
  const repo = input.repoUrl ? shortRepoName(input.repoUrl) : 'the connected repo'
  const base = input.baseBranch ? `the ${input.baseBranch} branch` : 'its default branch'
  return (
    `The fix agent reads the code, drafts a change with your LLM budget, and opens a draft PR on ${repo} ` +
    `against ${base}. Nothing merges until you review it.`
  )
}
