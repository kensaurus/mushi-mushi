/**
 * FILE: packages/server/supabase/functions/_shared/project-home.ts
 * PURPOSE: The per-app Home (console /dashboard, "Today"): what the app's
 *          owner wants to know when they open it. Is the app up, erroring,
 *          slow? What is waiting and what is shipping? Which pages hurt?
 *          What needs me?
 *
 *          Pure: api/routes/project-home.ts does the reads, this file
 *          decides. Every section carries `status`: 'ok', 'not_connected'
 *          (with how to connect) or 'error' (a read failed). A failed read
 *          is never "not connected" and never "ok with 0".
 *
 * No Deno globals: vitest and the Deno CI test run (no permission flags)
 * import it directly.
 */

import type { PipelineStage } from './pipeline-view.ts'

// ── Section envelope ────────────────────────────────────────────────────────

export type SectionStatus = 'ok' | 'not_connected' | 'error'

export interface ConnectHint {
  label: string
  to: string
}

export interface HomeSection<T> {
  status: SectionStatus
  data: T | null
  /** How to connect, when `not_connected`. */
  connect: ConnectHint | null
  /** What failed, when `error`. */
  error: string | null
}

export function okSection<T>(data: T): HomeSection<T> {
  return { status: 'ok', data, connect: null, error: null }
}

export function notConnected<T>(connect: ConnectHint, data: T | null = null): HomeSection<T> {
  return { status: 'not_connected', data, connect, error: null }
}

export function errorSection<T>(err: unknown): HomeSection<T> {
  const message = err instanceof Error ? err.message : String(err)
  return { status: 'error', data: null, connect: null, error: message.slice(0, 300) }
}

// ── Health strip ────────────────────────────────────────────────────────────

/** good / warn / bad are traffic lights; busy = running now; off = no signal. */
export type Light = 'good' | 'warn' | 'bad' | 'busy' | 'off'

export type HealthId = 'site' | 'errors' | 'sdk' | 'ci'

export interface HealthSignal {
  id: HealthId
  label: string
  status: SectionStatus
  light: Light
  /** Two to four words: "Up", "3 pages broken", "Failing". */
  headline: string
  /** One plain sentence, or null. */
  detail: string | null
  /** The moment the signal is about (last check, last heartbeat, CI run). */
  at: string | null
  /** Where the number came from. */
  href: string
  connect: ConnectHint | null
}

const HOUR = 3600_000
const DAY = 24 * HOUR

export const SITE_STALE_MS = 3 * DAY
/** Synthetic checks slower than this read "slow". */
export const SLOW_MS = 3000
export const SDK_QUIET_MS = DAY
export const SDK_SILENT_MS = 7 * DAY

export const SITE_WATCH_HREF = '/inventory?tab=discovery'
export const SITE_WATCH_CONNECT: ConnectHint = { label: 'Turn on the live-site watch', to: '/credits' }

export function errorSignal(id: HealthId, label: string, href: string, err: unknown): HealthSignal {
  const message = err instanceof Error ? err.message : String(err)
  return { id, label, status: 'error', light: 'off', headline: 'Could not read', detail: message.slice(0, 200), at: null, href, connect: null }
}

export interface SiteInput {
  watch: { base_url: string; status: string; last_checked_at: string | null; last_error: string | null } | null
  /** Open pages the watch confirmed broken. */
  brokenPages: number
  /** Median synthetic check latency over the last 24 h; null when none ran. */
  medianLatencyMs: number | null
  now: Date
}

