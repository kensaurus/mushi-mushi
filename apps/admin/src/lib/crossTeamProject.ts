/**
 * FILE: apps/admin/src/lib/crossTeamProject.ts
 * PURPOSE: Keep the active team and the active project in the same team.
 *
 * The API scopes every project request to the active team (X-Mushi-Org-Id).
 * A `?project=` from another team therefore 404s on every panel
 * (PROJECT_NOT_FOUND on notifications, inbox/stats, judge/stats) while the
 * header still shows the old team. Two entry points caused it:
 *
 *   - a deep link to a project in another team the user belongs to;
 *   - switching team while the URL still pinned the old team's project.
 *
 * `findProjectTeam` answers "which of my teams owns this project?" so the
 * switcher can move to it, and the per-team memory lets a team switch land on
 * the project last used in that team instead of the old team's project.
 */

import { apiFetch } from './supabase'

interface TeamRef {
  id: string
  name: string
}

/**
 * Probe the user's other teams for `projectId`. One request per team, made
 * only when a URL names a project the active team does not contain.
 */
export async function findProjectTeam(projectId: string, activeOrgId: string | null): Promise<TeamRef | null> {
  const orgs = await apiFetch<{ organizations: TeamRef[] }>('/v1/org', { scope: 'none' })
  if (!orgs.ok || !orgs.data) return null
  for (const org of orgs.data.organizations) {
    if (org.id === activeOrgId) continue
    const res = await apiFetch<{ projects: Array<{ id: string }> }>('/v1/admin/projects', {
      scope: 'none',
      // The micro-cache keys on the STORED active team, not on this header
      // override, so another team's list must bypass it rather than be
      // served from (or poison) the active team's cached response.
      cache: 'no-store',
      headers: { 'X-Mushi-Org-Id': org.id, 'x-org-id': org.id },
    })
    if (res.ok && res.data?.projects.some((p) => p.id === projectId)) {
      return { id: org.id, name: org.name }
    }
  }
  return null
}

const LAST_PROJECT_KEY = 'mushi:last_project_by_org'

function readMap(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LAST_PROJECT_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Remember the project last used in a team. Callers pass a validated pair. */
export function rememberTeamProject(orgId: string, projectId: string): void {
  if (typeof window === 'undefined') return
  const map = readMap()
  if (map[orgId] === projectId) return
  map[orgId] = projectId
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify(map))
  } catch {
    // storage-disabled: a team switch falls back to the team's first project
  }
}

/** The project last used in `orgId`, if any. Callers must check it still exists. */
export function lastTeamProject(orgId: string): string | null {
  if (typeof window === 'undefined') return null
  return readMap()[orgId] ?? null
}
