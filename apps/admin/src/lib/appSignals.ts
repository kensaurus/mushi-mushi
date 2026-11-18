/**
 * FILE: apps/admin/src/lib/appSignals.ts
 * PURPOSE: Rank the team's apps by what is wrong with them (2026-11-18, the
 *          Apps page's signal pass; owner: "all 10 cards say Bugs to fix, so
 *          nothing stands out"). One pure function turns each portfolio card
 *          (plus the SDK's last check-in) into the six signals the heat grid
 *          shows, a score, and the reasons behind it, worst first. The grid,
 *          the alert cards and the headline all read this, so they agree.
 *
 * Order: first the tier the cards already use (broken, then needs you, then
 * chores like an SDK update, then clear: `urgencyRank`), so the "Need you"
 * count still matches; inside a tier, the score. Score weights, highest
 * first (each reason's weight is its share of the score):
 *   - broken (a part failing, blueprint unreadable)         100
 *   - CI failures today        15 each, counted up to 4      ≤ 60
 *   - serious risks            10 each, up to 5              ≤ 50
 *   - open bugs                8 × log2(1 + n)               1 → 8, 12 → 30, 40 → 43
 *   - SDK silent over 7 days                                 10
 *   - a part to fix (CI, design, routes…)    6 each
 *   - risks to look at          2 each, up to 5              ≤ 10
 *   - SDK quiet (1 h to 7 days)                              2
 *   - SDK behind the latest release                          2
 * Unknown is never zero: a signal that could not be read is null and adds
 * nothing, and the grid shows it as "no data".
 */

import type { PortfolioCard } from './portfolioTypes'
import type { SetupProject } from './useSetupStatus'
import { sdkFreshness, type SdkFreshness } from './heartbeat'
import { appProblems, appUrgency, urgencyRank } from '../components/portfolio/portfolioView'
import type { SignalAlert } from '../components/signal/AlertCards'
import { appLink } from './openApp'

const DAY_MS = 86_400_000

type AppReasonId = 'broken' | 'ci' | 'risks' | 'bugs' | 'silent' | 'fix' | 'watch' | 'quiet' | 'sdk'

interface AppReason {
  id: AppReasonId
  /** A few words for the headline and the alert title: "4 CI jobs failed today". */
  short: string
  /** The big number on an alert card. */
  metric: { value: string; unit: string }
  /** The page that fixes it (before appLink scopes it to the app). */
  to: string
  weight: number
}

