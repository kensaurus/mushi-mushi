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

/**
 * Whether to offer "New project" before the role is known. Unknown (still
 * loading) offers it and lets the server decide; a known member or viewer
 * gets an explanation instead of a form that 403s.
 */
export function offerProjectCreate(role: OrgRole | string | null): boolean {
  return role === null || canCreateProject(role)
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
 * Role in the active team, or null when it is not known yet (orgs still
 * loading, or no team picked while the user belongs to several). Callers
 * treat null as "may be allowed" and let the server decide, so an owner
 * never loses a control while the org list is in flight.
 */
export function resolveActiveOrgRole(
  orgs: ReadonlyArray<{ id: string; role: string }> | null | undefined,
  activeOrgId: string | null,
): string | null {
  if (!orgs || orgs.length === 0) return null
  const match = activeOrgId ? orgs.find((o) => o.id === activeOrgId) : undefined
  if (match) return match.role
  return orgs.length === 1 ? orgs[0]!.role : null
}

/** True unless the active-team role is known and below owner/admin. */
export function mayManageActiveOrg(role: string | null): boolean {
  return role == null || canManageOrg(role)
}
