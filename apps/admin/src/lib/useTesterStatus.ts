/**
 * FILE: apps/admin/src/lib/useTesterStatus.ts
 * PURPOSE: Lightweight hook that fetches the tester's balance + reputation
 * from /v1/me/tester-status. Cached in usePageData with a 30-second
 * revalidation window so the nav pill stays fresh without hammering the API.
 */
import { useCallback } from 'react'
import { usePageData } from './usePageData'
import { apiFetch } from './supabase'
import { TESTER_API_OPTS } from './tester-page-data'

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
  { name: 'Platinum', min: 200, color: 'text-info-foreground', bg: 'bg-info-muted border-info/30' },
  { name: 'Gold',     min: 75,  color: 'text-warning-foreground', bg: 'bg-warn-muted border-warn/30' },
  { name: 'Silver',   min: 25,  color: 'text-fg-secondary', bg: 'bg-surface-overlay border-edge' },
  { name: 'Bronze',   min: 0,   color: 'text-brand', bg: 'bg-brand-subtle border-brand/30' },
] as const

export type TierName = typeof REP_TIERS[number]['name']

export function reputationTier(score: number): typeof REP_TIERS[number] {
  return REP_TIERS.find(t => score >= t.min) ?? REP_TIERS[REP_TIERS.length - 1]
}

const EMPTY_STATUS: TesterStatus = {
  isTester: false,
  handle: null,
  reputation: 0,
  balance: 0,
  totalEarned: 0,
  totalRedeemed: 0,
  acceptedSubmissions: 0,
  joinedApps: 0,
}

/** Normalise legacy `{ is_tester }` and `{ ok, data }` API shapes. */
function normalizeTesterStatus(raw: unknown): TesterStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.data && typeof obj.data === 'object') {
    return { ...EMPTY_STATUS, ...(obj.data as TesterStatus) }
  }
  if ('isTester' in obj) {
    return { ...EMPTY_STATUS, ...(obj as unknown as TesterStatus) }
  }
  if ('is_tester' in obj) {
    const tester = obj.tester as { public_handle?: string | null; display_name?: string | null } | null
    return {
      ...EMPTY_STATUS,
      isTester: obj.is_tester === true,
      handle: tester?.public_handle ?? tester?.display_name ?? null,
    }
  }
  return null
}

export function useTesterStatus() {
  const result = usePageData<{ data: TesterStatus } | TesterStatus>('/v1/me/tester-status', {
    deps: [],
    ...TESTER_API_OPTS,
  })
  // Normalise: the endpoint now wraps in { ok, data } but old deploys returned flat JSON.
  const raw = result.data
  const data = normalizeTesterStatus(raw)

  const enroll = useCallback(async (opts?: { marketingOptIn?: boolean; acceptedTerms?: boolean }) => {
    const res = await apiFetch<{ enrolled: boolean; created: boolean }>('/v1/tester/enroll', {
      method: 'POST',
      scope: 'none',
      body: JSON.stringify({
        marketingOptIn: opts?.marketingOptIn === true,
        acceptedTerms: opts?.acceptedTerms === true,
      }),
    })
    return res.ok
  }, [])

  return { ...result, data, enroll }
}
