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
    expect(JSON.parse((dispatchCalls()[0]![1] as { body: string }).body)).toEqual({ reportId: 'report-1' })
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