export function siteSignal(input: SiteInput): HealthSignal {
  const base = { id: 'site' as const, label: 'Site up', href: SITE_WATCH_HREF }
  const w = input.watch
  if (!w) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'Not watched', detail: 'Mushi is not checking your live site yet.', at: null, connect: SITE_WATCH_CONNECT }
  }
  const at = w.last_checked_at
  const speed = input.medianLatencyMs != null ? `Pages answer in about ${formatMs(input.medianLatencyMs)}.` : null
  if (w.status === 'paused') {
    return { ...base, status: 'ok', light: 'off', headline: 'Watch paused', detail: 'Turn the watch back on to check the site.', at, connect: SITE_WATCH_CONNECT }
  }
  if (input.brokenPages > 0) {
    return { ...base, status: 'ok', light: 'bad', headline: `${plural(input.brokenPages, 'page')} broken`, detail: `Checked ${hostOf(w.base_url)}; the broken pages are filed as reports.`, at, connect: null }
  }
  if (w.last_error) {
    return { ...base, status: 'ok', light: 'warn', headline: 'Last check failed', detail: w.last_error, at, connect: null }
  }
  if (!at) {
    return { ...base, status: 'ok', light: 'busy', headline: 'First check soon', detail: `Watching ${hostOf(w.base_url)}.`, at: null, connect: null }
  }
  if (input.now.getTime() - Date.parse(at) > SITE_STALE_MS) {
    return { ...base, status: 'ok', light: 'warn', headline: 'Not checked lately', detail: 'The watch has not reported for over 3 days.', at, connect: null }
  }
  if (input.medianLatencyMs != null && input.medianLatencyMs > SLOW_MS) {
    return { ...base, status: 'ok', light: 'warn', headline: 'Up, but slow', detail: speed, at, connect: null }
  }
  return { ...base, status: 'ok', light: 'good', headline: 'Up', detail: speed ?? `No broken pages on ${hostOf(w.base_url)}.`, at, connect: null }
}

/**
 * Report counts use the report list's calendar days (UTC midnight,
 * `reportWindowStartIso`), so the number and the `?days=` list it opens agree.
 */
export interface ErrorsInput {
  today: number
  yesterday: number
  criticalToday: number
  /** False until the app has sent its first report or the SDK checked in. */
  everConnected: boolean
  latestAt: string | null
  sdkHref: string
}

export function errorsSignal(input: ErrorsInput): HealthSignal {
  const base = { id: 'errors' as const, label: 'Errors today', href: '/reports?days=1' }
  if (!input.everConnected) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'No reports yet', detail: 'Install the SDK so your users can report bugs.', at: null, connect: { label: 'Install the SDK', to: input.sdkHref } }
  }
  const before = `${input.yesterday} yesterday.`
  if (input.criticalToday > 0) {
    return { ...base, href: '/reports?days=1&severity=critical', status: 'ok', light: 'bad', headline: `${input.criticalToday} critical`, detail: `${plural(input.today, 'new report')} today; ${before}`, at: input.latestAt, connect: null }
  }
  if (input.today >= 5 && input.today >= 2 * input.yesterday) {
    return { ...base, status: 'ok', light: 'warn', headline: `${input.today} new, rising`, detail: `Up from ${input.yesterday} yesterday.`, at: input.latestAt, connect: null }
  }
  return { ...base, status: 'ok', light: 'good', headline: input.today === 0 ? 'None new' : `${input.today} new`, detail: before, at: input.latestAt, connect: null }
}

export interface SdkInput {
  sdkKeys: number
  lastSeenAt: string | null
  now: Date
  sdkHref: string
}

export function sdkSignal(input: SdkInput): HealthSignal {
  const base = { id: 'sdk' as const, label: 'SDK sending', href: input.sdkHref }
  const connect = { label: 'Set up the SDK', to: input.sdkHref }
  if (input.sdkKeys === 0) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'No SDK key', detail: 'Create an SDK key and add the widget to your app.', at: null, connect }
  }
  if (!input.lastSeenAt) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'Never checked in', detail: 'Your app has not called Mushi with its SDK key yet.', at: null, connect }
  }
  const age = input.now.getTime() - Date.parse(input.lastSeenAt)
  if (age <= SDK_QUIET_MS) {
    return { ...base, status: 'ok', light: 'good', headline: 'Sending', detail: 'Your app checked in today.', at: input.lastSeenAt, connect: null }
  }
  if (age <= SDK_SILENT_MS) {
    return { ...base, status: 'ok', light: 'warn', headline: `Quiet for ${Math.floor(age / DAY)} d`, detail: 'No check-in today. Quiet traffic, or the SDK stopped loading.', at: input.lastSeenAt, connect: null }
  }
  return { ...base, status: 'ok', light: 'bad', headline: 'Silent', detail: 'No check-in for over a week. The SDK may be gone from your app.', at: input.lastSeenAt, connect }
}

