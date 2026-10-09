/**
 * FILE: apps/admin/src/lib/projectGroups.ts
 * PURPOSE: Project groups (Plan 021): named sets of apps inside one team,
 *          used to filter the portfolio and the project switcher.
 *
 * Data: GET /v1/admin/orgs/:orgId/project-groups
 */

import type { CHIP_TONE } from './chipTone'
import { usePageData } from './usePageData'

export const PROJECT_GROUP_COLORS = ['brand', 'accent', 'info', 'ok', 'warn', 'danger', 'neutral'] as const
export type ProjectGroupColor = (typeof PROJECT_GROUP_COLORS)[number]

export interface ProjectGroup {
  id: string
  name: string
  slug: string
  color: ProjectGroupColor | null
  sort: number
  project_ids: string[]
}

/** Chip tone per group colour; unset groups read as neutral. */
export function groupTone(color: ProjectGroupColor | null): keyof typeof CHIP_TONE {
  if (!color || color === 'neutral') return 'neutral'
  return `${color}Subtle` as keyof typeof CHIP_TONE
}

export const ACTIVE_GROUP_STORAGE_KEY = 'mushi:active_project_group'

export function readActiveGroup(): string | null {
  try {
    return localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeActiveGroup(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, slug)
    else localStorage.removeItem(ACTIVE_GROUP_STORAGE_KEY)
  } catch {
    /* private window or blocked storage: the filter just won't persist */
  }
}

export function projectGroupsPath(orgId: string): string {
  return `/v1/admin/orgs/${orgId}/project-groups`
}

export function useProjectGroups(orgId: string | null, enabled = true) {
  return usePageData<{ groups: ProjectGroup[] }>(orgId && enabled ? projectGroupsPath(orgId) : null, { scope: 'none' })
}
