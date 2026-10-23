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
 *          On 2026-10-23, 32 of the 41 no-PR runs still read as no verdict:
 *          backlog rows (BL-…) that wait on the owner, said in many ways
 *          ("stays open", "still needs you", "owner’s" with a curly quote).
 *          Spend-down would re-run each one after its 7-day cooldown. So the
 *          prompt now asks for a first line `Mushi verdict: <category>`
 *          (buildCloudAgentPrompt), read before any phrase, and a backlog row
 *          the agent left unchanged reads as needs_human.
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

export const NO_PR_CATEGORIES = ['already_fixed', 'wrong_repo', 'not_actionable', 'needs_human'] as const

/** `Mushi verdict: needs_human` on one of the first lines (markdown and backticks allowed). */
const VERDICT_LINE = /^[\s>*_#-]*mushi verdict[*_]*\s*[:：][\s*_`]*(already_fixed|wrong_repo|not_actionable|needs_human)\b[*_`]*[ \t]*[.:—–-]?[ \t]*/im

const WRONG_REPO = [
  /\bnot in this (?:frontend |backend |client |server )?(?:repository|repo|checkout)\b/i,
  /\bthis (?:[\w-]+ )?checkout cannot (?:read|change)\b/i,
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
  /\bthe live [^.]{0,80}?\b(?:is not (?:stuck|blank|broken|empty|down|showing)|renders|is rendering|is serving|serves)\b/i,
  /\brenders? (?:its|their) [^.]{0,60}\bon the live site\b/i,
  /\brenders? (?:its|their) (?:main )?content again\b/i,
]

/** Nothing in the evidence ties the report to code: a person should look at the source. */
const NOT_ACTIONABLE = [
  /\bno code change (?:that )?(?:can be tied|would fix)\b/i,
  /\b(?:payload|event|report) is too thin\b/i,
  /\bwith no stack\b/i,
  /\bdoes not say which\b/i,
  /\bcomes from [^.]{0,60}, not from this repo/i,
]

/** The agent stopped for a decision or review only a person can give. */
const NEEDS_HUMAN = [
  /\bneeds? (?:a |an )?(?:(?:product|design|pricing|human|owner) ){1,2}(?:decision|call|review|sign-?off)\b/i,
  /\b(?:needs?|requires?) (?:the |an? )?(?:brand )?owner(?:['’]s)?\b/i,
  /\b(?:is|are) an? (?:owner|product|human) (?:decision|call)\b/i,
  /\bneeds? (?:you|your)\b/i,
  /\bstays with the owner\b/i,
  /\bwait for the next (?:store )?(?:release|build|version)\b/i,
  /\bneedsHumanReview\s*[=:]\s*true\b/i,
]

/**
 * A backlog row (BL-…) the agent left as it was: whatever it waits on (a
 * device, an account, a decision), the run cannot close it. Both parts must
 * be in the opening, so a code fix that mentions a BL row is not caught.
 */
const BACKLOG_ROW = /\bBL-\d+\b/
const LEFT_UNCHANGED =
  /\b(?:changed nothing|nothing (?:in the repo )?was changed|left (?:the code|it|[\w-]+)(?: and docs)? unchanged|(?:stays|remains|is still) (?:open|deferred))\b/i

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
  let text = (summary ?? '').trim()
  if (!text) return { category: null, reason: null }
  const declared = VERDICT_LINE.exec(text.slice(0, 200))
  if (declared) {
    text = text.slice(0, declared.index) + text.slice(declared.index + declared[0].length)
    const rest = text.trim()
    return { category: declared[1].toLowerCase() as (typeof NO_PR_CATEGORIES)[number], reason: rest ? firstSentence(rest) : declared[1] }
  }
  const head = openingParagraph(text).slice(0, HEAD_CHARS)
  const reason = firstSentence(text)
  if (WRONG_REPO.some((re) => re.test(head))) return { category: 'wrong_repo', reason }
  if (ALREADY_FIXED.some((re) => re.test(head))) return { category: 'already_fixed', reason }
  if (NOT_ACTIONABLE.some((re) => re.test(head))) return { category: 'not_actionable', reason }
  if (NEEDS_HUMAN.some((re) => re.test(head))) return { category: 'needs_human', reason }
  if (BACKLOG_ROW.test(head) && LEFT_UNCHANGED.test(head)) return { category: 'needs_human', reason }
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
