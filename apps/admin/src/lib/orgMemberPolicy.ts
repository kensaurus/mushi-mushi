/**
 * FILE: apps/admin/src/lib/orgMemberPolicy.ts
 * PURPOSE: What the roster lets each person do, mirroring the API rule in
 *          packages/server/supabase/functions/_shared/org-member-policy.ts
 *          (keep the two in step). The UI shows only what the API allows,
 *          and says why a control is off.
 *
 *   - Only owners and admins manage the roster.
 *   - Only an owner grants owner, or changes/removes another owner.
 *   - Anyone may leave, except the last owner.
 *   - The last owner cannot be demoted.
 */

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

const ALL_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member', 'viewer']

export interface RosterRowPermissions {
  /** Roles the actor may pick for this row; empty = show a read-only badge. */
  roleOptions: OrgRole[]
  /** Why the role cannot be changed, when roleOptions is empty or locked. */
  roleLockedReason: string | null
  /** 'remove' a teammate, 'leave' for your own row, or null when neither is allowed. */
  removeAction: 'remove' | 'leave' | null
  /** Why remove/leave is off (tooltip). */
  removeLockedReason: string | null
}

export function rosterRowPermissions(input: {
  actorRole: OrgRole | null | undefined
  targetRole: OrgRole
  isSelf: boolean
  ownerCount: number
}): RosterRowPermissions {
  const { actorRole, targetRole, isSelf, ownerCount } = input
  const manager = actorRole === 'owner' || actorRole === 'admin'
  const lastOwner = targetRole === 'owner' && ownerCount <= 1

  let roleOptions: OrgRole[] = []
  let roleLockedReason: string | null = null
  if (!manager) {
    roleLockedReason = 'Only team owners and admins can change roles.'
  } else if (targetRole === 'owner' && actorRole !== 'owner') {
    roleLockedReason = "Only an owner can change another owner's role."
  } else if (lastOwner) {
    roleLockedReason = isSelf
      ? 'You are the only owner. Make someone else an owner first, then change your own role.'
      : 'This is the only owner. Make someone else an owner first.'
  } else {
    roleOptions = ALL_ROLES.filter((r) => r !== 'owner' || actorRole === 'owner')
  }

  let removeAction: RosterRowPermissions['removeAction'] = null
  let removeLockedReason: string | null = null
  if (isSelf) {
    if (lastOwner) removeLockedReason = 'You are the only owner. Make someone else an owner before you leave.'
    else removeAction = 'leave'
  } else if (!manager) {
    removeLockedReason = 'Only team owners and admins can remove teammates.'
  } else if (targetRole === 'owner' && actorRole !== 'owner') {
    removeLockedReason = 'Only an owner can remove another owner.'
  } else if (lastOwner) {
    removeLockedReason = 'This is the only owner. Make someone else an owner first.'
  } else {
    removeAction = 'remove'
  }

  return { roleOptions, roleLockedReason, removeAction, removeLockedReason }
}

/** Invitations the API still lists split into those that can be accepted and expired ones. */
export function splitInvitations<T extends { expires_at: string }>(
  invitations: readonly T[],
  nowMs: number,
): { open: T[]; expired: T[] } {
  const open: T[] = []
  const expired: T[] = []
  for (const invite of invitations) {
    const at = Date.parse(invite.expires_at)
    if (Number.isFinite(at) && at <= nowMs) expired.push(invite)
    else open.push(invite)
  }
  return { open, expired }
}
