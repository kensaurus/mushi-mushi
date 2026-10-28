/**
 * Whether a PageStatus block (pattern P1) is on screen. A page that leads with
 * its status sentence does not also need a green "all good" banner above it:
 * Weekly insights, Editor agents and Scheduled tests showed both, saying the
 * same thing twice (console sweep, 2026-10-28). StatusBannerShell reads this
 * and leaves its ok-tone banner out while a PageStatus is mounted.
 */

import { useEffect, useSyncExternalStore } from 'react'

type Listener = () => void

let mounted = 0
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return mounted > 0
}

export function usePageStatusShown(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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
