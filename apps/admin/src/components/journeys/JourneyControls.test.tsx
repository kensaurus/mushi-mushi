/**
 * @vitest-environment jsdom
 *
 * The scan and the recording window show their state as status pills
 * (2026-11-18): scanning pulses, a finished scan is ✓, a failed one ✕,
 * recording runs, off is idle.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingCard, ScanBar } from './JourneyControls'
import type { JourneyScan, JourneysData } from '../../lib/journeys'

vi.mock('../../lib/supabase', () => ({ apiFetchMutate: vi.fn() }))

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

const scan = (status: JourneyScan['status']): JourneyScan => ({
  id: 's1',
  status,
  baseUrl: 'https://app.example',
  pageCount: 12,
  error: status === 'failed' ? 'Firecrawl said no' : null,
  createdAt: '2026-11-18T00:00:00Z',
  finishedAt: status === 'running' ? null : '2026-11-18T00:05:00Z',
})

function data(over: Partial<JourneysData>): JourneysData {
  return { days: 30, liveUrl: 'https://app.example', scan: null, mapScan: null, recording: { until: null, sampleRate: 0.1 }, map: {} as JourneysData['map'], ...over }
}

function render(el: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(MemoryRouter, null, el)))
}
const pill = (sel: string) => host.querySelector(`${sel} [data-testid="status-pill"]`)

describe('journey controls', () => {
  it('marks the scan state', () => {
    for (const [status, mark] of [['running', 'running'], ['done', 'passed'], ['failed', 'failed']] as const) {
      render(createElement(ScanBar, { data: data({ scan: scan(status), mapScan: status === 'running' ? null : scan('done') }), projectId: 'p1', onStarted: vi.fn() }))
      expect(pill('[data-testid="journey-scan-state"]')?.getAttribute('data-status')).toBe(mark)
    }
    // No scan yet: no state to mark, just what a scan does.
    render(createElement(ScanBar, { data: data({}), projectId: 'p1', onStarted: vi.fn() }))
    expect(pill('[data-testid="journey-scan-state"]')).toBeNull()
  })

  it('marks recording on and off', () => {
    render(createElement(RecordingCard, { data: data({ recording: { until: '2026-11-19T00:00:00Z', sampleRate: 0.1 } }), projectId: 'p1', onChanged: vi.fn() }))
    expect(pill('[data-testid="journey-recording"]')?.getAttribute('data-status')).toBe('running')
    render(createElement(RecordingCard, { data: data({}), projectId: 'p1', onChanged: vi.fn() }))
    expect(pill('[data-testid="journey-recording"]')?.textContent).toBe('Off')
  })
})
