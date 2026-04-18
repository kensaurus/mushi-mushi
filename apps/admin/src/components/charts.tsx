/**
 * FILE: apps/admin/src/components/charts.tsx
 * PURPOSE: Shared visual primitives used across Dashboard, Judge, Queue,
 *          Fixes, and Prompt Lab. Extracted so every page speaks the same
 *          visual language — Kpi tiles, sparklines, stacked bars, status pills.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card, Badge } from './ui'

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
}

export function KpiTile({ label, value, sublabel, to, accent, delta }: KpiTileProps) {
  const inner = (
    <div className="px-3 py-2.5">
      <div className="text-2xs text-fg-muted uppercase tracking-wider truncate">{label}</div>
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
      <Card elevated interactive className="cursor-pointer">
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
      <div className="flex items-end gap-1 h-24">
        {data.map((d) => {
          const totalH = (d.total / max) * 100
          const seg = (n: number) => (d.total > 0 ? (n / d.total) * totalH : 0)
          return (
            <div
              key={d.day}
              className="flex-1 flex flex-col-reverse items-stretch gap-px h-full"
              title={`${shortDay(d.day)}: ${d.total} (C${d.critical} H${d.high} M${d.medium} L${d.low})`}
            >
              <div className="bg-danger" style={{ height: `${seg(d.critical)}%` }} />
              <div className="bg-warn" style={{ height: `${seg(d.high)}%` }} />
              <div className="bg-info" style={{ height: `${seg(d.medium)}%` }} />
              <div className="bg-ok" style={{ height: `${seg(d.low)}%` }} />
              {d.unscored != null && (
                <div className="bg-fg-faint/40" style={{ height: `${seg(d.unscored)}%` }} />
              )}
            </div>
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
