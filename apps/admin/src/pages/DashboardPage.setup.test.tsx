/**
 * @vitest-environment jsdom
 */

/**
 * Home with a required setup step open (mushi-demo, 2026-10-26: the SDK never
 * checked in, setup 3/4). The setup checklist shows inline with Fix it on the
 * SDK step, and its Fix it opens SDK health. Its "Show setup guide" button
 * used to open a docked guide that was no longer mounted, so it did nothing.
 * The hero names the open step with its fix instead of "healthy, nothing
 * waiting on you".
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'

const steps = [
  { id: 'project_created', label: 'Create your first project', description: '', complete: true, required: true, cta_to: '/projects', cta_label: 'Manage projects' },
  { id: 'api_key_generated', label: 'Generate an API key', description: '', complete: true, required: true, cta_to: '/projects', cta_label: 'Generate key' },
  {
    id: 'sdk_installed',
    label: 'Install the SDK in your app',
    description: 'Drop the Mushi widget into your app so users can submit reports.',
    complete: false,
    required: true,
    cta_to: '/onboarding?tab=sdk',
    cta_label: 'Install SDK',
    diagnostic: { last_sdk_seen_at: null, last_sdk_origin: null, last_sdk_user_agent: null, last_sdk_endpoint_host: null },
  },
  { id: 'first_report_received', label: 'Receive your first bug report', description: '', complete: true, required: true, cta_to: '/reports', cta_label: 'Send test report' },
]
const project = {
  project_id: PROJECT,
  project_name: 'mushi-demo',
  project_slug: 'mushi-demo',
  created_at: '2026-10-01T00:00:00Z',
  steps,
  required_total: 4,
  required_complete: 3,
  total: 4,
  complete: 3,
  done: false,
  report_count: 5,
  fix_count: 0,
  merged_fix_count: 0,
}
const setup = {
  data: { admin_endpoint_host: 'x.supabase.co', has_any_project: true, projects: [project] },
  loading: false,
  error: null,
  resolved: true,
  hasAnyProject: true,
  reload: vi.fn(),
  activeProject: project,
  selectors: { required_total: 4, required_complete: 3, total: 4, complete: 3, done: false },
  isStepIncomplete: (id: string) => !steps.find((s) => s.id === id)?.complete,
  getStep: (id: string) => steps.find((s) => s.id === id) ?? null,
}
const section = <T,>(data: T) => ({ status: 'ok', data, connect: null, error: null })
// Home for an app whose SDK never checked in: SDK light off, nothing else wrong.
const home = {
  generatedAt: '2026-10-26T00:00:00Z',
  projectId: PROJECT,
  app: section({
    name: 'mushi-demo',
    slug: 'mushi-demo',
    iconUrl: null,
    liveUrl: null,
    platforms: [],
    version: null,
    sdkOrigin: null,
    repoUrl: null,
    thumbnail: null,
    thumbnailState: { available: true, canRefresh: false, reason: 'Add your live site address to take a screenshot.', lastError: null, lastAttemptAt: null },
  }),
  health: section([
    { id: 'sdk', label: 'SDK sending', status: 'not_connected', light: 'off', headline: 'Never checked in', detail: null, at: null, href: '/connect', connect: { label: 'Set up the SDK', to: '/connect' } },
  ]),
  needsYou: section([{ id: 'sdk_silent', impact: 65, text: 'Your app is not sending to Mushi yet, so users cannot report bugs.', action: { label: 'Fix it', to: '/connect' } }]),
  release: { status: 'not_connected', data: null, connect: { label: 'Connect GitHub', to: '/connect' }, error: null },
  sitemap: { status: 'not_connected', data: null, connect: { label: 'Install the SDK', to: '/connect' }, error: null },
  week: section([]),
  activity: section([]),
  access: { status: 'error', data: null, connect: null, error: 'timeout' },
  partial: [],
}
const pageData = (data: unknown) => ({ data, loading: false, error: null, errorMessage: null, isValidating: false, lastFetchedAt: null, reload: vi.fn() })

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) =>
    path?.includes('/sdk-health')
      ? pageData({ problems: [], notes: [], installed: null, lastSeenAt: null, repoUrl: null, siteUrl: null, checkedAt: '2026-10-26T00:00:00Z' })
      : path?.endsWith('/home')
        ? pageData(home)
        : pageData(null),
}))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => setup }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ canEditProject: true, has: () => false }) }))
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
// Chrome the setup state does not depend on.
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/Confetti', () => ({ Confetti: () => null }))
vi.mock('../components/dashboard/QuotaBanner', () => ({ QuotaBanner: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

describe('Home while a required setup step is open', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount() {
    const { DashboardPage } = await import('./DashboardPage')
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(DashboardPage)))
    })
    await flush()
  }

  it('shows the setup checklist inline, with Fix it on the SDK step, and no dead "Show setup guide"', async () => {
    await mount()
    const text = container.textContent ?? ''
    expect(text).toContain('Install the SDK in your app')
    expect(text).not.toContain('Show setup guide')
    const fixIt = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Fix it')
    expect(fixIt).toBeTruthy()
    act(() => fixIt!.click())
    await flush()
    expect(container.querySelector('[data-testid="sdk-health-panel"]')).toBeTruthy()
  })

  it('names the open step once, in the checklist, never "healthy"', async () => {
    await mount()
    // The hero card that repeated the step, its button and a second count is
    // gone (owner, 2026-10-27); the checklist marks the step itself.
    expect(container.querySelector('[data-testid="dashboard-hero-setup"]')).toBeNull()
    expect(container.textContent).not.toContain('Setup 3 of 4 done')
    expect(container.textContent).toContain('Install the SDK in your app')
    expect(container.textContent).not.toContain('Loop is clean')
    expect(container.textContent).not.toContain('Nothing waiting on you')
  })

  it('still shows the Home sections: what needs you, how to connect, and which read failed', async () => {
    await mount()
    const text = container.textContent ?? ''
    expect(container.querySelector('[data-testid="home-needs-you"]')!.textContent).toContain('Your app is not sending to Mushi yet')
    expect(container.querySelector('[data-testid="home-health-sdk"]')!.textContent).toContain('Set up the SDK')
    expect(text).toContain('Connect your GitHub repo to see fixes move toward a release.')
    expect(text).toContain('Could not read access and details just now.')
    // An app with reports opens Home with the explainer closed.
    expect(container.querySelector('[data-testid="home-how-this-works"] button')!.getAttribute('aria-expanded')).toBe('false')
  })
})
