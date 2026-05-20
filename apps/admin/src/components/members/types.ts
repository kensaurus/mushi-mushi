/**
 * FILE: apps/admin/src/components/members/types.ts
 */

export type MembersTabId = 'roster' | 'invites' | 'setup'

export interface MembersStats {
  memberCount: number
  pendingInvites: number
  seatLimit: number | null
  seatsUsed: number
  seatsRemaining: number | null
  inactiveCount: number
  activeLast7d: number
  expiringSoonInvites: number
  atSeatCap: boolean
  planId: string | null
  planDisplayName: string | null
  currentUserRole: 'owner' | 'admin' | 'member' | 'viewer'
  canManage: boolean
  organizationName: string | null
}

export const EMPTY_MEMBERS_STATS: MembersStats = {
  memberCount: 0,
  pendingInvites: 0,
  seatLimit: null,
  seatsUsed: 0,
  seatsRemaining: null,
  inactiveCount: 0,
  activeLast7d: 0,
  expiringSoonInvites: 0,
  atSeatCap: false,
  planId: null,
  planDisplayName: null,
  currentUserRole: 'member',
  canManage: false,
  organizationName: null,
}
