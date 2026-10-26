/**
 * FILE: apps/admin/src/lib/projectGroups.ts
 * PURPOSE: Project groups (Plan 021): named sets of apps inside one team,
 *          used to filter the portfolio and the project switcher.
 *
 * Data: GET /v1/admin/orgs/:orgId/project-groups
 */

import type { CHIP_TONE } from './chipTone'
import { usePageData } from './usePageData'

/** @internal Exported for tests only. */
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

const ACTIVE_GROUP_STORAGE_KEY = 'mushi:active_project_group'

/** Fired when the remembered group changes, so the switcher and the portfolio stay on the same filter. */
export const ACTIVE_GROUP_EVENT = 'mushi:active-project-group'

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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACTIVE_GROUP_EVENT, { detail: slug }))
  }
}

/**
 * The group the portfolio and the project switcher both apply.
 * A slug that is not in this team's group list (deleted, or another team's)
 * falls back to every app in the team.
 */
export function resolveActiveGroup(requested: string | null, groups: readonly { slug: string }[]): string | null {
  return requested && groups.some((g) => g.slug === requested) ? requested : null
}

export function projectGroupsPath(orgId: string): string {
  return `/v1/admin/orgs/${orgId}/project-groups`
}

export function useProjectGroups(orgId: string | null, enabled = true) {
  return usePageData<{ groups: ProjectGroup[] }>(orgId && enabled ? projectGroupsPath(orgId) : null, { scope: 'none' })
}
