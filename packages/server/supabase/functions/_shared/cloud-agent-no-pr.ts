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
 *          Later the same day, runs that said "the live page is not blank",
 *          "needs a product decision" or "the event has no stack" still
 *          landed as API errors, so two more verdicts exist: not_actionable
 *          (no defect this evidence can tie to code) and needs_human (a
 *          decision or review only a person can make).
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
  | { category: 'not_actionable'; reason: string }
  | { category: 'needs_human'; reason: string }
  | { category: null; reason: string | null }

/**
 * Only the opening paragraph counts: agents state the verdict first, and later
 * sections ("What I ruled out") say "already fixed" about other causes. On
 * 2026-10-21 "I didn't find a confirmed root cause" was filed as already_fixed
 * because a ruled-out bullet said the old cause was "already fixed".
 */
const HEAD_CHARS = 600

const WRONG_REPO = [
  /\bnot in this (?:repository|repo|checkout)\b/i,
  /\bthis checkout is the (?:frontend|backend|client|server)\b/i,
  /\b(?:lives|belongs|is) in (?:the |another |a different )?(?:backend|frontend|server|other) repo/i,
]

const ALREADY_FIXED = [
  /\balready (?:fixed|gone|resolved|handled|in scope|defined|dropped|filtered|in the database)\b/i,
  /\bis already [^.]{0,60}\bon `?main`?/i,
  /\b(?:could not|couldn't|cannot|can't) reproduce\b/i,
  /\bnot reproducible\b/i,
  /\bis not happening on the current deploy\b/i,
  /\bnothing to (?:fix|change)\b/i,
  /\b(?:is|are) (?:loading|rendering|working) (?:correctly|fine|normally)\b/i,
  /\bcould not find a defect\b/i,
  /\bthe live [^.]{0,80}?\b(?:is not (?:stuck|blank|broken|empty|down)|renders|is rendering|is serving|serves)\b/i,
  /\brenders? (?:its|their) [^.]{0,60}\bon the live site\b/i,
]

/** Nothing in the evidence ties the report to code: a person should look at the source. */
const NOT_ACTIONABLE = [
  /\bno code change (?:that )?can be tied\b/i,
  /\b(?:payload|event|report) is too thin\b/i,
  /\bwith no stack\b/i,
  /\bdoes not say which\b/i,
  /\bcomes from [^.]{0,60}, not from this repo/i,
]

/** The agent stopped for a decision or review only a person can give. */
const NEEDS_HUMAN = [
  /\bneeds? (?:a |an )?(?:product|design|pricing|human|owner) (?:decision|call|review)\b/i,
  /\bneeds the owner'?s?\b/i,
  /\bneedsHumanReview\s*[=:]\s*true\b/i,
]

/** Sentences that only restate the outcome; the reason is the next one. */
const FILLER = /^(?:no pull request|i did not open a pull request|i did not open a pr|needsHumanReview\s*[=:]\s*true)\.?$/i

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

/** The first paragraph that is more than filler ("No pull request."), markdown stripped. */
function openingParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/`|\*\*/g, '').trim())
    .filter(Boolean)
  const isFillerOnly = (p: string) =>
    p
      .split(/(?<=[.!?])\s+/)
      .every((sentence) => FILLER.test(sentence.trim()))
  return paragraphs.find((p) => !isFillerOnly(p)) ?? paragraphs[0] ?? ''
}

export function classifyNoPrSummary(summary: string | null | undefined): NoPrVerdict {
  const text = (summary ?? '').trim()
  if (!text) return { category: null, reason: null }
  const head = openingParagraph(text).slice(0, HEAD_CHARS)
  const reason = firstSentence(text)
  if (WRONG_REPO.some((re) => re.test(head))) return { category: 'wrong_repo', reason }
  if (ALREADY_FIXED.some((re) => re.test(head))) return { category: 'already_fixed', reason }
  if (NOT_ACTIONABLE.some((re) => re.test(head))) return { category: 'not_actionable', reason }
  if (NEEDS_HUMAN.some((re) => re.test(head))) return { category: 'needs_human', reason }
  return { category: null, reason }
}

/** The error line stored on the attempt and the dispatch job. */
export function noPrErrorText(verdict: NoPrVerdict): string {
  if (verdict.category === 'already_fixed') return `Agent found nothing to change: ${verdict.reason}`
  if (verdict.category === 'wrong_repo') return `Agent says the code is in another repo: ${verdict.reason}`
  if (verdict.category === 'not_actionable') return `Agent found nothing it can tie to code: ${verdict.reason}`
  if (verdict.category === 'needs_human') return `Agent says this needs a person: ${verdict.reason}`
  if (verdict.reason) return `Cloud agent finished without opening a pull request. Its notes: ${verdict.reason}`
  return 'Cloud agent finished without opening a pull request.'
}
