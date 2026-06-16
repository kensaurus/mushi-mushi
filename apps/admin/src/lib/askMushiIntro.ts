/**
 * FILE: apps/admin/src/lib/askMushiIntro.ts
 * PURPOSE: Persist whether the user has discovered Ask Mushi (controls header glow).
 */

const STORAGE_KEY = 'mushi:ask-mushi-intro-seen:v1'
const EVENT = 'mushi:ask-mushi-intro'

export function isAskMushiIntroSeen(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export function markAskMushiIntroSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
    window.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    /* private mode — non-fatal */
  }
}

export function subscribeAskMushiIntro(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
