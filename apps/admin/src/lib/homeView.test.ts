import { describe, expect, it } from 'vitest'
import { ctaTarget, dedupeHomeSections, groupHomeKeys, healthDisplayTone, healthWithoutRepeatedConnects, homeCardsWithContent, splitWeekRows } from './homeView'
import type { HealthSignal, HomeRelease, HomeSection, ProjectHome, WeekRow } from './projectHome'

const ok = <T,>(data: T): HomeSection<T> => ({ status: 'ok', data, connect: null, error: null })
const watch = { label: 'Turn on the live-site watch', to: '/inventory?tab=discovery' }
const light = (over: Partial<HealthSignal>): HealthSignal => ({
  id: 'site',
  label: 'Site up',
  status: 'ok',
  light: 'good',
  headline: 'Up',
  detail: null,
  at: null,
  href: '/',
  connect: null,
  ...over,
})

function home(over: Partial<ProjectHome> = {}): ProjectHome {
  return {
    generatedAt: '2026-11-18T00:00:00Z',
    projectId: 'p',
    app: ok(null as never),
    health: ok([light({ id: 'site', status: 'not_connected', light: 'off', headline: 'Not watched', connect: watch }), light({ id: 'errors', headline: '1 new' })]),
    needsYou: ok([]),
    release: ok(null as never),
    sitemap: { status: 'not_connected', data: null, connect: watch, error: null },
    week: ok([]),
    activity: ok([
      { id: 'reports_today', text: '1 bug report came in today', to: '/reports?days=1' },
      { id: 'merged_today', text: '2 fixes merged today', to: '/fixes' },
    ]),
    access: ok(null as never),
    partial: [],
    ...over,
  }
}

describe('dedupeHomeSections (round-2 sweep 2026-11-18)', () => {
  it('keeps the live-site watch button on the health light only', () => {
    const out = dedupeHomeSections(home())
    expect(out.sitemap.connect).toBeNull()
    expect(out.health.data![0].connect).toEqual(watch)
  })

  it('keeps a Pages connect button no light carries', () => {
    const own = { label: 'Install the SDK', to: '/connect' }
    expect(dedupeHomeSections(home({ sitemap: { status: 'not_connected', data: null, connect: own, error: null } })).sitemap.connect).toEqual(own)
  })

  it('drops the "came in today" activity line while Bugs today shows the count', () => {
    expect(dedupeHomeSections(home()).activity.data!.map((l) => l.id)).toEqual(['merged_today'])
  })

  it('swaps the dropped today line for the week count from This week (round-3 sweep)', () => {
    const week = ok<WeekRow[]>([{ id: 'reports', label: 'Bug reports', thisWeek: 4, lastWeek: 0, moreIsBetter: false, href: '/reports' }])
    const h = home({ week, activity: ok([{ id: 'reports_today', text: '1 bug report came in today', to: '/reports?days=1' }]) })
    expect(dedupeHomeSections(h).activity.data).toEqual([{ id: 'reports_week', text: '4 bug reports came in this week', to: '/reports?days=7' }])
  })

  it('keeps the activity line when the Bugs today light could not read', () => {
    const h = home({ health: ok([light({ id: 'errors', status: 'error', headline: 'Could not read' })]) })
    expect(dedupeHomeSections(h).activity.data!.map((l) => l.id)).toEqual(['reports_today', 'merged_today'])
  })
})

describe('healthDisplayTone', () => {
  it('never draws an incoming bug green', () => {
    expect(healthDisplayTone(light({ id: 'errors', light: 'good', headline: '1 new' }))).toBe('info')
    expect(healthDisplayTone(light({ id: 'errors', light: 'good', headline: 'None new' }))).toBe('ok')
    expect(healthDisplayTone(light({ id: 'errors', light: 'bad', headline: '2 critical' }))).toBe('danger')
  })

  it('maps the other lights one to one and an unread one to off', () => {
    expect(healthDisplayTone(light({ id: 'ci', light: 'good', headline: 'Passing' }))).toBe('ok')
    expect(healthDisplayTone(light({ id: 'ci', light: 'warn', headline: 'Machine stopped' }))).toBe('warn')
    expect(healthDisplayTone(light({ id: 'ci', status: 'error', light: 'off', headline: 'Could not read' }))).toBe('off')
  })
})

describe('splitWeekRows', () => {
  const row = (id: WeekRow['id'], thisWeek: number, lastWeek: number): WeekRow => ({ id, label: id, thisWeek, lastWeek, moreIsBetter: false, href: '/' })
  it('folds rows that were 0 both weeks', () => {
    const { active, quiet } = splitWeekRows([row('reports', 4, 0), row('critical', 0, 0), row('merged', 0, 2), row('sessions', 0, 0)])
    expect(active.map((r) => r.id)).toEqual(['reports', 'merged'])
    expect(quiet.map((r) => r.id)).toEqual(['critical', 'sessions'])
  })
})

