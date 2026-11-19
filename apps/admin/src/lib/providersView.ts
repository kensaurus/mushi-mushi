/**
 * FILE: apps/admin/src/lib/providersView.ts
 * PURPOSE: Pure helpers for /providers (Providers & AI routes): micro-USD
 *          formatting, worst-first providers, balance gauges, alert cards,
 *          the app × provider spend grid, hourly bars, route chains, the
 *          last-default guard, reorder permutations, priced models, the
 *          params a provider takes, history diffs and error toasts.
 *          No React; every rule here is unit tested (providersView.test.ts).
 */

import type { RunStatus } from '../components/signal/StatusMark'
import type {
  AiRoute,
  ModelPrice,
  OpsMeta,
  OpsSnapshot,
  ProviderAccount,
  ProviderChange,
  ProviderState,
  RouteChange,
  RouteParams,
  SpendDigest,
  SpendHour,
} from './kensaurusOpsTypes'

// ── money ───────────────────────────────────────────────────────────────────

/** The one micro-USD formatter: `$0`, `<$0.01`, `$4.27`, `$1.2k`, `-$3.10`; null → `—`. */
export function formatMicroUsd(micro: number | null | undefined): string {
  if (micro == null || !Number.isFinite(micro)) return '—'
  if (micro === 0) return '$0'
  const sign = micro < 0 ? '-' : ''
  const usd = Math.abs(micro) / 1_000_000
  if (usd < 0.01) return `${sign}<$0.01`
  if (usd < 1000) return `${sign}$${usd.toFixed(2)}`
  if (usd < 1_000_000) return `${sign}$${(usd / 1000).toFixed(usd < 10_000 ? 1 : 0)}k`
  return `${sign}$${(usd / 1_000_000).toFixed(1)}M`
}

/**
 * Margin of sell over cost, as a fraction of sell; null when nothing was sold.
 * @internal Exported for tests.
 */
export function marginOf(cost: number | null, sell: number | null): number | null {
  if (!sell) return null
  return (sell - (cost ?? 0)) / sell
}

// ── time ────────────────────────────────────────────────────────────────────

/** "45s", "12m", "3h", "2d" since an ISO time; null when unknown. */
export function ageLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ── providers ───────────────────────────────────────────────────────────────

const STATE_RANK: Record<ProviderState, number> = { down: 0, warn: 1, stale: 2, unknown: 3, ok: 4 }

export function providerState(p: ProviderAccount): ProviderState {
  return p.status?.state ?? 'unknown'
}

