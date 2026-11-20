/**
 * FILE: packages/server/supabase/functions/_shared/ops-commands.ts
 * PURPOSE: Answers to the Ops hub's slash command (`/kensaurus status`, …),
 *          from data Mushi Mushi already has: Ops events, bug reports and
 *          CI jobs (docs/execplans/ops-hub-slack.md §2).
 *
 *   load*    read one organization's data (bounded queries, service role);
 *   answer*  pure: data → an ephemeral Block Kit reply. The vitest suite
 *            drives these with stubbed data.
 *
 * Every reply is ephemeral (only the person who typed the command sees it)
 * and names apps in lowercase, as the team writes them.
 */

import {
  escapeMrkdwn,
  formatMoney,
  isRefundKind,
  matchApp,
  opsEmoji,
  opsHelpText,
  shortUtc,
  type OpsCommand,
  type OpsEventRow,
  type SalesRange,
} from './ops-format.ts'
import { muteProject } from './ops-events.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export interface SlashReply {
  response_type: 'ephemeral'
  text: string
  blocks?: unknown[]
  replace_original?: boolean
}

export interface OpsApp {
  id: string
  name: string | null
  slug: string | null
}

/** Report statuses still waiting on a decision (mirrors api/shared.ts OPEN_REPORT_STATUSES). */
const OPEN_REPORT_STATUSES = ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened']
const DAY_MS = 86_400_000

export function eph(text: string, blocks?: unknown[]): SlashReply {
  return blocks ? { response_type: 'ephemeral', text, blocks } : { response_type: 'ephemeral', text }
}

