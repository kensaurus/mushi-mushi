/**
 * FILE: packages/server/supabase/functions/_shared/cloud-agent-no-pr.ts
 * PURPOSE: Read why a cloud agent finished without opening a pull request.
 *
 *          On 2026-10-20 six of eight Cursor runs on the dogfood apps ended
 *          with no PR. Every one explained itself in its final message: three
 *          bugs were already fixed on main, one did not reproduce on the live
 *          site, and two lived in the project's other repo. Mushi filed all
 *          six as `cursor_api_error` with "Cloud agent finished without
 *          opening a pull request.", so the console offered Retry, which
 *          would spend the same credits to reach the same answer.
 *
 *          The agent's summary is model output, so this only matches a few
 *          plain phrases near the start and falls back to "no verdict". A
 *          wrong "already fixed" would hide a live bug, so the patterns stay
 *          narrow and the full summary is always kept on the attempt.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export type NoPrVerdict =
  | { category: 'already_fixed'; reason: string }
  | { category: 'wrong_repo'; reason: string }
  | { category: null; reason: string | null }

/** Only the opening of the summary counts: agents state the verdict first. */
const HEAD_CHARS = 600

const WRONG_REPO = [
  /\bnot in this (?:repository|repo|checkout)\b/i,
  /\bthis checkout is the (?:frontend|backend|client|server)\b/i,
  /\b(?:lives|belongs|is) in (?:the |another |a different )?(?:backend|frontend|server|other) repo/i,
]

const ALREADY_FIXED = [
  /\balready (?:fixed|gone|resolved|handled|in scope)\b/i,
  /\bis already [^.]{0,60}\bon `?main`?/i,
  /\b(?:could not|couldn't|cannot|can't) reproduce\b/i,
  /\bnot reproducible\b/i,
  /\bis not happening on the current deploy\b/i,
  /\bnothing to (?:fix|change)\b/i,
  /\b(?:is|are) (?:loading|rendering|working) (?:correctly|fine|normally)\b/i,
  /\bcould not find a defect\b/i,
]

/** Sentences that only restate the outcome; the reason is the next one. */
const FILLER = /^(?:no pull request|i did not open a pull request|i did not open a pr)\.?$/i

/**
 * First sentence of the summary that says something, markdown backticks
 * stripped, for a one-line reason ("No pull request." is skipped).
 */
export function firstSentence(summary: string, max = 240): string {
  let flat = summary.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  let sentence = flat
  for (let i = 0; i < 3 && flat; i++) {
    const end = flat.search(/[.!?](?:\s|$)/)
    sentence = end === -1 ? flat : flat.slice(0, end + 1)
    if (!FILLER.test(sentence.trim())) break
    flat = flat.slice(sentence.length).trim()
  }
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
}

export function classifyNoPrSummary(summary: string | null | undefined): NoPrVerdict {
  const text = (summary ?? '').trim()
  if (!text) return { category: null, reason: null }
  const head = text.slice(0, HEAD_CHARS)
  const reason = firstSentence(text)
  if (WRONG_REPO.some((re) => re.test(head))) return { category: 'wrong_repo', reason }
  if (ALREADY_FIXED.some((re) => re.test(head))) return { category: 'already_fixed', reason }
  return { category: null, reason }
}

/** The error line stored on the attempt and the dispatch job. */
export function noPrErrorText(verdict: NoPrVerdict): string {
  if (verdict.category === 'already_fixed') return `Agent found nothing to change: ${verdict.reason}`
  if (verdict.category === 'wrong_repo') return `Agent says the code is in another repo: ${verdict.reason}`
  if (verdict.reason) return `Cloud agent finished without opening a pull request. Its notes: ${verdict.reason}`
  return 'Cloud agent finished without opening a pull request.'
}
