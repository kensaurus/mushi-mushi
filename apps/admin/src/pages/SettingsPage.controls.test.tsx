/**
 * @vitest-environment jsdom
 */

/**
 * How much Settings asks of a builder (ADR 0069, "Done is measured"): a
 * fresh account's Settings showed 689 words, 58 controls and 6 tabs
 * (fresh-account walk, 2026-11-24). General leads with what a builder needs,
 * AI keys and where bug alerts go; Sentry, the older Slack webhook, the
 * Supabase link, bug sorting, daily limits and the widget line sit in one
 * collapsed "Advanced" group that opens when a link points into it.
 *
 * Two apps, hand-built (the repo is public): a brand-new one with nothing
 * saved, and an established one with Slack, Sentry and a Supabase link
 * saved. Only the data layer is mocked; the General panel renders for real.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '44444444-4444-4444-8444-444444444444'

interface Fixture {
  stats: Record<string, unknown>
  settings: Record<string, unknown>
}

const STATS_BASE = {
  hasAnyProject: true,
  projectId: PROJECT,
  updatedAt: '2026-11-24T08:00:00Z',
  reporterNotificationsEnabled: false,
  stage2Model: null,
  sdkConfigEnabled: true,
  sdkConfigUpdatedAt: null,
  byokAnthropicConfigured: false,
  byokOpenaiConfigured: false,
  byokFirecrawlConfigured: false,
  byokKeysConfigured: 0,
  byokKeysPassing: 0,
  byokKeysFailing: 0,
  byokKeysUntested: 0,
  byokKeysExpiring: 0,
  autofixEnabled: false,
}

const FRESH: Fixture = {
  stats: { ...STATS_BASE, projectName: 'my-new-app', slackConfigured: false, slackCanPost: false, sentryConfigured: false, githubRepoConfigured: false },
  settings: {},
}

const ESTABLISHED: Fixture = {
  stats: { ...STATS_BASE, projectName: 'lets-talk', slackConfigured: true, slackCanPost: true, sentryConfigured: true, githubRepoConfigured: true, autofixEnabled: true },
  settings: {
    slack_channel_id: 'C0123ABCDEF',
    slack_bot_token_ref_set: true,
    sentry_dsn: 'https://public@o0.ingest.sentry.io/1',
    sentry_webhook_secret_set: true,
    sentry_consume_user_feedback: true,
    supabase_project_ref: 'abcdefghijklmnopqrst',
    fix_branch_template: 'bugfix/MUSHI-{reportId}-{category}',
    stage1_confidence_threshold: 0.85,
    dedup_threshold: 0.82,
  },
}

/** Ratchets: the counts after ADR 0069 (lower them when they drop). */
const BUDGET = {
  fresh: { controls: 28, words: 304 },
  established: { controls: 29 },
}

const state = vi.hoisted(() => ({ fx: null as unknown as Fixture }))
const pageData = (data: unknown) => ({ data, loading: false, error: null, errorCode: null, errorMessage: null, isValidating: false, lastFetchedAt: null, reload: vi.fn() })

function dataFor(path: string): unknown {
  const fx = state.fx
  if (path === '/v1/admin/settings/stats') return fx.stats
  if (path === '/v1/admin/settings') return fx.settings
  if (path === '/v1/admin/byok/keys') return { keys: [], legacyKeys: [], sharing: null, universal: null }
  return null
}

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => pageData(path ? dataFor(path) : null),
}))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async (path: string) => ({ ok: true, data: dataFor(path) })),
  apiFetchMutate: vi.fn(async () => ({ ok: true, data: null })),
  invalidateApiCache: () => {},
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))
vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({ activeProject: { project_name: state.fx.stats.projectName, project_slug: state.fx.stats.projectName } }),
  invalidateSetupStatus: () => {},
}))
// A builder on the Free plan: no own-key pool, not staff.
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ canEditProject: true, has: () => false, isOperator: false, isSuperAdmin: false, loading: false, planName: 'Free' }),
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
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
    tabs: el.querySelectorAll('[role="radio"], [role="tab"]').length,
  }
}

describe('Settings control budget (ADR 0069)', () => {
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
  })

  async function mountSettings(fx: Fixture, entry = '/settings') {
    state.fx = fx
    const { SettingsPage } = await import('./SettingsPage')
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(SettingsPage)))
    })
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
    return measure(container)
  }

  const ADVANCED = ['slack-webhook', 'error-tracking', 'supabase', 'bug-sorting', 'daily-limits', 'widget']

  // Before (2026-11-24, same fixture, whole DOM): 61 controls, 615 words, 6 tabs.
  it('a brand-new app: General leads with bug alerts, the rest in a closed Advanced group', async () => {
    const m = await mountSettings(FRESH)
    console.log('[settings-budget] fresh', JSON.stringify(m))
    expect(container.querySelector('#slack')).not.toBeNull()
    for (const id of ADVANCED) expect(container.querySelector(`#${id}`), id).toBeNull()
    expect(container.querySelector('[data-testid="settings-advanced-toggle"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(m.controls).toBeLessThanOrEqual(BUDGET.fresh.controls)
    expect(m.words).toBeLessThanOrEqual(BUDGET.fresh.words)
  })

  // Before (2026-11-24, same fixture, whole DOM): 63 controls, 636 words, 6 tabs.
  it('an established app: saved Sentry and Supabase stay one click away', async () => {
    const m = await mountSettings(ESTABLISHED)
    console.log('[settings-budget] established', JSON.stringify(m))
    for (const id of ADVANCED) expect(container.querySelector(`#${id}`), id).toBeNull()
    expect(m.controls).toBeLessThanOrEqual(BUDGET.established.controls)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-advanced-toggle"]')!.click()
    })
    for (const id of ADVANCED) expect(container.querySelector(`#${id}`), id).not.toBeNull()
  })

  it('opens Advanced when a link points into it', async () => {
    await mountSettings(ESTABLISHED, '/settings#supabase')
    expect(container.querySelector('#supabase')).not.toBeNull()
  })
})
