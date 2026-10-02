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
import { ACTIVE_ORG_QUERY_PARAM, getActiveOrgIdSnapshot, setActiveOrgIdSnapshot, useActiveOrgSignal } from '../lib/activeOrg'
import { findProjectTeam, lastTeamProject, rememberTeamProject } from '../lib/crossTeamProject'
import { useToast } from '../lib/toast'
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
import { HeaderContextChip, HeaderContextChipLink, HeaderContextChipSkeleton } from './ui/chrome'

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
  const toast = useToast()

  // Which team the loaded project list belongs to. On a team switch the list
  // stays the old team's until the refetch lands (stale-while-revalidate);
  // resolving against it put the OLD team's first project back in the URL,
  // and every panel then 404'd until a reload.
  const activeOrg = useActiveOrgSignal()
  const [listOrg, setListOrg] = useState<string | null>(null)
  useEffect(() => {
    if (setup.data) setListOrg(activeOrg)
    // Stamp only when a new list arrives; an org change alone must not
    // re-label the old list as the new team's, so activeOrg stays out of deps.
  }, [setup.data])
  const listIsCurrent = listOrg === activeOrg

  // A deep link to a project in another of the user's teams: find that team
  // and switch to it, once per project id.
  const probedRef = useRef<string | null>(null)

  // Hydrate the active project from URL > localStorage > first project. Once
  // we've picked one, mirror it into both stores so the rest of the app can
  // read either without thinking about precedence.
  useEffect(() => {
    if (setup.loading || !setup.data || !listIsCurrent) return
    const projects = setup.data.projects
    if (projects.length === 0) return
    const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
    const fromStorage = getActiveProjectIdSnapshot()
    if (fromUrl && !isValidProjectId(fromUrl)) {
      const next = new URLSearchParams(searchParams)
      next.delete(ACTIVE_PROJECT_QUERY_PARAM)
      setSearchParams(next, { replace: true })
      clearActiveProject()
      // Stop here: the effect re-runs with the cleaned URL. Falling through
      // would issue a second, conflicting setSearchParams against the stale
      // `fromUrl` in the same tick, silently losing this cleanup write.
      return
    }
    const candidate =
      (fromUrl && isValidProjectId(fromUrl) ? fromUrl : null) ?? fromStorage
    const known = projects.find((p) => p.project_id === candidate)
    const orgId = getActiveOrgIdSnapshot()
    if (known) {
      if (orgId) rememberTeamProject(orgId, known.project_id)
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
    // A valid project id in the URL that this list doesn't contain is a deep
    // link (another team's project, or a stale pin). Don't override it to the
    // first project here: pages that resolve their own project (report
    // detail) rewrite the param themselves, and fighting that rewrite
    // flickers the address bar in a loop. Instead, look for the team that
    // owns it and switch there.
    if (fromUrl && isValidProjectId(fromUrl)) {
      if (probedRef.current === fromUrl) return
      probedRef.current = fromUrl
      void findProjectTeam(fromUrl, orgId).then((team) => {
        if (!team) return
        // Still the same link? The user may have navigated on meanwhile.
        if (new URLSearchParams(window.location.search).get(ACTIVE_PROJECT_QUERY_PARAM) !== fromUrl) return
        setActiveOrgIdSnapshot(team.id)
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set(ACTIVE_ORG_QUERY_PARAM, team.id)
            return next
          },
          { replace: true },
        )
        toast.info(`Switched to team ${team.name}`, 'The project in this link belongs to that team.')
      })
      return
    }
    // No valid candidate: the team's last-used project, else its first.
    const remembered = orgId ? lastTeamProject(orgId) : null
    const fallbackId =
      projects.find((p) => p.project_id === remembered)?.project_id ?? projects[0].project_id
    if (orgId) rememberTeamProject(orgId, fallbackId)
    setActiveProjectIdSnapshot(fallbackId)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, fallbackId)
    setSearchParams(next, { replace: true })
  }, [setup.loading, setup.data, searchParams, listIsCurrent, setSearchParams, toast])

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
    return <HeaderContextChipSkeleton label="Loading project" />
  }
  if (setup.data.projects.length === 0) {
    return (
      <HeaderContextChipLink to="/projects?tab=create" title="No projects in this team yet">
        <span className="truncate max-w-48">No projects yet</span>
        <span aria-hidden className="text-fg-faint">→</span>
      </HeaderContextChipLink>
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
    const orgId = getActiveOrgIdSnapshot()
    if (orgId) rememberTeamProject(orgId, id)
    setActiveProjectIdSnapshot(id)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, id)
    setSearchParams(next, { replace: true })
    setOpen(false)
  }

  const snapshot = snapshots.byId.get(active.project_id)

  return (
    <div ref={containerRef} className="relative inline-flex min-w-0 max-w-full items-center gap-1">
      <HeaderContextChip
        // The favicon already says "project" — the uppercase PROJECT kicker
        // spent header width that long slugs needed, so it lives in the
        // tooltip now instead of truncating the name.
        title={`Project: ${active.project_name}`}
        aria-label={`Project: ${active.project_name} — switch project`}
        label={
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <ProjectFavicon
              {...faviconSourceFromProject(active, snapshot)}
              size={14}
            />
            <span className="truncate">{active.project_name}</span>
          </span>
        }
        trailing={
          <svg
            width="9"
            height="9"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            className="shrink-0"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      <ActiveProjectStatusChip snapshot={snapshot} className="hidden xl:inline-flex" />
      {open && (
        <div
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
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
                    className={`flex w-full flex-col gap-1 px-2.5 py-2 text-left text-xs hover:bg-surface-overlay motion-safe:transition-opacity ${
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
              className="flex w-full items-center justify-between gap-1.5 border-b border-edge-subtle px-2.5 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:bg-surface-overlay"
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
                  className="rounded-sm bg-brand px-2 py-1 text-2xs font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed motion-safe:transition-opacity"
                >
                  {submitting ? '…' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-brand hover:bg-surface-overlay motion-safe:transition-opacity focus-visible:outline-none focus-visible:bg-surface-overlay"
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
  if (isValidProjectId(fromUrl)) return fromUrl
  return getActiveProjectIdSnapshot()
}
