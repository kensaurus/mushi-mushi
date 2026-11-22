/**
 * @vitest-environment jsdom
 */

/**
 * The per-app Home sections (components/home/*). Each one:
 *   - shows its numbers with a link to where they came from;
 *   - says "could not read" when its read failed and how to connect when it
 *     is not connected, never an empty box or an uncounted 0;
 *   - keeps the owner's actions to one button per line.
 */

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ fetch: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: api.fetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { HealthStrip, showHealthDetail } from './HealthStrip'
import { NeedsYouCard } from './NeedsYouCard'
import { ReleaseCard, releaseIsEmpty } from './ReleaseCard'
import { SitemapCard } from './SitemapCard'
import { WeekCard } from './WeekCard'
import { ActivityCard } from './ActivityCard'
import { AccessCard } from './AccessCard'
import { AppCard } from './AppCard'
import { HowThisWorks } from './HowThisWorks'
import type { FixFirstItem, HealthSignal, HomeAccess, HomeApp, HomeRelease, HomeSection, HomeSitemap, NeedsYouItem, WeekRow } from '../../lib/projectHome'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const P = '11111111-1111-4111-8111-111111111111'
const ok = <T,>(data: T): HomeSection<T> => ({ status: 'ok', data, connect: null, error: null })
const failed = <T,>(error: string): HomeSection<T> => ({ status: 'error', data: null, connect: null, error })
const notConnected = <T,>(label: string, to: string): HomeSection<T> => ({ status: 'not_connected', data: null, connect: { label, to }, error: null })

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.fetch.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(el: ReactElement) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el))
  })
}
const text = () => container.textContent ?? ''
const hrefs = () => Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)

const signal = (over: Partial<HealthSignal>): HealthSignal => ({
  id: 'site',
  label: 'Site up',
  status: 'ok',
  light: 'good',
  headline: 'Up',
  detail: null,
  at: null,
  href: '/inventory?tab=discovery',
  connect: null,
  ...over,
})

describe('HealthStrip', () => {
  it('shows each light with a word, its headline and a link to its source', async () => {
    await render(
      createElement(HealthStrip, {
        section: ok([
          signal({ id: 'site', light: 'bad', headline: '2 pages broken' }),
          signal({ id: 'errors', label: 'Errors today', light: 'good', headline: '3 new', href: '/reports?days=1' }),
          signal({ id: 'sdk', label: 'SDK sending', status: 'not_connected', light: 'off', headline: 'Never checked in', href: '/connect', connect: { label: 'Set up the SDK', to: '/connect' } }),
          signal({ id: 'ci', label: 'CI on main', status: 'error', light: 'off', headline: 'Could not read', href: '/ci' }),
        ]),
      }),
    )
    // The state is the value's mark (named for screen readers), not a second
    // word pill beside it (round-2 sweep 2026-11-18: "Good" + "Passing").
    expect(byTestId('home-health-site')!.querySelector('svg[aria-label="Problem"]')).toBeTruthy()
    expect(byTestId('home-health-site')!.textContent).toContain('2 pages broken')
    expect(byTestId('home-health-site')!.textContent).not.toContain('Problem')
    // An incoming bug is information, never a green "Good" (round-2 sweep).
    expect(byTestId('home-health-errors')!.querySelector('svg[data-tone="info"]')).toBeTruthy()
    expect(byTestId('home-health-errors')!.textContent).not.toContain('Good')
    // Plain words over the server's "Set up the SDK" (audit 2026-11-11).
    expect(byTestId('home-health-sdk')!.textContent).toContain('Add the report button')
    expect(byTestId('home-health-ci')!.querySelector('svg[aria-label="Unknown"]')).toBeTruthy()
    expect(hrefs()).toEqual(expect.arrayContaining(['/inventory?tab=discovery', '/reports?days=1', '/connect', '/ci']))
  })

  // Fresh-eyes sweep 2026-11-18: "Passing / 4 checks green on the latest commit" said one state twice.
  it('keeps the detail sentence only for a light that shows a problem, with a shape for every light', async () => {
    expect(showHealthDetail({ light: 'good', detail: '4 checks green on the latest commit.' })).toBe(false)
    expect(showHealthDetail({ light: 'off', detail: 'Mushi is not checking your live site yet.' })).toBe(false)
    expect(showHealthDetail({ light: 'bad', detail: '2 pages return 500.' })).toBe(true)
    await render(createElement(HealthStrip, { section: ok([signal({ id: 'ci', light: 'good', headline: 'Passing', detail: '4 checks green on the latest commit.' }), signal({ id: 'site', light: 'bad', headline: '2 pages broken', detail: '2 pages return 500.' })]) }))
    expect(byTestId('home-health-ci')!.textContent).not.toContain('4 checks green')
    expect(byTestId('home-health-ci')!.querySelector('a[title="4 checks green on the latest commit."]')).toBeTruthy()
    expect(byTestId('home-health-site')!.textContent).toContain('2 pages return 500.')
    expect(byTestId('home-health-site')!.querySelector('svg[data-tone="danger"]')).toBeTruthy()
    expect(byTestId('home-health-ci')!.querySelector('svg[data-tone="ok"]')).toBeTruthy()
  })

  it('says it could not read when the section failed', async () => {
    await render(createElement(HealthStrip, { section: failed<HealthSignal[]>('timeout') }))
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Could not read the app's health")
  })
})

