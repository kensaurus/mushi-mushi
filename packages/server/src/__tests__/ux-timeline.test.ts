/**
 * FILE: packages/server/src/__tests__/ux-timeline.test.ts
 * PURPOSE: The iteration timeline's pure rules (Plan 025 P1/P8, ADR 0072):
 *            - a page is one screen across scorecard and loop runs;
 *            - the pinned shot is what users have: a loop's kept version
 *              only once its PR merged, a scorecard's settled shot at its viewport;
 *            - the rail is the releases (plus Unreleased), else the UX runs;
 *            - reports and run costs land on the right point, and the month
 *              summary picks the biggest score moves;
 *            - a scorecard page is re-scored only when its text or look changed,
 *              and a reused score is capped again by today's facts.
 */
import { describe, expect, it } from 'vitest'
import {
  baselineCapturePath,
  buildTimeline,
  captureFor,
  pickBaselineCaptures,
  timelineSurfaceKey,
  validVersion,
  type CaptureSourceRow,
  type TimelineRunRow,
} from '../../supabase/functions/_shared/ux-timeline.ts'
import { reuseScore, runCostFromSurfaces, scoreCacheKey } from '../../supabase/functions/_shared/ux-score-cache.ts'
import { UX_DIMENSIONS, UX_SCORECARD_PROMPT_VERSION, type UxPageFacts, type UxPageScore } from '../../supabase/functions/_shared/ux-scorecard.ts'

const P = '11111111-1111-1111-1111-111111111111'

function src(over: Partial<CaptureSourceRow>): CaptureSourceRow {
  return {
    run_id: 'run-a',
    run_kind: 'loop',
    run_pr_merged: false,
    surface_key: 'root-42099b',
    kind: 'page',
    path: '/',
    label: 'Home',
    status: 'accepted',
    score: null,
    penalty_before: 9,
    penalty_after: 2,
    capture_hash: null,
    cost_usd: null,
    thumbs: { 'before-desktop': `${P}/run-a/root-42099b/before-desktop.png`, 'after-desktop': `${P}/run-a/root-42099b/after-desktop.png` },
    facts_viewport_width: null,
    ...over,
  }
}

describe('screen identity and captures', () => {
  it('keys a page by its path, so the scorecard and the loop agree; other states keep their key', () => {
    expect(timelineSurfaceKey({ kind: 'page', path: '/team?view=sso', surface_key: 'team-x1' })).toBe('team-view-sso')
    expect(timelineSurfaceKey({ kind: 'dialog', path: '/team', surface_key: 'team-invite-dialog' })).toBe('team-invite-dialog')
  })

  it('pins the original until the run’s PR merged, then the kept version', () => {
    expect(captureFor(src({}), 'desktop', P)).toBe(`${P}/run-a/root-42099b/before-desktop.png`)
    expect(captureFor(src({ run_pr_merged: true }), 'desktop', P)).toBe(`${P}/run-a/root-42099b/after-desktop.png`)
    expect(captureFor(src({ run_pr_merged: true, status: 'reverted' }), 'desktop', P)).toBe(`${P}/run-a/root-42099b/before-desktop.png`)
    expect(captureFor(src({}), 'mobile', P)).toBeNull()
  })

  it('pins a scorecard page’s settled shot at the viewport it was taken', () => {
    const row = src({ run_kind: 'scorecard', thumbs: { scorecard: ['home/early.png', 'home/settled.png'] }, facts_viewport_width: 1440 })
    expect(captureFor(row, 'desktop', P)).toBe(`${P}/run-a/scorecard/home/settled.png`)
    expect(captureFor(row, 'mobile', P)).toBeNull()
    expect(captureFor({ ...row, facts_viewport_width: 390 }, 'mobile', P)).toBe(`${P}/run-a/scorecard/home/settled.png`)
    expect(captureFor({ ...row, thumbs: { scorecard: ['../x/settled.png'] } }, 'desktop', P)).toBeNull()
  })

  it('takes each screen and viewport once, from the newest run, and only this project’s files', () => {
    const newest = src({ run_id: 'run-b', thumbs: { 'before-desktop': `${P}/run-b/root-42099b/before-desktop.png` } })
    const older = src({})
    const foreign = src({ surface_key: 'about', path: '/about', thumbs: { 'before-desktop': 'other-project/run/about/before-desktop.png' } })
    const picks = pickBaselineCaptures([newest, older, foreign], P)
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ surfaceKey: 'root', viewport: 'desktop', runId: 'run-b', penalty: 9, ext: 'png' })
  })

  it('names the copy under baselines/, per screen, viewport and version', () => {
    expect(baselineCapturePath(P, 'home', 'mobile', 'V1.4.0 beta', 'abcd1234-ef', 'png')).toBe(`${P}/baselines/home/mobile/v1.4.0-beta-abcd1234.png`)
    expect(validVersion('1.4.0')).toBe(true)
    expect(validVersion('build-812')).toBe(true)
    expect(validVersion('../etc')).toBe(false)
    expect(validVersion('')).toBe(false)
  })
})

