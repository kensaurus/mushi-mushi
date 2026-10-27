/**
 * FILE: apps/admin/src/lib/closeReasons.ts
 * PURPOSE: Why a report is closed — one list for the report page, the row ×
 *          and the bulk bar, so every close path offers the same reasons.
 *
 * The reporter sees matching copy ("We couldn't reproduce it. Reply if it
 * happens again."); spam and a false alarm close silently. A false alarm is
 * offered only when Mushi's own check filed the report. Values are
 * `reports_closed_reason_check`. Missing info is not a close — use "Ask for
 * more info" in the Reporter view instead.
 */

export interface CloseReason {
  value: string
  label: string
  /** Needs the report grouped under its canonical one first (report page only). */
  needsGroup?: boolean
  /** Only when Mushi's own check filed the report. There is no human reporter. */
  ownCheck?: boolean
}

/** `reports.source` values Mushi files itself. Same set the API accepts. */
const MUSHI_CHECK_SOURCES = new Set<string>(['site_audit', 'site_watch', 'security_advisory'])

function isMushiCheckSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && MUSHI_CHECK_SOURCES.has(source)
}

const CLOSE_REASONS: readonly CloseReason[] = [
  { value: 'not_reproducible', label: "Couldn't reproduce it" },
  { value: 'wont_fix', label: "Won't fix" },
  { value: 'working_as_intended', label: 'Works as intended' },
  { value: 'duplicate', label: 'Same as another report', needsGroup: true },
  { value: 'spam', label: 'Spam (reporter is not told)' },
  { value: 'false_alarm', label: "False alarm (Mushi's check was wrong)", ownCheck: true },
]

/** Reasons a list or bulk close can offer without looking at each report. */
export const QUICK_CLOSE_REASONS: readonly CloseReason[] = CLOSE_REASONS.filter((r) => !r.needsGroup && !r.ownCheck)

/** Reasons the close picker may offer for a report from `source`. */
export function closeReasonsFor(source: string | null | undefined): readonly CloseReason[] {
  return isMushiCheckSource(source) ? CLOSE_REASONS : CLOSE_REASONS.filter((r) => !r.ownCheck)
}

/**
 * The message the reporter gets, word for word, for the confirm dialog
 * (server copy: `_shared/reporter-copy.ts` → `closedReason`).
 */
const REPORTER_SEES: Record<string, string> = {
  not_reproducible: "We couldn't reproduce it. Reply if it happens again.",
  wont_fix: 'We decided not to change this.',
  working_as_intended: 'This is expected behaviour.',
}

/**
 * Close reasons that also archive the report's open Sentry issues (until they
 * escalate). Mirrors ARCHIVE_ON_CLOSE in
 * packages/server/supabase/functions/_shared/sentry-resolve-back.ts.
 */
const ARCHIVES_IN_SENTRY = new Set(['working_as_intended', 'wont_fix'])

/**
 * What closing does to the linked Sentry issue, for a report imported from
 * Sentry. "Couldn't reproduce" leaves the issue open on purpose (the error
 * may still be happening), which surprised owners who expected Sentry to
 * clear; saying so lets them pick "Works as intended" for noise.
 */
export function closeReasonSentryNotice(reason: string): string {
  return ARCHIVES_IN_SENTRY.has(reason)
    ? 'Sentry: the linked issue is archived until it gets worse.'
    : 'Sentry: the linked issue stays open. Pick "Works as intended" or "Won\'t fix" to archive it there too.'
}

/** What closing tells the reporter(s), for the confirm dialog. */
export function closeReasonNotice(reason: string, count = 1): string {
  if (reason === 'spam') return count === 1 ? 'Closed as spam: the reporter is not told.' : 'Closed as spam: reporters are not told.'
  if (reason === 'false_alarm') return "Closed as a false alarm: nobody is told. Mushi's check was wrong."
  const who = count === 1 ? 'The reporter sees' : 'Each reporter sees'
  return `${who} “${REPORTER_SEES[reason] ?? 'Closed.'}”`
}
