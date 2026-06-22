/**
 * FILE: UsersStatsTypes.ts
 * PURPOSE: Super-admin operator metrics slice for UsersReadout and /users page hero.
 */

export interface UsersStats {
  total_users: number
  paid_users: number
  mrr_usd: number
  signups_last_7d: number
  signups_last_30d: number
  churn_last_30d: number
}

export const EMPTY_USERS_STATS: UsersStats = {
  total_users: 0,
  paid_users: 0,
  mrr_usd: 0,
  signups_last_7d: 0,
  signups_last_30d: 0,
  churn_last_30d: 0,
}
