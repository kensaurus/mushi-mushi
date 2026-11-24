/**
 * FILE: apps/admin/src/lib/homeView.ts
 * PURPOSE: Pure display rules for Home → Today (components/home/*), kept out
 *          of the components so they can be tested:
 *            - one place per fact: a connect button or a count that two
 *              sections both carried is kept in one (round-2 sweep
 *              2026-11-18: "Turn on the live-site watch" twice, "1 new"
 *              restated as "1 bug report came in today");
 *            - the health light's tone as drawn: an incoming bug is not
 *              "good" news, so it is not green;
 *            - zero rows and unused keys folded to one line each.
 */

import type { ActivityLine, HealthSignal, HomeAccess, HomeSection, NeedsYouItem, ProjectHome, WeekRow } from './projectHome'
import type { SignalTone } from '../components/signal/StatusGlyph'

/**
 * Drops what another Home section already says:
 *  - the Pages card's connect button when a health light carries the same one
 *    (the "Is my site up?" light owns "Turn on the live-site watch");
 *  - the activity line counting today's bug reports while the "Bugs today"
 *    light could read today's count.
 */
export function dedupeHomeSections(data: ProjectHome): ProjectHome {
  const signals = data.health.status === 'ok' ? (data.health.data ?? []) : []
  const lightConnects = new Set(signals.flatMap((s) => (s.connect ? [`${s.connect.label}\u0000${s.connect.to}`] : [])))
  const sitemapConnect = data.sitemap.connect
  const sitemap =
    sitemapConnect && lightConnects.has(`${sitemapConnect.label}\u0000${sitemapConnect.to}`) ? { ...data.sitemap, connect: null } : data.sitemap

  const errorsLight = signals.find((s) => s.id === 'errors')
  const todayShown = !!errorsLight && errorsLight.status === 'ok'
  const kept = todayShown && data.activity.data ? withoutTodayReports(data.activity.data, data.week.status === 'ok' ? (data.week.data ?? []) : []) : null
  const activity = kept && kept !== data.activity.data ? { ...data.activity, data: kept } : data.activity

  return sitemap === data.sitemap && activity === data.activity ? data : { ...data, sitemap, activity }
}

/**
 * The activity list without "N bug reports came in today" (Bugs today shows
 * that count). The server sends the week's reports only when none came in
 * today, so dropping today's line left Recent activity saying "nothing
 * reported" beside "Bug reports 4 this week" (round-3 sweep 2026-11-19). The
 * week line is rebuilt from the This week row, so both cards read one count.
 */
function withoutTodayReports(lines: ActivityLine[], week: readonly WeekRow[]): ActivityLine[] {
  const today = lines.findIndex((l) => l.id === 'reports_today')
  if (today < 0) return lines
  const out = lines.filter((l) => l.id !== 'reports_today')
  const n = week.find((r) => r.id === 'reports')?.thisWeek ?? 0
  if (n > 0 && !out.some((l) => l.id === 'reports_week')) {
    out.splice(today, 0, { id: 'reports_week', text: `${n} bug ${n === 1 ? 'report' : 'reports'} came in this week`, to: '/reports?days=7' })
  }
  return out
}

/**
 * @internal Exported for tests.
 * Where a button goes, for "is this the same button?": the path, other
 * params and the hash, without the `project` pin. `/connect?project=…#connect-sdk-health`
 * and `/connect#connect-sdk-health` are one place.
 */
