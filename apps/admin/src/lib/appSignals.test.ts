/**
 * The Apps page ranking (2026-11-18): ten apps that all said "Bugs to fix"
 * now rank by what is actually wrong, unknown is never zero, and the headline
 * names the worst three instead of "All 10 apps need you".
 */
import { describe, expect, it } from 'vitest'
import type { PortfolioCard } from './portfolioTypes'
import type { SetupProject } from './useSetupStatus'
import { appAlerts, appKey, appSignals, lastCheckIns, rankApps, rankingSentence, shortAge } from './appSignals'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const card = (over: Partial<PortfolioCard>): PortfolioCard => ({
  projectId: over.name ?? 'p',
  name: 'p',
  slug: null,
  kind: 'app',
  kindSource: 'declared',
  worst: 'drift',
  elements: {},
  error: null,
  needsLook: [],
  openReports: 0,
  sdk: [{ projectId: 'p', package: '@mushi-mushi/web', version: '1.33.0', latest: '1.33.0', status: 'current', reason: 'Latest.' }],
  latestRelease: null,
  radar: { checkedAt: hoursAgo(3), status: 'pass', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
  ciFailsToday: 0,
  ...over,
})

const NONE = new Map<string, string | null>()

describe('appSignals', () => {
  it('reads each signal, and an unknown one stays null instead of 0', () => {
    const s = appSignals(
      card({
        name: 'a',
        openReports: 7,
        unreadable: ['reports', 'ci'],
        ciFailsToday: 2,
        latestRelease: { version: 'v2', publishedAt: hoursAgo(24 * 10 + 1) },
        sdk: [{ projectId: 'a', package: '@mushi-mushi/web', version: '1.30.0', latest: '1.33.0', status: 'behind', reason: '' }],
      }),
      new Map([['a', hoursAgo(24 * 9)]]),
      NOW,
    )
    expect(s.openBugs).toEqual({ value: 7, atLeast: true })
    expect(s.ciFailsToday).toEqual({ value: 2, atLeast: true })
    expect(s.releaseAgeDays).toBe(10)
    expect(s.sdk).toBe('behind')
    expect(s.sdkNote).toBe('@mushi-mushi/web 1.30.0 → 1.33.0')
    expect(s.checkIn.freshness).toBe('cold')
    expect(s.reasons.map((r) => r.id)).toEqual(['ci', 'bugs', 'silent', 'sdk'])
    expect(s.reasons[0]!.short).toBe('2+ CI jobs failed today')

    const blank = appSignals(card({ name: 'b', ciFailsToday: null, radar: { checkedAt: null, status: 'never_run', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 }, sdk: [] }), NONE, NOW)
    expect(blank.ciFailsToday).toBeNull()
    expect(blank.risks).toBeNull()
    expect(blank.risksNote).toBe('The risk checks have not run yet')
    expect(blank.sdk).toBe('unknown')
    // Missing from the setup list: unknown, not "never checked in".
    expect(blank.checkIn.freshness).toBe('unknown')
    expect(blank.releaseAgeDays).toBeNull()
  })

  it('a failed risk check and an unreadable one are unknown, never "no risks"', () => {
    expect(appSignals(card({ name: 'c', radar: { checkedAt: hoursAgo(1), status: 'error', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 2 } }), NONE, NOW).risks).toBeNull()
    expect(appSignals(card({ name: 'd', unreadable: ['findings'] }), NONE, NOW).risksNote).toBe('Not every risk check could be read')
  })
})

describe('rankApps', () => {
  // Every one of these used to read "Bugs to fix" with nothing standing out.
  const apps = [
    card({ name: 'many-bugs', openReports: 12 }),
    card({ name: 'ci-red', openReports: 2, ciFailsToday: 4 }),
    card({ name: 'risky', openReports: 1, radar: { checkedAt: hoursAgo(1), status: 'fail', open: { error: 3, warn: 0, info: 0 }, unchecked: 0, errored: 0 } }),
    card({ name: 'one-bug', openReports: 1 }),
    card({ name: 'clear', openReports: 0, worst: 'ok' }),
    card({ name: 'broken', error: 'could not be composed', worst: 'error' }),
  ]

  it('broken first, then by score: CI failing today and serious risks outrank a long bug list', () => {
    const ranked = rankApps(apps, NONE, NOW)
    expect(ranked.map((r) => r.card.name)).toEqual(['broken', 'ci-red', 'risky', 'many-bugs', 'one-bug', 'clear'])
    expect(ranked[0]!.tier).toBe(0)
    expect(ranked.at(-1)!.reasons).toEqual([])
  })

  it('or A to Z', () => {
    expect(rankApps(apps, NONE, NOW, 'name').map((r) => r.card.name)).toEqual(['broken', 'ci-red', 'clear', 'many-bugs', 'one-bug', 'risky'])
  })
})

describe('rankingSentence', () => {
  it('names the worst three with their reasons, and how many more need you', () => {
    const ranked = rankApps(
      [card({ name: 'a', openReports: 1 }), card({ name: 'b', openReports: 2, ciFailsToday: 1 }), card({ name: 'c', openReports: 9 }), card({ name: 'd', openReports: 3 })],
      NONE,
      NOW,
    )
    const out = rankingSentence(ranked)
    expect(out.sentence).toBe('Worst first: b (1 CI job failed today, 2 open bugs) · c (9 open bugs) · d (3 open bugs) · 1 more needs you.')
    expect(out.tone).toBe('danger')
    expect(out.first?.card.name).toBe('b')
    // The page draws these as chips; the sentence above is its screen-reader text.
    expect(out.top.map((r) => r.card.name)).toEqual(['b', 'c', 'd'])
    expect(out.more).toBe(1)
  })

  it('never says an app needs you when only chores are left', () => {
    const chores = rankApps([card({ name: 'a', sdk: [{ projectId: 'a', package: 'x', version: '1', latest: '2', status: 'behind', reason: '' }] }), card({ name: 'b' })], NONE, NOW)
    const out = rankingSentence(chores)
    expect(out.first).toBeNull()
    expect(out.top).toEqual([])
    expect(out.tone).toBe('ok')
    expect(out.sentence).toBe('No app needs you right now. 1 app has small chores, like an SDK update.')
  })
})

describe('appAlerts', () => {
  it('one card per worst app that needs you, the top reason named in the title and counted once in the number, one action into that app', () => {
    const ranked = rankApps(
      [card({ projectId: 'p-ci', name: 'ci-red', openReports: 2, ciFailsToday: 3 }), card({ projectId: 'p-bugs', name: 'buggy', openReports: 9 }), card({ projectId: 'p-one', name: 'one', openReports: 1 }), card({ projectId: 'p-more', name: 'more', openReports: 1 }), card({ projectId: 'p-ok', name: 'ok', worst: 'ok' })],
      NONE,
      NOW,
    )
    const opened: string[] = []
    const alerts = appAlerts(ranked, (id) => opened.push(id))
    expect(alerts.map((a) => a.id)).toEqual(['p-ci', 'p-bugs', 'p-more'])
    const [ci, bugs] = alerts
    expect(ci).toMatchObject({ severity: 'critical', label: 'CI red', app: 'ci-red', title: 'CI failing today', detail: '2 open bugs', metric: { value: '3', unit: 'jobs failed' }, keys: [appKey('p-ci')] })
    // The number is said once, by the metric; the title names the problem.
    for (const a of alerts) expect(a.title).not.toMatch(/\d/)
    expect(ci!.action!.label).toBe('Open CI')
    expect(ci!.action!.to).toContain('/ci')
    expect(ci!.action!.to).toContain('p-ci')
    expect(bugs).toMatchObject({ severity: 'serious', label: 'Bugs waiting', title: 'Open bug reports', detail: 'Nothing else open.', metric: { value: '9', unit: 'bugs' } })
    expect(bugs!.action!.to).toContain('/reports')
    bugs!.action!.onClick!()
    expect(opened).toEqual(['p-bugs'])
  })

  it('leaves out a detail every card carries word for word ("2 serious risks" on all three)', () => {
    const risky = (name: string, ci: number, bugs: number) => card({ projectId: name, name, ciFailsToday: ci, openReports: bugs, radar: { checkedAt: hoursAgo(3), status: 'pass', open: { error: 2, warn: 0, info: 0 }, unchecked: 0, errored: 0 } })
    const alerts = appAlerts(rankApps([risky('a', 4, 1), risky('b', 3, 5), risky('c', 2, 1)], NONE, NOW), () => {})
    expect(alerts).toHaveLength(3)
    for (const a of alerts) expect(String(a.detail)).not.toContain('2 serious risks')
    expect(alerts.find((a) => a.id === 'b')!.detail).toBe('5 open bugs')
    expect(alerts.find((a) => a.id === 'a')!.detail).toBe('1 open bug')
    // Everything else was shared: not "Nothing else open." (things are open), just no line.
    const twins = appAlerts(rankApps([risky('a', 4, 1), risky('c', 2, 1)], NONE, NOW), () => {})
    expect(twins.map((a) => a.detail)).toEqual(['', ''])
    // One card alone keeps its whole detail.
    expect(appAlerts(rankApps([risky('a', 4, 1)], NONE, NOW), () => {})[0]!.detail).toBe('2 serious risks · 1 open bug')
  })

  it('no alert when nothing needs you', () => {
    expect(appAlerts(rankApps([card({ name: 'ok', worst: 'ok' })], NONE, NOW), () => {})).toEqual([])
  })
})

describe('helpers', () => {
  it('shortAge fits a heat cell', () => {
    expect(shortAge(hoursAgo(0.2), NOW)).toBe('12m')
    expect(shortAge(hoursAgo(5), NOW)).toBe('5h')
    expect(shortAge(hoursAgo(24 * 9 + 2), NOW)).toBe('9d')
    expect(shortAge(null, NOW)).toBe('never')
  })

  it('lastCheckIns reads the SDK step of each setup project', () => {
    const p = (id: string, seen: string | null | undefined): SetupProject => ({
      project_id: id, project_name: id, project_slug: id, created_at: '', required_total: 0, required_complete: 0, total: 0, complete: 0, done: true, report_count: 0, fix_count: 0, merged_fix_count: 0,
      steps: seen === undefined ? [] : [{ id: 'sdk_installed', label: '', description: '', complete: true, required: true, cta_to: '', cta_label: '', diagnostic: { last_sdk_seen_at: seen, last_sdk_origin: null, last_sdk_user_agent: null, last_sdk_endpoint_host: null } }],
    })
    const m = lastCheckIns([p('a', hoursAgo(1)), p('b', null), p('c', undefined)])
    expect(m.get('a')).toBe(hoursAgo(1))
    expect(m.has('b') && m.get('b')).toBeNull()
    expect(m.get('c')).toBeNull()
    expect(m.has('z')).toBe(false)
  })
})
