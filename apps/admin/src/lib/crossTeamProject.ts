/**
 * FILE: apps/admin/src/lib/crossTeamProject.ts
 * PURPOSE: Keep the active team and the active project in the same team.
 *
 * The API scopes every project request to the active team (X-Mushi-Org-Id).
 * A `?project=` from another team therefore 404s on every panel
 * (PROJECT_NOT_FOUND on notifications, inbox/stats, judge/stats) while the
 * header still shows the old team. Two entry points caused it:
 *
 *   - a deep link (Slack, email) to a project in another team the user
 *     belongs to — the first requests went out with the old team's header;
 *   - switching team while the URL still pinned the old team's project.
 *
 * One read, GET /v1/admin/workspace/projects, lists every project the user
 * can reach in every team. From it:
 *
 *   - `resolveTeamForProject` switches to the team that owns a deep-linked
 *     project. apiFetch runs it BEFORE the first team-scoped request whenever
 *     the URL names a project not known to be in the active team, so no
 *     request leaves with the wrong team (see `waitForTenant` in supabase.ts);
 *   - the project switcher lists all projects grouped by team;
 *   - a small project→team map in localStorage lets an ordinary reload skip
 *     the extra read.
 *
 * The per-team memory lets a team switch land on the project last used in
 * that team instead of the old team's project.
 */

import { apiFetch } from './supabase'
import { getActiveOrgIdSnapshot, setActiveOrgIdSnapshot } from './activeOrg'
import { setActiveProjectIdSnapshot } from './activeProject'

interface TeamRef {
  id: string
  name: string
}

export interface DirectoryTeam {
  id: string
  name: string
  role: string | null
  isPersonal: boolean
}

export interface DirectoryProject {
  id: string
  name: string
  organizationId: string | null
}

export interface ProjectDirectory {
  teams: DirectoryTeam[]
  projects: DirectoryProject[]
}

export const PROJECT_DIRECTORY_PATH = '/v1/admin/workspace/projects'

type DirectoryRead =
  | { status: 'ok'; directory: ProjectDirectory }
  /** Signed out or the session expired: try again after sign-in. */
  | { status: 'unauthenticated' }
  /** Any other failure (including an API build without the route). */
  | { status: 'error' }

/** Read the cross-team directory and remember which team owns each project. */
export async function readProjectDirectory(): Promise<DirectoryRead> {
  // scope 'none': this read decides the team, so it must not carry one.
  const res = await apiFetch<ProjectDirectory>(PROJECT_DIRECTORY_PATH, { scope: 'none' })
  if (!res.ok || !res.data || !Array.isArray(res.data.projects) || !Array.isArray(res.data.teams)) {
    const code = res.error?.code ?? ''
    if (code === 'INVALID_TOKEN' || code === 'MISSING_AUTH' || code === 'UNAUTHORIZED') {
      return { status: 'unauthenticated' }
    }
    return { status: 'error' }
  }
  rememberProjectTeams(res.data.projects)
  return { status: 'ok', directory: res.data }
}

/** Which of my teams owns `projectId`? One request, whatever the team count. */
export async function findProjectTeam(projectId: string, activeOrgId: string | null): Promise<TeamRef | null> {
  const read = await readProjectDirectory()
  if (read.status !== 'ok') return null
  const project = read.directory.projects.find((p) => p.id === projectId)
  if (!project?.organizationId || project.organizationId === activeOrgId) return null
  const team = read.directory.teams.find((t) => t.id === project.organizationId)
  return team ? { id: team.id, name: team.name } : null
}

/** Fired after the console moved to another team on the user's behalf. */
export const TEAM_AUTO_SWITCH_EVENT = 'mushi:team-auto-switch'

export interface TeamAutoSwitchDetail {
  teamId: string
  teamName: string
  projectId: string
}

/**
 * Make the active team the one that owns `projectId`. Writes the team first,
 * then the project, so no request can pair the new project with the old
 * team. `retry` means the user is signed out and the check should run again
 * after sign-in.
 */
export async function resolveTeamForProject(
  projectId: string,
): Promise<'switched' | 'same' | 'unknown' | 'retry'> {
  const read = await readProjectDirectory()
  if (read.status === 'unauthenticated') return 'retry'
  if (read.status !== 'ok') return 'unknown'
  const project = read.directory.projects.find((p) => p.id === projectId)
  if (!project?.organizationId) return 'unknown'
  if (project.organizationId === getActiveOrgIdSnapshot()) return 'same'
  const team = read.directory.teams.find((t) => t.id === project.organizationId)
  setActiveOrgIdSnapshot(project.organizationId)
  rememberTeamProject(project.organizationId, projectId)
  setActiveProjectIdSnapshot(projectId)
  if (typeof window !== 'undefined') {
    const detail: TeamAutoSwitchDetail = {
      teamId: project.organizationId,
      teamName: team?.name ?? 'another team',
      projectId,
    }
    window.dispatchEvent(new CustomEvent(TEAM_AUTO_SWITCH_EVENT, { detail }))
  }
  return 'switched'
}

/**
 * True when the URL's project is not known to belong to the active team, so
 * team-scoped requests must wait for {@link resolveTeamForProject}. A fresh
 * browser (no active team yet) checks too: otherwise the team switcher falls
 * back to the user's FIRST team and the link's project 404s under it.
 */
export function urlProjectNeedsTeamCheck(projectId: string, activeOrgId: string | null): boolean {
  if (!activeOrgId) return true
  return knownProjectTeam(projectId) !== activeOrgId
}

// ── localStorage memory ────────────────────────────────────────────────────

const LAST_PROJECT_KEY = 'mushi:last_project_by_org'
const PROJECT_TEAM_KEY = 'mushi:project_team_by_id'
const PROJECT_TEAM_MAX = 200

function readMap(key: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, map: Record<string, string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // storage-disabled: the next load re-reads the directory instead
  }
}

/** Remember the project last used in a team. Callers pass a validated pair. */
export function rememberTeamProject(orgId: string, projectId: string): void {
  if (typeof window === 'undefined') return
  rememberProjectTeams([{ id: projectId, organizationId: orgId }])
  const map = readMap(LAST_PROJECT_KEY)
  if (map[orgId] === projectId) return
  map[orgId] = projectId
  writeMap(LAST_PROJECT_KEY, map)
}

/** The project last used in `orgId`, if any. Callers must check it still exists. */
export function lastTeamProject(orgId: string): string | null {
  if (typeof window === 'undefined') return null
  return readMap(LAST_PROJECT_KEY)[orgId] ?? null
}

/** Record which team owns each project (from the directory or a team's list). */
export function rememberProjectTeams(
  projects: ReadonlyArray<{ id: string; organizationId: string | null }>,
): void {
  if (typeof window === 'undefined') return
  const map = readMap(PROJECT_TEAM_KEY)
  let changed = false
  for (const p of projects) {
    if (!p.organizationId || map[p.id] === p.organizationId) continue
    delete map[p.id]
    map[p.id] = p.organizationId
    changed = true
  }
  if (!changed) return
  const keys = Object.keys(map)
  for (const k of keys.slice(0, Math.max(0, keys.length - PROJECT_TEAM_MAX))) delete map[k]
  writeMap(PROJECT_TEAM_KEY, map)
}

/** The team `projectId` was last seen in, if this browser has seen it. */
export function knownProjectTeam(projectId: string): string | null {
  return readMap(PROJECT_TEAM_KEY)[projectId] ?? null
}
