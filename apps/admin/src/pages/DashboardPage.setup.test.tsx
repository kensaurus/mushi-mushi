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
const healthyStages = ['plan', 'do', 'check', 'act'].map((id) => ({
  id,
  label: id,
  icon: '',
  description: '',
  count: 0,
  countLabel: 'items',
  bottleneck: null,
  tone: 'ok',
  cta: { to: '/reports', label: 'Open' },
}))
const dashboard = {
  empty: false,
  counts: { openBacklog: 0, openCritical14d: 0, reports14d: 5 },
  fixSummary: { inProgress: 0, failed: 0 },
  pdcaStages: healthyStages,
  focusStage: null,
  activity: [],
  integrations: [],
}
const pageData = (data: unknown) => ({ data, loading: false, error: null, errorMessage: null, isValidating: false, lastFetchedAt: null, reload: vi.fn() })

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) =>
    path?.includes('/sdk-health')
      ? pageData({ problems: [], notes: [], installed: null, lastSeenAt: null, repoUrl: null, siteUrl: null, checkedAt: '2026-10-26T00:00:00Z' })
      : pageData(dashboard),
}))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => setup }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => PROJECT }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../lib/useMilestoneCelebration', () => ({ useMilestoneCelebration: () => ({ triggerKey: 0 }) }))
vi.mock('../lib/dashboardModeUx', () => ({
  useDashboardUx: () => ({ isQuickstart: false, isBeginner: true, isAdvanced: false, hideTabs: false, plainBanner: true, hideOverviewChrome: false, hideLoopSnapshot: true }),
}))
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
  POSTURE_PRIORITY: { status: 0, heroOrSnapshot: 1 },
  PagePosture: ({ slots }: { slots: Array<{ show: boolean; children: ReactNode }> }) =>
    createElement('div', null, ...slots.filter((s) => s.show).map((s) => s.children)),
}))
// Charts and tiles the setup state does not depend on.
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/NextStep', () => ({ NextStep: () => null }))
vi.mock('../components/Confetti', () => ({ Confetti: () => null }))
vi.mock('../components/dashboard/QuotaBanner', () => ({ QuotaBanner: () => null }))
vi.mock('../components/dashboard/SdkUpgradeBanner', () => ({ SdkUpgradeBanner: () => null }))
vi.mock('../components/dashboard/PdcaCockpit', () => ({ PdcaCockpit: () => null }))
vi.mock('../components/pdca-flow/PdcaFlow', () => ({ PdcaFlow: () => null }))
vi.mock('../components/dashboard/LivePdcaPipeline', () => ({ LivePdcaPipeline: () => null }))
vi.mock('../components/dashboard/KpiRow', () => ({ KpiRow: () => null }))
vi.mock('../components/dashboard/TriageAndFixRow', () => ({ TriageAndFixRow: () => null }))
vi.mock('../components/dashboard/TeamActivityTile', () => ({ TeamActivityTile: () => null }))
vi.mock('../components/dashboard/InsightsRow', () => ({ InsightsRow: () => null }))
vi.mock('../components/dashboard/QaCoverageTile', () => ({ QaCoverageTile: () => null }))
vi.mock('../components/dashboard/PlatformHealthTile', () => ({ PlatformHealthTile: () => null }))
vi.mock('../components/dashboard/DashboardLoopReadout', () => ({ DashboardLoopReadout: () => null }))

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

  it('the hero names the open step with its fix, never "healthy"', async () => {
    await mount()
    const hero = container.querySelector('[data-testid="dashboard-hero-setup"]')!
    expect(hero.textContent).toContain('Setup 3 of 4 done')
    expect(hero.textContent).toContain('Install the SDK in your app')
    expect(hero.querySelector('a')!.getAttribute('href')).toBe(`/connect?project=${PROJECT}#connect-sdk-health`)
    expect(container.textContent).not.toContain('Loop is clean')
    expect(container.textContent).not.toContain('Nothing waiting on you')
  })
})
