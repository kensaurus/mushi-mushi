/**
 * FILE: apps/admin/src/lib/orgPermissions.ts
 * PURPOSE: Shared org/project permission helpers for role-aware admin UI.
 */

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export function canManageOrg(role: OrgRole | string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function canCreateProject(role: OrgRole | string | null | undefined): boolean {
  return canManageOrg(role)
}

export function canDeleteProject(role: OrgRole | string | null | undefined): boolean {
  return canManageOrg(role)
}

export function canRenameProject(role: OrgRole | string | null | undefined): boolean {
  return canManageOrg(role)
}

export function canInviteMembers(role: OrgRole | string | null | undefined): boolean {
  return canManageOrg(role)
}

export function viewerRoleHint(role: OrgRole | string | null | undefined): string | null {
  if (role === 'viewer') return 'You are a viewer in this team — ask an owner or admin to make changes.'
  if (role === 'member') return 'Some actions require owner or admin access in this team.'
  return null
}

/**
 * Tooltip / caption for a control the server refuses to members and viewers
 * (requireProjectAdmin). Pages disable the control and show this instead of
 * letting the click end in a 403.
 */
export const ADMIN_ONLY_HINT = 'Owners and admins only. Ask one of them to make this change.'
