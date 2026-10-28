/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/OnboardingPage.test.tsx
 * PURPOSE: The pipeline-live card on /onboarding, once the step counter is full.
 *
 * A 10/10 project shows "View fixes" and "Open dashboard", and does not ask
 * to connect fix agents. While steps remain, that card stays down even if a
 * fix has already merged (report c016af11).
 */

import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingStats } from '../components/onboarding/types'

const PROJECT = '11111111-1111-4111-8111-111111111111'

const STEP_IDS = [
  'project_created',
  'api_key_generated',
  'sdk_installed',
  'first_report_received',
  'github_connected',
  'sentry_connected',
  'byok_anthropic',
  'first_fix_dispatched',
  'slack_connected',
  'first_qa_story_passing',
] as const

const steps = STEP_IDS.map((id) => ({
  id,
  label: id,
  description: '',
  complete: true,
  required: ['project_created', 'api_key_generated', 'sdk_installed', 'first_report_received'].includes(id),
  cta_to: '/onboarding',
  cta_label: 'Open',
}))

const project = {
  project_id: PROJECT,
  project_name: 'Demo',
  project_slug: 'demo',
  created_at: '2026-10-01T00:00:00Z',
  steps,
  required_total: 4,
  required_complete: 4,
  total: 10,
  complete: 10,
  done: true,
  report_count: 3,
  fix_count: 1,
  merged_fix_count: 1,
}

const stats: OnboardingStats = {
  hasAnyProject: true,
  projectId: PROJECT,
  projectName: 'Demo',
  requiredComplete: 4,
  requiredTotal: 4,
  stepsComplete: 10,
  stepsTotal: 10,
  optionalComplete: 6,
  optionalTotal: 6,
  setupDone: true,
  nextStepId: null,
  nextStepLabel: null,
  sdkInstalled: true,
  sdkHostMismatch: false,
  adminEndpointHost: null,
  sdkEndpointHost: null,
  hasApiKey: true,
  reportCount: 3,
  fixCount: 1,
  mergedFixCount: 1,
  nextStepTo: null,
  funnelCounts: null,
}

const setupResponse = { has_any_project: true, projects: [project], admin_endpoint_host: null }
const activation = {
  setup: setupResponse,
  stats,
  preflight: null,
  phase: 'loop' as const,
  top_priority: { label: 'Nothing waiting', to: '/fixes', tone: 'idle' as const },
}

function pageData(data: unknown) {
  return {
    data,
    loading: false,
    error: null,
    errorCode: null,
    errorMessage: null,
    requestId: null,
    isValidating: false,
    lastFetchedAt: '2026-10-29T00:00:00Z',
    reload: vi.fn(),
  }
}

function applyProgress(next: { complete: number; total: number; done: boolean; merged: number }) {
  project.complete = next.complete
  project.total = next.total
  project.done = next.done
  project.merged_fix_count = next.merged
  stats.stepsComplete = next.complete
  stats.stepsTotal = next.total
  stats.setupDone = next.done
  stats.mergedFixCount = next.merged
}

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (path?.includes('/v1/admin/activation')) return pageData(activation)
    if (path === '/v1/admin/setup' || path?.startsWith('/v1/admin/setup?')) return pageData(setupResponse)
    return pageData(null)
  },
}))

vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, data: { progress: [] } })),
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => null }))
vi.mock('../components/FirstRunTour', () => ({ restartFirstRunTour: () => {} }))
vi.mock('../components/SdkInstallCard', () => ({ SdkInstallCard: () => null }))
vi.mock('../components/pdca-flow/PdcaFlow', () => ({ PdcaFlow: () => null }))
vi.mock('../components/SetupChecklist', () => ({ SetupChecklist: () => null }))
vi.mock('../components/onboarding/SetupProgressRail', () => ({ SetupProgressRail: () => null }))
vi.mock('../components/ConnectionStatus', () => ({ ConnectionStatus: () => null }))
vi.mock('../components/CliSetupGuide', () => ({ CliSetupGuide: () => null }))
vi.mock('../components/migrations/MigrationsInProgressCard', () => ({ MigrationsInProgressCard: () => null }))
vi.mock('../components/onboarding/FirstDiagnosisScreen', () => ({ FirstDiagnosisScreen: () => null }))
vi.mock('../components/ProjectCreatedSuccessPanel', () => ({ ProjectCreatedSuccessPanel: () => null }))
vi.mock('../components/ConfigHelp', () => ({ ConfigHelp: () => null }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/onboarding/OnboardingSetupReadout', () => ({ OnboardingSetupReadout: () => null }))
vi.mock('../components/onboarding/SetupGapsSection', () => ({ SetupGapsSection: () => null }))
vi.mock('../components/dashboard/ProjectNarrativeStrip', () => ({ ProjectNarrativeStrip: () => null }))

function Where() {
  const { pathname } = useLocation()
  return createElement('div', { 'data-where': pathname })
}

function pipelineHeading(container: HTMLElement): HTMLElement | undefined {
  return [...container.querySelectorAll('h3')].find((node) => node.textContent?.includes('Pipeline live'))
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('OnboardingPage pipeline-live card', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    applyProgress({ complete: 10, total: 10, done: true, merged: 1 })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderPage() {
    const { OnboardingPage } = await import('./OnboardingPage')
    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        null,
        createElement(Fragment, null, createElement(OnboardingPage), createElement(Where)),
      ))
    })
  }

  it('shows View fixes and Open dashboard for a 10/10 project and does not ask to connect fix agents', async () => {
    await renderPage()
    const heading = pipelineHeading(container)
    expect(heading?.textContent).toContain('10 of 10')
    const labels = [...(heading?.parentElement?.querySelectorAll('button') ?? [])].map((button) => button.textContent)
    expect(labels).toEqual(['View fixes', 'Open dashboard'])
    expect(container.textContent ?? '').not.toContain('Connect fix agents')

    const fixes = [...container.querySelectorAll('button')].find((button) => button.textContent === 'View fixes')
    await act(async () => {
      fixes?.click()
    })
    expect(container.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/fixes')
  })

  it('keeps the same finished actions when no fix has merged', async () => {
    applyProgress({ complete: 10, total: 10, done: true, merged: 0 })
    await renderPage()
    const labels = [...(pipelineHeading(container)?.parentElement?.querySelectorAll('button') ?? [])].map((button) => button.textContent)
    expect(labels).toEqual(['View fixes', 'Open dashboard'])
    expect(container.textContent ?? '').not.toContain('Connect fix agents')
  })

  it('does not show the finished-pipeline card while steps remain, even after a merged fix', async () => {
    applyProgress({ complete: 8, total: 10, done: true, merged: 2 })
    await renderPage()
    expect(pipelineHeading(container)).toBeUndefined()
    const text = container.textContent ?? ''
    expect(text).not.toContain('View fixes')
    expect(text).not.toContain('Connect fix agents')
  })
})