/** "3m", "5h", "2d" ago; "just now" under a minute. */
export function ago(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'never'
  const ms = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < DAY_MS) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / DAY_MS)}d ago`
}

export function appLabel(app: Pick<OpsApp, 'id' | 'name'> | undefined): string {
  return escapeMrkdwn((app?.name ?? app?.id.slice(0, 8) ?? 'unknown app').toLowerCase())
}

/** Start of the range, UTC: today from 00:00, week = 7 days, month = 30 days. */
export function rangeStart(range: SalesRange, now: Date): Date {
  if (range === 'today') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return new Date(now.getTime() - (range === 'week' ? 7 : 30) * DAY_MS)
}

const RANGE_LABEL: Record<SalesRange, string> = { today: 'today (since 00:00 UTC)', week: 'the last 7 days', month: 'the last 30 days' }

/** A short unicode bar, `▰▰▰▱▱`, for a share of the largest value. */
export function bar(value: number, max: number, width = 8): string {
  if (max <= 0 || value <= 0) return '▱'.repeat(width)
  const filled = Math.max(1, Math.round((value / max) * width))
  return '▰'.repeat(Math.min(width, filled)) + '▱'.repeat(Math.max(0, width - filled))
}

/** Sections of at most ~2900 characters each, one line per row. */
function sections(lines: string[]): unknown[] {
  const out: unknown[] = []
  let cur = ''
  for (const l of lines) {
    if (cur && cur.length + l.length + 1 > 2900) {
      out.push({ type: 'section', text: { type: 'mrkdwn', text: cur } })
      cur = ''
    }
    cur = cur ? `${cur}\n${l}` : l
  }
  if (cur) out.push({ type: 'section', text: { type: 'mrkdwn', text: cur } })
  return out
}

function header(text: string): unknown {
  return { type: 'header', text: { type: 'plain_text', text: text.slice(0, 150), emoji: true } }
}

function footer(text: string): unknown {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] }
}

// ── status ──────────────────────────────────────────────────────────────────

export interface StatusRow {
  app: OpsApp
  lastRelease: { title: string; at: string } | null
  openAlerts: number
  urgentAlerts: number
  openBugs: number
  ciFailuresToday: number
  mutedUntil: string | null
}

export function answerStatus(rows: StatusRow[], now: Date, consoleBase: string | null): SlashReply {
  if (rows.length === 0) return eph('This team has no apps yet.')
  // Worst first: urgent alerts, then any alert, then CI failures, then bugs.
  const sorted = [...rows].sort(
    (a, b) => b.urgentAlerts - a.urgentAlerts || b.openAlerts - a.openAlerts || b.ciFailuresToday - a.ciFailuresToday || b.openBugs - a.openBugs || appLabel(a.app).localeCompare(appLabel(b.app)),
  )
  const lines = sorted.map((r) => {
    const mark = r.urgentAlerts > 0 ? '🔴' : r.openAlerts > 0 || r.ciFailuresToday > 0 ? '🟠' : '🟢'
    const parts = [
      r.lastRelease ? `🚀 ${escapeMrkdwn(r.lastRelease.title.slice(0, 40))} · ${ago(r.lastRelease.at, now)}` : '🚀 no release seen',
      r.openAlerts ? `⚠️ ${r.openAlerts} open alert${r.openAlerts === 1 ? '' : 's'}` : '✓ no open alerts',
      `🐞 ${r.openBugs} open bug${r.openBugs === 1 ? '' : 's'}`,
      r.ciFailuresToday ? `✕ ${r.ciFailuresToday} CI failure${r.ciFailuresToday === 1 ? '' : 's'} today` : '✓ CI clean today',
    ]
    if (r.mutedUntil) parts.push(`🔕 muted until ${shortUtc(r.mutedUntil)}`)
    return `${mark} *${appLabel(r.app)}*  ${parts.join('  ·  ')}`
  })
  const bad = rows.filter((r) => r.urgentAlerts > 0).length
  const blocks = [header(`Status · ${shortUtc(now.toISOString())}`), ...sections(lines)]
  if (consoleBase) blocks.push(footer(`<${consoleBase}/ops|Open the Ops page in Mushi Mushi>`))
  return eph(bad ? `${bad} app${bad === 1 ? '' : 's'} with urgent alerts` : 'All apps: no urgent alerts', blocks)
}

// ── sales ───────────────────────────────────────────────────────────────────

export type PaymentRow = Pick<OpsEventRow, 'project_id' | 'kind' | 'amount_minor' | 'currency'>

export function answerSales(payments: PaymentRow[], apps: OpsApp[], range: SalesRange): SlashReply {
  const byApp = new Map(apps.map((a) => [a.id, a]))
  type Cell = { net: number; count: number; refunds: number }
  const cells = new Map<string, Cell>()
  const totals = new Map<string, number>()
  for (const p of payments) {
    if (p.amount_minor == null || !p.currency) continue
    const signed = isRefundKind(p.kind) ? -Math.abs(p.amount_minor) : Math.abs(p.amount_minor)
    const key = `${p.project_id ?? ''}|${p.currency}`
    const cell = cells.get(key) ?? { net: 0, count: 0, refunds: 0 }
    cell.net += signed
    if (signed < 0) cell.refunds++
    else cell.count++
    cells.set(key, cell)
    totals.set(p.currency, (totals.get(p.currency) ?? 0) + signed)
  }
  if (cells.size === 0) return eph(`No payments recorded ${RANGE_LABEL[range]}.`)
  const maxByCurrency = new Map<string, number>()
  for (const [key, c] of cells) {
    const cur = key.split('|')[1]
    maxByCurrency.set(cur, Math.max(maxByCurrency.get(cur) ?? 0, c.net))
  }
  const rows = [...cells].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]) || b[1].net - a[1].net)
  const lines = rows.map(([key, c]) => {
    const [pid, cur] = key.split('|')
    const refunds = c.refunds ? `, ${c.refunds} refund${c.refunds === 1 ? '' : 's'}` : ''
    return `\`${bar(c.net, maxByCurrency.get(cur) ?? 0)}\`  *${appLabel(byApp.get(pid) ?? { id: pid || 'none', name: pid ? null : 'no app' })}*  ${formatMoney(c.net, cur)}  (${c.count} payment${c.count === 1 ? '' : 's'}${refunds})`
  })
  const total = [...totals].map(([cur, n]) => `*${formatMoney(n, cur)}*`).join('  ·  ')
  return eph(`Sales ${RANGE_LABEL[range]}: ${[...totals].map(([cur, n]) => formatMoney(n, cur)).join(', ')}`, [
    header(`💳 Sales · ${RANGE_LABEL[range]}`),
    ...sections(lines),
    footer(`Total: ${total}  ·  refunds taken off`),
  ])
}

// ── releases / alerts ───────────────────────────────────────────────────────

