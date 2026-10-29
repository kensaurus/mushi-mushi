/**
 * Whether a PageStatus block (pattern P1) is on screen. A page that leads with
 * its status sentence does not also need a green "all good" banner above it:
 * Weekly insights, Editor agents and Scheduled tests showed both, saying the
 * same thing twice (console sweep, 2026-10-28). StatusBannerShell reads this
 * and leaves its ok-tone banner out while a PageStatus is mounted.
 *
 * The banner's button (Refresh, View catalog, …) must not go with it: the
 * hidden banner hands its action to the status block, which shows it beside
 * its own.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

type Listener = () => void

let mounted = 0
let handedAction: ReactNode = null
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getShown(): boolean {
  return mounted > 0
}

function getHandedAction(): ReactNode {
  return handedAction
}

export function usePageStatusShown(): boolean {
  return useSyncExternalStore(subscribe, getShown, getShown)
}

/** Call from PageStatus: counts the blocks on screen while it is mounted. */
export function usePublishPageStatus(): void {
  useEffect(() => {
    mounted += 1
    emit()
    return () => {
      mounted -= 1
      emit()
    }
  }, [])
}

/** Call from a banner that stepped aside: its action shows in the status block instead. */
export function useHandOffBannerAction(action: ReactNode, active: boolean): void {
  useEffect(() => {
    if (!active || action == null) return
    handedAction = action
    emit()
    return () => {
      if (handedAction === action) {
        handedAction = null
        emit()
      }
    }
  }, [action, active])
}

/** Call from PageStatus: the action of a banner that stepped aside for it, if any. */
export function useHandedBannerAction(): ReactNode {
  return useSyncExternalStore(subscribe, getHandedAction, getHandedAction)
}
