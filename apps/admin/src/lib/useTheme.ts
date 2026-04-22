/**
 * FILE: apps/admin/src/lib/useTheme.ts
 * PURPOSE: Light / dark theme preference, persisted in localStorage and
 *          applied via `data-theme` on <html>. Defaults to dark (the
 *          original design) with `system` as an opt-in that honours
 *          `prefers-color-scheme`.
 *
 *          Why light mode matters: the admin console is used in
 *          brightly-lit offices and outdoors (think: on-call rotations,
 *          café debugging, tablet triage). A `data-theme` attribute on
 *          <html> lets us layer token overrides in CSS without rewriting
 *          every component — `@theme` tokens in index.css stay dark
 *          (backwards-compat), and `html[data-theme="light"]` overrides
 *          them.
 */

import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'mushi:theme:v1'

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    // ignore
  }
  return 'dark'
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersLight() ? 'light' : 'dark'
  return theme
}

function applyToDom(theme: Theme) {
  if (typeof document === 'undefined') return
  const resolved = resolve(theme)
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
}

export function useTheme(): {
  theme: Theme
  resolved: ResolvedTheme
  setTheme: (t: Theme) => void
} {
  const [theme, setThemeState] = useState<Theme>(readInitial)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readInitial()))

  useEffect(() => {
    applyToDom(theme)
    setResolved(resolve(theme))
  }, [theme])

  // When `theme === 'system'`, react to OS-level changes without forcing
  // the user to reload. Otherwise the listener is a no-op.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      applyToDom('system')
      setResolved(resolve('system'))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const v = e.newValue as Theme | null
      if (v === 'dark' || v === 'light' || v === 'system') setThemeState(v)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // ignore
    }
    setThemeState(t)
  }, [])

  return { theme, resolved, setTheme }
}

/** Apply the saved theme to <html> as early as possible — called from
 *  main.tsx so the first paint already reflects the preference. */
export function hydrateTheme(): void {
  applyToDom(readInitial())
}
