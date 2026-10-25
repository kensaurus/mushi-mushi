/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/DashboardPage.explainer.test.tsx
 * PURPOSE: The Home explainer must not treat a still-loading project as
 *          zero merged fixes. That fallback flashed the four-card "How
 *          Mushi works" block on a mature project (report 04f7bd36).
 *
 * DEPENDENCIES: react-dom/client + act. Child surfaces are mocked; the
 *               page's count helper and the prop it passes are what is
 *               under test.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ActiveProject {
  project_id: string
  project_name: string
  merged_fix_count: number
  report_count: number
}

const mocks = vi.hoisted(() => ({
  pageLoading: false,
  setupLoading: false,
  activeProject: null as ActiveProject | null,
  skeleton: false,
  mounted: false,
  mergedFixCount: 'unset' as number | null | undefined | 'unset',
}))

const DASHBOARD = {
  empty: false,
  counts: {
    reports14d: 2,
    openBacklog: 1,
    fixesTotal: 3,
    openPrs: 0,
    llmCalls14d: 0,
    llmTokens14d: 0,
    llmFailures14d: 0,
  },
  fixSummary: { total: 3, completed: 3, failed: 0, inProgress: 0, openPrs: 0 },
  reportsByDay: [],
  llmByDay: [],
  activity: [],
  triageQueue: [],
  integrations: [],
  pdcaStages: [],
}

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: mocks.pageLoading ? null : DASHBOARD,
    loading: mocks.pageLoading,
    error: null,
    isValidating: false,
    lastFetchedAt: '2026-10-25T00:00:00.000Z',
    reload: () => {},
  }),
}))

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({
    loading: mocks.setupLoading,
    error: null,
    resolved: !mocks.setupLoading,
    hasAnyProject: true,
    data: mocks.setupLoading ? null : { has_any_project: true, projects: [] },
    reload: () => {},
    activeProject: mocks.activeProject,
    selectors: { required_total: 1, required_complete: 1, total: 1, complete: 1, done: true },
    isStepIncomplete: () => false,
    getStep: () => null,
  }),
}))

vi.mock('../components/ProjectSwitcher', () => ({
  useActiveProjectId: () => mocks.activeProject?.project_id ?? null,
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../components/dashboard/LivePdcaPipeline', () => ({
  LivePdcaPipeline: (props: { mergedFixCount?: number | null }) => {
    mocks.mounted = true
    mocks.mergedFixCount = props.mergedFixCount
    return null
  },
}))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/PagePosture', () => ({
  PagePosture: () => null,
  POSTURE_PRIORITY: { status: 0, recommended: 10, heroOrSnapshot: 20, guide: 30, nudge: 5 },
}))
vi.mock('../components/NextStep', () => ({ NextStep: () => null }))
vi.mock('../components/Confetti', () => ({ Confetti: () => null }))
vi.mock('../components/dashboard/SdkUpgradeBanner', () => ({ SdkUpgradeBanner: () => null }))
vi.mock('../components/dashboard/FirstReportHero', () => ({ FirstReportHero: () => null }))
vi.mock('../components/dashboard/DashboardLoopReadout', () => ({ DashboardLoopReadout: () => null }))
vi.mock('../components/dashboard/QuotaBanner', () => ({ QuotaBanner: () => null }))
vi.mock('../components/dashboard/TriageAndFixRow', () => ({ TriageAndFixRow: () => null }))
vi.mock('../components/dashboard/TeamActivityTile', () => ({ TeamActivityTile: () => null }))
vi.mock('../components/dashboard/InsightsRow', () => ({ InsightsRow: () => null }))
vi.mock('../components/dashboard/PlatformHealthTile', () => ({ PlatformHealthTile: () => null }))
vi.mock('../components/dashboard/QaCoverageTile', () => ({ QaCoverageTile: () => null }))
vi.mock('../components/skeletons/DashboardSkeleton', () => ({
  DashboardSkeleton: () => {
    mocks.skeleton = true
    return null
  },
}))
vi.mock('../components/dashboard/GettingStartedEmpty', () => ({ GettingStartedEmpty: () => null }))
vi.mock('../components/dashboard/HeroIntro', () => ({ HeroIntro: () => null }))
vi.mock('../components/dashboard/PdcaCockpit', () => ({ PdcaCockpit: () => null }))
vi.mock('../components/dashboard/KpiRow', () => ({ KpiRow: () => null }))
vi.mock('../components/pdca-flow/PdcaFlow', () => ({ PdcaFlow: () => null }))
vi.mock('../components/PageLoadError', () => ({ PageLoadError: () => null }))
vi.mock('../lib/track', () => ({ trackAdHoc: () => {}, trackSelf: () => {} }))

import { DashboardPage, explainerMergedFixCount } from './DashboardPage'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.pageLoading = false
  mocks.setupLoading = false
  mocks.activeProject = null
  mocks.skeleton = false
  mocks.mounted = false
  mocks.mergedFixCount = 'unset'
  window.localStorage.clear()
  window.localStorage.setItem('mushi:milestone:first-merged-fix', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function renderPage() {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(DashboardPage)))
  })
}

describe('explainerMergedFixCount', () => {
  it('stays unknown while setup is loading, including a stale zero', () => {
    expect(explainerMergedFixCount(true, null)).toBeUndefined()
    expect(explainerMergedFixCount(true, { merged_fix_count: 0 })).toBeUndefined()
    expect(explainerMergedFixCount(true, { merged_fix_count: 4 })).toBeUndefined()
  })

  it('stays unknown when the active project has not resolved', () => {
    expect(explainerMergedFixCount(false, null)).toBeUndefined()
  })

  it('returns the real count once the project is known, including zero', () => {
    expect(explainerMergedFixCount(false, { merged_fix_count: 0 })).toBe(0)
    expect(explainerMergedFixCount(false, { merged_fix_count: 4 })).toBe(4)
  })
})

describe('DashboardPage explainer count', () => {
  it('does not mount the explainer while setup is still loading', () => {
    mocks.setupLoading = true
    mocks.activeProject = {
      project_id: 'p1',
      project_name: 'App',
      merged_fix_count: 4,
      report_count: 3,
    }
    renderPage()
    expect(mocks.skeleton).toBe(true)
    expect(mocks.mounted).toBe(false)
  })

  it('passes undefined when the page renders before a project is in hand', () => {
    renderPage()
    expect(mocks.mounted).toBe(true)
    expect(mocks.mergedFixCount).toBeUndefined()
  })

  it('passes zero for a known new project and the real count after a merge', () => {
    mocks.activeProject = {
      project_id: 'p1',
      project_name: 'App',
      merged_fix_count: 0,
      report_count: 1,
    }
    renderPage()
    expect(mocks.mergedFixCount).toBe(0)

    mocks.activeProject = {
      project_id: 'p1',
      project_name: 'App',
      merged_fix_count: 4,
      report_count: 3,
    }
    renderPage()
    expect(mocks.mergedFixCount).toBe(4)
  })
})
