/**
 * FILE: apps/admin/src/lib/useTesterStatus.ts
 * PURPOSE: Lightweight hook that fetches the tester's balance + reputation
 * from /v1/me/tester-status. Cached in usePageData with a 30-second
 * revalidation window so the nav pill stays fresh without hammering the API.
 */
import { usePageData } from './usePageData'

export interface TesterStatus {
  isTester: boolean
  handle: string | null
  reputation: number
  balance: number
  totalEarned: number
  totalRedeemed: number
  acceptedSubmissions: number
  joinedApps: number
}

/** Tier thresholds (inclusive lower bound). */
export const REP_TIERS = [
  { name: 'Platinum', min: 200, color: 'text-cyan-300', bg: 'bg-cyan-500/15 border-cyan-500/30' },
  { name: 'Gold',     min: 75,  color: 'text-yellow-300', bg: 'bg-yellow-500/15 border-yellow-500/30' },
  { name: 'Silver',   min: 25,  color: 'text-slate-300',  bg: 'bg-slate-500/15 border-slate-500/30' },
  { name: 'Bronze',   min: 0,   color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30' },
] as const

export type TierName = typeof REP_TIERS[number]['name']

export function reputationTier(score: number): typeof REP_TIERS[number] {
  return REP_TIERS.find(t => score >= t.min) ?? REP_TIERS[REP_TIERS.length - 1]
}

export function useTesterStatus() {
  const result = usePageData<{ data: TesterStatus } | TesterStatus>('/v1/me/tester-status', { deps: [] })
  // Normalise: the endpoint now wraps in { ok, data } but old deploys returned flat JSON.
  const raw = result.data
  const data: TesterStatus | null = raw
    ? ('data' in raw && raw.data ? (raw as { data: TesterStatus }).data : raw as TesterStatus)
    : null
  return { ...result, data }
}
