/**
 * Compact workflow stage row — live metric + posture chip + optional expand.
 * Used inside FeatureExplainPanel guides instead of nested bordered wells.
 */

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronDown } from '../icons'
import { GUIDE_CLEAR_WHEN_LABEL } from '../../lib/guideCopy'
import type { WorkflowPosture } from '../../lib/guideLiveOverlay'
import { GUIDE_STAGE_ROW_NEUTRAL } from '../../lib/guideSurfaces'

/** Chip sits on a tinted row — use raised surface so posture text stays crisp. */
const POSTURE_CHIP: Record<WorkflowPosture, string> = {
  clear: 'bg-surface-raised text-ok border border-ok/30',
  open: 'bg-surface-raised text-warn border border-warn/35',
  warn: 'bg-surface-raised text-warn border border-warn/35',
  danger: 'bg-surface-raised text-danger border border-danger/35',
  info: 'bg-surface-raised text-info border border-info/35',
  ok: 'bg-surface-raised text-ok border border-ok/30',
}

const POSTURE_ROW: Record<WorkflowPosture, string> = {
  clear: GUIDE_STAGE_ROW_NEUTRAL,
  open: 'border-warn/35 bg-warn-muted',
  warn: 'border-warn/35 bg-warn-muted',
  danger: 'border-danger/30 bg-danger-muted',
  info: 'border-info/30 bg-info-muted',
  ok: 'border-ok/30 bg-ok-muted',
}

const CHIP_LABEL: Record<WorkflowPosture, string> = {
  clear: 'Clear',
  open: 'Open',
  warn: 'Attention',
  danger: 'Blocked',
  info: 'Info',
  ok: 'OK',
}

export interface WorkflowStageRowProps {
  id: string
  shortLabel: string
  icon?: ReactNode
  metric?: string
  posture: WorkflowPosture
  actionLine?: string
  actionHref?: string
  plain?: string
  clearsWhen?: string
  examples?: string[]
  /** Auto-expand when posture is not clear and detail exists. */
  defaultExpanded?: boolean
}

export function WorkflowStageRow({
  id,
  shortLabel,
  icon,
  metric,
  posture,
  actionLine,
  actionHref,
  plain,
  clearsWhen,
  examples,
  defaultExpanded,
}: WorkflowStageRowProps) {
  const hasDetail = Boolean(
    plain ||
    clearsWhen ||
    (examples && examples.length > 0 && posture !== 'clear'),
  )
  const [expanded, setExpanded] = useState(
    defaultExpanded ?? (hasDetail && posture !== 'clear'),
  )

  const chipText = metric ?? CHIP_LABEL[posture]

  return (
    <div
      className={`rounded-md border px-2.5 py-2 ${POSTURE_ROW[posture]}`}
      data-workflow-stage={id}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="shrink-0 text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 text-xs font-medium text-fg truncate">{shortLabel}</span>
        <span
          className={`shrink-0 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide whitespace-nowrap ${POSTURE_CHIP[posture]}`}
        >
          {chipText}
        </span>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded p-0.5 text-fg-faint hover:text-fg-secondary"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse stage details' : 'Expand stage details'}
          >
            <IconChevronDown
              size={14}
              className={`motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {actionLine && (
        <p className="mt-1 text-2xs text-fg-muted leading-snug">
          {actionHref ? (
            <Link to={actionHref} className="text-brand hover:underline">
              {actionLine}
            </Link>
          ) : (
            actionLine
          )}
        </p>
      )}
      {expanded && hasDetail && (
        <div className="mt-2 space-y-1 border-t border-edge-subtle/60 pt-2">
          {plain && <p className="text-2xs text-fg-muted leading-relaxed">{plain}</p>}
          {clearsWhen && (
            <p className="text-2xs text-fg-faint">
              <span className="font-medium text-fg-secondary">{GUIDE_CLEAR_WHEN_LABEL}:</span>{' '}
              {clearsWhen}
            </p>
          )}
          {examples && examples.length > 0 && posture !== 'clear' && (
            <p className="text-2xs text-fg-faint">
              <span className="font-medium text-fg-secondary">Examples:</span>{' '}
              {examples.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