export interface CiJobRow {
  run_id: number
  run_attempt: number
  job_name: string
  status: string
  conclusion: string | null
  infra: boolean
  gh_created_at: string
  completed_at: string | null
}

export interface CiInput {
  repo: string | null
  branch: string | null
  /** Jobs on the default branch, any order. */
  jobs: CiJobRow[]
}

const CI_FAIL = new Set(['failure', 'timed_out', 'startup_failure', 'action_required'])

export function ciSignal(input: CiInput): HealthSignal {
  const base = { id: 'ci' as const, label: `CI on ${input.branch ?? 'main'}`, href: '/ci' }
  if (!input.repo) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'No repo', detail: 'Connect your GitHub repo to see CI.', at: null, connect: { label: 'Connect GitHub', to: '/connect' } }
  }
  if (input.jobs.length === 0) {
    return { ...base, status: 'not_connected', light: 'off', headline: 'No runs seen', detail: `No CI run on ${input.branch ?? 'main'} in the last 30 days.`, at: null, connect: { label: 'Open CI', to: '/ci' } }
  }
  const newest = Math.max(...input.jobs.map((j) => j.run_id))
  // The latest attempt of each job in the newest run (a re-run replaces it).
  const latest = new Map<string, CiJobRow>()
  for (const j of input.jobs.filter((x) => x.run_id === newest)) {
    const prev = latest.get(j.job_name)
    if (!prev || j.run_attempt > prev.run_attempt) latest.set(j.job_name, j)
  }
  const jobs = [...latest.values()]
  const at = jobs.map((j) => j.completed_at ?? j.gh_created_at).sort().at(-1) ?? null
  const red = jobs.filter((j) => j.conclusion && CI_FAIL.has(j.conclusion))
  // ADR 0033: a lost runner or expired queue is not a code failure.
  const codeRed = red.filter((j) => !j.infra)
  if (codeRed.length > 0) {
    return { ...base, status: 'ok', light: 'bad', headline: 'Failing', detail: `${plural(codeRed.length, 'check')} failed: ${codeRed.slice(0, 2).map((j) => j.job_name).join(', ')}.`, at, connect: null }
  }
  if (red.length > 0) {
    return { ...base, status: 'ok', light: 'warn', headline: 'Machine stopped', detail: 'The test machine stopped; the code was not tested.', at, connect: null }
  }
  if (jobs.some((j) => j.status !== 'completed')) {
    return { ...base, status: 'ok', light: 'busy', headline: 'Running', detail: `${plural(jobs.length, 'check')} on the latest commit.`, at, connect: null }
  }
  return { ...base, status: 'ok', light: 'good', headline: 'Passing', detail: `${plural(jobs.length, 'check')} green on the latest commit.`, at, connect: null }
}

// ── Release ─────────────────────────────────────────────────────────────────

export type StationId = 'fix' | 'ci' | 'train' | 'merged' | 'deployed'

export interface Station {
  id: StationId
  label: string
  count: number
  /** Of `count`, stuck (needs a person or is waiting too long). */
  stuck: number
}

