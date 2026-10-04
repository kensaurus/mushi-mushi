/**
 * FILE: packages/server/supabase/functions/_shared/org-member-policy.ts
 * PURPOSE: Who may change or remove whom in an organization. Pure, so the
 *          rules are unit-tested without a database.
 *
 * Rules:
 *   - Only owners and admins manage the roster.
 *   - Only an owner grants the owner role, and only an owner changes or
 *     removes another owner (an admin used to demote an owner, then remove
 *     them).
 *   - Admins cannot change or remove other admins' owner status indirectly;
 *     they can manage admins, members and viewers.
 *   - Anyone may remove themselves (leave the org), except the last owner.
 *   - An org always keeps one owner. The DB trigger
 *     guard_last_organization_owner enforces this too; checking here first
 *     turns its raw exception into a plain-English 409.
 */

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface PolicyDenial {
  status: 403 | 409
  code: 'FORBIDDEN' | 'OWNER_REQUIRED' | 'LAST_OWNER'
  message: string
}

const MANAGERS: ReadonlySet<OrgRole> = new Set(['owner', 'admin'])

export function roleChangeDenial(input: {
  actorRole: OrgRole | null | undefined
  targetRole: OrgRole | null | undefined
  nextRole: OrgRole
  isSelf: boolean
  ownerCount: number
}): PolicyDenial | null {
  const { actorRole, targetRole, nextRole, isSelf, ownerCount } = input
  if (!actorRole || !MANAGERS.has(actorRole)) {
    return { status: 403, code: 'FORBIDDEN', message: 'Only team owners and admins can change roles.' }
  }
  if (nextRole === 'owner' && actorRole !== 'owner') {
    return { status: 403, code: 'OWNER_REQUIRED', message: 'Only an owner can make someone an owner.' }
  }
  if (targetRole === 'owner' && actorRole !== 'owner') {
    return { status: 403, code: 'OWNER_REQUIRED', message: "Only an owner can change another owner's role." }
  }
  if (targetRole === 'owner' && nextRole !== 'owner' && ownerCount <= 1) {
    return {
      status: 409,
      code: 'LAST_OWNER',
      message: isSelf
        ? 'You are the only owner. Make someone else an owner first, then change your own role.'
        : 'This is the only owner. Make someone else an owner first.',
    }
  }
  return null
}

export function memberRemovalDenial(input: {
  actorRole: OrgRole | null | undefined
  targetRole: OrgRole | null | undefined
  isSelf: boolean
  ownerCount: number
}): PolicyDenial | null {
  const { actorRole, targetRole, isSelf, ownerCount } = input
  if (!actorRole) {
    return { status: 403, code: 'FORBIDDEN', message: 'You are not a member of this team.' }
  }
  if (!isSelf && !MANAGERS.has(actorRole)) {
    return { status: 403, code: 'FORBIDDEN', message: 'Only team owners and admins can remove teammates.' }
  }
  if (!isSelf && targetRole === 'owner' && actorRole !== 'owner') {
    return { status: 403, code: 'OWNER_REQUIRED', message: 'Only an owner can remove another owner.' }
  }
  if (targetRole === 'owner' && ownerCount <= 1) {
    return {
      status: 409,
      code: 'LAST_OWNER',
      message: isSelf
        ? 'You are the only owner. Make someone else an owner before you leave.'
        : 'This is the only owner. Make someone else an owner first.',
    }
  }
  return null
}