/** Worst first, then by label; disabled accounts last. */
export function sortProviders(providers: readonly ProviderAccount[]): ProviderAccount[] {
  return [...providers].sort(
    (a, b) =>
      Number(!a.enabled) - Number(!b.enabled) ||
      STATE_RANK[providerState(a)] - STATE_RANK[providerState(b)] ||
      a.label.localeCompare(b.label),
  )
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export interface Gauge {
  kind: 'balance' | 'usage'
  /** Shown value: dollars left, or fraction used (0..1). */
  value: number
  /** Bar end, same unit as value. */
  max: number
  warn: number | null
  crit: number | null
  /** Where the value sits against the thresholds. */
  level: 'ok' | 'warn' | 'crit'
  label: string
}

/**
 * A balance bar (dollars left against warn/crit) when the probe reported a
 * balance, else a usage bar (share used against warn_pct_used/crit_pct_used).
 * Thresholds are dollars and shares, as upstream stores them.
 */
export function providerGauge(p: ProviderAccount): Gauge | null {
  const s = p.status
  if (!s) return null
  const t = p.thresholds ?? {}
  if (s.balance_micro != null) {
    const value = s.balance_micro / 1_000_000
    const warn = num(t.warn_balance)
    const crit = num(t.crit_balance)
    const max = Math.max(value, (warn ?? 0) * 2, (crit ?? 0) * 3, 1)
    const level = crit != null && value <= crit ? 'crit' : warn != null && value <= warn ? 'warn' : 'ok'
    return { kind: 'balance', value, max, warn, crit, level, label: `${formatMicroUsd(s.balance_micro)} left` }
  }
  const used = num(s.usage?.character_count)
  const limit = num(s.usage?.character_limit)
  if (used != null && limit != null && limit > 0) {
    const value = used / limit
    const warn = num(t.warn_pct_used)
    const crit = num(t.crit_pct_used)
    const level = crit != null && value >= crit ? 'crit' : warn != null && value >= warn ? 'warn' : 'ok'
    return { kind: 'usage', value, max: 1, warn, crit, level, label: `${Math.round(value * 100)}% used` }
  }
  return null
}

/** Open incidents per account id. */
export function incidentCounts(snapshot: OpsSnapshot): Map<string, { total: number; crit: number }> {
  const out = new Map<string, { total: number; crit: number }>()
  for (const i of snapshot.incidents) {
    if (!i.account_id) continue
    const cur = out.get(i.account_id) ?? { total: 0, crit: 0 }
    cur.total += 1
    if (i.severity === 'crit') cur.crit += 1
    out.set(i.account_id, cur)
  }
  return out
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The console's name for an app the ops registry names by its repo slug
 * ("how-to-talk-to-girls" where every other page says "lets-talk", 2026-11-18). Matches the
 * project's slug or name, ignoring case and punctuation; an app no project matches keeps its slug.
 */
export function makeAppNamer(projects: ReadonlyArray<{ project_name: string; project_slug: string }>): (app: string) => string {
  const by = new Map<string, string>()
  for (const p of projects) {
    by.set(normName(p.project_slug), p.project_name)
    by.set(normName(p.project_name), p.project_name)
  }
  return (app: string) => by.get(normName(app)) ?? app
}

/**
 * The console's project for an ops app slug, matched like makeAppNamer, so a "Used by" chip can
 * carry the app's icon. Null when no project matches (the chip then shows the slug alone).
 */
export function makeAppProjectFinder<P extends { project_name: string; project_slug: string }>(projects: readonly P[]): (app: string) => P | null {
  const by = new Map<string, P>()
  for (const p of projects) {
    by.set(normName(p.project_slug), p)
    by.set(normName(p.project_name), p)
  }
  return (app: string) => by.get(normName(app)) ?? null
}

/** One app that uses an account, with the features it calls it for (a chip's hover). */
export interface AppUse {
  app: string
  features: string[]
}

/** The apps behind an account, one entry each with its features, sorted by the console's name. */
export function appUses(p: ProviderAccount, appName: (app: string) => string = (a) => a): AppUse[] {
  const by = new Map<string, Set<string>>()
  for (const d of p.depends ?? []) {
    if (!d.app) continue
    const f = by.get(d.app) ?? new Set<string>()
    if (d.feature) f.add(d.feature)
    by.set(d.app, f)
  }
  return [...by.entries()]
    .map(([app, f]) => ({ app, features: [...f].sort() }))
    .sort((a, b) => appName(a.app).localeCompare(appName(b.app)))
}

/** A provider state in plain words (the pill beside its glyph). */
export const PROVIDER_STATE_WORD: Record<ProviderState, string> = {
  ok: 'Working',
  warn: 'Warning',
  down: 'Down',
  stale: 'Not checked lately',
  unknown: 'Not checked',
}

/**
 * What an off or unchecked account needs, in one line, and the one button when the console can do
 * it (2026-11-19: ElevenLabs and fal.ai said "unknown" with nothing to press). Turning an account
 * on is the only fix the console has; a missing health check is set up on kenji, and the line says
 * so instead of offering a button that would only re-read the same snapshot.
 */
export function providerNeeds(p: ProviderAccount, now: number): { text: string; action: 'turn_on' | null } | null {
  if (!p.enabled) return { text: 'Off: the router skips it, so no app calls it. Turn it on to route to it again.', action: 'turn_on' }
  const state = providerState(p)
  if (state === 'unknown') {
    if (!p.status) {
      // Only what the data shows: no reading yet. Its health check is set up on kenji, not here.
      return { text: 'Not checked yet: the provider watch on kenji has no reading for it. It shows here after its first check.', action: null }
    }
    return { text: `The last check could not tell whether it works${p.status.detail ? `: ${p.status.detail}` : '.'}`, action: null }
  }
  if (state === 'stale') {
    const age = ageLabel(p.status?.last_probe_at, now)
    return { text: `Last checked ${age ? `${age} ago` : 'a while ago'}; the watch on kenji has not probed it since.`, action: null }
  }
  return null
}

/** A short phrase for an account that needs a look, for the lead ("fal.ai is off"). */
function needsWord(p: ProviderAccount): string {
  if (!p.enabled) return 'is off'
  const state = providerState(p)
  if (state === 'down') return 'is down'
  if (state === 'warn') return 'has a warning'
  if (state === 'stale') return 'is not checked lately'
  return 'is not checked'
}

/**
 * The page's lead (2026-11-19): which accounts need a look, worst first, and the one button the
 * console has for them (turn an off account on). Down and warning accounts also have their alert
 * cards below, with their own actions.
 */
export function providersLead(providers: readonly ProviderAccount[]): {
  sentence: string
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  working: number
  needLook: ProviderAccount[]
  turnOn: ProviderAccount | null
} {
  const sorted = sortProviders(providers)
  const working = sorted.filter((p) => p.enabled && providerState(p) === 'ok').length
  // An account someone switched off is a choice, not a problem (local check, 2026-11-19: the lead
  // said "2 accounts need a look: ElevenLabs is off, fal.ai is off" and pushed "Turn on").
  const needLook = sorted.filter((p) => p.enabled && providerState(p) !== 'ok')
  const off = sorted.filter((p) => !p.enabled)
  const name = (p: ProviderAccount) => p.label.replace(SHARED_SUFFIX, '')
  const offNote =
    off.length === 0
      ? ''
      : ` ${off.slice(0, 3).map(name).join(', ')}${off.length > 3 ? ` and ${off.length - 3} more` : ''} ${off.length === 1 ? 'is' : 'are'} switched off.`
  if (providers.length === 0) return { sentence: 'No provider accounts yet.', tone: 'neutral', working, needLook, turnOn: null }
  if (working === 0 && needLook.length === 0) {
    // Everything is off: no app can call a provider, so turning one on is the next step.
    return { sentence: 'Every provider account is switched off, so no app can call one.', tone: 'warn', working, needLook, turnOn: off[0] ?? null }
  }
  if (needLook.length === 0) {
    const on = providers.length - off.length
    return {
      sentence: `${on === 1 ? 'The switched-on account is working.' : `All ${on} switched-on accounts are working.`}${offNote}`,
      tone: 'ok',
      working,
      needLook,
      turnOn: null,
    }
  }
  const shown = needLook.slice(0, 3).map((p) => `${name(p)} ${needsWord(p)}`)
  const more = needLook.length > 3 ? `, and ${needLook.length - 3} more` : ''
  const down = needLook.some((p) => providerState(p) === 'down')
  return {
    sentence: `${needLook.length === 1 ? '1 account needs' : `${needLook.length} accounts need`} a look: ${shown.join(', ')}${more}.${offNote}`,
    tone: down ? 'danger' : 'warn',
    working,
    needLook,
    turnOn: null,
  }
}

/** Why an account has no balance bar, in a few words. */
export function balanceWhy(p: ProviderAccount): string {
  return p.probe_kind === 'auth_only' ? 'key check only' : 'not reported'
}

const SHARED_SUFFIX = /\s*\(shared (?:key|account)\)\s*$/i

/** Every account is a shared one: the table says "Shared account" once instead of on each row (round 3). */
export function allSharedAccounts(providers: ReadonlyArray<{ label: string }>): boolean {
  return providers.length > 1 && providers.every((p) => SHARED_SUFFIX.test(p.label))
}

/**
 * An account's name for its row: without "(shared key)" when the column says it, and whether the
 * provider chip adds anything ("Anthropic" beside an "anthropic" chip did not; round 3).
 */
export function accountLabel(p: { label: string; provider: string }, sharedAll: boolean): { text: string; showProvider: boolean } {
  const text = sharedAll ? p.label.replace(SHARED_SUFFIX, '') : p.label
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return { text, showProvider: !norm(text).includes(norm(p.provider)) }
}

/**
 * Columns the Providers table draws: Balance only once some account has a reading, Incidents
 * only once some account has one open. "not checked" on all five rows and "—" ×5 said nothing
 * (2026-11-18); the note under the table says it once.
 */
export function providerColumns(
  providers: readonly ProviderAccount[],
  incidents: ReadonlyMap<string, { total: number }>,
): { balance: boolean; incidents: boolean; note: string | null } {
  const balance = providers.some((p) => providerGauge(p) != null)
  const inc = providers.some((p) => (incidents.get(p.id)?.total ?? 0) > 0)
  // Say why there is no balance, from the checks themselves (2026-11-19: "Balance: not checked").
  const keyOnly = providers.length > 0 && providers.every((p) => p.probe_kind === 'auth_only')
  const noBalance = keyOnly
    ? 'Balance: not shown, because each account’s check only tests that its key works'
    : 'Balance: no account has reported one yet'
  const parts = [!balance && noBalance, !inc && 'no open incidents'].filter(Boolean) as string[]
  return { balance, incidents: inc, note: parts.length > 0 && providers.length > 0 ? parts.join(' · ') : null }
}

/** The Spend tab's one empty line: whose calls it counts, so "none" is not read as "Mushi Mushi made no AI calls". */
export function spendEmptyLine(win: '24h' | '30d'): string {
  return `No AI calls through your shared provider accounts in the last ${win === '24h' ? '24 hours' : '30 days'}.`
}

// ── alerts ──────────────────────────────────────────────────────────────────

export interface ProvidersAlert {
  id: string
  severity: 'critical' | 'serious'
  label: string
  title: string
  detail: string
  metric: { value: string; unit: string }
  tab: ProvidersTab
}

const ALERTS_MAX = 3

/**
 * At most three cards, worst first: providers down (critical) or warn
 * (serious), open critical incidents, and apps whose 24 h cost beat what
 * they sold.
 */
export function buildAlerts(snapshot: OpsSnapshot, now: number): ProvidersAlert[] {
  const out: ProvidersAlert[] = []
  const enabled = snapshot.providers.filter((p) => p.enabled)
  const down = enabled.filter((p) => providerState(p) === 'down')
  const warn = enabled.filter((p) => providerState(p) === 'warn')
  if (down.length > 0) {
    const first = down[0]!
    out.push({
      id: 'providers-down',
      severity: 'critical',
      label: 'Down',
      title: down.length === 1 ? `${first.label} is down` : `${down.length} providers down`,
      detail: first.status?.detail ?? first.provider,
      metric: { value: ageLabel(first.status?.state_since, now) ?? '—', unit: 'down' },
      tab: 'providers',
    })
  }
  const crit = snapshot.incidents.filter((i) => i.severity === 'crit')
  if (crit.length > 0) {
    const first = crit[0]!
    out.push({
      id: 'incidents-crit',
      severity: 'critical',
      label: 'Incident',
      title: crit.length === 1 ? `${first.class} on ${first.provider ?? first.account_id ?? 'a provider'}` : `${crit.length} critical incidents`,
      detail: [first.app, first.feature, first.model].filter(Boolean).join(' · ') || first.source,
      metric: { value: String(crit.reduce((n, i) => n + i.count, 0)), unit: 'hits' },
      tab: 'providers',
    })
  }
  if (warn.length > 0) {
    const first = warn[0]!
    out.push({
      id: 'providers-warn',
      severity: 'serious',
      label: 'Warning',
      title: warn.length === 1 ? `${first.label} needs a look` : `${warn.length} providers warn`,
      detail: first.status?.detail ?? first.provider,
      metric: { value: String(warn.length), unit: warn.length === 1 ? 'account' : 'accounts' },
      tab: 'providers',
    })
  }
  const losing = appTotals(snapshot.spend.last_24h).filter((a) => a.cost > a.sell)
  if (losing.length > 0) {
    const worst = [...losing].sort((a, b) => b.cost - b.sell - (a.cost - a.sell))[0]!
    out.push({
      id: 'apps-loss',
      severity: 'serious',
      label: 'Losing money',
      title: losing.length === 1 ? `${worst.app} costs more than it sells` : `${losing.length} apps cost more than they sell`,
      detail: `24 h: cost ${formatMicroUsd(worst.cost)} · sold ${formatMicroUsd(worst.sell)}`,
      metric: { value: formatMicroUsd(worst.cost - worst.sell), unit: 'lost' },
      tab: 'spend',
    })
  }
  const rank = (a: ProvidersAlert) => (a.severity === 'critical' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, ALERTS_MAX)
}

// ── spend ───────────────────────────────────────────────────────────────────

interface SpendCell {
  app: string
  provider: string
  calls: number
  errors: number
  cost: number
  sell: number
  /** Cost over what was sold (nothing sold and any cost is a loss). */
  loss: boolean
  margin: number | null
}

export interface SpendGrid {
  apps: string[]
  providers: string[]
  cells: Map<string, SpendCell>
  maxCost: number
  totals: { cost: number; sell: number; calls: number; errors: number; margin: number | null }
  byProvider: Map<string, { cost: number; sell: number }>
  byApp: Map<string, { cost: number; sell: number }>
}

export const cellKey = (app: string, provider: string) => `${app}|${provider}`

/** The app × provider grid of a digest; apps and providers sorted by cost, most first. */
export function buildSpendGrid(digest: SpendDigest | null | undefined): SpendGrid {
  const cells = new Map<string, SpendCell>()
  const byApp = new Map<string, { cost: number; sell: number }>()
  const byProvider = new Map<string, { cost: number; sell: number }>()
  const totals = { cost: 0, sell: 0, calls: 0, errors: 0, margin: null as number | null }
  for (const r of digest?.rows ?? []) {
    const cost = r.cost_micro ?? 0
    const sell = r.sell_micro ?? 0
    const key = cellKey(r.app, r.provider)
    const prev = cells.get(key)
    const c = prev
      ? { ...prev, calls: prev.calls + r.calls, errors: prev.errors + r.errors, cost: prev.cost + cost, sell: prev.sell + sell }
      : { app: r.app, provider: r.provider, calls: r.calls, errors: r.errors, cost, sell, loss: false, margin: null }
    c.loss = c.cost > c.sell
    c.margin = marginOf(c.cost, c.sell)
    cells.set(key, c)
    const a = byApp.get(r.app) ?? { cost: 0, sell: 0 }
    byApp.set(r.app, { cost: a.cost + cost, sell: a.sell + sell })
    const p = byProvider.get(r.provider) ?? { cost: 0, sell: 0 }
    byProvider.set(r.provider, { cost: p.cost + cost, sell: p.sell + sell })
    totals.cost += cost
    totals.sell += sell
    totals.calls += r.calls
    totals.errors += r.errors
  }
  totals.margin = marginOf(totals.cost, totals.sell)
  const byCost = (m: Map<string, { cost: number }>) => [...m].sort((x, y) => y[1].cost - x[1].cost || x[0].localeCompare(y[0])).map(([k]) => k)
  return {
    apps: byCost(byApp),
    providers: byCost(byProvider),
    cells,
    maxCost: Math.max(0, ...[...cells.values()].map((c) => c.cost)),
    totals,
    byProvider,
    byApp,
  }
}

function appTotals(digest: SpendDigest | null | undefined): Array<{ app: string; cost: number; sell: number }> {
  const grid = buildSpendGrid(digest)
  return grid.apps.map((app) => ({ app, ...grid.byApp.get(app)! }))
}

export interface HourBar {
  hour: string
  /** Cost per app this hour, stacked in `apps` order. */
  segments: Array<{ app: string; cost: number }>
  cost: number
  calls: number
  errors: number
}

/**
 * 48 hourly bars per provider, oldest first, ending at the snapshot's hour.
 * Hours with no row are empty bars, so the axis is the same for every provider.
 */
export function buildHourlyBars(
  hours: readonly SpendHour[],
  generatedAt: string,
  count = 48,
): { providers: string[]; apps: string[]; bars: Map<string, HourBar[]>; max: number } {
  const end = Math.floor(Date.parse(generatedAt) / 3_600_000) * 3_600_000
  const slots = Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 3_600_000).toISOString())
  const index = new Map(slots.map((s, i) => [s, i]))
  const providers = [...new Set(hours.map((h) => h.provider))].sort()
  const apps = [...new Set(hours.map((h) => h.app))].sort()
  const bars = new Map<string, HourBar[]>()
  for (const p of providers) {
    bars.set(
      p,
      slots.map((hour) => ({ hour, segments: [], cost: 0, calls: 0, errors: 0 })),
    )
  }
  for (const h of hours) {
    const t = Date.parse(h.hour)
    if (!Number.isFinite(t)) continue
    const i = index.get(new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString())
    if (i === undefined) continue
    const bar = bars.get(h.provider)![i]!
    const cost = h.cost_micro ?? 0
    bar.cost += cost
    bar.calls += h.calls
    bar.errors += h.errors
    const seg = bar.segments.find((s) => s.app === h.app)
    if (seg) seg.cost += cost
    else bar.segments.push({ app: h.app, cost })
  }
  for (const list of bars.values()) for (const b of list) b.segments.sort((x, y) => apps.indexOf(x.app) - apps.indexOf(y.app))
  const max = Math.max(0, ...[...bars.values()].flat().map((b) => b.cost))
  return { providers, apps, bars, max }
}

