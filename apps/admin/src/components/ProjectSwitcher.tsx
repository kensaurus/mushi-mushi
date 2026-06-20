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
  clearActiveProject,
  getActiveProjectIdSnapshot,
  isValidProjectId,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { useCreateProject } from '../lib/useCreateProject'
import { ProjectFavicon } from './ProjectFavicon'
import { ErrorAlert } from './ui'
import { ProjectHeartbeatStrip } from './ProjectHeartbeatStrip'
import { ProjectSnapshotMeta } from './ProjectSnapshotMeta'
import { ActiveProjectStatusChip } from './ActiveProjectStatusChip'
import { faviconSourceFromProject } from '../lib/resolveProjectDomain'
import { useProjectSnapshots } from '../lib/useProjectSnapshots'
import { buildProjectSetupTooltip } from '../lib/projectMetaTooltips'
import { headerDropdownPanelClass } from '../lib/appChrome'
import { MetricTooltipContent, Tooltip } from './ui'

export function ProjectSwitcher() {
  const setup = useSetupStatus()
  const snapshots = useProjectSnapshots()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  // Inline "create new project" affordance — exposed in the dropdown
  // footer so users don't have to navigate away to /projects to spin up
  // a fresh workspace. `creating` toggles the row from a chip to an input.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const newNameInputRef = useRef<HTMLInputElement | null>(null)
  const { create: createProject, creating: submitting, error: createError } = useCreateProject({
    onCreated: () => {
      setNewName('')
      setCreating(false)
      setOpen(false)
      void setup.reload()
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
    if (fromUrl && !isValidProjectId(fromUrl)) {
      const next = new URLSearchParams(searchParams)
      next.delete(ACTIVE_PROJECT_QUERY_PARAM)
      setSearchParams(next, { replace: true })
      clearActiveProject()
    }
    const candidate =
      (fromUrl && isValidProjectId(fromUrl) ? fromUrl : null) ?? fromStorage
    const known = projects.find((p) => p.project_id === candidate)
    if (known) {
      if (fromStorage !== known.project_id) {
        setActiveProjectIdSnapshot(known.project_id)
      }
      if (fromUrl !== known.project_id) {
        const next = new URLSearchParams(searchParams)
        next.set(ACTIVE_PROJECT_QUERY_PARAM, known.project_id)
        setSearchParams(next, { replace: true })
      }
      return
    }
    // No valid candidate — fall back to first owned project.
    const fallbackId = projects[0].project_id
    setActiveProjectIdSnapshot(fallbackId)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, fallbackId)
    setSearchParams(next, { replace: true })
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
    return (
      <Link
        to="/projects?tab=create"
        className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/60 px-2 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
        title="No projects in this team yet"
      >
        <span className="truncate max-w-[12rem]">No projects yet</span>
        <span aria-hidden className="text-fg-faint">→</span>
      </Link>
    )
  }

  const projects = setup.data.projects
  const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
  const activeId =
    (fromUrl && isValidProjectId(fromUrl) ? fromUrl : null) ??
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
        <ProjectFavicon
          {...faviconSourceFromProject(active, snapshots.byId.get(active.project_id))}
          size={14}
        />
        <span className="text-2xs uppercase tracking-wider text-fg-muted hidden sm:inline">Project</span>
        <span className="font-medium truncate max-w-[12rem]">{active.project_name}</span>
        <ActiveProjectStatusChip snapshot={snapshots.byId.get(active.project_id)} />
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
          className={`${headerDropdownPanelClass} w-80 max-w-[calc(100vw-2rem)]`}
        >
          <ul role="listbox" className="max-h-80 overflow-y-auto divide-y divide-edge-subtle/60">
            {projects.map((p) => {
              const isActive = p.project_id === active.project_id
              return (
                <li key={p.project_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => pick(p.project_id)}
                    className={`flex w-full flex-col gap-1 px-2.5 py-2 text-left text-xs hover:bg-surface-overlay motion-safe:transition-colors ${
                      isActive ? 'bg-surface-overlay/60 text-fg' : 'text-fg-secondary'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <ProjectFavicon
                        {...faviconSourceFromProject(p, snapshots.byId.get(p.project_id))}
                        size={16}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.project_name}</div>
                        <Tooltip
                          content={<MetricTooltipContent data={buildProjectSetupTooltip(p)} />}
                          side="left"
                          nowrap={false}
                          portal
                        >
                          <div className="mt-0.5 cursor-help truncate text-3xs text-fg-faint">
                            {p.report_count} reports · {p.required_complete}/{p.required_total} setup
                          </div>
                        </Tooltip>
                        <ProjectSnapshotMeta
                          snapshot={snapshots.byId.get(p.project_id)}
                          compact
                          linkless
                        />
                      </div>
                      {isActive && <span className="shrink-0 text-2xs text-brand">✓</span>}
                    </div>
                    <div className="flex justify-end">
                      <ProjectHeartbeatStrip
                        project={p}
                        adminEndpointHost={setup.data?.admin_endpoint_host}
                        placement="corner"
                      />
                    </div>
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
            {createError ? (
              <div className="border-t border-edge-subtle p-2">
                <ErrorAlert
                  title="Couldn't create project"
                  message={createError.message}
                  code={createError.code}
                />
              </div>
            ) : null}
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
