/**
 * Pages publish when PagePosture renders a visible status slot (priority 0).
 * Layout uses this to skip duplicate PageHero / NextBestAction chrome.
 */

import { useEffect, useSyncExternalStore } from 'react'

type Listener = () => void

let hasStatusBanner = false
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return hasStatusBanner
}

export function publishPostureHasStatusBanner(value: boolean): void {
  if (hasStatusBanner === value) return
  hasStatusBanner = value
  emit()
}

export function usePostureHasStatusBanner(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Call from PagePosture when a status slot (priority ≤ POSTURE_PRIORITY.status) is visible. */
export function usePublishPostureHasStatusBanner(active: boolean): void {
  useEffect(() => {
    publishPostureHasStatusBanner(active)
    return () => publishPostureHasStatusBanner(false)
  }, [active])
}