/**
 * What the hourly chart says when it has no bars (2026-11-18: it said "No calls in the last
 * 48 hours" beside a 24 h cost, because the hourly series and the daily digest are separate
 * feeds). Calls in the daily digest mean the hourly feed is missing, not that nothing ran.
 * Null when the chart has bars.
 */
export function hourlyEmptyText(hourlyProviders: number, callsLast24h: number): string | null {
  if (hourlyProviders > 0) return null
  return callsLast24h > 0 ? 'No hourly breakdown yet. The 24 h totals above are current.' : 'No calls in the last 48 hours.'
}

// ── routes ──────────────────────────────────────────────────────────────────

export interface FeatureChain {
  app: string
  feature: string
  /** By priority, best first. */
  routes: AiRoute[]
}

/**
 * A chain's shape: provider, model, on/off and params per candidate, in order. Two chains with the
 * same signature try the same things, so the Routes tab folds the later one under the first.
 */
export function chainSignature(chain: FeatureChain): string {
  return chain.routes.map((r) => `${r.provider}|${r.model}|${r.enabled ? 1 : 0}|${JSON.stringify(r.params ?? {})}`).join('>')
}

export interface AppRoutes {
  app: string
  features: FeatureChain[]
}

/** Routes per app → feature, '*' (default) first, then features by name; candidates by priority. */
export function groupRoutes(routes: readonly AiRoute[]): AppRoutes[] {
  const apps = new Map<string, Map<string, AiRoute[]>>()
  for (const r of routes) {
    const features = apps.get(r.app) ?? new Map<string, AiRoute[]>()
    const list = features.get(r.feature) ?? []
    list.push(r)
    features.set(r.feature, list)
    apps.set(r.app, features)
  }
  return [...apps.keys()].sort().map((app) => ({
    app,
    features: [...apps.get(app)!]
      .sort(([a], [b]) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)))
      .map(([feature, list]) => ({ app, feature, routes: [...list].sort((x, y) => x.priority - y.priority) })),
  }))
}