const need = (id: string, impact: number): NeedsYouItem => ({ id, impact, text: `Thing ${id}.`, action: { label: 'Open', to: `/${id}` } })

describe('NeedsYouCard', () => {
  it('puts leading items first and stops at five, one button each', async () => {
    await render(createElement(NeedsYouCard, { section: ok(['a', 'b', 'c', 'd', 'e'].map((id, i) => need(id, 90 - i))), leading: [need('setup', 200)] }))
    const rows = byTestId('home-needs-you')!.querySelectorAll('li')
    expect(rows).toHaveLength(5)
    expect(rows[0].textContent).toContain('Thing setup.')
    expect(rows[0].querySelectorAll('a')).toHaveLength(1)
    expect(text()).not.toContain('Thing e.')
  })

  it('carries a stuck local worker with the way to the Workers tab (ADR 0048 amendment 2026-10-28)', async () => {
    const worker: NeedsYouItem = { id: 'worker_run_stuck:c1', impact: 85, text: 'Local worker: glot: a run has held an agent space for 4 h.', action: { label: 'Open Workers', to: '/pipeline?tab=workers&project=p1' } }
    await render(createElement(NeedsYouCard, { section: ok([worker, need('a', 80)]) }))
    const row = byTestId('home-needs-you-worker_run_stuck:c1')!
    expect(row.textContent).toContain('Local worker: glot: a run has held an agent space for 4 h.')
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/pipeline?tab=workers&project=p1')
  })

  // Owner's walkthrough, 2026-11-17: the setup checklist's "do this next" and
  // this card's first button were two primary next steps.
  it('has no primary button while the setup step above is the next step', async () => {
    await render(createElement(NeedsYouCard, { section: ok([need('a', 90), need('b', 80)]) }))
    const primaryBefore = byTestId('home-needs-you')!.querySelectorAll('a')[0]!.className
    await render(createElement(NeedsYouCard, { section: ok([need('a', 90), need('b', 80)]), primaryElsewhere: true }))
    const links = Array.from(byTestId('home-needs-you')!.querySelectorAll('a'))
    expect(links.every((a) => a.className === links[1]!.className)).toBe(true)
    expect(links[0]!.className).not.toBe(primaryBefore)
    expect(byTestId('home-needs-you-after-setup')).toBeTruthy()
  })

  it('says nothing needs you, and warns when a check could not be read', async () => {
    await render(createElement(NeedsYouCard, { section: ok([]), partial: ['pipeline'] }))
    expect(byTestId('home-needs-you-clear')).toBeTruthy()
    expect(text()).toContain('may be missing an item')
  })

  it('shows Fix these first above the list: each root cause once, how many wait on it, and its one fix (plan-simplicity Phase 1)', async () => {
    const cause = (id: string, over: Partial<FixFirstItem> = {}): FixFirstItem => ({
      id,
      key: id,
      part: 'ai_keys',
      severity: 'critical',
      title: `Cause ${id}`,
      detail: `Detail ${id}.`,
      affects: null,
      fix: { kind: 'one_click', label: `Fix ${id}`, to: `/fix/${id}` },
      ...over,
    })
    const causes = [
      cause('review_followup_key', { affects: 24 }),
      cause('autofix_agent_key', { affects: 1 }),
      cause('deploy_events', { fix: { kind: 'guided', label: 'How to fix', steps: ['Connect GitHub deployments.'] } }),
      cause('extra'),
    ]
    await render(createElement(NeedsYouCard, { section: ok([]), fixFirst: ok(causes) }))
    const block = byTestId('home-fix-first')!
    expect(block.textContent).toContain('Fix these first')
    expect(block.querySelectorAll('[data-testid^="home-fix-first-"]')).toHaveLength(3)
    expect(byTestId('home-fix-first-review_followup_key')!.textContent).toContain('24 items are waiting on this.')
    expect(byTestId('home-fix-first-autofix_agent_key')!.textContent).toContain('1 item is waiting on this.')
    expect(byTestId('home-fix-first-review_followup_key')!.querySelector('a')!.getAttribute('href')).toBe('/fix/review_followup_key')
    expect(byTestId('home-fix-first-deploy_events')!.textContent).toContain('Connect GitHub deployments.')
    expect(text()).not.toContain('Cause extra')
    // The list below no longer claims nothing needs you.
    expect(byTestId('home-needs-you-clear')!.textContent).toBe('Nothing else needs you right now.')
  })

  it('lets the field guide say all clear only for a watched app with every read answered', async () => {
    await render(createElement(NeedsYouCard, { section: ok([]), hasReports: true }))
    expect(byTestId('home-needs-you-clear')!.querySelector('[data-mascot-pose="allclear"]')).toBeTruthy()
    expect(text()).toContain("I'll list it here the moment something does.")
    // A new app with no reports is unchecked, not clear.
    await render(createElement(NeedsYouCard, { section: ok([]) }))
    expect(byTestId('home-needs-you-clear')!.querySelector('[data-mascot-pose]')).toBeNull()
    // A read that failed may hide an item, so no all-clear either.
    await render(createElement(NeedsYouCard, { section: ok([]), partial: ['pipeline'], hasReports: true }))
    expect(byTestId('home-needs-you-clear')!.querySelector('[data-mascot-pose]')).toBeNull()
  })

  it('shows no Fix these first block without root causes (or from an older server)', async () => {
    await render(createElement(NeedsYouCard, { section: ok([need('a', 80)]) }))
    expect(byTestId('home-fix-first')).toBeNull()
    await render(createElement(NeedsYouCard, { section: ok([]), fixFirst: ok([]) }))
    expect(byTestId('home-fix-first')).toBeNull()
  })
})

