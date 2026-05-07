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
import { Link, useSearchParams } from 'react-router-dom'
import { useSetupStatus } from '../lib/useSetupStatus'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  getActiveProjectIdSnapshot,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { useCreateProject } from '../lib/useCreateProject'

export function ProjectSwitcher() {
  const setup = useSetupStatus()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  // Inline "create new project" affordance — exposed in the dropdown
  // footer so users don't have to navigate away to /projects to spin up
  // a fresh workspace. `creating` toggles the row from a chip to an input.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const newNameInputRef = useRef<HTMLInputElement | null>(null)
  const { create: createProject, creating: submitting } = useCreateProject({
    onCreated: () => {
      setNewName('')
      setCreating(false)
      setOpen(false)
    },
  })
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

  // Auto-focus the inline rename input the moment "+ New project" is clicked
  // so the user can start typing without an extra click. Defer to next tick
  // because the input only renders after `creating` flips true.
  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => newNameInputRef.current?.focus())
    } else {
      setNewName('')
    }
  }, [creating])

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
        <div
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-edge-subtle bg-surface-raised shadow-raised"
        >
          <ul role="listbox" className="max-h-72 overflow-y-auto">
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
          <div className="border-t border-edge-subtle bg-surface-raised/60">
            {/* "View project page" — shortcut into the project list/settings
                surface so users can manage the project they just selected
                without round-tripping through the sidebar. Closes the
                dropdown on click so the navigation feels intentional. */}
            <Link
              to="/projects"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between gap-1.5 border-b border-edge-subtle px-2.5 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:bg-surface-overlay"
            >
              <span>View project page</span>
              <span aria-hidden className="text-fg-faint">→</span>
            </Link>
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newName.trim() || submitting) return
                  void createProject(newName)
                }}
                className="flex items-center gap-1.5 p-1.5"
              >
                <input
                  ref={newNameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setCreating(false)
                    }
                  }}
                  placeholder="New project name"
                  maxLength={120}
                  className="flex-1 min-w-0 rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  aria-label="New project name"
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || submitting}
                  className="rounded-sm bg-brand px-2 py-1 text-2xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-colors"
                >
                  {submitting ? '…' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-brand hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:bg-surface-overlay"
              >
                <span aria-hidden className="text-sm leading-none">+</span>
                <span>New project</span>
              </button>
            )}
          </div>
        </div>
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
