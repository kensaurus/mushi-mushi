/**
 * FILE: apps/admin/src/components/charts.tsx
 * PURPOSE: Shared visual primitives used across Dashboard, Judge, Queue,
 *          Fixes, and Prompt Lab. Extracted so every page speaks the same
 *          visual language — Kpi tiles, sparklines, stacked bars, status pills.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card, Badge, Tooltip } from './ui'

/* ── KpiTile ────────────────────────────────────────────────────────────── */

export type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'muted' | 'info'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  brand: 'text-brand',
  muted: 'text-fg-muted',
  info: 'text-info',
}

const ARROW: Record<'up' | 'down' | 'flat', string> = {
  up: '↑',
  down: '↓',
  flat: '·',
}

export interface KpiDelta {
  value: string
  direction: 'up' | 'down' | 'flat'
  tone: Tone
}

export interface KpiTileProps {
  label: string
  value: string | number
  sublabel?: string
  to?: string
  accent?: Tone
  delta?: KpiDelta | null
  /** One-line "what does this number mean for me?" copy. Renders as a
   *  cursor-help hint on the tile so the dashboard answers a question
   *  rather than dumping a number. Audit P0 from 2026-04-19. */
  meaning?: string
}

export function KpiTile({ label, value, sublabel, to, accent, delta, meaning }: KpiTileProps) {
  const inner = (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1 truncate">
        <div className="text-2xs text-fg-muted uppercase tracking-wider truncate">{label}</div>
        {meaning && (
          <Tooltip content={meaning}>
            <span
              aria-label={meaning}
              className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint cursor-help"
            >
              <span aria-hidden="true" className="leading-none italic font-serif">i</span>
            </span>
          </Tooltip>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1 min-w-0">
        <div
          className={`text-lg font-semibold font-mono truncate ${
            accent ? TONE_TEXT[accent] : 'text-fg'
          }`}
        >
          {value}
        </div>
        {delta && (
          <span
            className={`text-3xs font-mono shrink-0 ${TONE_TEXT[delta.tone]}`}
            title="vs prior period"
          >
            {ARROW[delta.direction]}
            {delta.value}
          </span>
        )}
      </div>
      {sublabel && (
        <div className="text-2xs text-fg-faint mt-0.5 truncate">{sublabel}</div>
      )}
    </div>
  )
  if (to) {
    return (
      <Card elevated interactive>
        <Link
          to={to}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
        >
          {inner}
        </Link>
      </Card>
    )
  }
  return <Card elevated>{inner}</Card>
}

/* ── LegendDot ──────────────────────────────────────────────────────────── */

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
      <span>{label}</span>
    </span>
  )
}

/* ── LineSparkline ──────────────────────────────────────────────────────── */

export function LineSparkline({
  values,
  accent = 'text-brand',
  ariaLabel = 'Trend',
  height = 28,
}: {
  values: number[]
  accent?: string
  ariaLabel?: string
  height?: number
}) {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const w = 100
  const h = height
  const step = w / Math.max(1, values.length - 1)
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`,
    )
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`w-full ${accent}`}
      style={{ height: `${height}px` }}
      role="img"
      aria-label={ariaLabel}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/* ── BarSparkline (single colour) ───────────────────────────────────────── */

export function BarSparkline({
  values,
  accent = 'bg-brand',
  height = 28,
  ariaLabel = 'Bar trend',
}: {
  values: number[]
  accent?: string
  height?: number
  ariaLabel?: string
}) {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)
  return (
    <div
      className="flex items-end gap-px w-full"
      style={{ height: `${height}px` }}
      role="img"
      aria-label={ariaLabel}
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 ${accent} opacity-80 rounded-t-[1px]`}
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '1px' : 0 }}
          title={`${v}`}
        />
      ))}
    </div>
  )
}

/* ── SeverityStackedBars ────────────────────────────────────────────────── */

export interface SeverityDay {
  day: string
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unscored?: number
}