export const featureLabel = (feature: string) => (feature === '*' ? 'default' : feature)

export const routeKey = (r: { app: string; feature: string; priority: number }) => `${r.app}|${r.feature}|${r.priority}`

/**
 * True when turning this route off (disable, delete, or an upsert with
 * enabled:false) would leave its app with no enabled '*' route while it has
 * one now: upstream refuses that with 409 last_default_route.
 */
export function wouldDropLastDefault(routes: readonly AiRoute[], target: { app: string; feature: string; priority: number }): boolean {
  if (target.feature !== '*') return false
  const enabledDefaults = routes.filter((r) => r.app === target.app && r.feature === '*' && r.enabled)
  if (enabledDefaults.length === 0) return false
  return enabledDefaults.every((r) => r.priority === target.priority)
}

export const LAST_DEFAULT_HINT = 'Enable another default first'

/**
 * The `order` for a reorder: the chain's current priorities, best first,
 * with the candidate at `index` moved one step up (-1) or down (+1).
 * Null when the move would leave the chain.
 */
export function reorderPermutation(chain: readonly AiRoute[], index: number, dir: -1 | 1): number[] | null {
  const to = index + dir
  if (index < 0 || index >= chain.length || to < 0 || to >= chain.length) return null
  const order = chain.map((r) => r.priority)
  ;[order[index], order[to]] = [order[to]!, order[index]!]
  return order
}

