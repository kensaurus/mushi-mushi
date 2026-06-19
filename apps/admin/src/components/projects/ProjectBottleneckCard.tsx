/**
 * FILE: apps/admin/src/components/projects/ProjectBottleneckCard.tsx
 * PURPOSE: Human-readable alert when a project has a PDCA bottleneck.
 */

import type { PdcaStageId } from '../../lib/pdca'
import {
  PDCA_BOTTLENECK_TONE,
  bottleneckActionLabel,
  bottleneckDeepLink,
  bottleneckHumanHeadline,
  bottleneckHumanHint,
  bottleneckStageLetter,
} from '../../lib/pdcaBottleneck'
import { HumanActionAlert, type HumanActionPreviewItem } from '../HumanActionAlert'

export interface FailedFixPreview {
  id: string
  report_id: string
  error_head: string | null
  report_title: string | null
}

export interface ProjectBottleneckCardProps {
  projectId: string
  stage: PdcaStageId
  label: string
  count?: number | null
  failedFixesPreview?: FailedFixPreview[]
  compact?: boolean
}

export function ProjectBottleneckCard({
  projectId,
  stage,
  label,
  count,
  failedFixesPreview,
  compact = false,
}: ProjectBottleneckCardProps) {
  const ctx = { stage, label, count }
  const toneClass = PDCA_BOTTLENECK_TONE[stage]
  const blockTone =
    stage === 'do' && label.includes('retry')
      ? 'warn'
      : stage === 'plan'
        ? 'info'
        : 'warn'

  const preview: HumanActionPreviewItem[] = (failedFixesPreview ?? []).slice(0, 3).map((fix) => ({
    id: fix.id,
    title: fix.report_title?.trim() || `Report ${fix.report_id.slice(0, 8)}…`,
    subtitle: fix.error_head,
    href: `/fixes?project=${encodeURIComponent(projectId)}&status=failed#fix-${fix.id}`,
  }))

  return (
    <HumanActionAlert
      tone={blockTone}
      compact={compact}
      badge={
        <span
          className={`inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase ${toneClass}`}
        >
          {bottleneckStageLetter(stage)}
        </span>
      }
      headline={bottleneckHumanHeadline(ctx)}
      hint={bottleneckHumanHint(ctx)}
      actionLabel={bottleneckActionLabel(ctx)}
      actionHref={bottleneckDeepLink(stage, projectId, label)}
      preview={preview}
    />
  )
}