function shortDay(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function SeverityStackedBars({ data }: { data: SeverityDay[] }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  return (
    <div>
      <div className="flex items-end gap-1 h-24" role="group" aria-label="Daily severity breakdown">
        {data.map((d) => {
          const totalH = (d.total / max) * 100
          const seg = (n: number) => (d.total > 0 ? (n / d.total) * totalH : 0)
          return (
            <SeverityBarColumn
              key={d.day}
              day={d}
              totalH={totalH}
              seg={seg}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-3xs text-fg-faint font-mono mt-1">
        <span>{shortDay(data[0]?.day ?? '')}</span>
        <span>{shortDay(data[data.length - 1]?.day ?? '')}</span>
      </div>
      <div className="flex flex-wrap gap-2 mt-2 text-3xs text-fg-muted">
        <LegendDot color="bg-danger" label="Critical" />
        <LegendDot color="bg-warn" label="High" />
        <LegendDot color="bg-info" label="Medium" />
        <LegendDot color="bg-ok" label="Low" />
        {data.some((d) => d.unscored != null) && (
          <LegendDot color="bg-fg-faint/40" label="Unscored" />
        )}
      </div>
    </div>
  )
}

function SeverityBarColumn({
  day,
  totalH,
  seg,
}: {
  day: SeverityDay
  totalH: number
  seg: (n: number) => number
}) {
  // Hover surfaces a count badge above the column so users get quantitative
  // answers without leaving the chart.
  return (
    <div className="group relative flex-1 h-full">
      {day.total > 0 && (
        <span
          className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 z-10 rounded-sm bg-surface-overlay border border-edge-subtle px-1 text-3xs font-mono text-fg shadow-card opacity-0 group-hover:opacity-100 motion-safe:transition-opacity"
          aria-hidden="true"
        >
          {day.total}
        </span>
      )}
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col-reverse items-stretch gap-px"
        title={`${shortDay(day.day)}: ${day.total} reports (C${day.critical} H${day.high} M${day.medium} L${day.low})`}
        style={{ height: `${Math.max(2, totalH)}%` }}
      >
        <div className="bg-danger motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.critical)}%` }} />
        <div className="bg-warn motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.high)}%` }} />
        <div className="bg-info motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.medium)}%` }} />
        <div className="bg-ok motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.low)}%` }} />
        {day.unscored != null && (
          <div className="bg-fg-faint/40" style={{ height: `${seg(day.unscored)}%` }} />
        )}
      </div>
    </div>
  )
}

/* ── HealthPill ─────────────────────────────────────────────────────────── */

export function HealthPill({ status }: { status: string | null | undefined }) {
  if (status === 'ok')
    return (
      <Badge className="bg-ok/15 text-ok border border-ok/30">Healthy</Badge>
    )
  if (status === 'degraded')
    return (
      <Badge className="bg-warn/15 text-warn border border-warn/30">
        Degraded
      </Badge>
    )
  if (status === 'down')
    return (
      <Badge className="bg-danger/15 text-danger border border-danger/30">
        Down
      </Badge>
    )
  return (
    <Badge className="bg-fg-faint/15 text-fg-muted border border-edge-subtle">
      Unknown
    </Badge>
  )
}

/* ── StatusPill ─────────────────────────────────────────────────────────── */

const STATUS_CLASS: Record<string, string> = {
  new: 'bg-warn/15 text-warn border-warn/30',
  pending: 'bg-warn/15 text-warn border-warn/30',
  queued: 'bg-info/15 text-info border-info/30',
  running: 'bg-info/15 text-info border-info/30',
  classified: 'bg-ok/15 text-ok border-ok/30',
  completed: 'bg-ok/15 text-ok border-ok/30',
  fixing: 'bg-brand/15 text-brand border-brand/30',
  fixed: 'bg-info/15 text-info border-info/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  dead_letter: 'bg-danger/15 text-danger border-danger/30',
  rejected: 'bg-danger/15 text-danger border-danger/30',
  dismissed: 'bg-fg-faint/15 text-fg-muted border-edge-subtle',
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const cls =
    STATUS_CLASS[status ?? ''] ??
    'bg-fg-faint/15 text-fg-muted border-edge-subtle'
  return (
    <Badge className={`border ${cls} text-3xs`}>{status ?? 'unknown'}</Badge>
  )
}

/* ── Histogram (bucketed values, e.g. judge score distribution) ─────────── */

export function Histogram({
  buckets,
  labels,
  accent = 'bg-brand',
  height = 80,
}: {
  buckets: number[]
  labels?: string[]
  accent?: string
  height?: number
}) {
  if (buckets.length === 0) return null
  const max = Math.max(1, ...buckets)
  return (
    <div>
      <div
        className="flex items-end gap-1 w-full"
        style={{ height: `${height}px` }}
      >
        {buckets.map((v, i) => (
          <div
            key={i}
            className={`flex-1 ${accent} rounded-t-sm`}
            style={{
              height: `${(v / max) * 100}%`,
              minHeight: v > 0 ? '2px' : '0',
            }}
            title={`${labels?.[i] ?? i}: ${v}`}
          />
        ))}
      </div>
      {labels && (
        <div className="flex justify-between text-3xs text-fg-faint font-mono mt-1">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── KpiRow (responsive grid wrapper) ───────────────────────────────────── */

export function KpiRow({
  children,
  cols = 4,
}: {
  children: ReactNode
  cols?: 3 | 4 | 5 | 6
}) {
  const colsCls =
    cols === 6
      ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'
      : cols === 5
        ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
        : cols === 3
          ? 'grid-cols-2 md:grid-cols-3'
          : 'grid-cols-2 md:grid-cols-4'
  return <div className={`grid ${colsCls} gap-2`}>{children}</div>
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(0)}%`
}
