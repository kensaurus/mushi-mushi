/**
 * @vitest-environment jsdom
 */

/**
 * How much Connect asks of a builder (ADR 0069, "Done is measured"): a fresh
 * account's Connect showed 555 words, 91 controls and 44 tabs: an eleven-client
 * picker with MCP / CLI / Skills lanes, GitHub, the Update center, SDK health
 * and the install card with twelve framework tabs, all on one page
 * (fresh-account walk, 2026-11-24). Connect is one step at a time now: the
 * report button, then the editor, then GitHub. Targets for a fresh app:
 * under 200 words, under 30 controls, under 10 tabs.
 *
 * Two apps, hand-built (the repo is public): a brand-new one (an SDK key that
 * never checked in, no editor, no repo) and an established one (checked in an
 * hour ago, one SDK version behind, an editor and GitHub connected).
 *
 * Only the data layer is mocked; the install card, the editor picker and the
 * rest render for real, so the counts are the page a builder sees.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-11-24T09:00:00Z')
const HOURS_AGO = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

interface Fixture {
  project: Record<string, unknown>
  mcpStats: Record<string, unknown>
  githubReady: boolean
  repos: Array<{ id: string; repo_url: string; role: string; is_primary: boolean }>
  health: Record<string, unknown>
}

const MCP_BASE = {
  hasAnyProject: true,
  projectId: PROJECT,
  mcpWriteKeyCount: 0,
  neverConnectedCount: 0,
  daysSinceLastSeen: null,
  lastSeenEndpointHost: null,
  expectedEndpointHost: null,
  endpointMismatch: false,
  toolCount: 71,
  resourceCount: 8,
  promptCount: 4,
  topPriorityLabel: null,
  topPriorityTo: null,
}

const FRESH: Fixture = {
  project: {
    id: PROJECT,
    name: 'my-new-app',
    slug: 'my-new-app',
    sdk_package: null,
    sdk_version: null,
    sdk_latest_version: '1.37.2',
    sdk_status: 'unknown',
    primary_repo: null,
    api_keys: [{ id: 'k1', key_prefix: 'mushi_ab12', label: 'default', is_active: true, created_at: HOURS_AGO(1), last_seen_at: null, scopes: ['report:write'] }],
  },
  mcpStats: {
    ...MCP_BASE,
    projectName: 'my-new-app',
    activeKeyCount: 1,
    mcpReadKeyCount: 0,
    connectedKeyCount: 0,
    reportOnlyKeyCount: 1,
    lastSeenAt: null,
    topPriority: 'report_only_keys',
  },
  githubReady: false,
  repos: [],
  health: {
    problems: [
      { id: 'never_seen', severity: 'warn', title: 'Your app has not checked in', detail: 'No request with this SDK key has reached Mushi Mushi yet.', fix: null },
      { id: 'no_repo', severity: 'info', title: 'No repo linked', detail: 'Link the GitHub repo so fixes can open pull requests.', fix: null },
    ],
    notes: [],
    installed: null,
    lastSeenAt: null,
    repoUrl: null,
    siteUrl: null,
    checkedAt: new Date(NOW).toISOString(),
  },
}

const ESTABLISHED: Fixture = {
  project: {
    id: PROJECT,
    name: 'lets-talk',
    slug: 'lets-talk',
    sdk_package: '@mushi-mushi/web',
    sdk_version: '1.35.0',
    sdk_latest_version: '1.37.2',
    sdk_status: 'outdated',
    primary_repo: { repo_url: 'https://github.com/acme/lets-talk', github_app_connected: true },
    api_keys: [
      { id: 'k1', key_prefix: 'mushi_ab12', label: 'web', is_active: true, created_at: '2026-06-01T00:00:00Z', last_seen_at: HOURS_AGO(1), scopes: ['report:write'] },
      { id: 'k2', key_prefix: 'mushi_cd34', label: 'cursor', is_active: true, created_at: '2026-07-01T00:00:00Z', last_seen_at: HOURS_AGO(30), scopes: ['mcp:read'] },
    ],
  },
  mcpStats: {
    ...MCP_BASE,
    projectName: 'lets-talk',
    activeKeyCount: 2,
    mcpReadKeyCount: 1,
    connectedKeyCount: 1,
    reportOnlyKeyCount: 1,
    lastSeenAt: HOURS_AGO(30),
    topPriority: 'healthy',
  },
  githubReady: true,
  repos: [{ id: 'r1', repo_url: 'https://github.com/acme/lets-talk', role: 'app', is_primary: true }],
  health: {
    problems: [],
    notes: [],
    installed: true,
    lastSeenAt: HOURS_AGO(1),
    repoUrl: 'https://github.com/acme/lets-talk',
    siteUrl: 'https://lets-talk.example.com',
    checkedAt: new Date(NOW).toISOString(),
  },
}

/** Ratchet: the established app's count after ADR 0069 (lower it when it drops). */
const ESTABLISHED_CONTROLS = 11

