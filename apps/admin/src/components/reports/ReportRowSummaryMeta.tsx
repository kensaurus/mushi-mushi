import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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

/** Derives deterministic tag chips from already-present report fields.
 *  - page: route / URL path where the bug was felt
 *  - screenshot: report has an attached screenshot
 *  - area: AI-generated product-area label (e.g. "Checkout")
 *  No LLM call — purely from existing row data. */
export function ReportTagChips({ row, className = '' }: { row: ReportRow; className?: string }) {
  const route =
    (row.environment as { route?: string } | null | undefined)?.route
    ?? (row.environment as { url?: string } | null | undefined)?.url
  // Derive the displayable page path — strip origin, keep path
  const pagePath = (() => {
    if (!route) return null
    try {
      const u = new URL(route)
      return u.pathname === '/' ? null : u.pathname
    } catch {
      // Not a full URL — treat as a path segment
      return route.startsWith('/') && route !== '/' ? route : null
    }
  })()
  // screenshot_url / screenshot_path are not on ReportRow (they live on
  // ReportDetail) but may be present when the row is used in a wider context.
  // Access via unknown to avoid TS index-signature complaint.
  const rowAny = row as unknown as Record<string, unknown>
  const hasScreenshot = Boolean(rowAny['screenshot_url'] || rowAny['screenshot_path'])
  const area = row.area_tag

  const screenshotUrl = (rowAny['screenshot_url'] as string | undefined) ?? null

  if (!pagePath && !hasScreenshot && !area) return null

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      {pagePath && (
        <Tooltip portal content={`Activity for page: ${route}`}>
          <Link
            to={`/activity?route=${encodeURIComponent(pagePath)}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-edge-subtle bg-surface-overlay px-1 py-0.5 text-2xs font-mono text-fg-muted hover:text-brand hover:border-brand/40 transition-colors max-w-[10rem] truncate"
          >
            📄 {pagePath}
          </Link>
        </Tooltip>
      )}
      {hasScreenshot && screenshotUrl && (
        <Tooltip portal content="Open screenshot">
          <a
            href={screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-edge-subtle bg-surface-overlay px-1 py-0.5 text-2xs text-fg-muted hover:text-brand hover:border-brand/40 transition-colors"
          >
            📷 screenshot
          </a>
        </Tooltip>
      )}
      {hasScreenshot && !screenshotUrl && (
        <Tooltip portal content="Screenshot attached">
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-edge-subtle bg-surface-overlay px-1 py-0.5 text-2xs text-fg-muted cursor-help">
            📷 screenshot
          </span>
        </Tooltip>
      )}
      {area && (
        <Tooltip portal content={`Filter reports by area: ${area}`}>
          <Link
            to={`/reports?area=${encodeURIComponent(area)}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center rounded-sm border border-brand/25 bg-brand-muted/30 px-1 py-0.5 text-2xs font-medium text-brand-foreground hover:bg-brand-muted/50 transition-colors"
          >
            {area}
          </Link>
        </Tooltip>
      )}
    </div>
  )
}

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
