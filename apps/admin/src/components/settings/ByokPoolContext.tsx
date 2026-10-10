/**
 * FILE: apps/admin/src/components/settings/ByokPoolContext.tsx
 * PURPOSE: One copy of the saved-keys list per Settings page. The page banner,
 *          the tab badge, the AI keys tab and the Firecrawl / Browserbase
 *          tabs all read it, so a change on one tab shows everywhere at once
 *          and two places never show different key states.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { usePageData, type PageDataState } from '../../lib/usePageData'
import type { KeySharing, PoolKey } from './byokPool'
import type { LegacyKey } from './keyStatus'

export interface ByokPoolResponse {
  keys: PoolKey[]
  legacyKeys?: LegacyKey[]
  /** Null when the app is not in an organization. */
  sharing?: KeySharing | null
}

export type ByokPoolState = PageDataState<ByokPoolResponse>

const ByokPoolContext = createContext<ByokPoolState | null>(null)

/** Fetches the list once. Pass `enabled=false` when the plan has no own keys. */
export function ByokPoolProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const state = usePageData<ByokPoolResponse>(enabled ? '/v1/admin/byok/keys' : null)
  return <ByokPoolContext.Provider value={state}>{children}</ByokPoolContext.Provider>
}

/**
 * The shared list inside a provider; outside one (a panel rendered on its
 * own), the panel fetches its own copy.
 */
export function useByokPool(enabled: boolean): ByokPoolState {
  const shared = useContext(ByokPoolContext)
  const own = usePageData<ByokPoolResponse>(shared || !enabled ? null : '/v1/admin/byok/keys')
  return shared ?? own
}
