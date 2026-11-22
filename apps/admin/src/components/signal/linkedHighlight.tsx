/**
 * FILE: apps/admin/src/components/signal/linkedHighlight.tsx
 * PURPOSE: Linked highlighting for any console page (2026-11-18, generalised from the CI page's
 *          ciHighlight; the owner: "hover and click should show more effect… make it easy to
 *          understand the informational flow").
 *
 * Every row that stands for a thing (an app, a job, a stage, an integration) carries string
 * keys. Pointing at one lights every row with a shared key, in every panel, and dims the rest;
 * clicking pins it until clicked again or Escape. Outside a provider the hook is a no-op, so
 * components still work on their own (tests, pages that don't opt in).
 *
 * Styling lives in styles/components.css (`.ci-lk[data-hl]`): an accent outline on the lit
 * rows and lowered opacity on the rest, with transitions off under prefers-reduced-motion.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type HighlightKey = string

interface HighlightState {
  /** The key being pointed at, else the pinned one. */
  active: HighlightKey | null
  pinned: HighlightKey | null
  hover: (key: HighlightKey | null) => void
  togglePin: (key: HighlightKey) => void
}

const Ctx = createContext<HighlightState | null>(null)

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<HighlightKey | null>(null)
  const [pinned, setPinned] = useState<HighlightKey | null>(null)
  const togglePin = useCallback((key: HighlightKey) => setPinned((p) => (p === key ? null : key)), [])
  useEffect(() => {
    if (!pinned) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])
  const value = useMemo(() => ({ active: hovered ?? pinned, pinned, hover: setHovered, togglePin }), [hovered, pinned, togglePin])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Props for a linked row: spread them on the element (then set className to include
 * `link.className`). `primary` is what pointing at this row highlights; `keys` are everything
 * it belongs to. `pinOnClick` makes a click pin it.
 */
export interface LinkedProps {
  className: 'ci-lk'
  'data-hl': 'on' | 'dim' | undefined
  'data-pinned': true | undefined
  onMouseEnter: (() => void) | undefined
  onMouseLeave: (() => void) | undefined
  onClick: (() => void) | undefined
}

const INERT: LinkedProps = {
  className: 'ci-lk',
  'data-hl': undefined,
  'data-pinned': undefined,
  onMouseEnter: undefined,
  onMouseLeave: undefined,
  onClick: undefined,
}

export function useLinked(keys: readonly HighlightKey[], primary: HighlightKey, pinOnClick = false): LinkedProps {
  const ctx = useContext(Ctx)
  if (!ctx) return INERT
  const { active, pinned, hover, togglePin } = ctx
  return {
    className: 'ci-lk',
    'data-hl': active == null ? undefined : keys.includes(active) ? 'on' : 'dim',
    'data-pinned': pinned === primary || undefined,
    onMouseEnter: () => hover(primary),
    onMouseLeave: () => hover(null),
    onClick: pinOnClick ? () => togglePin(primary) : undefined,
  }
}

/** The pinned key and ways to set or clear it (the "Pinned" trail). */
export function usePinned(): {
  pinned: HighlightKey | null
  clear: () => void
  pin: (key: HighlightKey) => void
} {
  const ctx = useContext(Ctx)
  return {
    pinned: ctx?.pinned ?? null,
    clear: () => {
      if (ctx?.pinned) ctx.togglePin(ctx.pinned)
    },
    pin: (key) => {
      if (ctx && ctx.pinned !== key) ctx.togglePin(key)
    },
  }
}
