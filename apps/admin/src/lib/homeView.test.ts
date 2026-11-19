import { describe, expect, it } from 'vitest'
import { dedupeHomeSections, groupHomeKeys, healthDisplayTone, splitWeekRows } from './homeView'
import type { HealthSignal, HomeSection, ProjectHome, WeekRow } from './projectHome'

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