/** The pipeline stages each station adds up, in the pipeline's own order. */
const STATION_STAGES: Array<{ id: StationId; label: string; stages: string[] }> = [
  { id: 'fix', label: 'Fix ready', stages: ['pr', 'review'] },
  { id: 'ci', label: 'CI', stages: ['ci'] },
  { id: 'train', label: 'In train', stages: ['train'] },
  { id: 'merged', label: 'Merged', stages: ['merged'] },
  { id: 'deployed', label: 'Deployed', stages: ['deployed'] },
]

export function buildStations(stages: Pick<PipelineStage, 'id' | 'count' | 'stuck'>[]): Station[] {
  const byId = new Map(stages.map((s) => [s.id as string, s]))
  return STATION_STAGES.map((st) => ({
    id: st.id,
    label: st.label,
    count: st.stages.reduce((n, id) => n + (byId.get(id)?.count ?? 0), 0),
    stuck: st.stages.reduce((n, id) => n + (byId.get(id)?.stuck ?? 0), 0),
  }))
}

export interface TrainRowLite {
  state: string
  prNumber: number | null
  members: number
  createdAt: string
  repo: string
}

/** The train on the tracks now (building or testing), else the latest one. */
export function currentTrain(trains: TrainRowLite[]): (TrainRowLite & { active: boolean }) | null {
  const sorted = [...trains].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const active = sorted.find((t) => t.state === 'building' || t.state === 'testing')
  if (active) return { ...active, active: true }
  return sorted[0] ? { ...sorted[0], active: false } : null
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unrated'] as const
export type SeverityKey = (typeof SEVERITIES)[number]

export interface WaitingBySeverity {
  counts: Record<SeverityKey, number>
  total: number
}

export function waitingBySeverity(counts: Partial<Record<SeverityKey, number>>): WaitingBySeverity {
  const full = Object.fromEntries(SEVERITIES.map((s) => [s, counts[s] ?? 0])) as Record<SeverityKey, number>
  return { counts: full, total: SEVERITIES.reduce((n, s) => n + full[s], 0) }
}

// ── Needs you ───────────────────────────────────────────────────────────────

export interface NeedsYouItem {
  id: string
  /** Higher first. */
  impact: number
  text: string
  action: ConnectHint
}

export const NEEDS_YOU_MAX = 5

/** Pipeline groups that need a person, by how much they cost if ignored. */
const GROUP_IMPACT: Record<string, { impact: number; action: string }> = {
  hold: { impact: 80, action: 'Decide' },
  autofix_no_agent: { impact: 76, action: 'Set up agents' },
  agent_failed: { impact: 70, action: 'See why' },
  agent_failed_person: { impact: 68, action: 'Decide' },
  agent_failed_nothing: { impact: 45, action: 'Close' },
  intake_rejected: { impact: 66, action: 'See rejects' },
  fix_first: { impact: 60, action: 'Send back' },
  after_red_train: { impact: 56, action: 'Review' },
  not_queued: { impact: 55, action: 'Queue to merge' },
  not_deployed: { impact: 50, action: 'Check deploys' },
}
const DEFAULT_GROUP = { impact: 40, action: 'Open' }

export interface NeedsYouInput {
  projectId: string
  health: HealthSignal[]
  criticalWaiting: number | null
  pipeline: PipelineStage[] | null
  sdk: { status: string; version: string | null; latest: string | null } | null
}

/** At most NEEDS_YOU_MAX items, highest impact first; each one sentence and one button. */
export function buildNeedsYou(input: NeedsYouInput): NeedsYouItem[] {
  const items: NeedsYouItem[] = []
  const pipelineHref = `/pipeline?project=${encodeURIComponent(input.projectId)}`
  const sig = (id: HealthId) => input.health.find((h) => h.id === id && h.status === 'ok')

  const site = sig('site')
  if (site?.light === 'bad') items.push({ id: 'site_broken', impact: 100, text: `Your live site has ${site.headline}.`, action: { label: 'See pages', to: site.href } })
  if (input.criticalWaiting && input.criticalWaiting > 0) {
    items.push({ id: 'critical_waiting', impact: 90, text: `${plural(input.criticalWaiting, 'critical bug')} ${input.criticalWaiting === 1 ? 'is' : 'are'} waiting for a fix.`, action: { label: 'Open', to: '/reports?status=open&severity=critical' } })
  }
  const ci = sig('ci')
  if (ci?.light === 'bad') items.push({ id: 'ci_red', impact: 72, text: `CI on your main branch is failing. ${ci.detail ?? ''}`.trim(), action: { label: 'Open CI', to: '/ci' } })
  const sdk = input.health.find((h) => h.id === 'sdk')
  if (sdk && (sdk.light === 'bad' || sdk.status === 'not_connected')) {
    items.push({ id: 'sdk_silent', impact: 65, text: sdk.status === 'not_connected' ? 'Your app is not sending to Mushi yet, so users cannot report bugs.' : 'Your app stopped checking in over a week ago.', action: { label: 'Fix it', to: sdk.href } })
  }
  // Same groups, labels and counts the /pipeline page shows.
  for (const stage of input.pipeline ?? []) {
    for (const g of stage.groups) {
      if (g.tone !== 'stuck' || g.count === 0) continue
      const meta = GROUP_IMPACT[g.id] ?? DEFAULT_GROUP
      items.push({ id: `pipeline_${g.id}`, impact: meta.impact, text: `${g.label}.`, action: { label: meta.action, to: pipelineHref } })
    }
  }
  if (input.sdk && (input.sdk.status === 'outdated' || input.sdk.status === 'deprecated')) {
    const range = input.sdk.version && input.sdk.latest ? ` from ${input.sdk.version} to ${input.sdk.latest}` : ''
    items.push({ id: 'sdk_upgrade', impact: input.sdk.status === 'deprecated' ? 45 : 30, text: `Update the Mushi SDK${range}.`, action: { label: 'Update', to: '/connect' } })
  }
  return items.sort((a, b) => b.impact - a.impact).slice(0, NEEDS_YOU_MAX)
}

// ── Sitemap ─────────────────────────────────────────────────────────────────

export interface SitemapNode {
  path: string
  /** The last segment, or "Home" for "/". */
  label: string
  depth: number
  views: number
  bugs: number
  broken: boolean
}

export interface SitemapView {
  pages: SitemapNode[]
  /** Distinct pages seen before the cut. */
  totalPages: number
  /** True when the page-view sample hit its row cap. */
  sampled: boolean
}

export const SITEMAP_MAX = 12
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i

/** A URL or route as a page path: no origin, query or hash; ids become `:id`. */
export function normalizeRoute(raw: string | null | undefined): string | null {
  if (!raw) return null
  let path = raw.trim()
  if (!path) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }
  path = path.split(/[?#]/)[0] ?? ''
  if (!path.startsWith('/')) path = `/${path}`
  const segments = path.split('/').filter(Boolean).map((s) => (ID_SEGMENT.test(s) ? ':id' : s))
  const out = `/${segments.join('/')}`
  return out.length > 120 ? out.slice(0, 120) : out
}

export interface SitemapInput {
  /** Routes from page views (one entry per view). */
  views: string[]
  viewsCapped: boolean
  /** URLs of recent reports (one entry per report). */
  bugUrls: string[]
  /** URLs of open broken pages. */
  brokenUrls: string[]
}

export function buildSitemap(input: SitemapInput): SitemapView {
  const stats = new Map<string, { views: number; bugs: number; broken: boolean }>()
  const bump = (raw: string, key: 'views' | 'bugs' | 'broken') => {
    const path = normalizeRoute(raw)
    if (!path) return
    const s = stats.get(path) ?? { views: 0, bugs: 0, broken: false }
    if (key === 'broken') s.broken = true
    else s[key] += 1
    stats.set(path, s)
  }
  for (const v of input.views) bump(v, 'views')
  for (const u of input.bugUrls) bump(u, 'bugs')
  for (const u of input.brokenUrls) bump(u, 'broken')

  const score = (s: { views: number; bugs: number; broken: boolean }) => s.views + s.bugs * 5 + (s.broken ? 50 : 0)
  const top = [...stats.entries()].sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0])).slice(0, SITEMAP_MAX)
  const chosen = new Map(top)
  // Every chosen page sits under its first segment, so the tree has two levels.
  const sections = new Map<string, string[]>()
  for (const path of chosen.keys()) {
    if (path === '/') continue
    const head = `/${path.split('/')[1]}`
    sections.set(head, [...(sections.get(head) ?? []), path])
  }
  const zero = { views: 0, bugs: 0, broken: false }
  const node = (path: string, depth: number): SitemapNode => {
    const s = chosen.get(path) ?? stats.get(path) ?? zero
    return { path, label: path === '/' ? 'Home' : path.split('/').filter(Boolean).at(-1) ?? path, depth, views: s.views, bugs: s.bugs, broken: s.broken }
  }
  const pages: SitemapNode[] = [node('/', 0)]
  const ordered = [...sections.entries()].sort((a, b) => {
    const total = (paths: string[]) => paths.reduce((n, p) => n + score(chosen.get(p) ?? zero), 0)
    return total(b[1]) - total(a[1]) || a[0].localeCompare(b[0])
  })
  for (const [head, paths] of ordered) {
    pages.push(node(head, 1))
    for (const p of paths.filter((x) => x !== head).sort()) pages.push(node(p, 2))
  }
  return { pages: stats.size === 0 ? [] : pages, totalPages: stats.size, sampled: input.viewsCapped }
}

