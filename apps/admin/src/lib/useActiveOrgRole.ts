/**
 * FILE: apps/admin/src/lib/useActiveOrgRole.ts
 * PURPOSE: The signed-in user's role in the active team, for hiding
 *          owner/admin-only controls (spend caps, budgets) from members and
 *          viewers instead of letting them click into a 403.
 */

import { usePageData } from './usePageData'
import { useActiveOrgId } from '../components/OrgSwitcher'
import { mayManageActiveOrg, resolveActiveOrgRole } from './orgPermissions'

export function useActiveOrgRole(): { role: string | null; canManage: boolean } {
  const activeOrgId = useActiveOrgId()
  const { data } = usePageData<{ organizations: Array<{ id: string; role: string }> }>('/v1/org', {
    scope: 'none',
  })
  const role = resolveActiveOrgRole(data?.organizations, activeOrgId)
  return { role, canManage: mayManageActiveOrg(role) }
}