export type FeedRow = Pick<OpsEventRow, 'id' | 'project_id' | 'category' | 'severity' | 'kind' | 'title' | 'url' | 'occurred_at' | 'thread_key' | 'acked_at'>

function feedLine(e: FeedRow, app: OpsApp | undefined, now: Date): string {
  const title = escapeMrkdwn(e.title)
  const linked = e.url ? `<${e.url}|${title}>` : title
  return `${opsEmoji(e)} *${appLabel(app ?? (e.project_id ? { id: e.project_id, name: null } : undefined))}* · ${linked} · ${ago(e.occurred_at, now)}`
}

export function answerReleases(releases: FeedRow[], apps: OpsApp[], n: number, now: Date): SlashReply {
  if (releases.length === 0) return eph('No releases recorded yet. Connect GitHub deployments or send `releases` events.')
  const byApp = new Map(apps.map((a) => [a.id, a]))
  const shown = releases.slice(0, n)
  return eph(`Last ${shown.length} release${shown.length === 1 ? '' : 's'}`, [header(`🚀 Last ${shown.length} release${shown.length === 1 ? '' : 's'}`), ...sections(shown.map((e) => feedLine(e, byApp.get(e.project_id ?? ''), now)))])
}

/**
 * Alerts that still need someone: not acknowledged, not a resolve, and not
 * closed by a resolve in their thread at or after them. A second incident in
 * the same thread after the first was resolved is open again.
 */
export function openAlerts<T extends Pick<FeedRow, 'project_id' | 'severity' | 'thread_key' | 'acked_at' | 'occurred_at'>>(alerts: T[]): T[] {
  // A thread is one app's: another app's resolve on the same key closes nothing here.
  const threadOf = (a: T) => (a.thread_key ? `${a.project_id ?? ''}|${a.thread_key}` : null)
  const lastResolve = new Map<string, number>()
  for (const a of alerts) {
    const thread = threadOf(a)
    if (a.severity !== 'resolved' || !thread) continue
    const at = Date.parse(a.occurred_at)
    if (at > (lastResolve.get(thread) ?? -Infinity)) lastResolve.set(thread, at)
  }
  return alerts.filter((a) => {
    if (a.severity === 'resolved' || a.acked_at) return false
    const thread = threadOf(a)
    const closedAt = thread ? lastResolve.get(thread) : undefined
    return closedAt === undefined || closedAt < Date.parse(a.occurred_at)
  })
}