function run(over: Partial<TimelineRunRow>): TimelineRunRow {
  return { id: 'r', local_run_id: '20261101-000000-aaaa', kind: 'scorecard', status: 'done', started_at: '2026-11-01T00:00:00Z', cost_usd: null, cost: null, mean_score: null, improved: 0, ...over }
}

describe('buildTimeline', () => {
  const now = new Date('2026-11-27T00:00:00Z')

  it('falls back to UX runs when the app has no releases, with reports fixed between runs', () => {
    const tl = buildTimeline({
      releases: [],
      runs: [
        run({ id: 'r2', started_at: '2026-11-20T00:00:00Z', cost_usd: '0.42', cost: { judged: 3, cached: 9 }, mean_score: 7.25 }),
        run({ id: 'r1', started_at: '2026-11-10T00:00:00Z', cost_usd: 1.1, mean_score: 5 }),
        run({ id: 'r0', started_at: '2026-11-26T00:00:00Z', status: 'running' }),
      ],
      reports: [{ id: 'b1', title: 'Save button does nothing', fixed_at: '2026-11-15T00:00:00Z' }],
      baselines: [],
      pageScores: [],
      now,
    })
    expect(tl.rail).toBe('runs')
    expect(tl.points.map((p) => p.id)).toEqual(['run:r1', 'run:r2'])
    expect(tl.points[1]).toMatchObject({ cost_usd: 0.42, judged: 3, cached: 9, score: 7.3, reports_closed: 1 })
    expect(tl.month).toMatchObject({ runs: 2, cost_usd: 1.52, reports_closed: 1, judged: 3, cached: 9 })
  })

  it('puts runs and reports on the release they shipped in, and later work on Unreleased', () => {
    const tl = buildTimeline({
      releases: [
        { id: 'v2', version: '1.1.0', title: 'Faster checkout', status: 'published', published_at: '2026-11-20T00:00:00Z', created_at: '2026-11-19T00:00:00Z', fixed_report_ids: ['b2'] },
        { id: 'v1', version: '1.0.0', title: null, status: 'published', published_at: null, created_at: '2026-11-05T00:00:00Z', fixed_report_ids: [] },
      ],
      runs: [run({ id: 'a', started_at: '2026-11-10T00:00:00Z', kind: 'loop', improved: 2, cost_usd: 0.5 }), run({ id: 'b', started_at: '2026-11-24T00:00:00Z' })],
      reports: [
        { id: 'b1', title: 'Old bug', fixed_at: '2026-11-03T00:00:00Z' },
        { id: 'b2', title: 'Checkout spinner', fixed_at: '2026-11-12T00:00:00Z' },
        { id: 'b3', title: 'Typo on pricing', fixed_at: '2026-11-25T00:00:00Z' },
      ],
      baselines: [
        { id: 'x1', surface_key: 'checkout', path: '/checkout', label: 'Checkout', viewport: 'desktop', version: '1.0.0', release_id: null, run_id: null, score: 5, penalty: null, cost_usd: null, pinned: false, created_at: '2026-11-05T00:00:00Z', capture_path: 'p/baselines/a.png' },
        { id: 'x2', surface_key: 'checkout', path: '/checkout', label: 'Checkout', viewport: 'desktop', version: '1.1.0', release_id: 'v2', run_id: null, score: 8, penalty: null, cost_usd: null, pinned: true, created_at: '2026-11-20T00:00:00Z', capture_path: 'p/baselines/b.png' },
      ],
      pageScores: [],
      now,
    })
    expect(tl.rail).toBe('releases')
    expect(tl.points.map((p) => [p.id, p.reports_closed, p.runs.length])).toEqual([
      ['release:v1', 1, 0],
      ['release:v2', 1, 1],
      ['unreleased', 1, 1],
    ])
    expect(tl.points[1]).toMatchObject({ improved_screens: 2, cost_usd: 0.5, baselines: 1, reports: [{ id: 'b2', title: 'Checkout spinner' }] })
    expect(tl.surfaces[0]).toMatchObject({ key: 'checkout', first_score: 5, latest_score: 8 })
    expect(tl.surfaces[0].frames.map((f) => f.point_id)).toEqual(['release:v1', 'release:v2'])
  })

  it('lists the month’s biggest score moves first', () => {
    const tl = buildTimeline({
      releases: [],
      runs: [],
      reports: [],
      baselines: [],
      pageScores: [
        { run_id: 'a', started_at: '2026-11-02T00:00:00Z', surface_key: 'home', label: 'Home', score: 4 },
        { run_id: 'b', started_at: '2026-11-20T00:00:00Z', surface_key: 'home', label: 'Home', score: 8 },
        { run_id: 'a', started_at: '2026-11-02T00:00:00Z', surface_key: 'team', label: 'Team', score: 6 },
        { run_id: 'b', started_at: '2026-11-20T00:00:00Z', surface_key: 'team', label: 'Team', score: 5 },
        { run_id: 'z', started_at: '2026-09-01T00:00:00Z', surface_key: 'old', label: 'Old', score: 1 },
      ],
      now,
    })
    expect(tl.month.movers).toEqual([
      { key: 'home', label: 'Home', from: 4, to: 8 },
      { key: 'team', label: 'Team', from: 6, to: 5 },
    ])
  })
})

