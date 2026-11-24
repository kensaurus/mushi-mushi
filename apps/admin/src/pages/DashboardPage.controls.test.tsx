/**
 * @vitest-environment jsdom
 */

/**
 * How much Home asks of a builder (ADR 0069, "Done is measured"): a fresh
 * account's Home showed 323 words, 45 controls and 5 view tabs over 8
 * mostly empty cards (fresh-account walk, 2026-11-24). Home is one list of
 * next actions now: no view tabs, fewer than 20 controls on a fresh app, and
 * cards with nothing to show stay hidden.
 *
 * Two apps: a brand-new one (report button not installed, no reports) and an
 * established one shaped like the owner's lets-talk app (hand-built fixture:
 * every light green, two things need the owner, a week of traffic).
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-11-24T09:00:00Z'
const HOURS_AGO = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString()
const section = <T,>(data: T) => ({ status: 'ok' as const, data, connect: null, error: null })
const notConnected = (label: string, to: string) => ({ status: 'not_connected' as const, data: null, connect: { label, to }, error: null })
const sdkHref = `/connect?project=${PROJECT}#connect-sdk-health`

function setupFor(done: boolean, reportCount: number) {
  const steps = [
    { id: 'project_created', label: 'Create your first project', description: '', complete: true, required: true, cta_to: '/projects', cta_label: 'Manage projects' },
    { id: 'api_key_generated', label: 'Generate an API key', description: '', complete: true, required: true, cta_to: '/projects', cta_label: 'Generate key' },
    {
      id: 'sdk_installed',
      label: 'Install the SDK in your app',
      description: 'Drop the Mushi widget into your app so users can submit reports.',
      complete: done,
      required: true,
      cta_to: '/onboarding?tab=sdk',
      cta_label: 'Install SDK',
      diagnostic: { last_sdk_seen_at: done ? HOURS_AGO(2) : null, last_sdk_origin: null, last_sdk_user_agent: null, last_sdk_endpoint_host: null },
    },
    { id: 'first_report_received', label: 'Receive your first bug report', description: '', complete: done, required: true, cta_to: '/reports', cta_label: 'Send test report' },
  ]
  const complete = steps.filter((s) => s.complete).length
  const project = {
    project_id: PROJECT,
    project_name: done ? 'lets-talk' : 'my-new-app',
    project_slug: done ? 'lets-talk' : 'my-new-app',
    created_at: '2026-10-01T00:00:00Z',
    steps,
    required_total: 4,
    required_complete: complete,
    total: 4,
    complete,
    done,
    report_count: reportCount,
    fix_count: done ? 12 : 0,
    merged_fix_count: done ? 9 : 0,
  }
  return {
    data: { admin_endpoint_host: 'x.supabase.co', has_any_project: true, projects: [project] },
    loading: false,
    error: null,
    resolved: true,
    hasAnyProject: true,
    reload: vi.fn(),
    activeProject: project,
    selectors: { required_total: 4, required_complete: complete, total: 4, complete, done },
    isStepIncomplete: (id: string) => !steps.find((s) => s.id === id)?.complete,
    getStep: (id: string) => steps.find((s) => s.id === id) ?? null,
  }
}

const app = (name: string, liveUrl: string | null) =>
  section({
    name,
    slug: name,
    iconUrl: null,
    liveUrl,
    platforms: liveUrl ? ['web'] : [],
    version: liveUrl ? { value: '2.14.0', at: HOURS_AGO(20) } : null,
    sdkOrigin: null,
    repoUrl: liveUrl ? 'https://github.com/acme/lets-talk' : null,
    thumbnail: null,
    thumbnailState: { available: true, canRefresh: false, reason: 'Add your live site address to take a screenshot.', lastError: null, lastAttemptAt: null },
  })

/** A brand-new app: the server's real not-connected hints (functions/_shared/project-home.ts). */
const FRESH_HOME = {
  generatedAt: NOW,
  projectId: PROJECT,
  app: app('my-new-app', null),
  health: section([
    { id: 'site', label: 'Site up', status: 'not_connected', light: 'off', headline: 'Not watched', detail: 'Mushi is not checking your live site yet.', at: null, href: '/inventory?tab=discovery', connect: { label: 'Turn on the live-site watch', to: '/inventory?tab=discovery#site-watch' } },
    { id: 'errors', label: 'Errors today', status: 'not_connected', light: 'off', headline: 'No reports yet', detail: 'Install the SDK so your users can report bugs.', at: null, href: '/reports?days=1', connect: { label: 'Install the SDK', to: sdkHref } },
    { id: 'sdk', label: 'SDK sending', status: 'not_connected', light: 'off', headline: 'Never checked in', detail: 'Your app has not called Mushi with its SDK key yet.', at: null, href: sdkHref, connect: { label: 'Set up the SDK', to: sdkHref } },
    { id: 'ci', label: 'CI on main', status: 'not_connected', light: 'off', headline: 'No repo', detail: 'Connect your GitHub repo to see CI.', at: null, href: '/ci', connect: { label: 'Connect GitHub', to: '/connect' } },
  ]),
  fixFirst: section([]),
  needsYou: section([{ id: 'sdk_silent', impact: 65, text: 'Your app is not sending to Mushi yet, so users cannot report bugs.', action: { label: 'Set up the SDK', to: sdkHref } }]),
  release: notConnected('Connect GitHub', '/connect'),
  sitemap: notConnected('Install the SDK', sdkHref),
  week: section([
    { id: 'reports', label: 'Bug reports', thisWeek: 0, lastWeek: 0, moreIsBetter: false, href: '/reports?days=7', daily: Array(14).fill(0) },
    { id: 'critical', label: 'Critical bugs', thisWeek: 0, lastWeek: 0, moreIsBetter: false, href: '/reports?severity=critical', daily: Array(14).fill(0) },
    { id: 'merged', label: 'Fixes merged', thisWeek: 0, lastWeek: 0, moreIsBetter: true, href: '/fixes', daily: Array(14).fill(0) },
  ]),
  activity: section([]),
  access: section({
    projectId: PROJECT,
    createdAt: HOURS_AGO(1),
    repo: null,
    members: { total: 1, people: [{ name: 'Sam Builder', avatarUrl: null, role: 'owner' }] },
    sdk: { package: null, version: null, latest: '1.37.2', status: 'unknown' },
    keys: [{ label: 'default', kind: 'sdk', lastUsedAt: null, createdAt: HOURS_AGO(1) }],
    keysTotal: 1,
    keysReadable: true,
  }),
  partial: [],
}