export function answerAlerts(alerts: FeedRow[], apps: OpsApp[], now: Date, consoleBase: string | null): SlashReply {
  const open = openAlerts(alerts).sort((a, b) => (a.severity === 'urgent' ? 0 : 1) - (b.severity === 'urgent' ? 0 : 1) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
  if (open.length === 0) return eph('✅ No open alerts. Everything is acknowledged or resolved.')
  const byApp = new Map(apps.map((a) => [a.id, a]))
  const shown = open.slice(0, 15)
  const blocks = [header(`⚠️ ${open.length} open alert${open.length === 1 ? '' : 's'}`), ...sections(shown.map((e) => feedLine(e, byApp.get(e.project_id ?? ''), now)))]
  if (open.length > shown.length || consoleBase) blocks.push(footer([open.length > shown.length ? `${open.length - shown.length} more` : '', consoleBase ? `<${consoleBase}/ops?category=alerts&unacked=1|See them all in Mushi Mushi>` : ''].filter(Boolean).join('  ·  ')))
  return eph(`${open.length} open alerts`, blocks)
}

// ── bugs ────────────────────────────────────────────────────────────────────

export interface BugRow {
  id: string
  project_id: string
  title: string | null
  summary: string | null
  severity: string | null
  created_at: string
}

export function answerBugs(bugs: BugRow[], apps: OpsApp[], now: Date, consoleBase: string | null): SlashReply {
  if (bugs.length === 0) return eph('🎉 No open bug reports.')
  const byApp = new Map(apps.map((a) => [a.id, a]))
  const grouped = new Map<string, BugRow[]>()
  for (const b of bugs) grouped.set(b.project_id, [...(grouped.get(b.project_id) ?? []), b])
  const lines: string[] = []
  for (const [pid, list] of [...grouped].slice(0, 8)) {
    lines.push(`*${appLabel(byApp.get(pid) ?? { id: pid, name: null })}*`)
    for (const b of list.slice(0, 3)) {
      const label = escapeMrkdwn((b.title ?? b.summary ?? 'Untitled report').replace(/\s+/g, ' ').slice(0, 80))
      const id = consoleBase ? `<${consoleBase}/reports/${encodeURIComponent(b.id)}?project=${encodeURIComponent(pid)}|\`${b.id.slice(0, 8)}\`>` : `\`${b.id.slice(0, 8)}\``
      lines.push(`   • ${id} ${b.severity ? `*${escapeMrkdwn(b.severity)}* ` : ''}${label} · ${ago(b.created_at, now)}`)
    }
  }
  return eph(`Newest open bug reports`, [header('🐞 Newest open bug reports'), ...sections(lines)])
}

// ── ci ──────────────────────────────────────────────────────────────────────

export interface CiDayRow {
  project_id: string
  ci_kind: string
}

export function answerCi(jobs: CiDayRow[], apps: OpsApp[], consoleBase: string | null): SlashReply {
  const byApp = new Map(apps.map((a) => [a.id, a]))
  const counts = new Map<string, { passed: number; failed: number; stopped: number; running: number }>()
  for (const j of jobs) {
    const c = counts.get(j.project_id) ?? { passed: 0, failed: 0, stopped: 0, running: 0 }
    if (j.ci_kind === 'passed') c.passed++
    else if (j.ci_kind === 'code_failure') c.failed++
    else if (j.ci_kind === 'runner_lost' || j.ci_kind === 'queue_expired') c.stopped++
    else if (j.ci_kind === 'running' || j.ci_kind === 'queued' || j.ci_kind === 'waiting_for_runner') c.running++
    counts.set(j.project_id, c)
  }
  if (counts.size === 0) return eph('No CI jobs seen today. Connect GitHub on the CI runners page to see them here.')
  const rows = [...counts].sort((a, b) => b[1].failed - a[1].failed || b[1].stopped - a[1].stopped)
  const lines = rows.map(([pid, c]) => {
    const mark = c.failed ? '🔴' : c.stopped ? '🟠' : '🟢'
    const parts = [`✓ ${c.passed} passed`, c.failed ? `✕ ${c.failed} failed` : null, c.stopped ? `⛔ ${c.stopped} stopped by the test machine` : null, c.running ? `⏳ ${c.running} running` : null].filter(Boolean)
    return `${mark} *${appLabel(byApp.get(pid) ?? { id: pid, name: null })}*  ${parts.join('  ·  ')}`
  })
  const blocks = [header('🧪 CI today (since 00:00 UTC)'), ...sections(lines)]
  if (consoleBase) blocks.push(footer(`<${consoleBase}/ci|Open CI runners in Mushi Mushi>`))
  return eph('CI today', blocks)
}

// ── apps ────────────────────────────────────────────────────────────────────

export interface CoverageRow {
  project_id: string
  category: string
  last_at: string | null
  count_7d: number
}

const COVERAGE_COLUMNS: Array<[string, string]> = [
  ['payments', '💳'],
  ['releases', '🚀'],
  ['alerts', '🔔'],
  ['bugs', '🐞'],
]

export function answerApps(apps: OpsApp[], coverage: CoverageRow[], mutes: Array<{ project_id: string; until: string }>, now: Date): SlashReply {
  if (apps.length === 0) return eph('This team has no apps yet.')
  const cov = new Map(coverage.map((r) => [`${r.project_id}|${r.category}`, r]))
  const muted = new Map(mutes.filter((m) => Date.parse(m.until) > now.getTime()).map((m) => [m.project_id, m.until]))
  const lines = [...apps]
    .sort((a, b) => appLabel(a).localeCompare(appLabel(b)))
    .map((a) => {
      const cells = COVERAGE_COLUMNS.map(([cat, icon]) => {
        const r = cov.get(`${a.id}|${cat}`)
        return `${icon} ${r?.last_at ? ago(r.last_at, now).replace(' ago', '') : '—'}`
      })
      const silent = COVERAGE_COLUMNS.slice(0, 3).every(([cat]) => !cov.get(`${a.id}|${cat}`)?.last_at)
      const mute = muted.get(a.id)
      return `${silent ? '○' : '●'} *${appLabel(a)}*  ${cells.join('  ')}${mute ? `  🔕 until ${shortUtc(mute)}` : ''}`
    })
  return eph(`${apps.length} apps`, [header(`📱 ${apps.length} app${apps.length === 1 ? '' : 's'} · last heard from`), ...sections(lines), footer('○ = never sent an Ops event  ·  — = nothing yet in that column')])
}

// ── loaders ─────────────────────────────────────────────────────────────────

function throwIf(error: { message?: string } | null | undefined, what: string): void {
  if (error) throw new Error(`${what} read failed: ${error.message ?? 'unknown'}`)
}

export async function loadApps(db: Db, orgId: string): Promise<OpsApp[]> {
  const { data, error } = await db.from('projects').select('id, name, slug').eq('organization_id', orgId).order('name', { ascending: true }).limit(200)
  throwIf(error, 'projects')
  return (data as OpsApp[] | null) ?? []
}

const FEED_COLUMNS = 'id, project_id, category, severity, kind, title, url, occurred_at, thread_key, acked_at'

async function loadFeed(db: Db, orgId: string, category: string, since: Date, limit: number): Promise<FeedRow[]> {
  const { data, error } = await db
    .from('ops_events')
    .select(FEED_COLUMNS)
    .eq('organization_id', orgId)
    .eq('category', category)
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(limit)
  throwIf(error, 'ops_events')
  return (data as FeedRow[] | null) ?? []
}

async function loadMutes(db: Db, orgId: string): Promise<Array<{ project_id: string; until: string }>> {
  // `*`: the scope column may not exist yet. A one-alert mute (the Mute button) is not an app mute.
  const { data, error } = await db.from('ops_mutes').select('*').eq('organization_id', orgId)
  throwIf(error, 'ops_mutes')
  return ((data as Array<{ project_id: string; until: string; scope?: string | null }> | null) ?? []).filter((m) => !m.scope).map((m) => ({ project_id: m.project_id, until: m.until }))
}

async function loadCiToday(db: Db, projectIds: string[], now: Date): Promise<CiDayRow[]> {
  if (projectIds.length === 0) return []
  const { data, error } = await db
    .from('ci_jobs')
    .select('project_id, ci_kind')
    .in('project_id', projectIds)
    .gte('gh_created_at', rangeStart('today', now).toISOString())
    .limit(5000)
  throwIf(error, 'ci_jobs')
  return (data as CiDayRow[] | null) ?? []
}

async function loadOpenBugCounts(db: Db, projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  await Promise.all(
    projectIds.map(async (pid) => {
      const { count, error } = await db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', pid).in('status', OPEN_REPORT_STATUSES)
      throwIf(error, 'reports')
      out.set(pid, count ?? 0)
    }),
  )
  return out
}

export interface CommandContext {
  orgId: string
  /** The Slack user, recorded on a mute as `slack:<id>`. */
  slackUserId: string
  command: string
  consoleBase: string | null
  now: Date
}

/** Run one command for one organization. Throws on a failed read (the route answers with a plain error). */
export async function runOpsCommand(db: Db, cmd: OpsCommand, ctx: CommandContext): Promise<SlashReply> {
  const { now } = ctx
  switch (cmd.sub) {
    case 'help':
      return eph(opsHelpText(ctx.command))
    case 'usage':
      return eph(cmd.text)
    case 'status': {
      const apps = await loadApps(db, ctx.orgId)
      const ids = apps.map((a) => a.id)
      const [releases, alerts, bugs, ci, mutes] = await Promise.all([
        loadFeed(db, ctx.orgId, 'releases', new Date(now.getTime() - 90 * DAY_MS), 500),
        loadFeed(db, ctx.orgId, 'alerts', new Date(now.getTime() - 7 * DAY_MS), 500),
        loadOpenBugCounts(db, ids),
        loadCiToday(db, ids, now),
        loadMutes(db, ctx.orgId),
      ])
      const open = openAlerts(alerts)
      const rows: StatusRow[] = apps.map((app) => {
        const last = releases.find((r) => r.project_id === app.id && r.severity !== 'resolved')
        const mine = open.filter((a) => a.project_id === app.id)
        const mute = mutes.find((m) => m.project_id === app.id && Date.parse(m.until) > now.getTime())
        return {
          app,
          lastRelease: last ? { title: last.title, at: last.occurred_at } : null,
          openAlerts: mine.length,
          urgentAlerts: mine.filter((a) => a.severity === 'urgent').length,
          openBugs: bugs.get(app.id) ?? 0,
          ciFailuresToday: ci.filter((j) => j.project_id === app.id && j.ci_kind === 'code_failure').length,
          mutedUntil: mute?.until ?? null,
        }
      })
      return answerStatus(rows, now, ctx.consoleBase)
    }
    case 'sales': {
      const [apps, { data, error }] = await Promise.all([
        loadApps(db, ctx.orgId),
        db
          .from('ops_events')
          .select('project_id, kind, amount_minor, currency')
          .eq('organization_id', ctx.orgId)
          .eq('category', 'payments')
          .not('amount_minor', 'is', null)
          .gte('occurred_at', rangeStart(cmd.range, now).toISOString())
          .limit(10_000),
      ])
      throwIf(error, 'ops_events')
      return answerSales((data as PaymentRow[] | null) ?? [], apps, cmd.range)
    }
    case 'releases': {
      const [apps, rel] = await Promise.all([loadApps(db, ctx.orgId), loadFeed(db, ctx.orgId, 'releases', new Date(now.getTime() - 90 * DAY_MS), cmd.n + 20)])
      return answerReleases(rel.filter((r) => r.severity !== 'resolved'), apps, cmd.n, now)
    }
    case 'alerts': {
      const [apps, alerts] = await Promise.all([loadApps(db, ctx.orgId), loadFeed(db, ctx.orgId, 'alerts', new Date(now.getTime() - 7 * DAY_MS), 500)])
      return answerAlerts(alerts, apps, now, ctx.consoleBase)
    }
    case 'bugs': {
      const apps = await loadApps(db, ctx.orgId)
      if (apps.length === 0) return eph('This team has no apps yet.')
      const { data, error } = await db
        .from('reports')
        .select('id, project_id, title, summary, severity, created_at')
        .in('project_id', apps.map((a) => a.id))
        .in('status', OPEN_REPORT_STATUSES)
        .order('created_at', { ascending: false })
        .limit(60)
      throwIf(error, 'reports')
      return answerBugs((data as BugRow[] | null) ?? [], apps, now, ctx.consoleBase)
    }
    case 'ci': {
      const apps = await loadApps(db, ctx.orgId)
      return answerCi(await loadCiToday(db, apps.map((a) => a.id), now), apps, ctx.consoleBase)
    }
    case 'apps': {
      const [apps, cov, mutes] = await Promise.all([loadApps(db, ctx.orgId), db.rpc('ops_coverage', { p_organization_id: ctx.orgId }), loadMutes(db, ctx.orgId)])
      throwIf(cov.error, 'ops_coverage')
      return answerApps(apps, (cov.data as CoverageRow[] | null) ?? [], mutes, now)
    }
    case 'mute': {
      const found = matchApp(await loadApps(db, ctx.orgId), cmd.app)
      if (!found.ok) return eph(found.message)
      const until = new Date(now.getTime() + cmd.ms)
      const res = await muteProject(db, { organizationId: ctx.orgId, projectId: found.app.id, until, by: `slack:${ctx.slackUserId}` })
      if (!res.ok) return eph(`Could not mute ${appLabel(found.app)}. Try again in a minute.`)
      return eph(`🔕 *${appLabel(found.app)}* is muted here for ${cmd.label}, until ${shortUtc(until.toISOString())}. Its events are still kept in Mushi Mushi.`)
    }
    case 'unmute': {
      const found = matchApp(await loadApps(db, ctx.orgId), cmd.app)
      if (!found.ok) return eph(found.message)
      const { error } = await db.from('ops_mutes').delete().eq('organization_id', ctx.orgId).eq('project_id', found.app.id)
      if (error) return eph(`Could not unmute ${appLabel(found.app)}. Try again in a minute.`)
      return eph(`🔔 *${appLabel(found.app)}* posts here again.`)
    }
  }
}
