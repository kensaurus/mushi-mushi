/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/pages/TesterSubmissionsReviewPage.listing.test.tsx
 * PURPOSE: Round-2 sweep (2026-11-18): the review page says when the listing is not
 *          published, is named like the Bounties button that opens it, and the Accepted
 *          filter's empty line no longer tells you to "Publish your app".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listing: null as unknown }))

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ data: mocks.listing, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => createElement('header', null, createElement('h1', null, title), children as never),
}))
vi.mock('../components/report-detail/TesterSubmissionCard', () => ({ TesterSubmissionCard: () => null }))

import { TesterSubmissionsReviewPage } from './TesterSubmissionsReviewPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(TesterSubmissionsReviewPage)))
  })
}

describe('TesterSubmissionsReviewPage listing state', () => {
  it('says the listing is not published, once, and names the page like its button', async () => {
    mocks.listing = { visibility: 'draft' }
    await render()
    expect(host.querySelector('h1')?.textContent).toBe('Review submissions')
    expect(host.querySelector('[data-testid="tester-review-unpublished"]')?.textContent).toContain('not published')
    // Unpublished and empty: said once, with no tabs, no "0 submissions" chip and no second line.
    expect(host.textContent).not.toContain('once your listing is published')
    expect(host.textContent).not.toContain('0 submissions')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Accepted')).toBe(false)
    expect(host.textContent).not.toContain('Publish your app')
  })

  it('stays quiet about publishing when the listing is live', async () => {
    mocks.listing = { visibility: 'public' }
    await render()
    expect(host.querySelector('[data-testid="tester-review-unpublished"]')).toBeNull()
    expect(host.textContent).toContain('Nothing to review')
  })
})
