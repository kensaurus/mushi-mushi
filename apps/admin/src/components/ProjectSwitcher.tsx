/**
 * FILE: apps/admin/src/components/ProjectSwitcher.tsx
 * PURPOSE: Compact dropdown in the layout header that lets the user pick
 *          which project the admin console is currently focused on. Persists
 *          choice in URL `?project=…` (so links shared between teammates carry
 *          context) AND `localStorage` (so the choice survives reloads).
 *
 *          Reads from `useSetupStatus()` so the switcher is always in sync with
 *          the dashboard banner — no second source of truth.
 */

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSetupStatus } from '../lib/useSetupStatus'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  getActiveProjectIdSnapshot,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'

export function ProjectSwitcher() {
  const setup = useSetupStatus()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Hydrate the active project from URL > localStorage > first project. Once
  // we've picked one, mirror it into both stores so the rest of the app can
  // read either without thinking about precedence.
  useEffect(() => {
    if (setup.loading || !setup.data) return
    const projects = setup.data.projects
    if (projects.length === 0) return
    const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
    const fromStorage = getActiveProjectIdSnapshot()
    const candidate = fromUrl ?? fromStorage
    const known = projects.find((p) => p.project_id === candidate)
    if (known) {
      if (fromStorage !== known.project_id) {
        setActiveProjectIdSnapshot(known.project_id)
      }
      return
    }
    // No valid candidate — fall back to first owned project.
    setActiveProjectIdSnapshot(projects[0].project_id)
  }, [setup.loading, setup.data, searchParams])

  // Close on outside click so the dropdown doesn't stay pinned open behind nav.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (setup.loading || !setup.data) {
    // never collapse the chrome anchor while loading. A skeleton
    // chip keeps the header layout stable so links don't reflow under the
    // user's cursor and the user always sees "I'm in a project context".
    return (
      <div
        aria-busy="true"
        aria-label="Loading project"
        className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 text-2xs text-fg-faint"
      >
        <span className="motion-safe:animate-pulse">Loading project…</span>
      </div>
    )
  }
  if (setup.data.projects.length === 0) {
    return null
  }

  const projects = setup.data.projects
  const activeId =
    searchParams.get(ACTIVE_PROJECT_QUERY_PARAM) ??
    getActiveProjectIdSnapshot() ??
    projects[0].project_id
  const active = projects.find((p) => p.project_id === activeId) ?? projects[0]

  function pick(id: string) {
    setActiveProjectIdSnapshot(id)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, id)
    setSearchParams(next, { replace: true })
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/60 px-2 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
      >
        <span className="text-3xs uppercase tracking-wider text-fg-faint">Project</span>
        <span className="font-medium truncate max-w-[12rem]">{active.project_name}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-edge-subtle bg-surface-raised shadow-raised"
        >
          {projects.map((p) => {
            const isActive = p.project_id === active.project_id
            return (
              <li key={p.project_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => pick(p.project_id)}
                  className={`flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-overlay motion-safe:transition-colors ${
                    isActive ? 'bg-surface-overlay/60 text-fg' : 'text-fg-secondary'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.project_name}</div>
                    <div className="mt-0.5 truncate text-3xs font-mono text-fg-faint">
                      {p.report_count} reports · {p.required_complete}/{p.required_total} setup
                    </div>
                  </div>
                  {isActive && <span className="text-2xs text-brand">✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Companion hook so pages can consistently read the same active id. */
export function useActiveProjectId(): string | null {
  const [searchParams] = useSearchParams()
  const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
  if (fromUrl) return fromUrl
  return getActiveProjectIdSnapshot()
}
