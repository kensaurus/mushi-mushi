/**
 * FILE: apps/admin/src/lib/useOrgCanManage.ts
 * PURPOSE: Whether the signed-in user may change org-level portfolio settings
 *          (connected sources, bill imports, the digest, the shared funnel).
 *
 * Those writes answer 403 for members and viewers. The cards used to show
 * every write control anyway, so a member filled in a form (credential
 * included) and only learned on submit that it was not theirs to change
 * (QA 177). Same source of truth as the Projects page: the caller's role
 * from GET /v1/org, through canManageOrg.
 */

import { usePageData } from './usePageData'
import { canManageOrg } from './orgPermissions'
import { knownProjectTeam } from './crossTeamProject'
import { useActiveOrgSignal } from './activeOrg'
import { useActiveProjectSignal } from './activeProject'
import type { OrganizationSummary } from '../components/OrgSwitcher'

export interface OrgManageState {
  /** true = owner or admin; false = member or viewer; null = not known yet. */
  canManage: boolean | null
}

export function useOrgCanManage(orgId: string | null | undefined): OrgManageState {
  const { data } = usePageData<{ organizations: OrganizationSummary[] }>('/v1/org', { scope: 'none' })
  if (!orgId || !data) return { canManage: null }
  const org = data.organizations?.find((o) => o.id === orgId)
  if (!org) return { canManage: null }
  return { canManage: canManageOrg(org.role) }
}

/** Shown where a write control would be, for a member or a viewer. */
export const ORG_ADMIN_ONLY_HINT = 'Only team owners and admins can change this. Ask one of them, or switch to a team you manage.'

/**
 * The same answer for the active project: its team's role decides whether
 * the caller may open a draft PR (the server's projectAccess rule).
 */
export function useActiveProjectCanManage(): OrgManageState {
  // Router-free on purpose: the previews also render outside a <Router>.
  const orgId = useActiveOrgSignal() || null
  const projectId = useActiveProjectSignal() || null
  return useOrgCanManage((projectId ? knownProjectTeam(projectId) : null) ?? orgId)
}

/** Shown next to a disabled "Open draft PR" for a member or a viewer (QA 292). */
export const PROJECT_ADMIN_PR_HINT = 'Only owners and admins of this project\'s team can open a draft PR. You can still preview the change and share it with one of them.'
