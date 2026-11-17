/**
 * FILE: apps/admin/src/lib/opsView.ts
 * PURPOSE: Pure helpers for the Ops page (/ops): when each app last reported
 *          as a heat cell with a shape, the coverage rows (silent apps
 *          first), the feed nested by thread, money, and each event's
 *          severity and Slack state as a glyph plus words (never colour alone).
 */

import type { OpsApp, OpsCategory, OpsCoverageResponse, OpsEvent, OpsSeverity } from './opsTypes'

export type OpsColumn = OpsCategory | 'bugs'

export const OPS_COLUMNS: ReadonlyArray<{ id: OpsColumn; label: string; glyph: string }> = [
  { id: 'payments', label: 'Payments', glyph: '💳' },
  { id: 'releases', label: 'Releases', glyph: '🚀' },
  { id: 'alerts', label: 'Alerts', glyph: '🔔' },
  { id: 'bugs', label: 'Bugs', glyph: '🐞' },
]

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The app's name as the team writes it: lowercase. */
export function opsAppName(app: Pick<OpsApp, 'id' | 'name'> | undefined | null): string {
  if (!app) return 'no app'
  return (app.name ?? app.id.slice(0, 8)).toLowerCase()
}

export function agoText(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60_000) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  return `${Math.floor(ms / DAY)}d ago`
}

interface Freshness {
  bucket: 'hour' | 'day' | 'week' | 'old' | 'never'
  /** ci-heat ramp step (darker = more recent) or the hatched "never" cell. */
  className: string
  /** A shape, so the state never rests on colour: ● recent, ◐ this week, ○ older, – never. */
  glyph: string
  label: string
}

/** @internal Exported for tests. */
export function freshness(lastAt: string | null | undefined, now: number): Freshness {
  if (!lastAt) return { bucket: 'never', className: 'ci-cell-0 ci-nodata', glyph: '–', label: 'never' }
  const ms = now - Date.parse(lastAt)
  if (ms < HOUR) return { bucket: 'hour', className: 'ci-heat-6', glyph: '●', label: agoText(lastAt, now) }
  if (ms < DAY) return { bucket: 'day', className: 'ci-heat-4', glyph: '●', label: agoText(lastAt, now) }
  if (ms < 7 * DAY) return { bucket: 'week', className: 'ci-heat-2', glyph: '◐', label: agoText(lastAt, now) }
  return { bucket: 'old', className: 'ci-heat-1', glyph: '○', label: agoText(lastAt, now) }
}

interface CoverageCell {
  column: OpsColumn
  lastAt: string | null
  count7d: number
  fresh: Freshness
}

export interface CoverageRowView {
  app: OpsApp
  cells: CoverageCell[]
  /** Never sent a payments, releases or alerts event: not connected yet. */
  silent: boolean
  mutedUntil: string | null
}

/** One row per app; apps that never sent an Ops event first (worst first), then by name. */
export function buildCoverageRows(data: OpsCoverageResponse, now: number): CoverageRowView[] {
  const byKey = new Map(data.coverage.map((r) => [`${r.project_id}|${r.category}`, r]))
  const muted = new Map(data.mutes.filter((m) => Date.parse(m.until) > now).map((m) => [m.project_id, m.until]))
  const rows = data.apps.map((app) => {
    const cells = OPS_COLUMNS.map(({ id }) => {
      const r = byKey.get(`${app.id}|${id}`)
      return { column: id, lastAt: r?.last_at ?? null, count7d: r?.count_7d ?? 0, fresh: freshness(r?.last_at, now) }
    })
    const silent = cells.filter((c) => c.column !== 'bugs').every((c) => !c.lastAt)
    return { app, cells, silent, mutedUntil: muted.get(app.id) ?? null }
  })
  return rows.sort((a, b) => Number(b.silent) - Number(a.silent) || opsAppName(a.app).localeCompare(opsAppName(b.app)))
}

export interface ThreadView {
  event: OpsEvent
  replies: OpsEvent[]
}

/** Replies under their parent (oldest reply first); a reply whose parent is off this page stands alone. */
export function nestThreads(events: OpsEvent[]): ThreadView[] {
  const ids = new Set(events.map((e) => e.id))
  const replies = new Map<string, OpsEvent[]>()
  for (const e of events) {
    if (e.parent_id && ids.has(e.parent_id)) replies.set(e.parent_id, [...(replies.get(e.parent_id) ?? []), e])
  }
  return events
    .filter((e) => !(e.parent_id && ids.has(e.parent_id)))
    .map((event) => ({ event, replies: (replies.get(event.id) ?? []).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)) }))
}

export function formatMoney(amountMinor: number, currency: string): string {
  try {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2
    return fmt.format(amountMinor / 10 ** digits)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

export function isRefund(kind: string): boolean {
  return /refund|chargeback|reversal/i.test(kind)
}

/** "¥12,000 · $40.00", or "none yet". */
export function paymentsToday(payments: Record<string, number>): string {
  const parts = Object.entries(payments).map(([cur, n]) => formatMoney(n, cur))
  return parts.length ? parts.join(' · ') : 'none yet'
}

export const SEVERITY_META: Record<OpsSeverity, { label: string; glyph: string; tone: 'danger' | 'warn' | 'info' | 'ok' }> = {
  urgent: { label: 'Urgent', glyph: '■', tone: 'danger' },
  warn: { label: 'Warning', glyph: '▲', tone: 'warn' },
  info: { label: 'Info', glyph: '●', tone: 'info' },
  resolved: { label: 'Resolved', glyph: '✓', tone: 'ok' },
}

/** 💳 ↩️ ⚠️ 🔴 🚀 ✅ 🔔: the same marks the Slack message uses. */
export function eventEmoji(e: Pick<OpsEvent, 'category' | 'severity' | 'kind'>): string {
  if (e.severity === 'resolved') return '✅'
  if (e.severity === 'urgent') return '🔴'
  if (e.severity === 'warn') return '⚠️'
  if (e.category === 'releases') return '🚀'
  if (e.category === 'payments') return isRefund(e.kind) ? '↩️' : '💳'
  return '🔔'
}

export interface SlackState {
  glyph: '✓' | '✕' | '–'
  label: string
  /** Full error, for the hover title. */
  detail: string | null
  tone: 'ok' | 'danger' | 'neutral'
}

export function slackState(e: Pick<OpsEvent, 'slack_ts' | 'slack_channel' | 'slack_error'>): SlackState {
  if (e.slack_error) {
    const muted = e.slack_error.startsWith('muted')
    return { glyph: muted ? '–' : '✕', label: muted ? 'Muted' : 'Not posted', detail: e.slack_error, tone: muted ? 'neutral' : 'danger' }
  }
  if (e.slack_ts || e.slack_channel === 'webhook') return { glyph: '✓', label: 'In Slack', detail: null, tone: 'ok' }
  return { glyph: '–', label: 'Stored only', detail: 'The Slack bot is off for this team, or the event was not posted yet.', tone: 'neutral' }
}

/** An event that still needs someone. */
export function needsAck(e: Pick<OpsEvent, 'severity' | 'acked_at'>): boolean {
  return e.severity !== 'resolved' && !e.acked_at
}
