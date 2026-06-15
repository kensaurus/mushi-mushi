import type { ReactNode } from 'react'
import { Tooltip } from '../ui'
import { IconBolt } from '../icons'
import { ReportCodeText } from './ReportCodeText'
import type { ReportRow } from './types'
import {
  captureMode,
  inferReportLayer,
  LAYER_PILL,
  reporterWho,
  resolveReportPath,
  type ReportLayer,
} from './reportRowAttribution'

interface Props {
  row: ReportRow
}

function LayerPill({ layer }: { layer: ReportLayer }) {
  const cfg = LAYER_PILL[layer]
  return (
    <Tooltip portal content={cfg.tooltip}>
      <span
        className={`inline-flex shrink-0 items-center rounded-sm border px-1 py-0.5 text-2xs font-semibold uppercase tracking-wide cursor-help ${cfg.tone}`}
      >
        {cfg.label}
      </span>
    </Tooltip>
  )
}

export function ReportRowLayerPill({ row }: Props) {
  const layer = inferReportLayer(row)
  if (!layer) return null
  return <LayerPill layer={layer} />
}

export function ReportRowMeta({ row }: Props) {
  const capture = captureMode(row.proactive_trigger)
  const who = reporterWho(row)
  const { path, fullTitle } = resolveReportPath(row)
  const traceShort = row.sentry_trace_id ? `${row.sentry_trace_id.slice(0, 7)}…` : null
  const sdkDetail = row.sdk_package
    ? `${row.sdk_package}${row.sdk_version ? `@${row.sdk_version}` : ''}`
    : null

  if (!path && !traceShort) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <MetaChip tone={capture.tone} tooltip={capture.tooltip}>
          {capture.label}
        </MetaChip>
        <MetaChip tooltip={who.tooltip}>
          {who.verified && <span className="text-ok" aria-hidden="true">✓ </span>}
          {who.label}
        </MetaChip>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <MetaChip tone={capture.tone} tooltip={capture.tooltip}>
        {capture.label}
      </MetaChip>
      <span className="text-fg-faint/60 select-none" aria-hidden="true">
        ·
      </span>
      <MetaChip tooltip={who.tooltip}>
        {who.verified && <span className="text-ok" aria-hidden="true">✓ </span>}
        <span className="max-w-[9rem] truncate">{who.label}</span>
      </MetaChip>
      {path && (
        <>
          <span className="text-fg-faint/60 select-none" aria-hidden="true">
            ·
          </span>
          <Tooltip portal content={[fullTitle, sdkDetail].filter(Boolean).join(' · ') || path}>
            <span className="min-w-0 max-w-[14rem] cursor-help">
              <ReportCodeText title={fullTitle ?? path} className="max-w-full">
                {path}
              </ReportCodeText>
            </span>
          </Tooltip>
        </>
      )}
      {traceShort && (
        <Tooltip portal content={`Sentry trace: ${row.sentry_trace_id}`}>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-info/30 bg-info-muted/40 px-1 py-0.5 text-2xs font-mono text-info-foreground cursor-help">
            <IconBolt className="size-2.5" />
            {traceShort}
          </span>
        </Tooltip>
      )}
    </div>
  )
}

function MetaChip({
  children,
  tooltip,
  tone = 'bg-surface-overlay text-fg-muted border-edge-subtle',
}: {
  children: ReactNode
  tooltip: string
  tone?: string
}) {
  return (
    <Tooltip portal content={tooltip}>
      <span
        className={`inline-flex max-w-full min-w-0 shrink-0 items-center truncate rounded-sm border px-1 py-0.5 text-2xs font-medium cursor-help ${tone}`}
      >
        {children}
      </span>
    </Tooltip>
  )
}
