/**
 * FILE: apps/admin/src/lib/pdcaBottleneck.ts
 * PURPOSE: Shared PDCA bottleneck chip tokens + deep links used by
 *          ProjectsPage, ProjectSwitcher, and header status chrome.
 */

import type { PdcaStageId } from './pdca'

export const PDCA_BOTTLENECK_TONE: Record<PdcaStageId, string> = {
  plan: 'bg-info-muted text-info border border-info/30',
  do: 'bg-warn-muted text-warn border border-warn/30',
  check: 'bg-warn-muted text-warn border border-warn/30',
  act: 'bg-danger-muted text-danger border border-danger/30',
}

export const PDCA_BOTTLENECK_DEEP_LINK: Record<PdcaStageId, string> = {
  plan: '/reports?status=new',
  do: '/fixes',
  check: '/judge',
  act: '/integrations/config',
}

const STAGE_LETTER: Record<PdcaStageId, 'P' | 'D' | 'C' | 'A'> = {
  plan: 'P',
  do: 'D',
  check: 'C',
  act: 'A',
}

export function bottleneckStageLetter(stage: PdcaStageId): 'P' | 'D' | 'C' | 'A' {
  return STAGE_LETTER[stage]
}

/**
 * Deep link to a PDCA stage scoped to a project. Joins with `?` or `&`
 * depending on whether the base route already carries a query string —
 * `/fixes&project=…` would be treated as a literal pathname by the router.
 */
export function bottleneckDeepLink(stage: PdcaStageId, projectId: string): string {
  const base = PDCA_BOTTLENECK_DEEP_LINK[stage]
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}project=${encodeURIComponent(projectId)}`
}