/**
 * Apply a reorder to the routes the way upstream does: renumber the feature 1..n in `order`.
 * @internal Exported for tests.
 */
export function applyReorder(routes: readonly AiRoute[], app: string, feature: string, order: readonly number[]): AiRoute[] {
  const byPriority = new Map(routes.filter((r) => r.app === app && r.feature === feature).map((r) => [r.priority, r]))
  const renumbered = order.flatMap((p, i) => {
    const r = byPriority.get(p)
    return r ? [{ ...r, priority: i + 1 }] : []
  })
  return [...routes.filter((r) => !(r.app === app && r.feature === feature)), ...renumbered]
}

/** Models with a price in effect for a provider, by name: the only ones a route may use. */
export function pricedModels(prices: readonly ModelPrice[], provider: string): string[] {
  return [...new Set(prices.filter((p) => p.provider === provider).map((p) => p.model))].sort()
}

/** The lowest free priority of a feature within meta's bounds, or null when the chain is full. */
export function nextFreePriority(chain: readonly AiRoute[], meta: OpsMeta | null): number | null {
  const min = meta?.priority.min ?? 1
  const max = meta?.priority.max ?? 9
  const used = new Set(chain.map((r) => r.priority))
  for (let p = min; p <= max; p++) if (!used.has(p)) return p
  return null
}