// ── This week vs last ───────────────────────────────────────────────────────

/** The fixes list filtered to merged attempts (apps/admin lib/statCardLinks.ts). */
export const FIXES_MERGED_HREF = '/fixes?tab=attempts&status=merged'

export interface WeekRow {
  id: 'reports' | 'critical' | 'merged' | 'sessions'
  label: string
  thisWeek: number
  lastWeek: number
  /** For this row, is more better? Drives the arrow's colour. */
  moreIsBetter: boolean
  href: string
}

export function buildWeek(c: {
  reports: [number, number]
  critical: [number, number]
  merged: [number, number]
  sessions: [number, number] | null
}): WeekRow[] {
  const rows: WeekRow[] = [
    { id: 'reports', label: 'Bug reports', thisWeek: c.reports[0], lastWeek: c.reports[1], moreIsBetter: false, href: '/reports?days=7' },
    { id: 'critical', label: 'Critical bugs', thisWeek: c.critical[0], lastWeek: c.critical[1], moreIsBetter: false, href: '/reports?days=7&severity=critical' },
    { id: 'merged', label: 'Fixes merged', thisWeek: c.merged[0], lastWeek: c.merged[1], moreIsBetter: true, href: FIXES_MERGED_HREF },
  ]
  if (c.sessions) rows.push({ id: 'sessions', label: 'User visits', thisWeek: c.sessions[0], lastWeek: c.sessions[1], moreIsBetter: true, href: '/dashboard?view=users' })
  return rows
}

