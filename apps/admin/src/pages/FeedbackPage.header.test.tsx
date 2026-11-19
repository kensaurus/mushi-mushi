/**
 * @vitest-environment jsdom
 */

/**
 * 2026-11-18 fresh-eyes (390px): the Help & support header wrapped, leaving
 * "Request feature" alone on a second row and the freshness pill on its own
 * line. On a phone the secondary action now sits under More and the pill is
 * hidden (the status card carries it); from sm up both stay inline.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: false, error: null, errorCode: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false }),
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ loading: false, has: () => true, planName: 'pro' }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { status: 0, heroOrSnapshot: 1 } }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('header', { 'data-testid': 'hdr' }, children as never),
}))

import { FeedbackPage } from './FeedbackPage'

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

describe('FeedbackPage header on a phone', () => {
  it('keeps one primary inline and moves Request feature under More below sm', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/feedback'] }, createElement(FeedbackPage)))
    })
    const hdr = host.querySelector('[data-testid="hdr"]')!
    const inline = hdr.querySelector('[data-testid="feedback-header-feature"]')!
    expect(inline.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:inline-flex']))
    const more = hdr.querySelector('[data-testid="feedback-header-more"]')!
    expect(more.className.split(/\s+/)).toContain('sm:hidden')
    await act(async () => { (more.querySelector('[data-testid="feedback-more"]') as HTMLButtonElement).click() })
    expect(more.querySelector('[data-testid="feedback-more-feature"]')?.textContent).toBe('Request feature')
    const report = [...hdr.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Report a bug')
    expect(report?.className).toContain('whitespace-nowrap')
  })
})