/**
 * Params that only one provider reads; upstream refuses them on any other
 * (kensaurus-ops.ts superRefine). Every other key in meta applies to all.
 * The fallback for an upstream that does not send `meta.route_param_providers` yet.
 */
const PARAM_PROVIDER: Record<string, string> = {
  reasoning_effort: 'openai',
  thinking: 'anthropic',
  effort: 'anthropic',
}

/** The param keys meta lists that this provider takes, in meta's order. */
export function paramFieldsFor(meta: OpsMeta | null, provider: string): string[] {
  const fromMeta = meta?.route_param_providers
  const applies = (k: string): boolean => {
    if (fromMeta) {
      const list = fromMeta[k]
      return !Array.isArray(list) || list.includes(provider)
    }
    return !PARAM_PROVIDER[k] || PARAM_PROVIDER[k] === provider
  }
  return Object.keys(meta?.route_params ?? {}).filter(applies)
}

/** The allowed values of an enum param from meta, or null for a free value. */
export function paramChoices(meta: OpsMeta | null, key: string): string[] | null {
  const v = meta?.route_params?.[key]
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
}

const PARAM_SHORT: Record<string, string> = {
  max_output_tokens: 'max',
  temperature: 'temp',
  reasoning_effort: 'reasoning',
  effort: 'effort',
  thinking: 'thinking',
  secret_name: 'key',
}

/** A route's params as small chips: `effort high`, `temp 0.2`, `thinking enabled 4096`. */
export function paramChips(params: RouteParams | null | undefined): string[] {
  if (!params) return []
  return Object.entries(params).flatMap(([k, v]) => {
    if (v == null) return []
    const name = PARAM_SHORT[k] ?? k
    if (k === 'thinking' && typeof v === 'object') {
      const t = v as { type?: string; budget_tokens?: number }
      return [`${name} ${t.type ?? '?'}${t.budget_tokens ? ` ${t.budget_tokens}` : ''}`]
    }
    return [`${name} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`]
  })
}

// ── history ─────────────────────────────────────────────────────────────────

export interface HistoryRow {
  id: string
  at: string
  actor: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  kind: 'route' | 'provider'
  subject: string
  diff: Array<{ field: string; before: string; after: string }>
}

