/**
 * FILE: apps/admin/src/lib/activeOrg.ts
 * PURPOSE: Single source of truth for the active organization/team context.
 */

import { useSyncExternalStore } from 'react'

export const ACTIVE_ORG_STORAGE_KEY = 'mushi:active_org_id'
export const ACTIVE_ORG_QUERY_PARAM = 'org'

const ACTIVE_ORG_EVENT = 'mushi:active-org-change'
const SERVER_SNAPSHOT = '__server__'

function readStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)
  } catch {
    return null
  }
}

export function getActiveOrgIdSnapshot(): string | null {
  return readStorage()
}

export function setActiveOrgIdSnapshot(orgId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId)
  } catch {
    // Storage-disabled environments still get the URL param.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_ORG_EVENT, { detail: { orgId } }))
}

export function subscribeActiveOrg(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onActiveOrg = () => listener()
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_ORG_STORAGE_KEY) listener()
  }
  window.addEventListener(ACTIVE_ORG_EVENT, onActiveOrg)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(ACTIVE_ORG_EVENT, onActiveOrg)
    window.removeEventListener('storage', onStorage)
  }
}

export function useActiveOrgSignal(): string {
  return useSyncExternalStore(
    subscribeActiveOrg,
    () => getActiveOrgIdSnapshot() ?? '',
    () => SERVER_SNAPSHOT,
  )
}
