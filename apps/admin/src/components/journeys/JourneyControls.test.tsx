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
import { RecordingCard, SCAN_NEEDS_URL, ScanBar } from './JourneyControls'
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

  // Fresh-eyes sweep 2026-11-18: an empty address field and a disabled Scan button with no reason.
  it('says why Scan my site is disabled when no address is on file', () => {
    render(createElement(ScanBar, { data: data({ liveUrl: null }), projectId: 'p1', onStarted: vi.fn() }))
    expect(host.querySelector<HTMLButtonElement>('[data-testid="journey-scan"]')?.disabled).toBe(true)
    expect(host.querySelector('[data-testid="journey-scan-why"]')?.textContent).toBe(SCAN_NEEDS_URL)
  })

  it('prefills the address on file and shows no reason', () => {
    render(createElement(ScanBar, { data: data({}), projectId: 'p1', onStarted: vi.fn() }))
    expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://app.example')
    expect(host.querySelector('[data-testid="journey-scan-why"]')).toBeNull()
  })

  it('keeps the on-demand recording note to one line', () => {
    render(createElement(RecordingCard, { data: data({}), projectId: 'p1', onChanged: vi.fn() }))
    const hint = host.querySelector('[data-testid="journey-recording-hint"]')!
    expect(hint.className).toContain('truncate')
    expect(hint.getAttribute('title')).toContain('Nobody is recorded until you start')
  })

  it('marks recording on and off', () => {
    render(createElement(RecordingCard, { data: data({ recording: { until: '2026-11-19T00:00:00Z', sampleRate: 0.1 } }), projectId: 'p1', onChanged: vi.fn() }))
    expect(pill('[data-testid="journey-recording"]')?.getAttribute('data-status')).toBe('running')
    render(createElement(RecordingCard, { data: data({}), projectId: 'p1', onChanged: vi.fn() }))
    expect(pill('[data-testid="journey-recording"]')?.textContent).toBe('Off')
  })

  // Round-2 review: the field was empty although the SDK's origin was known,
  // the reason was amber, the two choices had no names, and the on-demand
  // card sat open for apps on the default.
  it('falls back to the SDK origin, and the typed address wins', () => {
    render(createElement(ScanBar, { data: data({ liveUrl: null }), projectId: 'p1', onStarted: vi.fn(), fallbackUrl: 'https://kensaur.us' }))
    expect(host.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://kensaur.us')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="journey-scan"]')?.disabled).toBe(false)
  })

  it('gives the reason in neutral ink, not amber', () => {
    render(createElement(ScanBar, { data: data({ liveUrl: null }), projectId: 'p1', onStarted: vi.fn() }))
    expect(host.querySelector('[data-testid="journey-scan-why"]')?.className).not.toMatch(/warn/)
  })

  it('names Duration and Sample, and folds the card unless recording', () => {
    render(createElement(RecordingCard, { data: data({}), projectId: 'p1', onChanged: vi.fn() }))
    expect(host.querySelector('[data-testid="journey-recording-duration"]')?.textContent).toContain('Duration')
    expect(host.querySelector('[data-testid="journey-recording-sample"]')?.textContent).toContain('Sample')
    expect(host.querySelector<HTMLDetailsElement>('[data-testid="journey-recording"] details')?.open).toBe(false)
    render(createElement(RecordingCard, { data: data({ recording: { until: '2026-11-19T00:00:00Z', sampleRate: 0.1 } }), projectId: 'p1', onChanged: vi.fn() }))
    expect(host.querySelector<HTMLDetailsElement>('[data-testid="journey-recording"] details')?.open).toBe(true)
  })
})

