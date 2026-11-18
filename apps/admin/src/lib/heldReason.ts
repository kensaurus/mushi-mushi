/**
 * FILE: apps/admin/src/lib/heldReason.ts
 * PURPOSE: Why a fix is held, as a short chip in plain words (2026-11-18): "key used up", not
 *          "(key_used_up)". The merge queue and the follow-up worker put a reason code inside
 *          free text ("The follow-up Cursor key cannot be used here (key_used_up)."), and a held
 *          row's detail is a whole sentence. This turns either into a two-or-three-word chip and
 *          keeps the sentence for the tooltip.
 *
 * Codes: the server's FOLLOWUP_REASONS keys (_shared/review-followup.ts) and the merge queue's
 * waits. An unknown code still reads: underscores become spaces.
 */

const CODE_WORDS: Record<string, string> = {
  key_used_up: 'key used up',
  no_cursor_key: 'no Cursor key',
  key_not_allowed: 'key not allowed',
  key_removed: 'key removed',
  platform_key: 'platform key only',
  daily_limit: 'daily limit reached',
  autofix_cap: 'auto-fix limit reached',
  autofix_off: 'auto-fix off',
  followups_off: 'follow-ups off',
  budget_unavailable: 'limits unreadable',
  models_unavailable: 'models unreadable',
  model_not_listed: 'model not listed',
  pr_unreadable: 'PR unreadable',
  pr_not_open: 'PR closed',
  no_pr: 'no PR',
  agent_busy: 'agent busy',
  cursor_error: 'Cursor error',
  cursor_unavailable: 'Cursor unavailable',
  review_pending: 'review pending',
  review_changed: 'reviewed again',
  ci_pending: 'CI running',
  ci_not_failing: 'CI not failing',
  ci_fails_on_base: 'base branch red',
  another_running: 'another follow-up running',
  already_followed_up: 'already followed up',
  max_followups: 'follow-ups used up',
  not_fix_first: 'review did not ask for fixes',
  head_moved: 'new commits',
  attempt_missing: 'fix gone',
  expired: 'waited too long',
}

/** A snake_case code in parentheses: "(key_used_up)". */
const CODE_IN_TEXT = /\s*\(([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\)/

/** Sentences the queue writes without a code, matched in order. */
const TEXT_REASONS: ReadonlyArray<[RegExp, string]> = [
  [/usage limit|used up/i, 'key used up'],
  [/merge conflict|conflicts with the base/i, 'merge conflict'],
  [/is red too/i, 'base branch red'],
  [/CI fails|CI failed|own CI is red/i, 'CI red'],
  [/behind/i, 'branch behind'],
  [/fix first|will not merge|\bhold\b/i, 'review says hold'],
]

/** @internal Plain words for a reason code; an unknown code reads with spaces for underscores (exported for tests). */
export function heldReasonLabel(code: string): string {
  return CODE_WORDS[code] ?? code.replace(/_+/g, ' ').trim()
}

/** The chip for a held row's detail (or a skipped reason), or null when it names no reason. */
export function heldReasonOf(detail: string | null | undefined): string | null {
  if (!detail) return null
  const code = CODE_IN_TEXT.exec(detail)?.[1]
  if (code) return heldReasonLabel(code)
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(detail.trim())) return heldReasonLabel(detail.trim())
  for (const [re, words] of TEXT_REASONS) if (re.test(detail)) return words
  return null
}

/** The sentence without its "(code)", for the tooltip and the row text. */
export function withoutReasonCode(detail: string): string {
  return detail.replace(CODE_IN_TEXT, '').trim()
}