// ── Recent activity, grouped ────────────────────────────────────────────────

export interface ActivityLine {
  id: string
  text: string
  to: string
}

export function buildActivity(c: {
  reportsToday: number
  reportsWeek: number
  mergedToday: number
  mergedWeek: number
  prsOpenedWeek: number
  deploysWeek: number
  lastDeploy: { at: string; version: string | null } | null
}): ActivityLine[] {
  const lines: ActivityLine[] = []
  if (c.mergedToday > 0) lines.push({ id: 'merged_today', text: `${plural(c.mergedToday, 'fix', 'fixes')} merged today`, to: FIXES_MERGED_HREF })
  else if (c.mergedWeek > 0) lines.push({ id: 'merged_week', text: `${plural(c.mergedWeek, 'fix', 'fixes')} merged this week`, to: FIXES_MERGED_HREF })
  if (c.prsOpenedWeek > 0) lines.push({ id: 'prs_week', text: `${plural(c.prsOpenedWeek, 'fix PR')} opened this week`, to: '/fixes?tab=attempts' })
  if (c.reportsToday > 0) lines.push({ id: 'reports_today', text: `${plural(c.reportsToday, 'bug report')} came in today`, to: '/reports?days=1' })
  else if (c.reportsWeek > 0) lines.push({ id: 'reports_week', text: `${plural(c.reportsWeek, 'bug report')} came in this week`, to: '/reports?days=7' })
  if (c.deploysWeek > 0) {
    const v = c.lastDeploy?.version ? `, latest ${c.lastDeploy.version}` : ''
    lines.push({ id: 'deploys_week', text: `${plural(c.deploysWeek, 'deploy')} seen this week${v}`, to: '/releases' })
  }
  return lines
}