const state = vi.hoisted(() => ({ fx: null as unknown as Fixture }))
const pageData = (data: unknown) => ({ data, loading: false, error: null, errorMessage: null, isValidating: false, lastFetchedAt: null, reload: vi.fn() })

function dataFor(path: string): unknown {
  const fx = state.fx
  if (path === '/v1/admin/projects') return { projects: [fx.project] }
  if (path === '/v1/admin/mcp/stats') return fx.mcpStats
  if (path.includes('/github/stack')) return { repo: null, packageJson: null, reason: 'no_repo' }
  if (path.includes('/sdk-health')) return fx.health
  if (path.startsWith('/v1/admin/repo/repos')) return fx.repos
  if (path.includes('/sdk-config')) return { enabled: true, canEdit: true }
  if (path.includes('/preflight')) return { checks: [] }
  return null
}

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => pageData(path ? dataFor(path) : null),
}))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async (path: string) => ({ ok: true, data: dataFor(path) })),
  apiFetchMutate: vi.fn(async () => ({ ok: true, data: null })),
  invalidateApiCache: () => {},
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: () => {},
  },
}))
vi.mock('../lib/useDispatchPreflight', () => ({
  useDispatchPreflight: () => {
    const fx = state.fx
    const github = { key: 'github', ready: fx.githubReady, label: 'GitHub', hint: 'Connect your GitHub repo.', fixHref: '/integrations/config' }
    return {
      loading: false,
      ready: fx.githubReady,
      checks: [github],
      failing: fx.githubReady ? [] : [github],
      error: null,
      reload: vi.fn(),
      repoUrl: fx.repos[0]?.repo_url ?? null,
      baseBranch: fx.repos[0] ? 'main' : null,
    }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('../components/PagePosture', () => ({
  POSTURE_PRIORITY: { status: 0, nudge: 5, recommended: 10, heroOrSnapshot: 20, guide: 30 },
  PagePosture: ({ slots }: { slots: Array<{ show?: boolean; children: ReactNode }> }) =>
    createElement('div', null, ...slots.filter((s) => s.show !== false).map((s) => s.children)),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONTROLS = 'a[href], button, [role="button"], [role="radio"], [role="tab"], input, select, textarea, summary'

function measure(el: Element) {
  const words: string[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) words.push(...(n.textContent ?? '').split(/\s+/).filter(Boolean))
  return {
    controls: el.querySelectorAll(CONTROLS).length,
    words: words.length,
    // Every chip and tab a builder can pick from: editors, setup lanes, frameworks, hosts, section jumps.
    tabs: el.querySelectorAll('[role="radio"], [role="tab"]').length,
  }
}

describe('Connect control budget (ADR 0069)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    } as unknown as typeof IntersectionObserver
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
    Element.prototype.scrollIntoView ??= function scrollIntoView() {}
    try { localStorage.clear() } catch { /* no storage */ }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function mountConnect(fx: Fixture, entry = '/connect') {
    state.fx = fx
    const { ConnectPage } = await import('./ConnectPage')
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(ConnectPage)))
    })
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
    return measure(container)
  }

  const step = (key: string) => container.querySelector<HTMLLIElement>(`[data-step="${key}"]`)!
  const stepButton = (key: string) => step(key).querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const opened = () => Array.from(container.querySelectorAll('[data-step]')).filter((li) => li.querySelector('button[aria-expanded="true"]')).map((li) => li.getAttribute('data-step'))
  async function click(el: HTMLElement) {
    await act(async () => {
      el.click()
    })
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
  }

  // Before (2026-11-24, same fixture, whole DOM): 101 controls, 800 words, 44 tabs.
  it('a brand-new app: one open step, under 200 words, 30 controls and 10 tabs', async () => {
    const m = await mountConnect(FRESH)
    console.log('[connect-budget] fresh', JSON.stringify(m))
    expect(m.words).toBeLessThan(200)
    expect(m.controls).toBeLessThan(30)
    // Ratchet: 16 after ADR 0069 (lower it when it drops).
    expect(m.controls).toBeLessThanOrEqual(16)
    expect(m.tabs).toBeLessThan(10)
    // The report button is the step to do; editor and GitHub are one line each.
    expect(opened()).toEqual(['sdk'])
    expect(container.querySelector('#connect-sdk-body')).not.toBeNull()
    expect(container.querySelector('#connect-studio-body')).toBeNull()
    expect(container.querySelector('#connect-github-body')).toBeNull()
    // Nothing to upgrade or check before the app checks in.
    expect(container.querySelector('#connect-update')).toBeNull()
    expect(container.querySelector('[data-testid="sdk-health-panel"]')).toBeNull()
    // Home's "Set up the SDK" link still lands, on the report button step.
    expect(step('sdk').querySelector('#connect-sdk-health')).not.toBeNull()
  })

  it('keeps every step reachable on a brand-new app', async () => {
    await mountConnect(FRESH)
    await click(stepButton('editor'))
    expect(opened()).toEqual(['editor'])
    // Three editors lead; the rest and the CLI / Skills lanes are one click away.
    expect(container.querySelectorAll('#connect-studio-body [role="radio"]')).toHaveLength(3)
    expect(container.querySelector('[data-testid="connect-other-editors"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="connect-alt-lanes-toggle"]')).not.toBeNull()
    await click(stepButton('github'))
    expect(opened()).toEqual(['github'])
    expect(container.querySelector('#connect-github-body [data-testid="github-connect-card"]')).not.toBeNull()
  })

  it('opens the step a link points at', async () => {
    await mountConnect(FRESH, '/connect#connect-github')
    expect(opened()).toEqual(['github'])
    act(() => root.unmount())
    root = createRoot(container)
    await mountConnect(FRESH, '/connect#connect-sdk-health')
    expect(opened()).toEqual(['sdk'])
  })

  // Before (2026-11-24, same fixture, whole DOM): 91 controls, 944 words, 31 tabs.
  it('an established app: three done steps, then the Update center for the SDK that is behind', async () => {
    const m = await mountConnect(ESTABLISHED)
    console.log('[connect-budget] established', JSON.stringify(m))
    expect(opened()).toEqual([])
    for (const key of ['sdk', 'editor', 'github']) expect(step(key).getAttribute('data-done'), key).toBe('true')
    expect(step('sdk').textContent).toContain('App checked in 1h ago')
    expect(step('github').textContent).toContain('acme/lets-talk')
    // 1.35.0 is behind 1.37.2: the upgrade shows in full, with SDK health beside it.
    expect(container.querySelector('#connect-update')?.textContent).toContain('1.37.2')
    expect(container.querySelector('#connect-sdk-health [data-testid="sdk-health-panel"]')).not.toBeNull()
    // The upgrade is offered only while the SDK is behind (was the status pills' "Upgrade the SDK").
    const buttons = () => Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(buttons()).toContain('Upgrade to 1.37.2')
    expect(m.controls).toBeLessThanOrEqual(ESTABLISHED_CONTROLS)
    expect(m.tabs).toBe(0)
  })

  it('an established app on the latest SDK with nothing wrong: one line', async () => {
    const current = { ...ESTABLISHED, project: { ...ESTABLISHED.project, sdk_version: '1.37.2', sdk_status: 'up-to-date' } }
    const m = await mountConnect(current)
    console.log('[connect-budget] established-current', JSON.stringify(m))
    const ok = container.querySelector('[data-testid="connect-sdk-ok"]')!
    expect(ok.id).toBe('connect-sdk-health')
    expect(container.querySelector('#connect-update')).toBeNull()
    expect(Array.from(container.querySelectorAll('button')).some((b) => /^Upgrade/.test(b.textContent?.trim() ?? ''))).toBe(false)
    expect(m.controls).toBeLessThan(10)
    await click(Array.from(ok.querySelectorAll('button')).find((b) => b.textContent === 'Details')!)
    expect(container.querySelector('#connect-update')).not.toBeNull()
  })
})
