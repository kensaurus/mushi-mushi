/**
 * FILE: apps/admin/src/components/dashboard/FixPipelineMeter.tsx
 * PURPOSE: Visual auto-fix pipeline — proportional segment bar + status
 *          glyphs so operators see failures first without reading four
 *          identical stat boxes (NN/g #1 Visibility, #6 Recognition).
 */

import { Link } from 'react-router-dom'
import type { FixSummary } from './types'
import { SignalChip } from '../report-detail/ReportSurface'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  fixSummary: FixSummary
}

type SegmentTone = 'danger' | 'info' | 'ok' | 'muted'

const SEGMENT_BG: Record<SegmentTone, string> = {
  danger: 'bg-danger',
  info: 'bg-info',
  ok: 'bg-ok',
  muted: 'bg-fg-faint/35',
}

export function FixPipelineMeter({ fixSummary }: Props) {
  const { total, failed, inProgress, openPrs } = fixSummary
  const denom = Math.max(total, 1)

  const segments: Array<{ key: string; count: number; tone: SegmentTone; label: string }> = [
    { key: 'failed', count: failed, tone: 'danger', label: 'Failed' },
    { key: 'in-progress', count: inProgress, tone: 'info', label: 'In flight' },
    { key: 'open-prs', count: openPrs, tone: 'ok', label: 'Open PRs' },
  ]

  const accounted = failed + inProgress + openPrs
  const remainder = Math.max(0, total - accounted)
  if (remainder > 0) {
    segments.push({ key: 'other', count: remainder, tone: 'muted', label: 'Other' })
  }

  const hasFailure = failed > 0
  const primaryHref = hasFailure ? '/fixes?status=failed' : openPrs > 0 ? '/fixes?status=open_pr' : '/fixes'
  const primaryLabel = hasFailure
    ? `${failed} failed — retry`
    : openPrs > 0
      ? `${openPrs} PR${openPrs === 1 ? '' : 's'} ready`
      : 'Open fixes'

  return (
    <div className="space-y-2.5">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full border border-edge-subtle/80 bg-surface-overlay/40"
        role="img"
        aria-label={`Auto-fix pipeline: ${failed} failed, ${inProgress} in flight, ${openPrs} open PRs, ${total} total`}
      >
        {segments.map((seg) => {
          if (seg.count <= 0) return null
          const pct = (seg.count / denom) * 100
          return (
            <div
              key={seg.key}
              className={`h-full min-w-[3px] motion-safe:transition-[width] ${SEGMENT_BG[seg.tone]} ${
                seg.tone === 'danger' && hasFailure ? 'motion-safe:animate-pulse' : ''
              }`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          )
        })}
        {total === 0 && <div className="h-full w-full bg-fg-faint/20" aria-hidden />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {segments.map((seg) =>
          seg.count > 0 ? (
            <SignalChip
              key={seg.key}
              tone={seg.tone === 'muted' ? 'neutral' : seg.tone}
              className={seg.tone === 'danger' && hasFailure ? 'motion-safe:animate-pulse' : undefined}
            >
              {seg.count} {seg.label}
            </SignalChip>
          ) : null,
        )}
        <SignalChip tone="neutral" className="ml-auto">
          {total} total
        </SignalChip>
      </div>

      <Link
        to={primaryHref}
        className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs font-medium motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
          hasFailure
            ? `border-danger/40 ${CHIP_TONE.dangerSubtle} hover:bg-danger/15`
            : openPrs > 0
              ? `border-ok/35 ${CHIP_TONE.okSubtle} hover:bg-ok/15`
              : 'border-edge-subtle bg-surface-overlay/30 text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg'
        }`}
      >
        <span className="min-w-0 truncate">{primaryLabel}</span>
        <span aria-hidden className="shrink-0 opacity-70">→</span>
      </Link>
    </div>
  )
}