// ── App info ────────────────────────────────────────────────────────────────

export type Platform = 'web' | 'ios' | 'android'

/** Platforms from the live URL, the store icon source and SDK user agents / origins. */
export function detectPlatforms(input: { liveUrl: string | null; iconSource: string | null; agents: Array<string | null>; origins: Array<string | null> }): Platform[] {
  const out = new Set<Platform>()
  if (input.liveUrl) out.add('web')
  if (input.iconSource === 'app_store') out.add('ios')
  if (input.iconSource === 'google_play') out.add('android')
  for (const o of input.origins) if (o && /^https?:\/\//i.test(o) && !isLocalOrigin(o)) out.add('web')
  for (const a of input.agents) {
    if (!a) continue
    if (/CFNetwork|iPhone|iPad|iOS/i.test(a)) out.add('ios')
    if (/okhttp|Android/i.test(a)) out.add('android')
  }
  return (['web', 'ios', 'android'] as const).filter((p) => out.has(p))
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || h === '0.0.0.0'
  } catch {
    return true
  }
}

/** The app's live address: the watched site, the audited site, then the SDK's public origin. */
export function pickLiveUrl(c: { watch: string | null; audit: string | null; origins: Array<string | null> }): string | null {
  if (c.watch) return c.watch
  if (c.audit) return c.audit
  const origin = c.origins.find((o) => !!o && /^https:\/\//i.test(o) && !isLocalOrigin(o))
  return origin ?? null
}

// ── Thumbnail ───────────────────────────────────────────────────────────────

export const THUMBNAIL_STALE_MS = 7 * DAY
/** Refresh: one capture per app per 10 minutes. */
export const THUMBNAIL_MANUAL_GAP_MS = 10 * 60_000
/** Capture on view: at most one try a day. */
export const THUMBNAIL_AUTO_GAP_MS = DAY

/** Whether opening Home should capture a fresh thumbnail in the background. */
export function shouldAutoCapture(c: {
  watchActive: boolean
  ownKey: boolean
  pageUrl: string | null
  capturedAt: string | null
  lastAttemptAt: string | null
  now: Date
}): boolean {
  if (!c.watchActive || !c.ownKey || !c.pageUrl) return false
  const t = c.now.getTime()
  if (c.lastAttemptAt && t - Date.parse(c.lastAttemptAt) < THUMBNAIL_AUTO_GAP_MS) return false
  return !c.capturedAt || t - Date.parse(c.capturedAt) > THUMBNAIL_STALE_MS
}

// ── Access ──────────────────────────────────────────────────────────────────

export type KeyKind = 'sdk' | 'mcp' | 'other'

export function keyKind(scopes: readonly string[] | null | undefined): KeyKind {
  const s = scopes ?? []
  if (s.some((x) => x.startsWith('mcp:'))) return 'mcp'
  if (s.includes('report:write')) return 'sdk'
  return 'other'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