/** An established app shaped like lets-talk: green lights, two things need the owner, a week of traffic. */
const ESTABLISHED_HOME = {
  generatedAt: NOW,
  projectId: PROJECT,
  app: app('lets-talk', 'https://lets-talk.example.com'),
  health: section([
    { id: 'site', label: 'Site up', status: 'ok', light: 'good', headline: 'Up', detail: 'Pages answer in about 320 ms.', at: HOURS_AGO(1), href: '/inventory?tab=discovery', connect: null },
    { id: 'errors', label: 'Errors today', status: 'ok', light: 'good', headline: '2 new', detail: '2 bug reports today.', at: HOURS_AGO(3), href: '/reports?days=1', connect: null },
    { id: 'sdk', label: 'SDK sending', status: 'ok', light: 'good', headline: 'Sending', detail: 'Your app checked in today.', at: HOURS_AGO(1), href: sdkHref, connect: null },
    { id: 'ci', label: 'CI on main', status: 'ok', light: 'good', headline: 'Passing', detail: '6 checks green on the latest commit.', at: HOURS_AGO(5), href: '/ci', connect: null },
  ]),
  fixFirst: section([]),
  needsYou: section([
    { id: 'critical_waiting', impact: 90, text: '1 critical bug is waiting for a fix.', action: { label: 'Open', to: '/reports?status=open&severity=critical' } },
    { id: 'sdk_upgrade', impact: 30, text: 'Update the Mushi SDK from 1.35.0 to 1.37.2.', action: { label: 'Update', to: '/connect' } },
  ]),
  release: section({
    stations: [
      { id: 'fix', label: 'Fix PRs', count: 2, stuck: 0 },
      { id: 'ci', label: 'CI', count: 1, stuck: 0 },
      { id: 'train', label: 'In train', count: 0, stuck: 0 },
      { id: 'merged', label: 'Merged', count: 3, stuck: 0 },
      { id: 'deployed', label: 'Deployed', count: 3, stuck: 0 },
    ],
    train: null,
    lastDeploy: { at: HOURS_AGO(20), version: '2.14.0', ok: true },
    waiting: { counts: { critical: 1, high: 2, medium: 3, low: 1, unrated: 0 }, total: 7 },
    waitingError: null,
  }),
  sitemap: section({
    pages: [
      { path: '/', label: 'Home', depth: 0, views: 410, bugs: 1, broken: false },
      { path: '/rooms', label: 'Rooms', depth: 1, views: 220, bugs: 2, broken: false },
      { path: '/rooms/:id', label: 'Room', depth: 2, views: 180, bugs: 3, broken: false },
      { path: '/settings', label: 'Settings', depth: 1, views: 40, bugs: 0, broken: false },
    ],
    totalPages: 9,
    sampled: false,
  }),
  week: section([
    { id: 'reports', label: 'Bug reports', thisWeek: 9, lastWeek: 6, moreIsBetter: false, href: '/reports?days=7', daily: [1, 0, 2, 1, 0, 1, 1, 2, 1, 0, 3, 1, 1, 1] },
    { id: 'critical', label: 'Critical bugs', thisWeek: 1, lastWeek: 0, moreIsBetter: false, href: '/reports?severity=critical', daily: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    { id: 'merged', label: 'Fixes merged', thisWeek: 3, lastWeek: 4, moreIsBetter: true, href: '/fixes', daily: [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] },
    { id: 'sessions', label: 'User visits', thisWeek: 840, lastWeek: 790, moreIsBetter: true, href: '/portfolio?view=users', daily: [110, 120, 100, 115, 105, 120, 120, 125, 118, 122, 119, 120, 116, 120] },
  ]),
  activity: section([
    { id: 'merged_week', text: '3 fixes merged this week', to: '/fixes' },
    { id: 'deploy', text: 'Version 2.14.0 went live yesterday', to: '/releases' },
    { id: 'reports_today', text: '2 bug reports came in today', to: '/reports?days=1' },
  ]),
  access: section({
    projectId: PROJECT,
    createdAt: '2026-06-01T00:00:00Z',
    repo: { url: 'https://github.com/acme/lets-talk', branch: 'main' },
    members: { total: 2, people: [{ name: 'Sam Builder', avatarUrl: null, role: 'owner' }, { name: 'Alex', avatarUrl: null, role: 'member' }] },
    sdk: { package: '@mushi-mushi/web', version: '1.35.0', latest: '1.37.2', status: 'outdated' },
    keys: [
      { label: 'web', kind: 'sdk', lastUsedAt: HOURS_AGO(1), createdAt: '2026-06-01T00:00:00Z' },
      { label: 'cursor', kind: 'mcp', lastUsedAt: HOURS_AGO(30), createdAt: '2026-07-01T00:00:00Z' },
      { label: 'ci', kind: 'other', lastUsedAt: null, createdAt: '2026-08-01T00:00:00Z' },
    ],
    keysTotal: 3,
    keysReadable: true,
  }),
  partial: [],
}

const state = vi.hoisted(() => ({ home: null as unknown, setup: null as unknown }))
const pageData = (data: unknown) => ({ data, loading: false, error: null, errorMessage: null, isValidating: false, lastFetchedAt: null, reload: vi.fn() })

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) =>
    path?.includes('/sdk-health')
      ? pageData({ problems: [], notes: [], installed: null, lastSeenAt: null, repoUrl: null, siteUrl: null, checkedAt: NOW })
      : path?.endsWith('/home')
        ? pageData(state.home)
        : pageData(null),
}))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => state.setup }))
// A builder: not an operator, no paid features.
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ canEditProject: true, has: () => false, isOperator: false, isSuperAdmin: false, loading: false, planName: 'Free' }),
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../lib/useMilestoneCelebration', () => ({ useMilestoneCelebration: () => ({ triggerKey: 0 }) }))
vi.mock('../lib/useNextStep', () => ({
  useNextStep: () => ({ step: null, stepId: 'sdk_installed', projectId: PROJECT, loading: false }),
  useClaimNextStep: () => {},
}))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: null })),
  apiFetchMutate: vi.fn(),
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))
vi.mock('../components/PagePosture', () => ({
  POSTURE_PRIORITY: { status: 0, nudge: 5, recommended: 10, heroOrSnapshot: 20, guide: 30 },
  PagePosture: ({ slots }: { slots: Array<{ show?: boolean; children: ReactNode }> }) =>
    createElement('div', null, ...slots.filter((s) => s.show !== false).map((s) => s.children)),
}))
vi.mock('../components/Confetti', () => ({ Confetti: () => null }))
vi.mock('../components/dashboard/QuotaBanner', () => ({ QuotaBanner: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONTROLS = 'a[href], button, [role="button"], [role="radio"], [role="tab"], input, select, textarea, summary'

function measure(el: Element) {
  const words: string[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) words.push(...(n.textContent ?? '').split(/\s+/).filter(Boolean))
  return {
    controls: el.querySelectorAll(CONTROLS).length,
    words: words.length,
    viewTabs: el.querySelectorAll('[role="radiogroup"] [role="radio"], [role="tablist"] [role="tab"]').length,
    cards: el.querySelectorAll('[id^="home-"]').length,
  }
}

describe('Home control budget (ADR 0069)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    // Desktop width: the layout a builder first meets.
    window.matchMedia ??= ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mountHome(home: unknown, setup: unknown) {
    state.home = home
    state.setup = setup
    const { DashboardPage } = await import('./DashboardPage')
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, createElement(DashboardPage)))
    })
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
    return measure(container)
  }

  const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)

  // Before (2026-11-24, same fixture): 32 controls, 326 words, 5 view tabs.
  it('a brand-new app: under 20 controls, no view tabs, no empty cards', async () => {
    const m = await mountHome(FRESH_HOME, setupFor(false, 0))
    console.log('[home-budget] fresh', JSON.stringify(m))
    expect(m.viewTabs).toBe(0)
    expect(m.controls).toBeLessThan(20)
    // Release, Pages, This week and Recent activity have nothing to show yet.
    for (const id of ['home-release', 'home-sitemap', 'home-week', 'home-activity']) expect(container.querySelector(`#${id}`), id).toBeNull()
    // One button per place: Connect GitHub once (the CI light), the report button only in the checklist.
    const labels = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent?.trim())
    expect(labels.filter((l) => l === 'Connect GitHub')).toHaveLength(1)
    expect(labels).not.toContain('Set up the SDK')
    expect(labels).not.toContain('Add the report button')
  })

  // Before (2026-11-24, same fixture): 48 controls, 274 words, 5 view tabs.
  it('an established app (lets-talk shape): Needs you first, no view tabs', async () => {
    const m = await mountHome(ESTABLISHED_HOME, setupFor(true, 40))
    console.log('[home-budget] established', JSON.stringify(m))
    expect(m.viewTabs).toBe(0)
    expect(m.controls).toBeLessThan(40)
    const needs = byTestId('home-needs-row')!
    expect(needs.compareDocumentPosition(byTestId('home-health')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(needs.textContent).toContain('1 critical bug is waiting for a fix.')
    // "User visits" still opens User activity, now under Apps.
    expect(container.querySelector('a[href="/portfolio?view=users"]')).toBeTruthy()
  })

  it('says nothing needs you in one line above the live status', async () => {
    await mountHome({ ...ESTABLISHED_HOME, needsYou: section([]) }, setupFor(true, 40))
    const clear = byTestId('home-needs-you-clear')!
    expect(clear.closest('section')).toBeNull()
    expect(clear.compareDocumentPosition(byTestId('home-health')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('#home-needs-you')!.tagName).toBe('DIV')
  })

  it('opens an old Home view link under Apps', async () => {
    state.home = ESTABLISHED_HOME
    state.setup = setupFor(true, 40)
    const { DashboardPage } = await import('./DashboardPage')
    const { Route, Routes, useLocation } = await import('react-router-dom')
    function Where() {
      const l = useLocation()
      return createElement('p', { 'data-testid': 'where' }, `${l.pathname}${l.search}`)
    }
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/dashboard?project=p1&view=users'] },
          createElement(Routes, null, createElement(Route, { path: '/dashboard', element: createElement(DashboardPage) }), createElement(Route, { path: '/portfolio', element: createElement(Where) })),
        ),
      )
    })
    expect(byTestId('where')!.textContent).toBe('/portfolio?project=p1&view=users')
  })
})
