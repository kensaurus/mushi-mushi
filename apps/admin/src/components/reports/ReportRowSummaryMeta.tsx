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
  routePathname,
  type ReportLayer,
} from './reportRowAttribution'

/** Derives deterministic tag chips from already-present report fields.
 *  - page: route / URL path where the bug was felt
 *  - screenshot: report has an attached screenshot
 *  - area: AI-generated product-area label (e.g. "Checkout")
 *  No LLM call — purely from existing row data. */
/** The page the report came from, as a path ("/api/calendar"), or null. */
function rowPagePath(row: ReportRow): string | null {
  const route =
    (row.environment as { route?: string } | null | undefined)?.route
    ?? (row.environment as { url?: string } | null | undefined)?.url
  const path = routePathname(route)
  return path && path.startsWith('/') && path !== '/' ? path : null
}

export function ReportTagChips({ row, className = '' }: { row: ReportRow; className?: string }) {
  // The info line above already shows this path (as the activity link): a
  // second chip put the same path on a third line of every row (2026-11-16).
  const pagePath = resolveReportPath(row).path === rowPagePath(row) ? null : rowPagePath(row)
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
        <Tooltip portal content={`Activity for page: ${pagePath}`}>
          <Link
            to={`/activity?route=${encodeURIComponent(pagePath)}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-overlay px-1 py-px text-2xs font-mono text-fg-muted hover:text-brand transition-opacity max-w-40 truncate"
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
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-overlay px-1 py-px text-2xs text-fg-muted hover:text-brand transition-opacity"
          >
            📷 screenshot
          </a>
        </Tooltip>
      )}
      {hasScreenshot && !screenshotUrl && (
        <Tooltip portal content="Screenshot attached">
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-overlay px-1 py-px text-2xs text-fg-muted cursor-help">
            📷 screenshot
          </span>
        </Tooltip>
      )}
      {area && (
        <Tooltip portal content={`Filter reports by area: ${area}`}>
          <Link
            to={`/reports?area=${encodeURIComponent(area)}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center rounded-sm border border-brand/25 bg-brand-muted/30 px-1 py-0.5 text-2xs font-medium text-brand-foreground hover:bg-brand-muted/50 transition-opacity"
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
        className={`inline-flex shrink-0 items-center rounded-sm px-1 py-px text-2xs font-semibold cursor-help ${cfg.tone}`}
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
  const capture = captureMode(row.proactive_trigger, row)
  const who = reporterWho(row)
  // An anonymous reporter whose key only names the source ("anon·sentry" beside "sentry")
  // says the same thing twice: keep the source chip, carry the reporter in its tooltip.
  const whoRepeatsSource = !who.verified && who.label.toLowerCase().includes(capture.label.toLowerCase())
  const captureTooltip = whoRepeatsSource ? `${capture.tooltip} · ${who.tooltip}` : capture.tooltip
  const { path, fullTitle } = resolveReportPath(row)
  const traceShort = row.sentry_trace_id ? `${row.sentry_trace_id.slice(0, 7)}…` : null
  const sdkDetail = row.sdk_package
    ? `${row.sdk_package}${row.sdk_version ? `@${row.sdk_version}` : ''}`
    : null
  const app = row.project_name ? (
    <MetaChip tooltip={`App: ${row.project_name}`}>
      <span className="max-w-36 truncate">{row.project_name}</span>
    </MetaChip>
  ) : null

  if (!path && !traceShort) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {app}
        <MetaChip tone={capture.tone} tooltip={captureTooltip}>
          {capture.label}
        </MetaChip>
        {!whoRepeatsSource && (
          <MetaChip tooltip={who.tooltip}>
            {who.verified && <span className="text-ok" aria-hidden="true">✓ </span>}
            {who.label}
          </MetaChip>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {app}
      <MetaChip tone={capture.tone} tooltip={captureTooltip}>
        {capture.label}
      </MetaChip>
      {!whoRepeatsSource && (
        <>
          <span className="text-fg-faint/60 select-none" aria-hidden="true">
            ·
          </span>
          <MetaChip tooltip={who.tooltip}>
            {who.verified && <span className="text-ok" aria-hidden="true">✓ </span>}
            <span className="max-w-36 truncate">{who.label}</span>
          </MetaChip>
        </>
      )}
      {path && (
        <>
          <span className="text-fg-faint/60 select-none" aria-hidden="true">
            ·
          </span>
          <Tooltip portal content={[fullTitle, sdkDetail].filter(Boolean).join(' · ') || path}>
            {path === rowPagePath(row) ? (
              <Link
                to={`/activity?route=${encodeURIComponent(path)}`}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 max-w-56 hover:underline"
              >
                <ReportCodeText title={fullTitle ?? path} className="max-w-full">
                  {path}
                </ReportCodeText>
              </Link>
            ) : (
              <span className="min-w-0 max-w-56 cursor-help">
                <ReportCodeText title={fullTitle ?? path} className="max-w-full">
                  {path}
                </ReportCodeText>
              </span>
            )}
          </Tooltip>
        </>
      )}
      {traceShort && (
        <Tooltip portal content={`Sentry trace: ${row.sentry_trace_id}`}>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-info-muted/40 px-1 py-px text-2xs font-mono text-info-foreground cursor-help">
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
        className={`inline-flex max-w-full min-w-0 shrink-0 items-center truncate rounded-sm px-1 py-px text-2xs font-medium cursor-help ${tone}`}
      >
        {children}
      </span>
    </Tooltip>
  )
}