/** Stamps that change on every write; never a diff line. */
const STAMP_FIELDS = new Set(['updated_at', 'updated_by', 'provider_state'])

function show(v: unknown): string {
  if (v === undefined || v === null) return '—'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

/**
 * The fields that differ between before and after, stamps left out.
 * @internal Exported for tests.
 */
export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): HistoryRow['diff'] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !STAMP_FIELDS.has(k))
  return keys.flatMap((field) => {
    const b = show(before?.[field])
    const a = show(after?.[field])
    return b === a ? [] : [{ field, before: b, after: a }]
  })
}

/**
 * "console:<uuid>" → "console:1a2b3c4d"; migration and other labels as they are.
 * @internal Exported for tests.
 */
export function actorLabel(actor: string | null): string {
  if (!actor) return 'unknown'
  const m = /^([a-z][a-z0-9-]*):([0-9a-f]{8})[0-9a-f-]{28}$/i.exec(actor)
  return m ? `${m[1]}:${m[2]}` : actor
}

/** Route and account changes merged, newest first. */
export function buildHistory(routes: readonly RouteChange[], providers: readonly ProviderChange[]): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...routes.map((c) => ({
      id: `r${c.id}`,
      at: c.changed_at,
      actor: actorLabel(c.changed_by),
      op: c.op,
      kind: 'route' as const,
      subject: `${c.app} › ${featureLabel(c.feature)} › #${c.priority}`,
      diff: diffFields(c.before as Record<string, unknown> | null, c.after as Record<string, unknown> | null),
    })),
    ...providers.map((c) => ({
      id: `p${c.id}`,
      at: c.changed_at,
      actor: actorLabel(c.changed_by),
      op: c.op,
      kind: 'provider' as const,
      subject: c.account_id,
      diff: diffFields(c.before, c.after),
    })),
  ]
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
}

export type HistoryItem =
  | { type: 'row'; row: HistoryRow }
  | { type: 'group'; id: string; actor: string; op: HistoryRow['op']; kind: HistoryRow['kind']; rows: HistoryRow[] }
  /** The same change by one actor on several rows ("effort: low added" on four routes). */
  | { type: 'same'; id: string; actor: string; kind: HistoryRow['kind']; changes: string[]; rows: HistoryRow[] }

function parseObject(v: string): Record<string, unknown> | null {
  if (!v.startsWith('{')) return null
  try {
    const o = JSON.parse(v) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `{ thinking: { type: 'disabled' } }` → { 'thinking.type': 'disabled' }. */
function flatten(o: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key))
    else out[key] = show(v)
  }
  return out
}

/**
 * A row's changes in plain words, one per changed value: "effort: low added", "model: gpt-6 →
 * gpt-6-luna", "turned on". Raw JSON struck through (`{"thinking":…}` → `{"effort":"low",…}`) said
 * the same thing in a way nobody reads, and cut off at 390 (2026-11-18).
 */
export function plainChanges(row: Pick<HistoryRow, 'op' | 'diff'>): string[] {
  return row.diff.flatMap((d) => {
    if (row.op === 'INSERT') return [`${d.field}: ${d.after}`]
    if (row.op === 'DELETE') return [`${d.field}: ${d.before}`]
    if (d.field === 'enabled' && (d.after === 'true' || d.after === 'false')) return [d.after === 'true' ? 'turned on' : 'turned off']
    const b = parseObject(d.before)
    const a = parseObject(d.after)
    if (b || a) {
      const fb = b ? flatten(b) : {}
      const fa = a ? flatten(a) : {}
      const keys = [...new Set([...Object.keys(fb), ...Object.keys(fa)])]
      return keys.flatMap((k) => {
        if (!(k in fb)) return [`${k}: ${fa[k]} added`]
        if (!(k in fa)) return [`${k}: ${fb[k]} removed`]
        return fb[k] === fa[k] ? [] : [`${k}: ${fb[k]} → ${fa[k]}`]
      })
    }
    return [`${d.field}: ${d.before} → ${d.after}`]
  })
}

/**
 * Runs of `minRun`+ adds or deletes by the same actor on the same kind (a migration that adds
 * nine routes) fold into one item, so the list shows "migration added 9 routes" instead of nine
 * near-identical rows of raw values. Changes stay one row each: their diffs differ.
 */
