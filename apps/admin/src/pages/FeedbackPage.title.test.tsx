/**
 * @vitest-environment jsdom
 */

/**
 * 2026-11-21: the Help & support browser tab read "Help & support · Overview · 0 submissions ·
 * 0 active". It now follows the shared tab-title rule (lib/pageTitle.ts, as #1206 did for eight
 * pages): the page name, then the tab when it is not the first one, and no counts.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const published = vi.hoisted(() => [] as Array<{ route: string; title: string; summary?: string }>)

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: false, error: null, errorCode: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false }),
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({
  usePublishPageContext: (ctx: { route: string; title: string; summary?: string }) => {
    published.push(ctx)
  },
}))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ loading: false, has: () => true, planName: 'pro' }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { status: 0, heroOrSnapshot: 1 } }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('header', null, children as never),
}))

import { FeedbackPage } from './FeedbackPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  published.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function titleAt(path: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(FeedbackPage)))
  })
  return published.at(-1)!
}

describe('Help & support tab title', () => {
  it('is the page name on the first tab, with no counts', async () => {
    const ctx = await titleAt('/feedback')
    expect(ctx.route).toBe('/feedback')
    expect(ctx.title).toBe('Help & support')
    expect(ctx.summary).toBeUndefined()
  })

  it('adds the tab after the page name on another tab', async () => {
    expect((await titleAt('/feedback?tab=active')).title).toBe('Help & support · Active')
  })

  it('names each tab by its label', async () => {
    expect((await titleAt('/feedback?tab=shipped')).title).toBe('Help & support · Shipped')
  })
})