const release = (over: Partial<HomeRelease> = {}): HomeRelease => ({
  stations: [
    { id: 'fix', label: 'Fix PRs', count: 5, stuck: 3 },
    { id: 'ci', label: 'CI', count: 1, stuck: 0 },
    { id: 'train', label: 'In train', count: 2, stuck: 0 },
    { id: 'merged', label: 'Merged', count: 4, stuck: 0 },
    { id: 'deployed', label: 'Deployed', count: 0, stuck: 0 },
  ],
  train: { state: 'testing', prNumber: 57, members: 2, createdAt: '2026-10-27T10:00:00Z', repo: 'o/r', active: true },
  lastDeploy: { at: '2026-10-27T09:00:00Z', version: 'v1.103.0', ok: true },
  waiting: { counts: { critical: 1, high: 2, medium: 0, low: 3, unrated: 4 }, total: 10 },
  waitingError: null,
  ...over,
})

describe('ReleaseCard', () => {
  it('draws the stations with counts and stuck badges, the train and the last deploy', async () => {
    await render(createElement(ReleaseCard, { section: ok(release()), projectId: P }))
    const stations = byTestId('home-release-stations')!
    const labels = Array.from(stations.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'))
    expect(labels).toEqual(['Fix PRs: 5, 3 need you', 'CI: 1', 'In train: 2', 'Merged: 4', 'Deployed: 0'])
    expect(stations.textContent).toContain('3 need you')
    expect(text()).toContain('Train #57 with 2 fixes is running CI')
    expect(text()).toContain('v1.103.0 seen live')
    expect(hrefs()).toContain(`/pipeline?project=${P}`)
  })

  it('shows bugs waiting as one bar by severity, each linking to its open list', async () => {
    await render(createElement(ReleaseCard, { section: ok(release()), projectId: P }))
    const waiting = byTestId('home-release-waiting')!
    expect(waiting.textContent).toContain('10 bugs waiting for a fix')
    expect(waiting.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Critical 1, High 2, Low 3, Not rated yet 4')
    // The legend names only severities with bugs: no "Medium 0" chip (round-2 sweep 2026-11-18).
    expect(waiting.querySelector('ul')!.textContent).not.toContain('Medium')
    expect(hrefs()).toEqual(expect.arrayContaining(['/reports?status=open&severity=critical', '/reports?status=open&severity=low', '/reports?status=open']))
  })

  // Fresh-eyes sweep 2026-11-18: five "0" chips said one fact five times.
  it('collapses an untouched release to one "No fix PRs yet" line', async () => {
    const zero = release({ stations: release().stations.map((s) => ({ ...s, count: 0, stuck: 0 })), train: null })
    expect(releaseIsEmpty(zero)).toBe(true)
    expect(releaseIsEmpty(release())).toBe(false)
    await render(createElement(ReleaseCard, { section: ok(zero), projectId: P }))
    expect(byTestId('home-release-stations')).toBeNull()
    expect(byTestId('home-release-empty')!.textContent).toBe('No fix PRs yet')
    expect(byTestId('home-release-waiting')).toBeTruthy()
  })

  it('says how to connect, or that it could not read', async () => {
    await render(createElement(ReleaseCard, { section: notConnected<HomeRelease>('Connect GitHub', '/connect'), projectId: P }))
    expect(text()).toContain('Connect your GitHub repo')
    expect(hrefs()).toContain('/connect')
    await render(createElement(ReleaseCard, { section: failed<HomeRelease>('fix_attempts: timeout'), projectId: P }))
    expect(text()).toContain('Could not read the release')
    expect(text()).toContain('fix_attempts: timeout')
  })
})

describe('SitemapCard', () => {
  const map: HomeSitemap = {
    pages: [
      { path: '/', label: 'Home', depth: 0, views: 40, bugs: 0, broken: false },
      { path: '/lessons', label: 'lessons', depth: 1, views: 12, bugs: 0, broken: false },
      { path: '/lessons/:id', label: ':id', depth: 2, views: 30, bugs: 3, broken: false },
      { path: '/pricing', label: 'pricing', depth: 1, views: 0, bugs: 0, broken: true },
    ],
    totalPages: 9,
    sampled: true,
  }

  it('indents the tree and badges visits, bugs and broken pages', async () => {
    await render(createElement(SitemapCard, { section: ok(map) }))
    const rows = byTestId('home-sitemap')!.querySelectorAll('li')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Home (/)')
    expect(rows[2].className).toContain('pl-8')
    expect(rows[2].textContent).toContain('30 visits')
    expect(rows[2].textContent).toContain('3 bugs')
    expect(rows[3].textContent).toContain('Broken')
    expect(text()).toContain('4 of 9 pages')
    expect(text()).toContain('latest 5,000 visits')
  })

  it('says what fills the map when nothing has', async () => {
    await render(createElement(SitemapCard, { section: notConnected<HomeSitemap>('Install the SDK', '/connect') }))
    expect(text()).toContain('No page visits, bug reports or site checks yet')
    // One plain line, not a dashed box inside the card (sweep 2026-11-18).
    expect(container.querySelector('[class*="border-dashed"]')).toBeNull()
  })
})

describe('WeekCard', () => {
  it('shows this week, last week and a change coloured by whether more is good', async () => {
    await render(
      createElement(WeekCard, {
        section: ok<WeekRow[]>([
          { id: 'reports', label: 'Bug reports', thisWeek: 8, lastWeek: 5, moreIsBetter: false, href: '/reports?days=7' },
          { id: 'merged', label: 'Fixes merged', thisWeek: 1, lastWeek: 3, moreIsBetter: true, href: '/fixes' },
          { id: 'critical', label: 'Critical bugs', thisWeek: 0, lastWeek: 0, moreIsBetter: false, href: '/reports?days=7&severity=critical' },
        ]),
      }),
    )
    const rows = byTestId('home-week')!.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('+3')
    expect(rows[0].querySelector('span')!.className).toContain('warn')
    expect(rows[1].textContent).toContain('−2')
    expect(rows[1].querySelector('span')!.className).toContain('warn')
    // A row that was 0 both weeks folds to one line (round-2 sweep 2026-11-18).
    expect(rows).toHaveLength(2)
    expect(byTestId('home-week-quiet')!.textContent).toBe('None either week: critical bugs')
    expect(text()).not.toContain('same')
    expect(hrefs()).toEqual(['/reports?days=7', '/fixes', '/reports?days=7&severity=critical'])
  })
})

describe('WeekCard sparkline', () => {
  it("draws each row's 14 days, last week grey and this week dark, with the days in its label", async () => {
    const daily = [0, 1, 0, 2, 0, 0, 1, 3, 0, 1, 0, 2, 4, 1]
    await render(
      createElement(WeekCard, {
        section: ok<WeekRow[]>([
          { id: 'reports', label: 'Bug reports', thisWeek: 11, lastWeek: 4, moreIsBetter: false, href: '/reports?days=7', daily },
          { id: 'merged', label: 'Fixes merged', thisWeek: 1, lastWeek: 3, moreIsBetter: true, href: '/fixes' },
        ]),
      }),
    )
    const spark = byTestId('home-week-spark-Bug reports')!
    expect(spark.getAttribute('role')).toBe('img')
    expect(spark.getAttribute('aria-label')).toBe('Bug reports per day, last week: 0, 1, 0, 2, 0, 0, 1; this week: 3, 0, 1, 0, 2, 4, 1')
    const bars = spark.querySelectorAll('rect')
    expect(bars).toHaveLength(14)
    expect([...bars].filter((b) => b.getAttribute('data-week') === 'this')).toHaveLength(7)
    // The tallest day fills the height; an empty day is a 1 px tick, not a gap.
    expect(bars[12]!.getAttribute('height')).toBe('16')
    expect(bars[0]!.getAttribute('height')).toBe('1')
    // A row without a series (an older server) draws nothing.
    expect(byTestId('home-week-spark-Fixes merged')).toBeNull()
  })
})

describe('ActivityCard', () => {
  it('lists grouped sentences with links, or says the week was quiet', async () => {
    await render(createElement(ActivityCard, { section: ok([{ id: 'm', text: '3 fixes merged today', to: '/fixes' }]) }))
    expect(byTestId('home-activity')!.textContent).toBe('3 fixes merged today')
    expect(hrefs()).toEqual(['/fixes'])
    await render(createElement(ActivityCard, { section: ok([]) }))
    expect(text()).toContain('A quiet week')
  })
})

const access = (over: Partial<HomeAccess> = {}): HomeAccess => ({
  projectId: P,
  createdAt: '2026-01-01T00:00:00Z',
  repo: { url: 'https://github.com/kensaurus/glot.it', branch: 'main' },
  members: { total: 3, people: [{ name: 'Kenji Sato', avatarUrl: null, role: 'owner' }, { name: 'Ana', avatarUrl: 'https://avatars.githubusercontent.com/u/2', role: 'member' }] },
  sdk: { package: '@mushi-mushi/web', version: '1.30.0', latest: '1.33.0', status: 'outdated' },
  keys: [{ label: 'Web SDK', kind: 'sdk', lastUsedAt: null, createdAt: '2026-01-02T00:00:00Z' }],
  keysTotal: 3,
  keysReadable: true,
  ...over,
})

describe('AccessCard', () => {
  it('shows the repo, people, SDK against latest and keys by label', async () => {
    await render(createElement(AccessCard, { section: ok(access()), auditLog: false }))
    const t = byTestId('home-access')!.textContent ?? ''
    expect(t).toContain('kensaurus/glot.it')
    expect(t).toContain('3 people')
    expect(t).toContain('KS')
    expect(t).toContain('@mushi-mushi/web 1.30.0')
    expect(t).toContain('latest 1.33.0')
    expect(t).toContain('Update available')
    expect(t).toContain('Web SDK')
    expect(byTestId('home-keys-unused')!.textContent).toBe('1 never used: Web SDK')
    expect(t).toContain('All 3 keys')
    expect(hrefs()).not.toContain('/team?view=audit')
  })

  it('links the audit log only on a plan that has it', async () => {
    await render(createElement(AccessCard, { section: ok(access()), auditLog: true }))
    expect(hrefs()).toContain('/team?view=audit')
  })
})

const app = (over: Partial<HomeApp> = {}): HomeApp => ({
  name: 'glot.it',
  slug: 'glot-it',
  iconUrl: null,
  liveUrl: 'https://glot.it',
  platforms: ['web', 'ios'],
  version: { value: 'v1.103.0', at: '2026-10-27T09:00:00Z' },
  sdkOrigin: 'https://glot.it',
  repoUrl: null,
  thumbnail: null,
  thumbnailState: { available: true, canRefresh: true, reason: null, lastError: null, lastAttemptAt: null },
  ...over,
})

describe('AppCard', () => {
  it('shows the screenshot, name, live address, platforms and version', async () => {
    await render(createElement(AppCard, { section: ok(app({ thumbnail: { url: 'https://x.supabase.co/sign/a.png', capturedAt: '2026-10-27T08:00:00Z', pageUrl: 'https://glot.it' } })), projectId: P, canEdit: true, onRefreshed: () => {} }))
    const card = byTestId('home-app-card')!
    expect(card.querySelector('img')!.getAttribute('src')).toBe('https://x.supabase.co/sign/a.png')
    expect(card.textContent).toContain('glot.it')
    expect(card.textContent).toContain('Web')
    expect(card.textContent).toContain('iOS')
    expect(card.textContent).toContain('v1.103.0')
    expect(hrefs()).toContain('https://glot.it')
  })

  it('names a site under a path by its path, not just the domain', async () => {
    await render(createElement(AppCard, { section: ok(app({ name: 'mushi-mushi', liveUrl: 'https://kensaur.us/mushi-mushi/' })), projectId: P, canEdit: false, onRefreshed: () => {} }))
    expect(byTestId('home-app-card')!.textContent).toContain('kensaur.us/mushi-mushi')
  })

  it('falls back to the icon and says why there is no screenshot', async () => {
    await render(createElement(AppCard, { section: ok(app({ thumbnailState: { available: true, canRefresh: false, reason: 'Add a Firecrawl key in Settings to take a screenshot.', lastError: null, lastAttemptAt: null } })), projectId: P, canEdit: true, onRefreshed: () => {} }))
    expect(text()).toContain('Add a Firecrawl key')
    // No picture: one icon row at every width, no 16:9 grey box (round-2 sweep 2026-11-18).
    const picture = byTestId('home-app-picture')!
    expect(picture.className).not.toContain('aspect-video')
    expect(picture.className).not.toContain('bg-surface-overlay')
    // "No deploy seen yet" lives on the Release card only.
    await render(createElement(AppCard, { section: ok(app({ version: null })), projectId: P, canEdit: false, onRefreshed: () => {} }))
    expect(text()).not.toContain('No deploy seen yet')
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Refresh picture'))).toBe(false)
  })

  it('Refresh takes a new screenshot and reloads Home; viewers do not see it', async () => {
    const refreshed = vi.fn()
    api.fetch.mockResolvedValue({ ok: true, data: { url: 'https://x.supabase.co/sign/b.png' } })
    await render(createElement(AppCard, { section: ok(app()), projectId: P, canEdit: true, onRefreshed: refreshed }))
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh picture'))!
    await act(async () => {
      btn.click()
    })
    expect(api.fetch).toHaveBeenCalledWith(`/v1/admin/projects/${P}/home/thumbnail`, { method: 'POST' })
    expect(refreshed).toHaveBeenCalled()
    await render(createElement(AppCard, { section: ok(app()), projectId: P, canEdit: false, onRefreshed: refreshed }))
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Refresh picture'))).toBe(false)
  })

  it('says why a refresh failed', async () => {
    api.fetch.mockResolvedValue({ ok: false, error: { message: 'A screenshot was taken in the last 10 minutes.' } })
    await render(createElement(AppCard, { section: ok(app()), projectId: P, canEdit: true, onRefreshed: () => {} }))
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Refresh picture'))!
    await act(async () => {
      btn.click()
    })
    expect(toast.error).toHaveBeenCalledWith('No new screenshot', 'A screenshot was taken in the last 10 minutes.')
  })
})

describe('HowThisWorks', () => {
  it('opens by default only when asked (a new app with no reports)', async () => {
    await render(createElement(HowThisWorks, { defaultOpen: true }))
    expect(text()).toContain('Mushi explains it')
    expect(text()).not.toMatch(/PDCA/)
    await render(createElement(HowThisWorks, { defaultOpen: false, key: 'closed' }))
    expect(byTestId('home-how-this-works')!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
  })
})
