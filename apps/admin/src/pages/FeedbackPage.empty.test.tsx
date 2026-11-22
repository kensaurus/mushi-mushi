/**
 * @vitest-environment jsdom
 *
 * Round-2 sweep 2026-11-18: with nothing sent, Help & support showed four tabs
 * and a Refresh over an empty state per tab, an app chip on an account-wide
 * inbox, and on a phone pointed at a "Request feature" button hidden under
 * More. It is now one empty state with both actions, visible at every width.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_FEEDBACK_STATS } from '../components/feedback/types'

const header = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { loading: false, error: null, errorCode: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false }
    if (path?.includes('stats')) return { ...base, data: { ...EMPTY_FEEDBACK_STATS, hasAnyProject: true, projectName: 'Shop', totalTickets: 0, topPriority: 'first_submit' } }
    return { ...base, data: null }
  },
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ loading: false, has: () => true, planName: 'pro' }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: (props: { children?: unknown }) => {
    header.props = props as Record<string, unknown>
    return createElement('header', { 'data-testid': 'hdr' }, props.children as never)
  },
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

describe('FeedbackPage with nothing sent', () => {
  it('is one empty state with both actions, no tabs, no Refresh, no app chip', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/feedback'] }, createElement(FeedbackPage)))
    })
    const actions = host.querySelector('[data-testid="feedback-empty-actions"]')!
    expect([...actions.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Report a bug', 'Request feature'])
    expect(actions.closest('.hidden')).toBeNull()
    expect(host.querySelector('[aria-label="Feedback sections"]')).toBeNull()
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Report a bug')).toHaveLength(1)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Refresh')).toBe(false)
    expect(host.textContent).not.toContain('at the top')
    expect(header.props?.projectScope).toBeUndefined()
  })
})
