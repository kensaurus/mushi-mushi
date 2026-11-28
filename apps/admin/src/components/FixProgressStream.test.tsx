/**
 * FILE: apps/admin/src/components/FixProgressStream.test.tsx
 * PURPOSE: The fix progress card on a report. An agent's answer ("already
 *          fixed", "nothing to change") is quoted once by the recommendation
 *          above it; the card must not print it again as a red "Attempt error"
 *          (journey walk, 2026-11-28: the same verdict showed three times).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../lib/supabase', () => ({ apiFetch: api.fetch }))
vi.mock('../lib/usePlatformIntegrations', () => ({ usePlatformIntegrations: () => ({ traceUrl: () => null }) }))

import { FixProgressStream } from './FixProgressStream'
import type { DispatchState } from '../lib/dispatchFix'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.fetch.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

let n = 0
async function renderWith(attempt: Record<string, unknown>) {
  // A new report id each time, so the card fetches the new attempt.
  n += 1
  api.fetch.mockResolvedValue({ ok: true, data: { fixes: [{ id: 'f1', agent: 'cursor_cloud', started_at: '2026-11-28T00:00:00Z', ...attempt }] } })
  const state = { status: 'completed' } as unknown as DispatchState
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(FixProgressStream, { reportId: `r${n}`, dispatchState: state })))
  })
}

describe('FixProgressStream', () => {
  it('names the card in plain words, not "PDCA loop"', async () => {
    await renderWith({ status: 'completed' })
    expect(container.textContent).toContain('Fix progress')
    expect(container.textContent).not.toContain('PDCA')
  })

  it('does not repeat an agent verdict as an "Attempt error"', async () => {
    await renderWith({ status: 'failed', error: 'Agent found nothing to change: the guard is already in place.' })
    expect(container.textContent).not.toContain('Attempt error')
    await renderWith({ status: 'failed', failure_category: 'not_actionable', error: 'No code to tie this to.' })
    expect(api.fetch).toHaveBeenLastCalledWith(expect.stringContaining('report_id=r'))
    expect(container.textContent).not.toContain('Attempt error')
    expect(container.textContent).not.toContain('No code to tie this to.')
  })

  it('still shows a real error', async () => {
    await renderWith({ status: 'failed', error: 'GitHub API 502 while pushing the branch' })
    expect(container.textContent).toContain('Attempt error')
    expect(container.textContent).toContain('GitHub API 502')
  })
})
