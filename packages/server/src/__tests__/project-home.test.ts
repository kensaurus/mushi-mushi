/**
 * FILE: project-home.test.ts
 * PURPOSE: The per-app Home's decisions (_shared/project-home.ts): each
 *          health light, the release stations, "Needs you" ranking and
 *          counts (the same pipeline groups /pipeline shows), the sitemap
 *          tree and route normalising, week-over-week rows and grouped
 *          activity lines, platforms and the live URL, and when a thumbnail
 *          may be captured on view.
 */

import { describe, expect, it } from 'vitest'
import {
  buildActivity,
  buildNeedsYou,
  buildSitemap,
  buildStations,
  buildWeek,
  ciSignal,
  currentTrain,
  detectPlatforms,
  errorsSignal,
  keyKind,
  median,
  NEEDS_YOU_MAX,
  normalizeRoute,
  pickLiveUrl,
  sdkSignal,
  setupSignal,
  shouldAutoCapture,
  siteSignal,
  waitingBySeverity,
  type CiJobRow,
  type HealthSignal,
} from '../../supabase/functions/_shared/project-home.ts'
import type { PipelineStage } from '../../supabase/functions/_shared/pipeline-view.ts'

const NOW = new Date('2026-10-27T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const H = 3600_000
const SDK_HREF = '/connect?project=p#connect-sdk-health'

describe('siteSignal', () => {
  const watch = { base_url: 'https://glot.it', status: 'active', last_checked_at: ago(2 * H), last_error: null }

  it('is not connected without a watch, with how to connect', () => {
    const s = siteSignal({ watch: null, brokenPages: 0, medianLatencyMs: null, now: NOW })
    expect(s.status).toBe('not_connected')
    expect(s.light).toBe('off')
    expect(s.connect?.to).toBe('/credits')
  })

  it('is red with the broken page count, before any other state', () => {
    const s = siteSignal({ watch: { ...watch, last_error: 'boom' }, brokenPages: 3, medianLatencyMs: null, now: NOW })
    expect(s.light).toBe('bad')
    expect(s.headline).toBe('3 pages broken')
  })

  it('is amber when the last check failed or is over 3 days old', () => {
    expect(siteSignal({ watch: { ...watch, last_error: 'Firecrawl out of credits' }, brokenPages: 0, medianLatencyMs: null, now: NOW }).light).toBe('warn')
    expect(siteSignal({ watch: { ...watch, last_checked_at: ago(4 * 24 * H) }, brokenPages: 0, medianLatencyMs: null, now: NOW }).headline).toBe('Not checked lately')
  })

  it('reads slow over 3 s and green otherwise, naming the speed', () => {
    expect(siteSignal({ watch, brokenPages: 0, medianLatencyMs: 4200, now: NOW }).headline).toBe('Up, but slow')
    const ok = siteSignal({ watch, brokenPages: 0, medianLatencyMs: 820, now: NOW })
    expect(ok.light).toBe('good')
    expect(ok.detail).toContain('820 ms')
  })
})

describe('errorsSignal', () => {
  const base = { everConnected: true, latestAt: null, sdkHref: SDK_HREF }
  it('is not connected before the first report or check-in', () => {
    const s = errorsSignal({ ...base, today: 0, yesterday: 0, criticalToday: 0, everConnected: false })
    expect(s.status).toBe('not_connected')
    expect(s.connect?.to).toBe(SDK_HREF)
  })
  it('is red on any critical, linking to the critical list', () => {
    const s = errorsSignal({ ...base, today: 4, yesterday: 1, criticalToday: 1 })
    expect(s.light).toBe('bad')
    expect(s.href).toBe('/reports?days=1&severity=critical')
  })
  it('is amber when reports at least double (5 or more)', () => {
    expect(errorsSignal({ ...base, today: 6, yesterday: 2, criticalToday: 0 }).light).toBe('warn')
    expect(errorsSignal({ ...base, today: 4, yesterday: 1, criticalToday: 0 }).light).toBe('good')
  })
})

describe('sdkSignal', () => {
  it('walks from no key to never seen to sending, quiet and silent', () => {
    expect(sdkSignal({ sdkKeys: 0, lastSeenAt: null, now: NOW, sdkHref: SDK_HREF }).headline).toBe('No SDK key')
    expect(sdkSignal({ sdkKeys: 1, lastSeenAt: null, now: NOW, sdkHref: SDK_HREF }).status).toBe('not_connected')
    expect(sdkSignal({ sdkKeys: 1, lastSeenAt: ago(H), now: NOW, sdkHref: SDK_HREF }).light).toBe('good')
    expect(sdkSignal({ sdkKeys: 1, lastSeenAt: ago(3 * 24 * H), now: NOW, sdkHref: SDK_HREF }).headline).toBe('Quiet for 3 d')
    expect(sdkSignal({ sdkKeys: 1, lastSeenAt: ago(9 * 24 * H), now: NOW, sdkHref: SDK_HREF }).light).toBe('bad')
  })
})

describe('ciSignal', () => {
  const job = (over: Partial<CiJobRow>): CiJobRow => ({
    run_id: 2,
    run_attempt: 1,
    job_name: 'build',
    status: 'completed',
    conclusion: 'success',
    infra: false,
    gh_created_at: ago(H),
    completed_at: ago(H / 2),
    ...over,
  })

  it('needs a repo, then a run', () => {
    expect(ciSignal({ repo: null, branch: null, jobs: [] }).status).toBe('not_connected')
    expect(ciSignal({ repo: 'o/r', branch: 'main', jobs: [] }).headline).toBe('No runs seen')
  })

  it('reads only the newest run, latest attempt per job', () => {
    const s = ciSignal({
      repo: 'o/r',
      branch: 'main',
      jobs: [
        job({ run_id: 1, conclusion: 'failure' }), // older run: ignored
        job({ run_attempt: 1, conclusion: 'failure' }), // re-run passed
        job({ run_attempt: 2, conclusion: 'success' }),
        job({ job_name: 'test' }),
      ],
    })
    expect(s.light).toBe('good')
    expect(s.label).toBe('CI on main')
  })

  it('a code failure is red; a test machine stop is amber (ADR 0033)', () => {
    expect(ciSignal({ repo: 'o/r', branch: 'main', jobs: [job({ conclusion: 'failure' })] }).light).toBe('bad')
    const infra = ciSignal({ repo: 'o/r', branch: 'main', jobs: [job({ conclusion: 'failure', infra: true })] })
    expect(infra.light).toBe('warn')
    expect(infra.headline).toBe('Machine stopped')
  })

  it('is busy while a job runs', () => {
    expect(ciSignal({ repo: 'o/r', branch: 'main', jobs: [job({ status: 'in_progress', conclusion: null })] }).light).toBe('busy')
  })
})

const stage = (id: string, count: number, stuck: number, groups: PipelineStage['groups'] = []): PipelineStage =>
  ({ id, label: id, count, stuck, oldestAt: null, groups }) as PipelineStage
const group = (id: string, label: string, count: number, tone: 'stuck' | 'moving' | 'done' = 'stuck') =>
  ({ id, stage: 'review', tone, label, count, oldestAt: null, actions: [], settings: null, items: [] }) as PipelineStage['groups'][number]

describe('release', () => {
  it('adds pipeline stages into five stations in pipeline order', () => {
    const stations = buildStations([stage('reported', 9, 0), stage('pr', 2, 1), stage('review', 3, 2), stage('ci', 1, 0), stage('train', 4, 0), stage('merged', 5, 0), stage('deployed', 6, 0)])
    expect(stations.map((s) => [s.id, s.count, s.stuck])).toEqual([
      ['fix', 5, 3],
      ['ci', 1, 0],
      ['train', 4, 0],
      ['merged', 5, 0],
      ['deployed', 6, 0],
    ])
  })

  it('prefers the train on the tracks, else the latest', () => {
    const t = (state: string, createdAt: string) => ({ state, prNumber: 1, members: 3, createdAt, repo: 'o/r' })
    expect(currentTrain([t('merged', ago(H)), t('testing', ago(3 * H))])).toMatchObject({ state: 'testing', active: true })
    expect(currentTrain([t('merged', ago(3 * H)), t('failed', ago(H))])).toMatchObject({ state: 'failed', active: false })
    expect(currentTrain([])).toBeNull()
  })

  it('fills every severity and totals them', () => {
    expect(waitingBySeverity({ critical: 1, low: 2 })).toEqual({ counts: { critical: 1, high: 0, medium: 0, low: 2, unrated: 0 }, total: 3 })
  })
})

describe('buildNeedsYou', () => {
  const sig = (id: HealthSignal['id'], light: HealthSignal['light'], status: HealthSignal['status'] = 'ok'): HealthSignal => ({
    id,
    label: id,
    status,
    light,
    headline: id === 'site' ? '2 pages broken' : 'x',
    detail: null,
    at: null,
    href: `/${id}`,
    connect: null,
  })

  it('ranks by impact, caps at five, and keeps the pipeline group label and count', () => {
    const items = buildNeedsYou({
      projectId: 'p1',
      health: [sig('site', 'bad'), sig('ci', 'bad'), sig('sdk', 'good'), sig('errors', 'good')],
      criticalWaiting: 2,
      pipeline: [
        stage('review', 45, 45, [group('hold', '45 PRs: Opus says hold; a person decides', 45), group('fix_first_working', '3 PRs: moving', 3, 'moving')]),
        stage('pr', 7, 7, [group('agent_failed', '7 fixes: agent failed, no PR opened', 7)]),
        stage('train', 2, 2, [group('not_queued', '2 PRs: approved and green, not queued to merge', 2)]),
      ],
      sdk: { status: 'outdated', version: '1.30.0', latest: '1.33.0' },
    })
    expect(items).toHaveLength(NEEDS_YOU_MAX)
    expect(items.map((i) => i.id)).toEqual(['site_broken', 'critical_waiting', 'pipeline_hold', 'ci_red', 'pipeline_agent_failed'])
    const hold = items.find((i) => i.id === 'pipeline_hold')!
    expect(hold.text).toBe('45 PRs: Opus says hold; a person decides.')
    expect(hold.action.to).toBe('/pipeline?project=p1')
    expect(items.find((i) => i.id === 'critical_waiting')!.action.to).toBe('/reports?status=open&severity=critical')
  })

  it('never lists a moving group, and asks for the SDK when it is not connected', () => {
    const items = buildNeedsYou({
      projectId: 'p1',
      health: [sig('sdk', 'off', 'not_connected')],
      criticalWaiting: 0,
      pipeline: [stage('train', 3, 0, [group('in_train', '3 PRs: riding a release train', 3, 'moving')])],
      sdk: null,
    })
    expect(items.map((i) => i.id)).toEqual(['sdk_silent'])
  })

  it('ignores a signal whose read failed', () => {
    expect(buildNeedsYou({ projectId: 'p', health: [sig('site', 'bad', 'error')], criticalWaiting: null, pipeline: null, sdk: null })).toEqual([])
  })
})

describe('sitemap', () => {
  it('normalises URLs and routes to page paths with ids collapsed', () => {
    expect(normalizeRoute('https://glot.it/lessons/42?x=1#top')).toBe('/lessons/:id')
    expect(normalizeRoute('/u/0b6f3c8e-1d2a-4b3c-8d9e-0f1a2b3c4d5e/settings')).toBe('/u/:id/settings')
    expect(normalizeRoute('practice')).toBe('/practice')
    expect(normalizeRoute('')).toBeNull()
    expect(normalizeRoute('https://')).toBeNull()
  })

  it('builds a two-level tree of the busiest pages with bug and broken badges', () => {
    const map = buildSitemap({
      views: ['/', '/', '/lessons/1', '/lessons/2', '/lessons', '/settings', '/settings/profile'],
      viewsCapped: false,
      bugUrls: ['https://glot.it/lessons/7', 'https://glot.it/checkout'],
      brokenUrls: ['https://glot.it/pricing'],
    })
    expect(map.pages[0]).toMatchObject({ path: '/', label: 'Home', depth: 0, views: 2 })
    const lessons = map.pages.find((p) => p.path === '/lessons/:id')!
    expect(lessons).toMatchObject({ depth: 2, views: 2, bugs: 1 })
    expect(map.pages.find((p) => p.path === '/pricing')).toMatchObject({ depth: 1, broken: true })
    // Every child follows its section.
    const idx = (p: string) => map.pages.findIndex((x) => x.path === p)
    expect(idx('/lessons/:id')).toBeGreaterThan(idx('/lessons'))
    expect(map.totalPages).toBe(7)
  })

  it('is empty with no signal at all', () => {
    expect(buildSitemap({ views: [], viewsCapped: false, bugUrls: [], brokenUrls: [] }).pages).toEqual([])
  })
})

describe('week and activity', () => {
  it('hides visits when the session tracker has nothing', () => {
    expect(buildWeek({ reports: [3, 5], critical: [0, 1], merged: [2, 0], sessions: null }).map((r) => r.id)).toEqual(['reports', 'critical', 'merged'])
    const withVisits = buildWeek({ reports: [3, 5], critical: [0, 1], merged: [2, 0], sessions: [40, 30] })
    expect(withVisits.at(-1)).toMatchObject({ id: 'sessions', thisWeek: 40, lastWeek: 30, moreIsBetter: true })
  })

  it('says today when something happened today, else this week, and drops zeros', () => {
    const lines = buildActivity({ reportsToday: 0, reportsWeek: 12, mergedToday: 3, mergedWeek: 9, prsOpenedWeek: 1, deploysWeek: 2, lastDeploy: { at: ago(H), version: 'v1.4.0' } })
    expect(lines.map((l) => l.text)).toEqual(['3 fixes merged today', '1 fix PR opened this week', '12 bug reports came in this week', '2 deploys seen this week, latest v1.4.0'])
    expect(buildActivity({ reportsToday: 0, reportsWeek: 0, mergedToday: 0, mergedWeek: 0, prsOpenedWeek: 0, deploysWeek: 0, lastDeploy: null })).toEqual([])
  })
})

describe('app info', () => {
  it('detects platforms from the live URL, store icon and SDK agents', () => {
    expect(detectPlatforms({ liveUrl: null, iconSource: 'app_store', agents: ['okhttp/4.12'], origins: ['http://localhost:3000'] })).toEqual(['ios', 'android'])
    expect(detectPlatforms({ liveUrl: 'https://glot.it', iconSource: null, agents: [], origins: [] })).toEqual(['web'])
  })

  it('picks the watched site, then the audited one, then a public SDK origin', () => {
    expect(pickLiveUrl({ watch: 'https://a.app', audit: 'https://b.app', origins: [] })).toBe('https://a.app')
    expect(pickLiveUrl({ watch: null, audit: null, origins: ['http://localhost:5173', 'https://c.app'] })).toBe('https://c.app')
    expect(pickLiveUrl({ watch: null, audit: null, origins: ['http://c.app'] })).toBeNull()
  })

  it('captures on view only with the watch on, an own key, and a stale capture', () => {
    const base = { watchActive: true, ownKey: true, pageUrl: 'https://a.app', capturedAt: null, lastAttemptAt: null, now: NOW }
    expect(shouldAutoCapture(base)).toBe(true)
    expect(shouldAutoCapture({ ...base, ownKey: false })).toBe(false)
    expect(shouldAutoCapture({ ...base, watchActive: false })).toBe(false)
    expect(shouldAutoCapture({ ...base, capturedAt: ago(2 * 24 * H) })).toBe(false)
    expect(shouldAutoCapture({ ...base, capturedAt: ago(8 * 24 * H) })).toBe(true)
    expect(shouldAutoCapture({ ...base, lastAttemptAt: ago(H) })).toBe(false)
  })

  it('names key kinds and takes a median', () => {
    expect(keyKind(['report:write'])).toBe('sdk')
    expect(keyKind(['mcp:read', 'report:write'])).toBe('mcp')
    expect(keyKind([])).toBe('other')
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
  })
})

describe('setupSignal (fresh-eyes, ADR 0053)', () => {
  const run = { ttfv_seconds: 372, steps: 11, reached: 2, stalled_at: null, finished_at: '2026-10-27T21:00:00.000Z', counts: { sessions: 3 } }

  it('shows nothing for an app that never ran one', () => {
    expect(setupSignal({ run: null })).toBeNull()
  })

  it('reads minutes and steps, with the light by time', () => {
    const s = setupSignal({ run })!
    expect(s).toMatchObject({ id: 'setup', label: 'First-time setup', headline: '6 min, 11 steps', light: 'warn', href: '/first-user-test' })
    expect(s.detail).toBe('2 of 3 first-time visitors reached the goal in the last run.')
    expect(setupSignal({ run: { ...run, ttfv_seconds: 200 } })!.light).toBe('good')
    expect(setupSignal({ run: { ...run, ttfv_seconds: 1200 } })!.light).toBe('bad')
  })

  it('names the screen when nobody reached the goal', () => {
    const s = setupSignal({ run: { ...run, reached: 0, ttfv_seconds: null, stalled_at: { screen: '/admin/login', reason: 'signup_wall' } } })!
    expect(s).toMatchObject({ light: 'bad', headline: 'Stalls at /admin/login' })
  })
})
