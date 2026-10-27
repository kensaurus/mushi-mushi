/**
 * FILE: apps/admin/src/components/settings/fixBranchField.ts
 * PURPOSE: The "Fix branch names" field's error and whether it blocks Save
 *          (report f66ae5d0).
 *
 *          The branch rule tightened, and four projects still store the old
 *          pattern `mushi/fix/{date}-{category}-{shortId}`. The field showed
 *          no error, yet Save stayed disabled with the reason in the sticky
 *          bar, so nobody could save a Sentry DSN or Slack channel without
 *          editing an unrelated field. The fix worker meanwhile falls back to
 *          the default pattern.
 *
 *          Now an invalid saved pattern is flagged on the field as soon as the
 *          page loads, saying what fixes use instead, and it never blocks
 *          saving other fields: a save only sends changed fields, and the
 *          server checks the pattern only when it is sent. Save is blocked
 *          only when the user edits the pattern into one that breaks the rule.
 */

import { fixBranchTemplate } from '../../lib/validators'

interface FixBranchFieldState {
  /** The message under the field, or null when the pattern is fine. */
  error: string | null
  /** True only when the user changed the pattern to one the server refuses. */
  blocksSave: boolean
}

export function fixBranchFieldState(input: {
  current: string | null | undefined
  saved: string | null | undefined
  defaultValue: string
}): FixBranchFieldState {
  const current = (input.current ?? '').trim() || input.defaultValue
  const saved = (input.saved ?? '').trim() || input.defaultValue
  const problem = fixBranchTemplate()(current)
  if (!problem) return { error: null, blocksSave: false }
  if (current === saved) {
    return {
      error: `Your saved pattern is no longer allowed, so fixes use ${input.defaultValue}. Choose "Reset to default" or edit it. Other settings still save.`,
      blocksSave: false,
    }
  }
  return { error: problem.message, blocksSave: true }
}
