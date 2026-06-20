/**
 * FILE: connectModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Connect hub page.
 */

import { useAdminMode } from './mode'

export interface ConnectUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideConnectSnapshot: boolean
  compactSnapshot: boolean
  hideSnapshotLinks: boolean
}

export function useConnectUx(): ConnectUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideConnectSnapshot: isQuickstart,
    compactSnapshot: isQuickstart || isBeginner,
    hideSnapshotLinks: !isAdvanced,
  }
}
