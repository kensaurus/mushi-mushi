/**
 * FILE: packages/server/supabase/functions/_shared/rewards-admin.ts
 * PURPOSE: Pure decisions for the admin Rewards routes (api/routes/rewards.ts),
 *          kept free of Deno and network imports so they are unit-testable.
 */

/** Why a caller may not change the rewards program, or null when they may. */
export type RewardsWriteDenial =
  | { status: 403; code: 'FORBIDDEN'; message: string }
  | { status: 402; code: 'FEATURE_NOT_IN_PLAN'; message: string }

/**
 * Viewers and members can read rewards; only owners and admins change them
 * (they reach every reporter). Every write also needs a
 * plan that includes `rewards_program` (the same flag the console's
 * `has('rewards_program')` reads, so the UI and the server agree).
 */
export function rewardsWriteDenial(role: string | null | undefined, planHasRewards: boolean): RewardsWriteDenial | null {
  if (!role || role === 'viewer') {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'Viewers can see the rewards program but not change it. Ask a team owner or admin to make the change.',
    }
  }
  if (role !== 'owner' && role !== 'admin') {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'Only team owners and admins can change rewards. Ask one of them to make the change or raise your role.',
    }
  }
  if (!planHasRewards) {
    return {
      status: 402,
      code: 'FEATURE_NOT_IN_PLAN',
      message: 'Changing rewards needs the Starter plan or higher. Your team can still view the program.',
    }
  }
  return null
}

/**
 * One readable sentence from zod issues, e.g.
 * `Steps 0 action: String must contain at least 1 character(s)`, so a 422
 * carries a `message` instead of only a code (the console showed the code).
 */
export function plainIssues(
  prefix: string,
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  const parts = issues.slice(0, 3).map((i) => {
    const path = i.path.map(String).join(' ').replace(/_/g, ' ').trim()
    return path ? `${path}: ${i.message}` : i.message
  })
  return parts.length > 0 ? `${prefix} ${parts.join('; ')}.` : prefix
}

/**
 * Contributor search text that is safe inside a PostgREST `.or()` filter.
 * `,` `(` `)` `"` `\` `:` split or break the filter, and `%` `*` `_` are
 * wildcards, so they are replaced with spaces (search stays a plain
 * substring match on the remaining words). Capped at 64 characters.
 */
export function leaderboardSearchTerm(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[,()"\\:%*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 64)
}