export function ctaTarget(to: string): string {
  const [rest, hash = ''] = to.split('#') as [string, string?]
  const [path, query = ''] = rest.split('?') as [string, string?]
  const params = new URLSearchParams(query)
  params.delete('project')
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

/**
 * The health lights without a connect button that Needs you or another light
 * already carries (ADR 0069: one button per place). A brand-new app showed
 * "Set up the SDK" in Needs you and on the SDK light, and "Install the SDK"
 * for the same page on the Bugs today light. The light whose own page the
 * button opens keeps it; the others keep their status and lose the button.
 */
export function healthWithoutRepeatedConnects(
  health: HomeSection<HealthSignal[]>,
  needs: readonly NeedsYouItem[],
): HomeSection<HealthSignal[]> {
  if (health.status !== 'ok' || !health.data) return health
  const seen = new Set(needs.map((n) => ctaTarget(n.action.to)))
  const signals = health.data
  const owns = (s: HealthSignal) => !!s.connect && ctaTarget(s.connect.to) === ctaTarget(s.href)
  const keep = new Set<string>()
  for (const s of [...signals.filter(owns), ...signals.filter((x) => !owns(x))]) {
    if (!s.connect) continue
    const t = ctaTarget(s.connect.to)
    if (seen.has(t)) continue
    seen.add(t)
    keep.add(s.id)
  }
  const next = signals.map((s) => (s.connect && !keep.has(s.id) ? { ...s, connect: null } : s))
  return next.some((s, i) => s !== signals[i]) ? { ...health, data: next } : health
}

/**
 * Which Home cards have something to show (ADR 0069: a card with no data
 * stays hidden until it has some). A read that failed always shows, so the
 * owner sees "could not read"; a card that is not connected hides, because a
 * health light or the setup checklist carries its connect button.
 */
export function homeCardsWithContent(data: Pick<ProjectHome, 'release' | 'sitemap' | 'week' | 'activity'>): {
  release: boolean
  sitemap: boolean
  week: boolean
  activity: boolean
} {
  const has = <T>(s: HomeSection<T>, test: (d: T) => boolean) => s.status === 'error' || (s.status === 'ok' && s.data != null && test(s.data))
  return {
    release: has(data.release, (r) => !!r.train || !!r.lastDeploy || !r.waiting || r.waiting.total > 0 || r.stations.some((s) => s.count > 0 || s.stuck > 0)),
    sitemap: has(data.sitemap, (m) => m.pages.some((p) => p.views > 0 || p.bugs > 0 || p.broken)),
    week: has(data.week, (rows) => splitWeekRows(rows).active.length > 0),
    activity: has(data.activity, (lines) => lines.length > 0),
  }
}

const LIGHT_TONE: Record<HealthSignal['light'], SignalTone> = { good: 'ok', warn: 'warn', bad: 'danger', busy: 'info', off: 'off' }

/**
 * The tone a health light is drawn in. The server calls "Bugs today: 1 new"
 * good when the count is not rising, but a green mark beside an incoming bug
 * read as "bugs are good". New bugs that need no alarm are information (■ blue);
 * "None new" stays green.
 */
export function healthDisplayTone(s: Pick<HealthSignal, 'id' | 'light' | 'headline' | 'status'>): SignalTone {
  if (s.status === 'error') return 'off'
  if (s.id === 'errors' && s.light === 'good' && !/^none\b/i.test(s.headline)) return 'info'
  return LIGHT_TONE[s.light]
}

/** Rows with something in either week, and the rows that were 0 both weeks. */
export function splitWeekRows(rows: readonly WeekRow[]): { active: WeekRow[]; quiet: WeekRow[] } {
  const active: WeekRow[] = []
  const quiet: WeekRow[] = []
  for (const r of rows) (r.thisWeek === 0 && r.lastWeek === 0 ? quiet : active).push(r)
  return { active, quiet }
}

type HomeKey = Pick<HomeAccess['keys'][number], 'label' | 'kind' | 'lastUsedAt'>
export type GroupedKey = HomeKey & { count: number }

/**
 * One row per key name and kind, newest use first: every `mushi login` mints a
 * "cli-login" key, so Home listed five identical rows (2026-11-16). Keys that
 * were never used go to one line ("3 never used: …") instead of a row each.
 */
export function groupHomeKeys(keys: readonly HomeKey[]): { used: GroupedKey[]; unused: GroupedKey[] } {
  const out = new Map<string, GroupedKey>()
  for (const k of keys) {
    const id = `${k.label}\u0000${k.kind}`
    const seen = out.get(id)
    if (!seen) out.set(id, { ...k, count: 1 })
    else {
      seen.count++
      if (k.lastUsedAt && (!seen.lastUsedAt || k.lastUsedAt > seen.lastUsedAt)) seen.lastUsedAt = k.lastUsedAt
    }
  }
  const all = [...out.values()]
  const used = all.filter((k) => k.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
  const unused = all.filter((k) => !k.lastUsedAt)
  return { used, unused }
}
