/**
 * TraceWaterfall — Phase 4a
 *
 * Renders a proportional span waterfall that shows the full client → server
 * causal chain for a bug report:
 *
 *   [SDK: fetch/xhr request ─────────────────────────]
 *      └─ [backend span: router handler ──────────]
 *            └─ [backend span: db query ──]
 *
 * Data sources:
 *   - `networkRequests`: SDK-captured fetch/XHR entries (from reports.network_logs).
 *   - `backendSpans`:    Server-side spans joined by trace_id (from backend_spans table).
 *
 * Both sources are already available on ReportDetailPage — networkRequests comes
 * from the evidence and backendSpans comes from the Phase 1a join in reports.ts.
 */
import { Fragment, useState } from 'react'
import { LegendDot } from '../charts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaterfallNetworkEntry {
  method: string
  url: string
  status: number
  duration: number
  timestamp: number
  traceId?: string
  captureMethod?: 'fetch' | 'xhr'
  correlationId?: string
}

export interface WaterfallSpanEntry {
  id: string
  trace_id: string
  span_json: {
    spanId?: string
    parentSpanId?: string
    name?: string
    status?: string
    duration_ms?: number
    attributes?: Record<string, unknown>
  }
  ingested_at: string
}

interface WaterfallRow {
  id: string
  label: string
  durationMs: number
  offsetMs: number
  source: 'network' | 'backend'
  status: 'ok' | 'error' | 'pending'
  parentId?: string
  depth: number
  tooltip: string
  traceId?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spanStatus(span: WaterfallSpanEntry['span_json']): 'ok' | 'error' | 'pending' {
  const s = span?.status?.toLowerCase()
  if (!s) return 'pending'
  // OTel UNSET (code 0) is the default for spans that finished without an
  // explicit setStatus — not an error (see otlp-exporter.ts).
  if (s.includes('unset')) return 'ok'
  if (s.includes('error') || s.includes('fail')) return 'error'
  return 'ok'
}

function networkStatus(status: number): 'ok' | 'error' | 'pending' {
  if (status === 0) return 'error'
  if (status >= 400) return 'error'
  return 'ok'
}

const STATUS_BAR: Record<string, string> = {
  ok: 'bg-ok',
  error: 'bg-danger',
  pending: 'bg-fg-faint',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TraceWaterfall({
  networkRequests,
  backendSpans,
}: {
  networkRequests: WaterfallNetworkEntry[] | null | undefined
  backendSpans: WaterfallSpanEntry[] | null | undefined
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  if ((!networkRequests || networkRequests.length === 0) && (!backendSpans || backendSpans.length === 0)) {
    return null
  }

  // ── Build a unified list of rows ──────────────────────────────────────────
  const rows: WaterfallRow[] = []

  // Network requests are root rows (depth 0).
  // We only include requests that have a traceId (meaning backend spans may exist for them).
  const tracedRequests = (networkRequests ?? []).filter((r) => r.traceId)
  const untracedRequests = (networkRequests ?? []).filter((r) => !r.traceId)

  // All timestamps are relative to the earliest event in this waterfall.
  const allTimestamps = [
    ...tracedRequests.map((r) => r.timestamp),
    ...(backendSpans ?? []).map((s) => new Date(s.ingested_at).getTime()),
  ]
  const originMs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0

  // Add traced network requests as root rows.
  for (const req of tracedRequests) {
    rows.push({
      id: `net-${req.traceId ?? req.timestamp}`,
      label: `${req.method} ${req.url.split('?')[0]}`,
      durationMs: req.duration,
      offsetMs: req.timestamp - originMs,
      source: 'network',
      status: networkStatus(req.status),
      depth: 0,
      tooltip: `${req.captureMethod ?? 'SDK'} • ${req.method} ${req.url} → ${req.status} • ${req.duration}ms`,
      traceId: req.traceId,
    })
  }

  // Backend spans: build a depth map via parentSpanId.
  const spanDepths = new Map<string, number>()
  const spanParents = new Map<string, string>()

  const sortedSpans = [...(backendSpans ?? [])].sort(
    (a, b) => new Date(a.ingested_at).getTime() - new Date(b.ingested_at).getTime(),
  )

  for (const span of sortedSpans) {
    const sj = span.span_json
    const spanId = sj?.spanId ?? span.id
    const parentId = sj?.parentSpanId
    const depth = parentId && spanDepths.has(parentId) ? (spanDepths.get(parentId) ?? 0) + 1 : 1
    spanDepths.set(spanId, depth)
    if (parentId) spanParents.set(spanId, parentId)

    rows.push({
      id: `span-${span.id}`,
      label: sj?.name ?? `span ${span.trace_id.slice(0, 8)}`,
      durationMs: sj?.duration_ms ?? 0,
      offsetMs: new Date(span.ingested_at).getTime() - originMs,
      source: 'backend',
      status: spanStatus(sj),
      parentId: parentId ? `span-${parentId}` : undefined,
      depth,
      tooltip: `Backend • ${sj?.name ?? '(span)'} • ${sj?.duration_ms ?? 0}ms • status: ${sj?.status ?? 'unknown'}`,
      traceId: span.trace_id,
    })
  }

  // Calculate total window for proportional widths.
  const maxEnd = Math.max(
    ...rows.map((r) => r.offsetMs + r.durationMs),
    1,
  )

  return (
    <div className="flex flex-col gap-0">
      {/* Legend */}
      <div className="flex items-center gap-4 px-2 py-1 border-b border-edge-subtle/30 text-2xs text-fg-faint">
        <LegendDot color="bg-brand" label="network (SDK)" />
        <LegendDot color="bg-accent" label="backend span" />
        <LegendDot color="bg-ok" label="ok" />
        <LegendDot color="bg-danger" label="error" />
      </div>

      {/* Waterfall rows */}
      {rows.map((row) => {
        const leftPct = maxEnd > 0 ? (row.offsetMs / maxEnd) * 100 : 0
        const widthPct = maxEnd > 0 ? Math.max((row.durationMs / maxEnd) * 100, 0.5) : 0.5
        const isExpanded = expandedRow === row.id
        const attrs = row.source === 'backend'
          ? (backendSpans ?? []).find((s) => `span-${s.id}` === row.id)?.span_json?.attributes
          : null

        return (
          <div key={row.id} className="border-b border-edge-subtle/20 last:border-b-0">
            {/* Row */}
            <div
              className="grid items-center gap-1 px-2 py-1 hover:bg-surface-overlay/50 cursor-pointer"
              style={{ gridTemplateColumns: '16px 160px 1fr 48px' }}
              title={row.tooltip}
              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setExpandedRow(isExpanded ? null : row.id)}
            >
              {/* Depth indent (max 4 levels) */}
              <div style={{ width: `${row.depth * 8}px` }} className="shrink-0" />

              {/* Label */}
              <span
                className="min-w-0 truncate font-mono text-2xs text-fg-secondary"
                style={{ paddingLeft: `${row.depth * 8}px` }}
              >
                {row.label}
              </span>

              {/* Proportional bar */}
              <div className="relative h-3 rounded-sm overflow-hidden bg-surface-overlay/60">
                <div
                  className={`absolute h-full rounded-sm ${STATUS_BAR[row.status]} opacity-80`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </div>

              {/* Duration */}
              <span className="shrink-0 text-right font-mono text-3xs text-fg-faint tabular-nums">
                {row.durationMs > 0 ? `${row.durationMs}ms` : '—'}
              </span>
            </div>

            {/* Expanded attributes panel */}
            {isExpanded && attrs && Object.keys(attrs).length > 0 && (
              <div className="px-4 py-1 bg-surface-overlay/30 border-t border-edge-subtle/20">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {Object.entries(attrs).slice(0, 12).map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="font-mono text-3xs text-fg-faint truncate">{k}</dt>
                      <dd className="font-mono text-3xs text-fg-secondary truncate">
                        {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )
      })}

      {/* Untraced requests (no backend spans) shown as simple rows below */}
      {untracedRequests.length > 0 && (
        <div className="border-t border-edge-subtle/30 mt-1">
          <p className="px-2 py-1 text-3xs text-fg-faint">
            {untracedRequests.length} request{untracedRequests.length > 1 ? 's' : ''} without trace propagation
          </p>
        </div>
      )}
    </div>
  )
}