export function groupHistory(rows: readonly HistoryRow[], minRun = 3): HistoryItem[] {
  const out: HistoryItem[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]!
    // Two or more changes in a row by one actor that change the same thing the same way fold too.
    if (r.op === 'UPDATE') {
      const changes = plainChanges(r)
      const sig = changes.join('\n')
      let k = i + 1
      while (sig && k < rows.length && rows[k]!.op === 'UPDATE' && rows[k]!.actor === r.actor && rows[k]!.kind === r.kind && plainChanges(rows[k]!).join('\n') === sig) k++
      if (sig && k - i >= 2) {
        out.push({ type: 'same', id: `s-${r.id}`, actor: r.actor, kind: r.kind, changes, rows: rows.slice(i, k) })
        i = k
        continue
      }
    }
    let j = i + 1
    if (r.op !== 'UPDATE') while (j < rows.length && rows[j]!.op === r.op && rows[j]!.actor === r.actor && rows[j]!.kind === r.kind) j++
    if (j - i >= minRun) {
      out.push({ type: 'group', id: `g-${r.id}`, actor: r.actor, op: r.op, kind: r.kind, rows: rows.slice(i, j) })
      i = j
    } else {
      out.push({ type: 'row', row: r })
      i++
    }
  }
  return out
}

// ── tabs and errors ─────────────────────────────────────────────────────────

export type ProvidersTab = 'providers' | 'spend' | 'routes' | 'history'
export const PROVIDERS_TABS: ReadonlyArray<{ id: ProvidersTab; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'spend', label: 'Spend' },
  { id: 'routes', label: 'Routes' },
  { id: 'history', label: 'History' },
]

export function resolveProvidersTab(raw: string | null): ProvidersTab {
  return PROVIDERS_TABS.some((t) => t.id === raw) ? (raw as ProvidersTab) : 'providers'
}

/** One line for a refused write. */
export function writeErrorText(error: { code: string; message: string; issues?: unknown[] } | undefined): string {
  if (!error) return 'Not saved.'
  // Upstream sends a readable `message` on 409 and 422 (last_default_route, unpriced_model);
  // the proxy fills `message` with the code when there is none. Read the real one when present.
  const own = error.message && error.message !== error.code ? error.message : null
  switch (error.code) {
    case 'unpriced_model':
      return own ?? 'No price for this model yet: add it in Kenji first'
    case 'last_default_route':
      return own ?? `${LAST_DEFAULT_HINT}: an app needs one enabled default route`
    case 'validation_failed': {
      const issues = (error.issues ?? []).filter((i): i is string => typeof i === 'string')
      return `Not saved: ${issues.length > 0 ? issues.join('; ') : error.message}`
    }
    case 'not_found':
      return 'That route or account no longer exists'
    case 'upstream_auth':
      return 'Kenji refused the console token'
    case 'upstream_unreachable':
      return 'Kenji did not answer in time'
    default:
      return error.message || 'Not saved.'
  }
}

// ── optimistic writes ───────────────────────────────────────────────────────

/** What a toggle or reorder changes before the server answers. */
export type OptimisticPatch =
  | { kind: 'provider-enabled'; id: string; enabled: boolean }
  | { kind: 'route-enabled'; app: string; feature: string; priority: number; enabled: boolean }
  | { kind: 'reorder'; app: string; feature: string; order: number[] }

/** The snapshot as it will look once the write lands; unchanged when the patch no longer fits. */
export function applyOptimistic(snapshot: OpsSnapshot | null, patch: OptimisticPatch): OpsSnapshot | null {
  if (!snapshot) return snapshot
  switch (patch.kind) {
    case 'provider-enabled':
      return { ...snapshot, providers: snapshot.providers.map((p) => (p.id === patch.id ? { ...p, enabled: patch.enabled } : p)) }
    case 'route-enabled':
      return {
        ...snapshot,
        routes: snapshot.routes.map((r) =>
          r.app === patch.app && r.feature === patch.feature && r.priority === patch.priority ? { ...r, enabled: patch.enabled } : r,
        ),
      }
    case 'reorder': {
      const current = snapshot.routes.filter((r) => r.app === patch.app && r.feature === patch.feature).map((r) => r.priority)
      const fits = current.length === patch.order.length && patch.order.every((p) => current.includes(p))
      return fits ? { ...snapshot, routes: applyReorder(snapshot.routes, patch.app, patch.feature, patch.order) } : snapshot
    }
  }
}

/**
 * A provider's state as the console's run status (components/signal/StatusMark): down ✕,
 * warn ⧗ (degraded), ok ✓, stale ◷ (no recent probe), unknown ○.
 */
export const PROVIDER_STATUS: Record<ProviderState, RunStatus> = {
  down: 'failed',
  warn: 'slow',
  ok: 'passed',
  stale: 'waiting',
  unknown: 'idle',
}

/** A margin (0.12 = 12%) as the kit's change chip: "▲ +12%" is better, "▼ -8%" worse. */
export function marginChange(value: number | null): { text: string; worse: boolean } | null {
  if (value == null) return null
  const pct = Math.round(value * 100)
  return pct >= 0 ? { text: `▲ +${pct}%`, worse: false } : { text: `▼ ${pct}%`, worse: true }
}