export interface AppSignals {
  card: PortfolioCard
  /** 0 broken, 1 needs you, 2 chores, 3 clear. */
  tier: 0 | 1 | 2 | 3
  openBugs: { value: number; atLeast: boolean }
  /** null: the risk checks never ran, failed, or could not be read. */
  risks: { error: number; warn: number } | null
  /** Why `risks` is null, for the cell's title. */
  risksNote: string | null
  sdk: 'behind' | 'current' | 'unknown'
  sdkNote: string
  /** Days since the latest release shipped; null when none is recorded. */
  releaseAgeDays: number | null
  /** null: no repo, an older server, or the read failed. */
  ciFailsToday: { value: number; atLeast: boolean } | null
  /** `unknown`: this app is not in the setup list (yet), so nothing is known. */
  checkIn: { freshness: SdkFreshness | 'unknown'; at: string | null }
  score: number
  /** Worst first; empty when nothing is wrong. */
  reasons: AppReason[]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "12m", "5h", "9d": an age in the fewest characters (heat cells). */
export function shortAge(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'never'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86_400) return `${Math.round(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

function tierOf(card: PortfolioCard): AppSignals['tier'] {
  const r = urgencyRank(card)
  return r === 0 ? 0 : r <= 2 ? 1 : r <= 4 ? 2 : 3
}

/** The SDK's newest check-in per app from the setup list; an app missing from it is unknown. */
export function lastCheckIns(projects: readonly SetupProject[] | null | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const p of projects ?? []) {
    const d = p.steps.find((s) => s.id === 'sdk_installed')?.diagnostic
    out.set(p.project_id, d?.last_sdk_seen_at ?? null)
  }
  return out
}

/** @internal Exported for tests; the page uses rankApps. One app's signals, score and reasons. */
export function appSignals(card: PortfolioCard, checkIns: ReadonlyMap<string, string | null>, now: number): AppSignals {
  const reasons: AppReason[] = []
  const urgency = appUrgency(card)
  const tier = tierOf(card)

  if (tier === 0) {
    const failing = appProblems(card).find((p) => p.state === 'error')
    reasons.push({
      id: 'broken',
      short: urgency.short,
      metric: failing ? { value: failing.label, unit: 'failing' } : { value: '?', unit: 'unreadable' },
      to: urgency.next?.to ?? '/recipe',
      weight: 100,
    })
  }

  const ciUnread = card.unreadable.includes('ci')
  const ciFailsToday = card.ciFailsToday == null ? null : { value: card.ciFailsToday, atLeast: ciUnread }
  if (ciFailsToday && ciFailsToday.value > 0) {
    const n = ciFailsToday.value
    reasons.push({ id: 'ci', short: `${n}${ciFailsToday.atLeast ? '+' : ''} CI ${n === 1 ? 'job' : 'jobs'} failed today`, metric: { value: `${n}${ciFailsToday.atLeast ? '+' : ''}`, unit: n === 1 ? 'job failed' : 'jobs failed' }, to: '/ci', weight: 15 * Math.min(n, 4) })
  }

  const radarUnread = card.unreadable.includes('gate_runs') || card.unreadable.includes('findings')
  const risksNote = radarUnread
    ? 'Not every risk check could be read'
    : !card.radar.checkedAt || card.radar.status === 'never_run'
      ? 'The risk checks have not run yet'
      : card.radar.status === 'error'
        ? 'The last risk check could not finish'
        : null
  const risks = risksNote ? null : { error: card.radar.open.error, warn: card.radar.open.warn }
  if (risks && risks.error > 0) {
    reasons.push({ id: 'risks', short: plural(risks.error, 'serious risk'), metric: { value: String(risks.error), unit: risks.error === 1 ? 'risk' : 'risks' }, to: '/recipe', weight: 10 * Math.min(risks.error, 5) })
  }

  const openBugs = { value: card.openReports, atLeast: card.unreadable.includes('reports') }
  if (openBugs.value > 0) {
    const n = `${openBugs.value}${openBugs.atLeast ? '+' : ''}`
    reasons.push({ id: 'bugs', short: `${n} open ${openBugs.value === 1 ? 'bug' : 'bugs'}`, metric: { value: n, unit: openBugs.value === 1 ? 'bug' : 'bugs' }, to: '/reports', weight: 8 * Math.log2(1 + openBugs.value) })
  }

  const known = checkIns.has(card.projectId)
  const seenAt = checkIns.get(card.projectId) ?? null
  const freshness: SdkFreshness | 'unknown' = known ? sdkFreshness(seenAt, now) : 'unknown'
  if (freshness === 'cold' && seenAt) {
    const days = Math.floor((now - Date.parse(seenAt)) / DAY_MS)
    reasons.push({ id: 'silent', short: `SDK silent ${days} d`, metric: { value: String(days), unit: 'days silent' }, to: '/connect', weight: 10 })
  }

  if (tier !== 0) {
    const drift = appProblems(card).filter((p) => p.state === 'drift')
    if (drift.length > 0) {
      reasons.push({
        id: 'fix',
        short: drift.length === 1 ? `${drift[0].label} to fix` : `${drift.length} parts to fix`,
        metric: { value: String(drift.length), unit: drift.length === 1 ? 'part to fix' : 'parts to fix' },
        to: urgency.level === 'fix' && urgency.next ? urgency.next.to : '/recipe',
        weight: 6 * drift.length,
      })
    }
  }

  if (risks && risks.warn > 0) {
    reasons.push({ id: 'watch', short: plural(risks.warn, 'risk to look at', 'risks to look at'), metric: { value: String(risks.warn), unit: 'to look at' }, to: '/recipe', weight: 2 * Math.min(risks.warn, 5) })
  }
  if (freshness === 'stale' && seenAt) {
    reasons.push({ id: 'quiet', short: `SDK quiet ${shortAge(seenAt, now)}`, metric: { value: shortAge(seenAt, now), unit: 'quiet' }, to: '/connect', weight: 2 })
  }

  const sdkUnread = card.unreadable.includes('sdk')
  const behind = sdkUnread ? undefined : card.sdk.find((e) => e.status === 'behind')
  const current = sdkUnread ? undefined : card.sdk.find((e) => e.status === 'current')
  const sdk: AppSignals['sdk'] = behind ? 'behind' : current ? 'current' : 'unknown'
  const sdkNote = sdkUnread
    ? 'The SDK versions could not be read'
    : behind
      ? `${behind.package ?? 'SDK'} ${behind.version} → ${behind.latest}`
      : current
        ? `${current.package ?? 'SDK'} ${current.version} (latest)`
        : (card.sdk[0]?.reason ?? 'No SDK has reported yet')
  if (behind) reasons.push({ id: 'sdk', short: `SDK ${behind.version} → ${behind.latest}`, metric: { value: behind.latest ?? '?', unit: 'SDK out' }, to: '/connect', weight: 2 })

  const shipped = card.latestRelease?.publishedAt ? Date.parse(card.latestRelease.publishedAt) : NaN
  const releaseAgeDays = Number.isFinite(shipped) ? Math.max(0, Math.floor((now - shipped) / DAY_MS)) : null

  reasons.sort((a, b) => b.weight - a.weight)
  const score = reasons.reduce((n, r) => n + r.weight, 0)
  return { card, tier, openBugs, risks, risksNote, sdk, sdkNote, releaseAgeDays, ciFailsToday, checkIn: { freshness, at: seenAt }, score, reasons }
}

/** Every app's signals, worst first (tier, then score, then name), or A to Z. */
export function rankApps(
  cards: readonly PortfolioCard[],
  checkIns: ReadonlyMap<string, string | null>,
  now: number,
  by: 'worst' | 'name' = 'worst',
): AppSignals[] {
  const rows = cards.map((c) => appSignals(c, checkIns, now))
  if (by === 'name') return rows.sort((a, b) => a.card.name.localeCompare(b.card.name))
  return rows.sort((a, b) => a.tier - b.tier || b.score - a.score || a.card.name.localeCompare(b.card.name))
}

/** Apps that need their owner (broken or tier "needs you"), worst first. */
function appsNeedingYou(ranked: readonly AppSignals[]): AppSignals[] {
  return ranked.filter((r) => r.tier <= 1 && r.reasons.length > 0)
}

/** "glot.it (4 CI jobs failed today, 3 open bugs)": the name and its top two reasons. */
function named(r: AppSignals): string {
  const why = r.reasons.slice(0, 2).map((x) => x.short).join(', ')
  return why ? `${r.card.name} (${why})` : r.card.name
}

/**
 * The page's headline: a ranking, not a count ("All 10 apps need you" said
 * nothing about which one first). Expects `rankApps(…, 'worst')`.
 */
export function rankingSentence(ranked: readonly AppSignals[]): { sentence: string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; first: AppSignals | null } {
  if (ranked.length === 0) return { sentence: 'No apps yet.', tone: 'neutral', first: null }
  const needing = appsNeedingYou(ranked)
  if (needing.length === 0) {
    const chores = ranked.filter((r) => r.reasons.length > 0).length
    return {
      sentence: chores > 0 ? `No app needs you right now. ${plural(chores, 'app has', 'apps have')} small chores, like an SDK update.` : ranked.length === 1 ? `${ranked[0].card.name} is clear.` : `All ${ranked.length} apps are clear.`,
      tone: 'ok',
      first: null,
    }
  }
  const top = needing.slice(0, 3).map(named).join(' · ')
  const rest = needing.length - 3
  const first = needing[0]
  const tone = first.tier === 0 || (first.ciFailsToday?.value ?? 0) > 0 ? 'danger' : 'warn'
  return { sentence: `Worst first: ${top}${rest > 0 ? ` · ${rest} more ${rest === 1 ? 'needs' : 'need'} you` : ''}.`, tone, first }
}

/** The highlight key of an app: its heat row, alert card and app card share it. */
export function appKey(projectId: string): string {
  return `app:${projectId}`
}

const ALERT_LABEL: Record<AppReasonId, string> = {
  broken: 'Broken',
  ci: 'CI red',
  risks: 'Serious risk',
  bugs: 'Bugs waiting',
  silent: 'SDK silent',
  fix: 'Part to fix',
  watch: 'Risks',
  quiet: 'SDK quiet',
  sdk: 'SDK update',
}

const ACTION_LABEL: Record<AppReasonId, string> = {
  broken: 'See why',
  ci: 'Open CI',
  risks: 'Open risks',
  bugs: 'Open bugs',
  silent: 'Check SDK',
  fix: 'Fix it',
  watch: 'Open risks',
  quiet: 'Check SDK',
  sdk: 'Update SDK',
}

/**
 * Alert cards for the worst apps that need you (at most `max`): the top
 * reason as the title and the big number, the next ones as the detail line,
 * and one action that opens the page fixing the top reason, in that app.
 * Critical (red, pulsing) when the app is broken or its CI failed today.
 */
export function appAlerts(ranked: readonly AppSignals[], onOpen: (projectId: string) => void, max = 3): SignalAlert[] {
  return appsNeedingYou(ranked)
    .slice(0, max)
    .map((r) => {
      const top = r.reasons[0]
      const id = r.card.projectId
      const rest = r.reasons.slice(1, 4).map((x) => x.short)
      return {
        id,
        severity: r.tier === 0 || (r.ciFailsToday?.value ?? 0) > 0 ? 'critical' : 'serious',
        label: ALERT_LABEL[top.id],
        app: r.card.name,
        title: top.short.charAt(0).toUpperCase() + top.short.slice(1),
        detail: rest.length > 0 ? rest.join(' · ') : 'Nothing else open.',
        metric: top.metric,
        keys: [appKey(id)],
        action: { label: ACTION_LABEL[top.id], to: appLink(top.to, id), onClick: () => onOpen(id) },
      } satisfies SignalAlert
    })
}
