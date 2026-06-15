/**
 * CI check-run status as a 3-segment heat strip — faster to scan than a badge alone.
 */

import { Tooltip } from '../ui'
import type { FixAttempt } from './types'
import { ciBadge } from './types'

const CI_SEGMENTS = 3

type CiPhase = 'unknown' | 'pending' | 'running' | 'success' | 'failure' | 'neutral'

function ciPhase(fix: FixAttempt): CiPhase {
  const conclusion = fix.check_run_conclusion?.toLowerCase()
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'failure'
  if (conclusion === 'neutral' || conclusion === 'cancelled') return 'neutral'

  const status = fix.check_run_status?.toLowerCase()
  if (status === 'in_progress' || status === 'queued') return 'running'
  if (status === 'completed' && !conclusion) return 'pending'
  return 'unknown'
}

function filledSegments(phase: CiPhase): number {
  switch (phase) {
    case 'success':
      return 3
    case 'failure':
      return 1
    case 'running':
      return 2
    case 'pending':
    case 'neutral':
      return 1
    default:
      return 0
  }
}

function segmentTone(phase: CiPhase, filled: boolean): string {
  if (!filled) return 'bg-edge-subtle/70'
  switch (phase) {
    case 'success':
      return 'bg-ok'
    case 'failure':
      return 'bg-danger'
    case 'running':
      return 'bg-info'
    case 'pending':
    case 'neutral':
      return 'bg-warn/80'
    default:
      return 'bg-edge-subtle/70'
  }
}

interface Props {
  fix: FixAttempt
}

export function CiStatusCell({ fix }: Props) {
  const badge = ciBadge(fix)
  if (!badge) {
    return <span className="text-3xs text-fg-faint">—</span>
  }

  const phase = ciPhase(fix)
  const filled = filledSegments(phase)
  const shortLabel = badge.label.replace(/^CI:\s*/i, '')

  return (
    <Tooltip content={badge.label}>
      <div className="inline-flex min-w-0 max-w-full flex-col gap-0.5">
        <div
          className="inline-flex gap-px"
          role="img"
          aria-label={badge.label}
        >
          {Array.from({ length: CI_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-1.5 rounded-[1px] motion-safe:transition-colors ${segmentTone(phase, i < filled)}`}
            />
          ))}
        </div>
        <span className="text-3xs font-mono text-fg-muted truncate max-w-[5.5rem]">
          {shortLabel}
        </span>
      </div>
    </Tooltip>
  )
}
