/**
 * @vitest-environment jsdom
 *
 * The report page's Pipeline strip: every stage drawn with its state, the
 * failed stage called out in plain words with the raw text behind Details,
 * Retry triage posts once and says what happened, and a refused retry says why.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  trail: null as unknown,
  posts: [] as Array<{ path: string; body: unknown }>,
}))

vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
    if (opts.method === 'POST') {
      state.posts.push({ path, body: opts.body ? JSON.parse(opts.body) : null })
      return { ok: true, data: { outcome: 'queued', message: 'Triage is running again. This page updates when it finishes.' } }
    }
    return { ok: true, data: state.trail }
  },
}))

import { ReportPipelineStrip } from './ReportPipelineStrip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LABELS: Record<string, string> = { received: 'Reported', triage: 'Quick check', diagnosis: 'Diagnosis', fix: 'Fix', pr: 'PR', ci: 'CI', merge: 'Merged', deploy: 'Live' }

function trail(triage: Record<string, unknown>) {
  return {
    reportId: 'r1',
    fixId: null,
    generatedAt: '2026-11-19T12:00:00Z',
    current: 'triage',
    failing: triage.state === 'failed' ? 'triage' : null,
    jobs: [{ id: 'q1', stage: 'stage1', status: 'failed', attempts: 2, maxAttempts: 3, lastError: 'Stage 1 failed: 401', createdAt: '2026-11-19T11:00:00Z', startedAt: null, completedAt: '2026-11-19T11:05:00Z' }],
    stages: Object.keys(LABELS).map((id) => ({
      id,
      label: LABELS[id],
      state: id === 'received' ? 'passed' : 'idle',
      startedAt: null,
      endedAt: null,
      durationMs: null,
      problem: null,
      detail: null,
      attempts: null,
      retry: null,
      skipped: false,
      note: null,
      ...(id === 'triage' ? triage : {}),
    })),
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  state.posts = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(onRetryDispatch = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ReportPipelineStrip, { reportId: 'r1', onRetryDispatch, dispatchBlock: { blocked: false, reason: null }, hasFixActions: false }),
      ),
    )
  })
  await act(async () => {})
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`)

describe('ReportPipelineStrip', () => {
  it('draws every stage and calls out the failed one in plain words, raw text behind Details', async () => {
    state.trail = trail({
      state: 'failed',
      durationMs: 300_000,
      problem: 'The AI key or the internal worker token was refused.',
      detail: 'Stage 1 failed: 401 {"error":"sk-[redacted]"}',
      attempts: { used: 2, max: 3 },
      retry: { kind: 'triage', allowed: true, reason: null },
    })
    await render()
    expect(container.querySelectorAll('li[data-testid^="trail-stage-"]')).toHaveLength(8)
    expect(q('trail-stage-triage')?.getAttribute('data-state')).toBe('failed')
    expect(q('trail-stage-triage')?.textContent).toContain('5 min')
    expect(q('report-pipeline-callout')?.textContent).toContain('The AI key or the internal worker token was refused.')
    expect(q('report-pipeline-callout')?.textContent).toContain('attempt 2/3')
    expect(q('report-pipeline-details')?.textContent).toContain('sk-[redacted]')
    expect(container.textContent).toContain('Failed at Quick check')
  })

  it('Retry triage posts once and shows the result inline', async () => {
    state.trail = trail({ state: 'failed', problem: 'Triage failed.', retry: { kind: 'triage', allowed: true, reason: null } })
    await render()
    const btn = q('report-pipeline-retry') as HTMLButtonElement
    expect(btn.textContent).toBe('Retry triage')
    await act(async () => btn.click())
    await act(async () => {})
    expect(state.posts).toEqual([{ path: '/v1/admin/reports/r1/pipeline/retry', body: { stage: 'triage' } }])
    expect(q('report-pipeline-result')?.textContent).toContain('Triage is running again')
  })

  it('a refused retry is disabled and says why', async () => {
    state.trail = trail({ state: 'slow', problem: 'Waited over 15 minutes.', retry: { kind: 'triage', allowed: false, reason: 'Triage is running for this report now.' } })
    await render()
    expect((q('report-pipeline-retry') as HTMLButtonElement).disabled).toBe(true)
    expect(q('report-pipeline-retry-why')?.textContent).toBe('Triage is running for this report now.')
  })

  it('a skipped stage reads "not needed", not a missing number', async () => {
    state.trail = trail({ state: 'idle', skipped: true, note: 'Sorted without an AI quick check.' })
    await render()
    expect(q('trail-stage-triage-time')?.textContent).toBe('not needed')
    expect(q('trail-stage-triage-time')?.getAttribute('title')).toBe('Sorted without an AI quick check.')
    expect(q('report-pipeline-callout')).toBeNull()
  })

  it('a moving report has no callout', async () => {
    state.trail = trail({ state: 'running', durationMs: 4_000 })
    await render()
    expect(q('report-pipeline-callout')).toBeNull()
    expect(q('trail-stage-triage')?.textContent).toContain('so far')
  })
})
