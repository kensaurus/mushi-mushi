/**
 * @vitest-environment jsdom
 *
 * A fix row shows its state and its CI as status marks (2026-11-18): running
 * pulses blue, merged is a green ✓, failed a red ✕, a machine that never came
 * is waiting (never passed or failed), and a vital in the summary is a graded
 * badge.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixRowView } from './FixRowView'
import { ciRunStatus, fixRunStatus } from './fixRunStatus'
import type { FixAttempt } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function fix(over: Partial<FixAttempt>): FixAttempt {
  return { id: 'f1', report_id: 'r1', agent: 'cursor_cloud', status: 'completed', started_at: '2026-11-18T00:00:00Z', ...over } as FixAttempt
}

function render(f: FixAttempt) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement('table', null, createElement('tbody', null, createElement(FixRowView, { fix: f, index: 0, isExpanded: false, isInFlight: false, onToggle: vi.fn(), onRetry: vi.fn() }))),
      ),
    )
  })
}

const pills = () => [...host.querySelectorAll('[data-testid="status-pill"]')].map((p) => [p.getAttribute('data-status'), p.textContent])

describe('fix states as marks', () => {
  it('maps every fix and dispatch state to one status', () => {
    expect(fixRunStatus('running')).toBe('running')
    expect(fixRunStatus('queued')).toBe('waiting')
    expect(fixRunStatus('merged')).toBe('passed')
    expect(fixRunStatus('dead_letter')).toBe('failed')
    expect(fixRunStatus('cancelled')).toBe('cancelled')
    expect(fixRunStatus('skipped_no_sandbox')).toBe('idle')
    expect(fixRunStatus('completed_no_pr')).toBe('slow')
    expect(fixRunStatus(null)).toBe('idle')
  })

  it('maps CI, and an untested run is waiting', () => {
    expect(ciRunStatus(fix({ check_run_conclusion: 'success' }))?.status).toBe('passed')
    expect(ciRunStatus(fix({ check_run_conclusion: 'failure' }))?.status).toBe('failed')
    expect(ciRunStatus(fix({ check_run_status: 'in_progress' }))?.status).toBe('running')
    expect(ciRunStatus(fix({}))).toBeNull()
    const untested = fix({ check_run_conclusion: 'failure', ci_infra: { infra: true } as FixAttempt['ci_infra'] })
    expect(ciRunStatus(untested)?.status).toBe('waiting')
  })

  it('a row draws its state and CI as pills', () => {
    render(fix({ status: 'failed', check_run_conclusion: 'failure' }))
    expect(pills()).toEqual(expect.arrayContaining([['failed', 'Failed'], ['failed', 'CI: failure']]))
    render(fix({ status: 'running', check_run_status: 'in_progress' }))
    expect(pills()).toEqual(expect.arrayContaining([['running', 'Running'], ['running', 'CI: in progress']]))
  })

  it('grades a vital in the summary', () => {
    render(fix({ summary: 'Homepage LCP 6408ms after the hero change' }))
    expect(host.querySelector('[data-testid="vital-LCP"]')).not.toBeNull()
  })
})