describe('groupHomeKeys', () => {
  it('groups repeats, lists used keys newest first and never-used keys apart', () => {
    const { used, unused } = groupHomeKeys([
      { label: 'sdk-ingest', kind: 'sdk', lastUsedAt: null },
      { label: 'web', kind: 'sdk', lastUsedAt: '2026-11-18T09:00:00Z' },
      { label: 'cli-login', kind: 'mcp', lastUsedAt: '2026-11-18T10:00:00Z' },
      { label: 'cli-login', kind: 'mcp', lastUsedAt: '2026-11-17T10:00:00Z' },
      { label: 'ops', kind: 'other', lastUsedAt: null },
    ])
    expect(used.map((k) => [k.label, k.count])).toEqual([
      ['cli-login', 2],
      ['web', 1],
    ])
    expect(unused.map((k) => k.label)).toEqual(['sdk-ingest', 'ops'])
  })
})

// ADR 0069: one button per place, and a card only once it has something to show.
describe('one button per place', () => {
  const sdk = '/connect?project=p1#connect-sdk-health'
  it('reads a button target without the project pin', () => {
    expect(ctaTarget(sdk)).toBe('/connect#connect-sdk-health')
    expect(ctaTarget('/reports?project=p1&status=open')).toBe('/reports?status=open')
    expect(ctaTarget('/connect')).toBe('/connect')
  })

  it('drops a light connect that Needs you or the light that owns the page already carries', () => {
    const health = ok([
      light({ id: 'errors', href: '/reports?days=1', connect: { label: 'Install the SDK', to: sdk } }),
      light({ id: 'sdk', href: sdk, connect: { label: 'Set up the SDK', to: sdk } }),
      light({ id: 'ci', href: '/ci', connect: { label: 'Connect GitHub', to: '/connect' } }),
    ])
    const alone = healthWithoutRepeatedConnects(health, [])
    // The SDK light owns its page's button; Bugs today keeps its status only.
    expect(alone.data!.map((s) => s.connect?.label ?? null)).toEqual([null, 'Set up the SDK', 'Connect GitHub'])
    const withNeeds = healthWithoutRepeatedConnects(health, [{ id: 'sdk_silent', impact: 65, text: 'x', action: { label: 'Set up the SDK', to: '/connect#connect-sdk-health' } }])
    expect(withNeeds.data!.map((s) => s.connect?.label ?? null)).toEqual([null, null, 'Connect GitHub'])
    // Nothing repeated: the same section back.
    const plain = ok([light({ id: 'ci', href: '/ci', connect: { label: 'Connect GitHub', to: '/connect' } })])
    expect(healthWithoutRepeatedConnects(plain, [])).toBe(plain)
  })

  it('hides a card with nothing to show, never one whose read failed', () => {
    const emptyRelease: HomeRelease = {
      stations: [{ id: 'fix', label: 'Fix PRs', count: 0, stuck: 0 }],
      train: null,
      lastDeploy: null,
      waiting: { counts: { critical: 0, high: 0, medium: 0, low: 0, unrated: 0 }, total: 0 },
      waitingError: null,
    }
    const zero = (id: WeekRow['id']): WeekRow => ({ id, label: id, thisWeek: 0, lastWeek: 0, moreIsBetter: false, href: '/' })
    const quiet = homeCardsWithContent({
      release: ok(emptyRelease),
      sitemap: ok({ pages: [{ path: '/', label: 'Home', depth: 0, views: 0, bugs: 0, broken: false }], totalPages: 0, sampled: false }),
      week: ok([zero('reports'), zero('merged')]),
      activity: ok([]),
    })
    expect(quiet).toEqual({ release: false, sitemap: false, week: false, activity: false })
    const notConnected = { status: 'not_connected' as const, data: null, connect: { label: 'Connect GitHub', to: '/connect' }, error: null }
    expect(homeCardsWithContent({ release: notConnected, sitemap: notConnected, week: ok([]), activity: ok([]) }).release).toBe(false)
    const failed = { status: 'error' as const, data: null, connect: null, error: 'timeout' }
    expect(homeCardsWithContent({ release: failed, sitemap: failed, week: failed, activity: failed })).toEqual({ release: true, sitemap: true, week: true, activity: true })
    const busy = homeCardsWithContent({
      release: ok({ ...emptyRelease, waiting: { ...emptyRelease.waiting!, total: 2 } }),
      sitemap: ok({ pages: [{ path: '/', label: 'Home', depth: 0, views: 3, bugs: 0, broken: false }], totalPages: 1, sampled: false }),
      week: ok([{ ...zero('reports'), thisWeek: 1 }]),
      activity: ok([{ id: 'a', text: '1 fix merged today', to: '/fixes' }]),
    })
    expect(busy).toEqual({ release: true, sitemap: true, week: true, activity: true })
    // A bug count that could not be read is a problem to show.
    expect(homeCardsWithContent({ release: ok({ ...emptyRelease, waiting: null, waitingError: 'timeout' }), sitemap: failed, week: failed, activity: failed }).release).toBe(true)
  })
})
