/**
 * Canonical async job / upgrade PR status chip — shared across Connect,
 * Projects bulk upgrade, and SdkUpgradeCTA surfaces.
 */

import { IconCheck, IconExternalLink } from '../icons'
import { Tooltip } from './misc'
import { CHIP_TONE } from '../../lib/chipTone'

const SPINNER = (
  <span
    className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
    aria-hidden
  />
)

export interface JobStatusPillProps {
  status: string
  prUrl?: string
  error?: string
  /** Override idle label for queue states */
  queueLabel?: string
  runningLabel?: string
}

export function JobStatusPill({
  status,
  prUrl,
  error,
  queueLabel = 'Queuing…',
  runningLabel = 'Opening PR…',
}: JobStatusPillProps) {
  if (status === 'idle') return null

  if (status === 'queueing' || status === 'queued') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${CHIP_TONE.neutral}`}
      >
        {SPINNER}
        {queueLabel}
      </span>
    )
  }

  if (status === 'running') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP_TONE.brandSubtle}`}
      >
        {SPINNER}
        {runningLabel}
      </span>
    )
  }

  if (status === 'completed' && prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-90 motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${CHIP_TONE.okSubtle}`}
      >
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        PR opened
        <IconExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </a>
    )
  }

  if (status === 'completed_no_pr') {
    return (
      <Tooltip content={error ?? 'All @mushi-mushi/* packages are already at the latest version.'} side="top">
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP_TONE.okSubtle}`}
        >
          <IconCheck className="h-3.5 w-3.5" aria-hidden />
          All up to date
        </span>
      </Tooltip>
    )
  }

  if (status === 'failed') {
    return (
      <Tooltip content={error ?? 'Unknown error'} side="top">
        <span
          role="status"
          aria-live="assertive"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP_TONE.dangerSubtle}`}
        >
          Failed
        </span>
      </Tooltip>
    )
  }

  return null
}
