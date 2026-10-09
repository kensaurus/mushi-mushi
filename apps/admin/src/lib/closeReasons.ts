/**
 * FILE: apps/admin/src/lib/closeReasons.ts
 * PURPOSE: Why a report is closed — one list for the report page, the row ×
 *          and the bulk bar, so every close path offers the same reasons.
 *
 * The reporter sees matching copy ("We couldn't reproduce it. Reply if it
 * happens again."); spam closes silently. Values are
 * `reports_closed_reason_check`. Missing info is not a close — use "Ask for
 * more info" in the Reporter view instead.
 */

export interface CloseReason {
  value: string
  label: string
  /** Needs the report grouped under its canonical one first (report page only). */
  needsGroup?: boolean
}

export const CLOSE_REASONS: readonly CloseReason[] = [
  { value: 'not_reproducible', label: "Couldn't reproduce it" },
  { value: 'wont_fix', label: "Won't fix" },
  { value: 'working_as_intended', label: 'Works as intended' },
  { value: 'duplicate', label: 'Same as another report', needsGroup: true },
  { value: 'spam', label: 'Spam (reporter is not told)' },
]

/** Reasons that need no per-report check, so a list or bulk close can offer them. */
export const QUICK_CLOSE_REASONS: readonly CloseReason[] = CLOSE_REASONS.filter((r) => !r.needsGroup)

/**
 * The message the reporter gets, word for word, for the confirm dialog
 * (server copy: `_shared/reporter-copy.ts` → `closedReason`).
 */
const REPORTER_SEES: Record<string, string> = {
  not_reproducible: "We couldn't reproduce it. Reply if it happens again.",
  wont_fix: 'We decided not to change this.',
  working_as_intended: 'This is expected behaviour.',
}

/** What closing tells the reporter(s), for the confirm dialog. */
export function closeReasonNotice(reason: string, count = 1): string {
  if (reason === 'spam') return count === 1 ? 'Closed as spam: the reporter is not told.' : 'Closed as spam: reporters are not told.'
  const who = count === 1 ? 'The reporter sees' : 'Each reporter sees'
  return `${who} “${REPORTER_SEES[reason] ?? 'Closed.'}”`
}
