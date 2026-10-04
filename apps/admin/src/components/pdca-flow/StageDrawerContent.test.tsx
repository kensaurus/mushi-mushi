/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/pdca-flow/StageDrawerContent.test.tsx
 * PURPOSE: The Plan drawer's "Dispatch fix" goes through the same confirm and
 *          prerequisites gate as the reports table.
 *
 * Why (2026-09-23): it was the one dispatch entry point that POSTed on the
 * first click — no summary of what a dispatch does (an LLM run and a draft
 * PR) and no prerequisite check, so autofix-off or a missing repo showed up
 * only as an error toast after the request.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightCheck, PreflightState } from '../../lib/useDispatchPreflight'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const preflightHook = vi.hoisted(() => ({ useDispatchPreflight: vi.fn() }))
const undo = vi.hoisted(() => ({ trigger: vi.fn() }))

vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/useDispatchPreflight', () => preflightHook)
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => 'project-1' }))
vi.mock('../flow-primitives/useFlowUndo', () => ({ useFlowUndo: () => undo }))

import { StageDrawerContent } from './StageDrawerContent'

const REPORT = {
  id: 'report-1',
  summary: 'Checkout button does nothing on Safari',
  severity: 'medium',
  created_at: '2026-09-23T00:00:00Z',
}

function preflightState(overrides: Partial<PreflightState> = {}): PreflightState {
  return {
    loading: false,
    ready: true,
    checks: [],
    failing: [],
    error: null,
    reload: vi.fn(),
    repoUrl: 'https://github.com/acme/shop',
    ...overrides,
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function dispatchCalls(): unknown[][] {
  return api.apiFetch.mock.calls.filter(([path]) => path === '/v1/admin/fixes/dispatch')
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  )
}

describe('StageDrawerContent — Plan drawer dispatch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/admin/reports?')) return { ok: true, data: { reports: [REPORT] } }
      if (path === '/v1/admin/fixes/dispatch') return { ok: true, data: {} }
      return { ok: false, error: { code: 'UNEXPECTED' } }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(StageDrawerContent, { stageId: 'plan', stage: null, onClose: vi.fn() }),
        ),
      )
      await flush()
    })
  }

  it('opens the confirm popover instead of dispatching on the first click', async () => {
    preflightHook.useDispatchPreflight.mockReturnValue(preflightState())
    await render()

    await act(async () => {
      buttonByText('Dispatch fix →')?.click()
      await flush()
    })
    expect(dispatchCalls()).toHaveLength(0)
    expect(document.body.querySelector('[role="dialog"][aria-label="Dispatch agentic fix"]')).not.toBeNull()

    await act(async () => {
      buttonByText('Queue fix worker →')?.click()
      await flush()
    })
    expect(dispatchCalls()).toHaveLength(1)
    // QA 43: the route requires projectId; without it every dispatch here was a 400.
    expect(JSON.parse((dispatchCalls()[0]![1] as { body: string }).body)).toEqual({
      reportId: 'report-1',
      projectId: 'project-1',
    })
  })

  it('cannot dispatch while a prerequisite fails', async () => {
    const autofixOff: PreflightCheck = {
      key: 'autofix',
      ready: false,
      label: 'Autofix enabled',
      hint: 'Turn on autofix in project settings.',
      fixHref: '/settings',
    }
    preflightHook.useDispatchPreflight.mockReturnValue(
      preflightState({ ready: false, checks: [autofixOff], failing: [autofixOff] }),
    )
    await render()

    await act(async () => {
      buttonByText('Dispatch fix →')?.click()
      await flush()
    })
    const confirm = buttonByText('Resolve prerequisites first')
    expect(confirm?.disabled).toBe(true)

    await act(async () => {
      confirm?.click()
      await flush()
    })
    expect(dispatchCalls()).toHaveLength(0)
  })
})

describe('StageDrawerContent: Do, Check and Act drawers', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    preflightHook.useDispatchPreflight.mockReturnValue(preflightState())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderStage(stageId: 'do' | 'check' | 'act', extra: Record<string, unknown> = {}): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(StageDrawerContent, { stageId, stage: null, onClose: vi.fn(), ...extra }),
        ),
      )
      await flush()
    })
  }

  it('asks before Retry re-dispatches, then sends the project id (QA 43)', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/fixes')
        return {
          ok: true,
          data: {
            fixes: [
              {
                id: 'fix-1',
                report_id: 'report-9',
                project_id: 'project-7',
                status: 'failed',
                report_fix_state: 'failed',
                is_latest_attempt: true,
                retryable: true,
                report_title: 'Login loops forever',
              },
            ],
          },
        }
      if (path === '/v1/admin/fixes/dispatches') return { ok: true, data: { dispatches: [] } }
      if (path === '/v1/admin/fixes/dispatch') return { ok: true, data: {} }
      return { ok: false, error: { code: 'UNEXPECTED' } }
    })
    await renderStage('do')

    await act(async () => {
      buttonByText('Retry')?.click()
      await flush()
    })
    expect(dispatchCalls()).toHaveLength(0)
    expect(document.body.textContent).toContain('Retry the auto-fix?')

    await act(async () => {
      buttonByText('Retry fix')?.click()
      await flush()
    })
    expect(dispatchCalls()).toHaveLength(1)
    expect(JSON.parse((dispatchCalls()[0]![1] as { body: string }).body)).toEqual({
      reportId: 'report-9',
      projectId: 'project-7',
    })
  })

  it('reads judge_score and classification_agreed and names the report (QA 170)', async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/admin/judge/evaluations'))
        return {
          ok: true,
          data: {
            evaluations: [
              {
                id: 'ev-1',
                report_id: 'report-1',
                judge_score: 0.84,
                classification_agreed: false,
                report_summary: 'Checkout button does nothing',
                created_at: '2026-10-01T00:00:00Z',
              },
            ],
          },
        }
      return { ok: false, error: { code: 'UNEXPECTED' } }
    })
    await renderStage('check')
    const text = document.body.textContent ?? ''
    expect(text).toContain('84%')
    expect(text).toContain('Checkout button does nothing')
    expect(text).not.toContain('report-1')
  })

  it('lists the dashboard integrations it is given (QA 171)', async () => {
    await renderStage('act', {
      integrations: [
        { kind: 'github', lastStatus: 'ok', lastAt: null, uptime: 1, severity: 'ok' },
        { kind: 'claude_code_agent', lastStatus: 'down', lastAt: null, uptime: 0, severity: 'red' },
      ],
    })
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('No health checks')
    expect(text).toContain('github')
    expect(text).toContain('claude code agent')
    expect(text).toContain('Failing')
    expect(api.apiFetch).not.toHaveBeenCalledWith('/v1/admin/integrations/platform')
  })
})
