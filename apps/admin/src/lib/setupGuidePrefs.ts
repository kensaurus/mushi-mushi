/**
 * FILE: apps/admin/src/lib/setupGuidePrefs.ts
 * PURPOSE: Persisted view state for the docked <SetupGuide>. The guide is the
 *          only setup surface that follows the user across every route, so its
 *          "get out of my way" choice has to survive navigation and reloads —
 *          otherwise a dismissed panel reappears on the next click and the
 *          helper becomes the nag.
 *
 *          Three states, one key:
 *            - 'expanded'  — panel open
 *            - 'minimized' — docked pill only (progress still visible)
 *            - 'dismissed' — nothing rendered until the user asks for it back
 *
 *          `null` means "the user has never chosen"; the component picks the
 *          opening state from setup progress in that case (see
 *          resolveSetupGuideView). Once the user touches any control we store
 *          the choice and stop deciding for them.
 *
 *          Mirrors sidebarCollapsed.ts (localStorage + `mushi:*` key) and
 *          FirstRunTour.tsx (CustomEvent so a second mount / another tab and
 *          the "Show setup guide" button on /onboarding stay in sync).
 */

import { useCallback, useEffect, useState } from 'react'

export type SetupGuideView = 'expanded' | 'minimized' | 'dismissed'

/** No stored value yet — the component decides from setup progress. */
export type StoredSetupGuideView = SetupGuideView | null

const KEY = 'mushi:setupGuide:v1'
const EVENT = 'mushi:setup-guide-state'

function isView(value: unknown): value is SetupGuideView {
  return value === 'expanded' || value === 'minimized' || value === 'dismissed'
}

export function readSetupGuideView(): StoredSetupGuideView {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return isView(raw) ? raw : null
  } catch {
    // Private-mode / blocked storage: behave like a first-time visitor
    // rather than throwing inside a render.
    return null
  }
}

export function writeSetupGuideView(next: SetupGuideView) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    /* storage unavailable — the in-memory state below still applies */
  }
  window.dispatchEvent(new CustomEvent<SetupGuideView>(EVENT, { detail: next }))
}

/**
 * Public re-entry point for a guide the user dismissed. Called from the
 * /onboarding footer today; a header or sidebar entry can call the same
 * function without importing the component.
 */
export function openSetupGuide() {
  writeSetupGuideView('expanded')
}

/**
 * Routes whose page content IS the setup wizard. Only /onboarding qualifies:
 * an open dock on top of it shows the same list twice on one screen.
 *
 * /dashboard is deliberately absent. A user who just created a project lands
 * there (DashboardPage redirects the project-less case to /onboarding), so
 * suppressing it would mean the guide never opens on its own for the person
 * it exists for.
 */
const AUTO_EXPAND_SUPPRESSED_ROUTES = ['/onboarding']

export function shouldSuppressAutoExpand(pathname: string): boolean {
  return AUTO_EXPAND_SUPPRESSED_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

/**
 * Resolve the state to render from the stored choice plus live progress.
 *
 * An explicit choice from the user always wins; `suppressAutoExpand` only
 * blocks the *automatic* open.
 */
export function resolveSetupGuideView(
  stored: StoredSetupGuideView,
  opts: { requiredComplete: boolean; suppressAutoExpand: boolean },
): SetupGuideView {
  if (stored) return stored
  if (opts.suppressAutoExpand) return 'minimized'
  return opts.requiredComplete ? 'minimized' : 'expanded'
}

export function useSetupGuideView(): [
  StoredSetupGuideView,
  (next: SetupGuideView) => void,
] {
  const [stored, setStored] = useState<StoredSetupGuideView>(readSetupGuideView)

  useEffect(() => {
    function onState(e: Event) {
      const detail = (e as CustomEvent<SetupGuideView>).detail
      if (isView(detail)) setStored(detail)
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== KEY) return
      setStored(isView(e.newValue) ? e.newValue : null)
    }
    window.addEventListener(EVENT, onState)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT, onState)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const set = useCallback((next: SetupGuideView) => {
    setStored(next)
    writeSetupGuideView(next)
  }, [])

  return [stored, set]
}
