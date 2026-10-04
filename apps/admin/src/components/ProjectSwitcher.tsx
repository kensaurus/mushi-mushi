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
import {
  PROJECT_DIRECTORY_PATH,
  TEAM_AUTO_SWITCH_EVENT,
  lastTeamProject,
  rememberProjectTeams,
  rememberTeamProject,
  resolveTeamForProject,
  type ProjectDirectory,
  type TeamAutoSwitchDetail,
} from '../lib/crossTeamProject'
import { usePageData } from '../lib/usePageData'
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
import { offerProjectCreate } from '../lib/orgPermissions'
import type { OrganizationSummary } from './OrgSwitcher'
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
  // and switch to it, once per project id. apiFetch usually did this before
  // the first request (see waitForTenant); this is the safety net for a
  // link opened inside the running app.
  const probedRef = useRef<string | null>(null)

  // Every switch to another team made on the user's behalf (by apiFetch's
  // deep-link gate or by the effect below) says so, and puts the team in
  // the URL so the team switcher, which honours `?org=`, agrees.
  useEffect(() => {
    function onAutoSwitch(event: Event) {
      const detail = (event as CustomEvent<TeamAutoSwitchDetail>).detail
      if (!detail) return
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(ACTIVE_ORG_QUERY_PARAM, detail.teamId)
          next.set(ACTIVE_PROJECT_QUERY_PARAM, detail.projectId)
          return next
        },
        { replace: true },
      )
      toast.info(`Switched to team ${detail.teamName}`, 'The project in this link belongs to that team.')
    }
    window.addEventListener(TEAM_AUTO_SWITCH_EVENT, onAutoSwitch)
    return () => window.removeEventListener(TEAM_AUTO_SWITCH_EVENT, onAutoSwitch)
  }, [setSearchParams, toast])

  // B23: the dropdown lists every project the user can reach, grouped by
  // team. Read only while it is open, so closed pages pay nothing.
  const directory = usePageData<ProjectDirectory>(open ? PROJECT_DIRECTORY_PATH : null, {
    scope: 'none',
  })

  // Only team owners and admins may create projects (the server 403s anyone
  // else), so members and viewers get an explanation instead of a form that
  // fails after they type a name. Unknown role (still loading) keeps the
  // button; the server stays the authority.
  const teams = usePageData<{ organizations: OrganizationSummary[] }>(open ? '/v1/org' : null, {
    scope: 'none',
  })
  const activeTeamRole = teams.data?.organizations?.find((o) => o.id === activeOrg)?.role ?? null
  const mayCreateProject = offerProjectCreate(activeTeamRole)

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
    // This list is the active team's: remember which team owns each project
    // so a reload of a link to any of them skips apiFetch's team check.
    if (orgId) rememberProjectTeams(projects.map((p) => ({ id: p.project_id, organizationId: orgId })))
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
      // Switches team (org first, then project) and fires the auto-switch
      // event handled above; does nothing when no team of the user owns it.
      void resolveTeamForProject(fromUrl)
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
  }, [setup.loading, setup.data, searchParams, listIsCurrent, setSearchParams])

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

  /** Pick a project in another team: switch team first, then project. */
  function pickInTeam(projectId: string, orgId: string) {
    setActiveOrgIdSnapshot(orgId)
    rememberTeamProject(orgId, projectId)
    setActiveProjectIdSnapshot(projectId)
    const next = new URLSearchParams(searchParams)
    next.set(ACTIVE_ORG_QUERY_PARAM, orgId)
    next.set(ACTIVE_PROJECT_QUERY_PARAM, projectId)
    setSearchParams(next, { replace: true })
    setOpen(false)
  }

  const activeOrgId = getActiveOrgIdSnapshot()
  const currentTeamName =
    directory.data?.teams.find((t) => t.id === activeOrgId)?.name ?? null
  const otherTeams = (directory.data?.teams ?? [])
    .filter((t) => t.id !== activeOrgId)
    .map((team) => ({
      team,
      projects: (directory.data?.projects ?? []).filter((p) => p.organizationId === team.id),
    }))
    .filter((g) => g.projects.length > 0)

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
          <div className="max-h-96 overflow-y-auto">
          {otherTeams.length > 0 && (
            <p className="px-2.5 pt-2 pb-1 text-3xs font-medium uppercase tracking-wide text-fg-faint">
              {currentTeamName ? `${currentTeamName} (this team)` : 'This team'}
            </p>
          )}
          <ul role="listbox" aria-label="Projects in this team" className="divide-y divide-edge-subtle/60">
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
          {otherTeams.map(({ team, projects: teamProjects }) => (
            <div key={team.id} className="border-t border-edge-subtle">
              <p className="px-2.5 pt-2 pb-1 text-3xs font-medium uppercase tracking-wide text-fg-faint">
                {team.name}
              </p>
              <ul role="listbox" aria-label={`Projects in ${team.name}`} className="pb-1">
                {teamProjects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => pickInTeam(p.id, team.id)}
                      title={`Switches to the ${team.name} team`}
                      className="flex w-full min-h-9 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-overlay focus-visible:outline-none focus-visible:bg-surface-overlay motion-safe:transition-opacity"
                    >
                      <ProjectFavicon project_id={p.id} project_name={p.name} project_slug="" size={16} />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-3xs text-fg-faint">switch team</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {directory.loading && !directory.data && (
            <p className="border-t border-edge-subtle px-2.5 py-1.5 text-3xs text-fg-faint">
              Checking your other teams…
            </p>
          )}
          </div>
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
            {!mayCreateProject ? (
              <p className="px-2.5 py-1.5 text-2xs text-fg-muted">
                Only team owners and admins can create projects. Ask one of them, or switch team.
              </p>
            ) : creating ? (
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
