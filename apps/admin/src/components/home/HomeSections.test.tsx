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

import { HealthStrip } from './HealthStrip'
import { NeedsYouCard } from './NeedsYouCard'
import { ReleaseCard } from './ReleaseCard'
import { SitemapCard } from './SitemapCard'
import { WeekCard } from './WeekCard'
import { ActivityCard } from './ActivityCard'
import { AccessCard } from './AccessCard'
import { AppCard } from './AppCard'
import { HowThisWorks } from './HowThisWorks'
import type { HealthSignal, HomeAccess, HomeApp, HomeRelease, HomeSection, HomeSitemap, NeedsYouItem, WeekRow } from '../../lib/projectHome'

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
    expect(byTestId('home-health-site')!.textContent).toContain('Problem')
    expect(byTestId('home-health-site')!.textContent).toContain('2 pages broken')
    expect(byTestId('home-health-errors')!.textContent).toContain('Good')
    expect(byTestId('home-health-sdk')!.textContent).toContain('Set up the SDK')
    expect(byTestId('home-health-ci')!.textContent).toContain('Unknown')
    expect(hrefs()).toEqual(expect.arrayContaining(['/inventory?tab=discovery', '/reports?days=1', '/connect', '/ci']))
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

  it('says nothing needs you, and warns when a check could not be read', async () => {
    await render(createElement(NeedsYouCard, { section: ok([]), partial: ['pipeline'] }))
    expect(byTestId('home-needs-you-clear')).toBeTruthy()
    expect(text()).toContain('may be missing an item')
  })
})

const release = (over: Partial<HomeRelease> = {}): HomeRelease => ({
  stations: [
    { id: 'fix', label: 'Fix ready', count: 5, stuck: 3 },
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
    expect(labels).toEqual(['Fix ready: 5, 3 stuck', 'CI: 1', 'In train: 2', 'Merged: 4', 'Deployed: 0'])
    expect(stations.textContent).toContain('3 stuck')
    expect(text()).toContain('Train #57 with 2 fixes is running CI')
    expect(text()).toContain('v1.103.0 seen live')
    expect(hrefs()).toContain(`/pipeline?project=${P}`)
  })

  it('shows bugs waiting as one bar by severity, each linking to its open list', async () => {
    await render(createElement(ReleaseCard, { section: ok(release()), projectId: P }))
    const waiting = byTestId('home-release-waiting')!
    expect(waiting.textContent).toContain('10 bugs waiting for a fix, any age')
    expect(waiting.querySelector('a[href="/reports?status=open&severity=critical"]')?.getAttribute('title')).toBe(
      'Critical reports waiting on a decision, any age',
    )
    expect(waiting.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Critical 1, High 2, Low 3, Not rated yet 4')
    expect(hrefs()).toEqual(expect.arrayContaining(['/reports?status=open&severity=critical', '/reports?status=open&severity=low', '/reports?status=open']))
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
    expect(rows[2].textContent).toContain('same')
    expect(hrefs()).toEqual(['/reports?days=7', '/fixes', '/reports?days=7&severity=critical'])
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
    expect(t).toContain('never used')
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

  it('falls back to the icon and says why there is no screenshot', async () => {
    await render(createElement(AppCard, { section: ok(app({ thumbnailState: { available: true, canRefresh: false, reason: 'Add a Firecrawl key in Settings to take a screenshot.', lastError: null, lastAttemptAt: null } })), projectId: P, canEdit: true, onRefreshed: () => {} }))
    expect(text()).toContain('Add a Firecrawl key')
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
