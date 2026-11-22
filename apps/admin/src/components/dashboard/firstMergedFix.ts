/**
 * FILE: apps/admin/src/components/dashboard/firstMergedFix.ts
 * PURPOSE: When Home may say "Your first auto-fix was merged".
 *
 * The toast fired on any app with merges and a browser that had not seen it,
 * so an account with dozens of merged fixes was told about its "first" one
 * (UX review 2026-11-22). It now counts merges across every app the account
 * opens and fires only while that total is exactly 1, once per account: the
 * milestone key carries the user id, and useMilestoneCelebration stores it as
 * seen the moment it fires, so a dismissed toast never comes back.
 */

/**
 * The value to feed useMilestoneCelebration (threshold 1): 1 while the
 * account has exactly one merged fix, else 0, or null while the counts load.
 * Mapping every other total to 0 means a long-merged account never reaches
 * the threshold, and a live 0 → 1 still fires.
 */
export function firstMergedFixSignal(projects: ReadonlyArray<{ merged_fix_count?: number | null }> | null | undefined): 0 | 1 | null {
  if (!projects) return null
  const total = projects.reduce((sum, p) => sum + (typeof p.merged_fix_count === 'number' ? p.merged_fix_count : 0), 0)
  return total === 1 ? 1 : 0
}

/** One milestone per signed-in account; null until the user is known (no toast). */
export function firstMergedFixMilestone(userId: string | null | undefined): string | null {
  return userId ? `first-merged-fix:${userId}` : null
}
