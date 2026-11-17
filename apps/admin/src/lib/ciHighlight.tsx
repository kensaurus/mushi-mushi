/**
 * FILE: apps/admin/src/lib/ciHighlight.tsx
 * PURPOSE: Linked highlighting on the CI page (2026-11-17; the owner: "hover and click should
 *          show more effect… make it easy to understand the informational flow").
 *
 * Every row that stands for an app, a job or a machine carries keys (`ciJobKeys`). Pointing
 * at one lights every row with a shared key, in every panel, and dims the rest; clicking pins
 * it until clicked again or Escape. Outside a provider the hook is a no-op, so the components
 * still work on their own (tests, other pages).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type CiKey = string

interface CiHighlight {
  /** The key being pointed at, else the pinned one. */
  active: CiKey | null
  pinned: CiKey | null
  hover: (key: CiKey | null) => void
  togglePin: (key: CiKey) => void
}

const Ctx = createContext<CiHighlight | null>(null)

export function CiHighlightProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<CiKey | null>(null)
  const [pinned, setPinned] = useState<CiKey | null>(null)
  const togglePin = useCallback((key: CiKey) => setPinned((p) => (p === key ? null : key)), [])
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

/** The keys of one job: its app (repo), the job type, and the runner it ran on. */
export function ciJobKeys(job: { repo: string; jobName: string; runnerName?: string | null }): CiKey[] {
  const keys = [`repo:${job.repo}`, `job:${job.repo}|${job.jobName}`]
  if (job.runnerName) keys.push(`runner:${job.runnerName}`)
  return keys
}

export const ciRepoKey = (repo: string): CiKey => `repo:${repo}`
export const ciJobKey = (repo: string, jobName: string): CiKey => `job:${repo}|${jobName}`
export const ciRunnerKey = (runner: string): CiKey => `runner:${runner}`

/**
 * Props for a linked row: spread them on the element (then set className to include
 * `link.className`). `primary` is what pointing at this row
 * highlights; `keys` are everything it belongs to. `pinOnClick` makes a click pin it.
 */
export interface CiLinkProps {
  className: 'ci-lk'
  'data-hl': 'on' | 'dim' | undefined
  'data-pinned': true | undefined
  onMouseEnter: (() => void) | undefined
  onMouseLeave: (() => void) | undefined
  onClick: (() => void) | undefined
}

export function useCiLink(keys: readonly CiKey[], primary: CiKey, pinOnClick = false): CiLinkProps {
  const ctx = useContext(Ctx)
  if (!ctx)
    return {
      className: 'ci-lk',
      'data-hl': undefined,
      'data-pinned': undefined,
      onMouseEnter: undefined,
      onMouseLeave: undefined,
      onClick: undefined,
    }
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

/** The pinned key and a way to clear it (the "Pinned" trail). */
export function useCiPinned(): {
  pinned: CiKey | null
  clear: () => void
  pin: (key: CiKey) => void
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
