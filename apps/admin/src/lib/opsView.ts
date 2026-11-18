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

/**
 * The columns that have data first (most apps reporting first), the all-hatched ones last, so a
 * phone that shows one column at a time shows one that says something. Stable for ties.
 */
export function orderOpsColumns(rows: readonly CoverageRowView[]): OpsColumn[] {
  const filled = (id: OpsColumn) => rows.filter((r) => r.cells.some((c) => c.column === id && c.lastAt)).length
  return OPS_COLUMNS.map((c, i) => ({ id: c.id, i, n: filled(c.id) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((c) => c.id)
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
  urgent: { label: 'Urgent', glyph: '▲', tone: 'danger' },
  warn: { label: 'Warning', glyph: '◆', tone: 'warn' },
  info: { label: 'Info', glyph: '■', tone: 'info' },
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

/** A thread still waiting for someone: an unacknowledged urgent or warning that no later resolve closed. */
export function needsLook(t: ThreadView): boolean {
  const e = t.event
  return (e.severity === 'urgent' || e.severity === 'warn') && needsAck(e) && !t.replies.some((r) => r.severity === 'resolved')
}

export interface FeedThreadItem {
  kind: 'thread'
  thread: ThreadView
  /** Every event this row stands for: the thread itself plus identical copies folded into it. */
  ids: string[]
}

export interface FeedGroupItem {
  kind: 'group'
  key: string
  projectId: string | null
  category: OpsCategory
  items: FeedThreadItem[]
}

export type FeedItem = FeedThreadItem | FeedGroupItem

export interface ArrangedFeed {
  /** Unacknowledged urgent, then warning rows, newest first within each: pinned on top. */
  pinned: FeedThreadItem[]
  /** The rest, newest first: info rows grouped per app and kind, identical rows folded together. */
  items: FeedItem[]
}

const CATEGORY_NOUN: Record<OpsCategory, [string, string]> = {
  payments: ['payment', 'payments'],
  releases: ['release', 'releases'],
  alerts: ['alert', 'alerts'],
}

/** "6 releases", "1 payment". */
export function categoryCount(category: OpsCategory, n: number): string {
  return `${n} ${CATEGORY_NOUN[category][n === 1 ? 0 : 1]}`
}

/**
 * Problems first: unacknowledged urgent and warning threads pinned on top, worst first. Below,
 * the same event sent twice (same app, kind, severity and title, no replies) shows once, and two or
 * more info rows from one app and kind collapse into one group, placed where its newest row was.
 */
export function arrangeFeed(events: OpsEvent[]): ArrangedFeed {
  const threads = nestThreads(events)
  const rank = (s: OpsSeverity) => (s === 'urgent' ? 0 : 1)
  const pinned = threads
    .filter(needsLook)
    .sort((a, b) => rank(a.event.severity) - rank(b.event.severity) || Date.parse(b.event.occurred_at) - Date.parse(a.event.occurred_at))
    .map((thread): FeedThreadItem => ({ kind: 'thread', thread, ids: [thread.event.id] }))

  const singles: FeedThreadItem[] = []
  const seen = new Map<string, FeedThreadItem>()
  for (const thread of threads) {
    if (needsLook(thread)) continue
    const e = thread.event
    const key = thread.replies.length === 0 ? `${e.project_id ?? ''}|${e.category}|${e.severity}|${e.title}` : null
    const copy = key ? seen.get(key) : undefined
    if (copy) {
      copy.ids.push(e.id)
      continue
    }
    const item: FeedThreadItem = { kind: 'thread', thread, ids: [e.id] }
    if (key) seen.set(key, item)
    singles.push(item)
  }

  const groupKey = (t: ThreadView) => (t.event.severity === 'info' ? `${t.event.project_id ?? ''}|${t.event.category}` : null)
  const sizes = new Map<string, number>()
  for (const s of singles) {
    const k = groupKey(s.thread)
    if (k) sizes.set(k, (sizes.get(k) ?? 0) + 1)
  }
  const groups = new Map<string, FeedGroupItem>()
  const items: FeedItem[] = []
  for (const s of singles) {
    const k = groupKey(s.thread)
    if (!k || (sizes.get(k) ?? 0) < 2) {
      items.push(s)
      continue
    }
    let g = groups.get(k)
    if (!g) {
      g = { kind: 'group', key: k, projectId: s.thread.event.project_id, category: s.thread.event.category, items: [] }
      groups.set(k, g)
      items.push(g)
    }
    g.items.push(s)
  }
  return { pinned, items }
}

/** The ids in these rows that still need an acknowledgement. */
export function unackedIds(items: readonly FeedThreadItem[], events: readonly OpsEvent[]): string[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  return items.flatMap((i) => i.ids).filter((id) => {
    const e = byId.get(id)
    return e ? needsAck(e) : false
  })
}