const facts: UxPageFacts = {
  key: '/settings',
  path: '/settings',
  label: 'Settings',
  title: 'Settings',
  headings: ['Settings'],
  text: 'Checks: Not run yet',
  controls: ['Save'],
  settleMs: 900,
  axe: { critical: 0, serious: 0, rules: [] },
  overflowX: false,
  consoleErrors: 0,
  cls: 0,
  viewport: { width: 1440, height: 900 },
}

describe('scorecard verdict cache (P8)', () => {
  it('keys on text and look, not on settle time or layout shift; no shot hash means no cache', async () => {
    const k = await scoreCacheKey(facts, 'a1b2c3d4e5f60718')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(await scoreCacheKey({ ...facts, settleMs: 4000, cls: 0.3 }, 'a1b2c3d4e5f60718')).toBe(k)
    // A copy change the 64-bit image hash cannot see is a new key.
    expect(await scoreCacheKey({ ...facts, text: 'Checks: 7 of 7 passed' }, 'a1b2c3d4e5f60718')).not.toBe(k)
    expect(await scoreCacheKey(facts, 'ffffffffffffffff')).not.toBe(k)
    expect(await scoreCacheKey(facts, 'a1b2c3d4e5f60718', 'ux-scorecard-next')).not.toBe(k)
    expect(await scoreCacheKey(facts, undefined)).toBeNull()
    expect(await scoreCacheKey(facts, 'not-a-hash')).toBeNull()
  })

  it('re-applies today’s caps to the reused score', () => {
    const scores = Object.fromEntries(UX_DIMENSIONS.map((d) => [d, 9])) as UxPageScore['scores']
    const cached: UxPageScore = { key: '/settings', page: 'Settings', scores, why: {}, capped: {}, overall: 9, issues: [], claims: [], promptVersion: UX_SCORECARD_PROMPT_VERSION }
    const fast = reuseScore(cached, facts)
    expect(fast?.scores.performance).toBe(9)
    const slow = reuseScore(cached, { ...facts, settleMs: 9000 })
    expect(slow?.scores.performance).toBe(3)
    expect(slow?.capped.performance).toBe(9)
    expect(slow!.overall).toBeLessThan(fast!.overall)
    // A score capped last time recovers once the page is fast again.
    expect(reuseScore(slow, facts)?.scores.performance).toBe(9)
    expect(reuseScore({ ...cached, promptVersion: 'old' }, facts)).toBeNull()
  })

  it('totals a run: model calls priced, reused pages free, unpriced counted', () => {
    expect(
      runCostFromSurfaces([
        { cost_usd: '0.0123', judge_cached: false, score: 7 },
        { cost_usd: 0, judge_cached: true, score: 8 },
        { cost_usd: null, judge_cached: false, score: 6 },
        { cost_usd: null, judge_cached: false, score: null },
      ]),
    ).toEqual({ cost_usd: 0.0123, cost: { judged: 2, cached: 1, unpriced: 1 } })
  })
})
