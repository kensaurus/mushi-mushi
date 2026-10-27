/**
 * @vitest-environment jsdom
 *
 * "What you shipped": the app's releases newest first, each with its fixes
 * and how many reporters were told. A missing credit summary reads
 * "unknown", never "0 told"; a draft says who is still to be told.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<string | null> }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: vi.fn(), lastFetchedAt: null }
  },
}))

import { ReleaseTimeline, RELEASE_TIMELINE_PATH, toldText, type TimelineRelease } from './ReleaseTimeline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rel = (over: Partial<TimelineRelease>): TimelineRelease => ({
  id: 'r1',
  version: '1.4.0',
  title: 'Checkout fixes',
  status: 'published',
  published_at: '2026-10-20T00:00:00Z',
  created_at: '2026-10-19T00:00:00Z',
  fixed_report_ids: ['a', 'b'],
  credited_reporter_ids: ['u1', 'u2', 'u3'],
  ...over,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.data = null
  state.error = null
  state.loading = false
  state.paths = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(onOpen = vi.fn()) {
  act(() => root.render(createElement(MemoryRouter, null, createElement(ReleaseTimeline, { onOpen }))))
  return onOpen
}

describe('toldText', () => {
  it('counts delivered messages, and says unknown without a summary', () => {
    expect(toldText(rel({ credit_summary: { credited: 3, told: 3 } })).text).toBe('All 3 reporters told')
    expect(toldText(rel({ credit_summary: { credited: 3, told: 1 } }))).toEqual({ text: '1 of 3 reporters told', tone: 'warnSubtle' })
    expect(toldText(rel({ credit_summary: { credited: 0, told: 0 } })).text).toBe('No reporters to tell')
    expect(toldText(rel({})).text).toBe('Reporters told: unknown')
    expect(toldText(rel({ status: 'draft' })).text).toBe('3 reporters to tell')
  })
})

describe('ReleaseTimeline', () => {
  it('asks the list for credit summaries and shows each release with its fixes', () => {
    state.data = [
      rel({ credit_summary: { credited: 3, told: 2 } }),
      rel({ id: 'r0', version: 'v1.3.0', status: 'draft', published_at: null, fixed_report_ids: [] }),
    ]
    const onOpen = render()
    expect(state.paths).toContain(RELEASE_TIMELINE_PATH)
    expect(RELEASE_TIMELINE_PATH).toContain('credits=1')
    const items = host.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('v1.4.0')
    expect(items[0].textContent).toContain('2 fixes')
    expect(items[0].textContent).toContain('2 of 3 reporters told')
    expect(items[1].textContent).toContain('v1.3.0')
    expect(items[1].textContent).not.toContain('vv1.3.0')
    expect(items[1].textContent).toContain('Draft')
    act(() => (items[0].querySelector('button') as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
  })

  it('renders nothing with no releases, and the error when the read fails', () => {
    state.data = []
    render()
    expect(host.querySelector('[data-testid="release-timeline"]')).toBeNull()
    state.error = 'Could not read releases'
    render()
    expect(host.textContent).toContain('Could not read releases')
  })
})
