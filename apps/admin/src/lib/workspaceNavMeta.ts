/**
 * FILE: apps/admin/src/lib/workspaceNavMeta.ts
 * PURPOSE: Pure helpers that derive sidebar badge semantics for Workspace
 *          nav items — inventory counts vs attention overrides.
 */

import type { ProjectsStats } from '../components/projects/types'
import type { MembersStats } from '../components/members/types'
import type { HealthTone } from './useNavCounts'

export type NavBadgeMode = 'inventory' | 'attention'

export interface WorkspaceNavBadge {
  mode: NavBadgeMode
  count: number
  tone?: HealthTone
  label: string
}

export function projectsNeedingAttentionCount(
  stats: Pick<ProjectsStats, 'neverIngestedCount' | 'staleKeyCount'>,
): number {
  return stats.neverIngestedCount + (stats.staleKeyCount > 0 ? 1 : 0)
}

export function projectsNavBadge(
  stats: Pick<ProjectsStats, 'projectCount' | 'neverIngestedCount' | 'staleKeyCount'>,
): WorkspaceNavBadge | null {
  const attention = projectsNeedingAttentionCount(stats)
  if (attention > 0) {
    const parts: string[] = []
    if (stats.neverIngestedCount > 0) {
      parts.push(
        `${stats.neverIngestedCount} project${stats.neverIngestedCount === 1 ? '' : 's'} never ingested`,
      )
    }
    if (stats.staleKeyCount > 0) {
      parts.push(`${stats.staleKeyCount} active key${stats.staleKeyCount === 1 ? '' : 's'} never seen`)
    }
    return {
      mode: 'attention',
      count: attention,
      tone: 'warn',
      label: parts.join(' · '),
    }
  }
  if (stats.projectCount > 0) {
    return {
      mode: 'inventory',
      count: stats.projectCount,
      label: `${stats.projectCount} project${stats.projectCount === 1 ? '' : 's'} in workspace`,
    }
  }
  return null
}

export function membersNavBadge(
  stats: Pick<MembersStats, 'memberCount' | 'pendingInvites'>,
): WorkspaceNavBadge | null {
  if (stats.pendingInvites > 0) {
    return {
      mode: 'attention',
      count: stats.pendingInvites,
      tone: 'warn',
      label: `${stats.pendingInvites} pending invite${stats.pendingInvites === 1 ? '' : 's'}`,
    }
  }
  if (stats.memberCount > 0) {
    return {
      mode: 'inventory',
      count: stats.memberCount,
      label: `${stats.memberCount} team member${stats.memberCount === 1 ? '' : 's'}`,
    }
  }
  return null
}

export function workspaceSectionAttention(nav: {
  projectsNeedingAttention: number
  pendingInvites: number
}): { count: number; tone: 'warn' | 'danger'; label: string } | null {
  const total = nav.projectsNeedingAttention + nav.pendingInvites
  if (total === 0) return null
  const parts: string[] = []
  if (nav.projectsNeedingAttention > 0) {
    parts.push(
      `${nav.projectsNeedingAttention} project setup issue${nav.projectsNeedingAttention === 1 ? '' : 's'}`,
    )
  }
  if (nav.pendingInvites > 0) {
    parts.push(`${nav.pendingInvites} pending invite${nav.pendingInvites === 1 ? '' : 's'}`)
  }
  return {
    count: total,
    tone: 'warn',
    label: parts.join(' · '),
  }
}
