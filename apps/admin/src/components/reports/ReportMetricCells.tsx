/**
 * Heatmap / meter cells for the triage table — numeric values rendered as
 * scannable color scales instead of plain text (NN/g #6 Recognition).
 */

import { Tooltip } from '../ui'
import { SEVERITY_TRAFFIC, SEVERITY_TRAFFIC_BADGE, type SeverityTrafficKey } from '../../lib/severityTraffic'
import { severityLabelShort } from './types'
import {
  blastRadiusBlockTone,
  blastRadiusFilledBlocks,
  blastRadiusIntensity,
  confidenceBarTone,
  confidenceCellTint,
  confidenceEmptySegmentTone,
  confidencePercent,
  confidenceSegmentCount,
  confidenceSegmentFilled,
  confidenceTextTone,
  recencyBarTone,
  recencyFreshness,
  recencyHours,
  severityActiveIndex,
  severityLevelKeys,
} from './reportMetricViz'

interface ConfidenceCellProps {
  confidence: number | null | undefined
  /** `table` = compact vertical stack, centered in metric cell. */
  layout?: 'default' | 'table'
}

/** 5-block heat strip + tinted wash + color-scaled %. */
export function TableConfidenceCell({ confidence, layout = 'default' }: ConfidenceCellProps) {
  const pct = confidencePercent(confidence)
  if (pct == null || confidence == null) {
    return <span className="block w-full text-center text-2xs text-fg-faint">—</span>
  }

  const barTone = confidenceBarTone(confidence)
  const tint = confidenceCellTint(confidence)
  const textTone = confidenceTextTone(pct)
  const isTable = layout === 'table'

  const bar = (
    <div
      className={`flex gap-px h-1.5 ${isTable ? 'w-full max-w-[2.75rem]' : 'min-w-0 flex-1'}`}
      aria-hidden="true"
    >
      {Array.from({ length: confidenceSegmentCount }, (_, i) => (
        <span
          key={i}
          className={`flex-1 rounded-hairline motion-safe:transition-opacity ${
            confidenceSegmentFilled(pct, i) ? barTone : confidenceEmptySegmentTone()
          }`}
        />
      ))}
    </div>
  )

  const pctLabel = (
    <span className={`shrink-0 text-2xs font-mono font-semibold tabular-nums leading-none ${textTone}`}>
      {pct}%
    </span>
  )

  const body = isTable ? (
    <div
      className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5"
      role="img"
      aria-label={`Confidence ${pct} percent`}
    >
      {bar}
      {pctLabel}
    </div>
  ) : (
    <div
      className={`flex min-w-0 w-full items-center gap-1 rounded-sm px-0.5 py-0.5 ${tint}`}
      role="img"
      aria-label={`Confidence ${pct} percent`}
    >
      {bar}
      {pctLabel}
    </div>
  )

  return (
    <Tooltip
      portal
      content={`LLM confidence ${pct}% — ${pct >= 85 ? 'high' : pct >= 65 ? 'review suggested' : 'low; read breadcrumbs before dispatch'}`}
      className={isTable ? 'flex h-full w-full min-w-0 items-center justify-center' : undefined}
    >
      {body}
    </Tooltip>
  )
}

interface SeverityCellProps {
  severity: string | null | undefined
}

/** Traffic-light segment strip — active severity column lit, rest muted. */
export function TableSeverityCell({ severity }: SeverityCellProps) {
  if (!severity) {
    return <span className="text-2xs text-fg-faint">—</span>
  }

  const activeIdx = severityActiveIndex(severity)
  const label = severityLabelShort(severity)
  const traffic = SEVERITY_TRAFFIC[severity as keyof typeof SEVERITY_TRAFFIC]
  const badgeCls = SEVERITY_TRAFFIC_BADGE[severity] ?? 'bg-surface-overlay text-fg-muted border border-edge-subtle'

  return (
    <Tooltip portal content={`Severity: ${traffic?.label ?? severity}`}>
      <div className="flex min-w-0 w-full items-center gap-1">
        <div
          className="flex min-w-0 flex-1 gap-px h-1.5"
          role="img"
          aria-label={`Severity ${traffic?.label ?? severity}`}
        >
          {severityLevelKeys.map((level: SeverityTrafficKey, i: number) => {
            const active = i === activeIdx
            const tone = SEVERITY_TRAFFIC[level]?.bg ?? 'bg-surface-overlay/80'
            return (
              <span
                key={level}
                className={[
                  'flex-1 rounded-hairline motion-safe:transition-opacity',
                  active ? tone : 'bg-fg-faint/15',
                  active ? 'ring-1 ring-inset ring-fg/15' : 'opacity-40',
                ].join(' ')}
                aria-hidden="true"
              />
            )
          })}
        </div>
        <span
          className={`inline-flex shrink-0 max-w-full min-w-0 truncate rounded-sm px-0.5 py-px text-2xs font-medium leading-none ${badgeCls}`}
        >
          {label}
        </span>
      </div>
    </Tooltip>
  )
}

interface BlastRadiusMeterProps {
  value: number
  /** Tooltip body (caller supplies dedup vs unique-user copy). */
  tooltip: string
}

const BLAST_BLOCKS = 5

/** Block heatmap for blast radius (×N felt). */
export function BlastRadiusMeter({ value, tooltip }: BlastRadiusMeterProps) {
  if (value <= 1) return null

  const intensity = blastRadiusIntensity(value)
  const filled = blastRadiusFilledBlocks(value, BLAST_BLOCKS)

  return (
    <Tooltip portal content={tooltip}>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-edge-subtle bg-surface-overlay/30 px-1.5 py-0.5 cursor-help">
        <span className="inline-flex gap-px shrink-0" aria-hidden="true">
          {Array.from({ length: BLAST_BLOCKS }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-1 rounded-hairline ${blastRadiusBlockTone(intensity, i < filled)}`}
            />
          ))}
        </span>
        <span className="text-2xs font-mono tabular-nums text-fg-secondary whitespace-nowrap">
          ×{value}
        </span>
      </span>
    </Tooltip>
  )
}

/** Recency row with external label (keeps formatRelative in ReportRowView). */
export function RecencyHeatLabel({
  createdAt,
  label,
  className = '',
  wrapperClass = '',
  /** Table action column — text-only age to avoid overlapping the CTA row. */
  compact = false,
}: {
  createdAt: string
  label: string
  className?: string
  wrapperClass?: string
  compact?: boolean
}) {
  const hours = recencyHours(createdAt)
  const freshness = recencyFreshness(hours)
  const tone = recencyBarTone(hours)
  const full = new Date(createdAt).toLocaleString()

  if (compact) {
    return (
      <Tooltip portal content={full} className={wrapperClass || undefined}>
        <span className={`block w-full truncate text-right text-3xs font-mono text-fg-faint tabular-nums leading-none cursor-help ${className}`}>
          {label}
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip portal content={full} className={wrapperClass || undefined}>
      <div className={`flex min-w-0 w-full flex-col items-stretch gap-0.5 ${className}`}>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-fg-faint/15 border border-edge-subtle/60"
          role="progressbar"
          aria-valuenow={Math.round(freshness * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Report age: ${label}`}
        >
          <div
            className={`h-full rounded-full motion-safe:transition-[width] ${tone}`}
            style={{ width: `${Math.round(freshness * 100)}%` }}
          />
        </div>
        <span className="self-end text-2xs font-mono text-fg-faint tabular-nums cursor-help whitespace-nowrap">
          {label}
        </span>
      </div>
    </Tooltip>
  )
}
