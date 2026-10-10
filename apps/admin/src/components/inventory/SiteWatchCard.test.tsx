/**
 * @vitest-environment jsdom
 *
 * "Watch your live site" (ADR 0024): turn on with the suggested URL, show
 * the watch and the pages broken right now, run a check, turn off.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  data: null as unknown,
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: mocks.data, loading: false, error: null, reload: mocks.reload }),
}))

import { SiteWatchCard } from './SiteWatchCard'

const WATCH = {
  id: 'w1',
  base_url: 'https://kensaur.us/yen-yen',
  page_limit: 25,
  status: 'active',
  last_checked_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  last_summary: { totalPages: 24, broken: 1 },
  last_error: null,
  estimated_credits_per_month: 900,
}

describe('SiteWatchCard', () => {
  let container: HTMLDivElement
  let root: Root
  const buttons = () => Array.from(container.querySelectorAll('button'))
  const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text)

  async function render() {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(SiteWatchCard, { projectId: 'p1' }))))
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue({ ok: true, data: {} })
    mocks.reload.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('asks for a Firecrawl key when the app has none', async () => {
    mocks.data = { watch: null, openPages: [], suggestedUrl: null, firecrawlReady: false }
    await render()
    expect(container.textContent).toContain('Needs a Firecrawl key')
    expect(button('Turn on')).toBeUndefined()
  })

  it('turns on with the suggested URL', async () => {
    mocks.data = { watch: null, openPages: [], suggestedUrl: 'https://kensaur.us/yen-yen', firecrawlReady: true }
    await render()
    await act(async () => button('Turn on')!.click())
    const input = container.querySelector('input[type=url]') as HTMLInputElement
    expect(input.value).toBe('https://kensaur.us/yen-yen')
    await act(async () => (container.querySelector('form') as HTMLFormElement).requestSubmit())
    const [path, init] = mocks.apiFetch.mock.calls[0]!
    expect(path).toBe('/v1/admin/projects/p1/site-watch')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ baseUrl: 'https://kensaur.us/yen-yen', pageLimit: 25 })
    expect(mocks.reload).toHaveBeenCalled()
  })

  it('shows the watch, its cost and the pages broken right now', async () => {
    mocks.data = {
      watch: WATCH,
      openPages: [
        { id: 'pg1', url: 'https://kensaur.us/yen-yen/pricing', problem: 'http_error', status_code: 500, detail: 'The page returned HTTP 500 (server error).', last_seen_at: WATCH.last_checked_at, report_id: 'r9' },
      ],
      suggestedUrl: null,
      firecrawlReady: true,
    }
    await render()
    expect(container.querySelector('[data-testid="mushi-site-watch-card"]')).toBeTruthy()
    expect(container.textContent).toContain('Watching https://kensaur.us/yen-yen')
    expect(container.textContent).toContain('up to 900 Firecrawl credits a month')
    // The count comes from the open list, not the last check's summary.
    expect(container.textContent).toContain('24 pages. 1 broken right now.')
    expect(container.textContent).toContain('/yen-yen/pricing')
    expect(container.querySelector('a[href="/reports/r9"]')).toBeTruthy()
  })

  it('shows a watch whose monitor is gone as needing attention, with the reason', async () => {
    mocks.data = {
      watch: { ...WATCH, status: 'error', last_error: 'The Firecrawl monitor no longer exists. Turn the watch off and on again.' },
      openPages: [],
      suggestedUrl: null,
      firecrawlReady: true,
    }
    await render()
    expect(container.textContent).toContain('needs attention')
    expect(container.textContent).toContain('The Firecrawl monitor no longer exists')
    expect(container.textContent).toContain('Nothing broken right now.')
  })

  it('runs a check now and turns off', async () => {
    mocks.data = { watch: WATCH, openPages: [], suggestedUrl: null, firecrawlReady: true }
    await render()
    await act(async () => button('Check now')!.click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/site-watch/run', { method: 'POST' })
    await act(async () => button('Turn off')!.click())
    // Asks first.
    expect(mocks.apiFetch).not.toHaveBeenCalledWith('/v1/admin/projects/p1/site-watch', { method: 'DELETE' })
    expect(document.body.textContent).toContain('Turn off the live-site watch?')
    const confirm = Array.from(document.body.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Turn off').pop()!
    await act(async () => confirm.click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/projects/p1/site-watch', { method: 'DELETE' })
  })

  it('keeps Turn off reachable without a Firecrawl key, so the monitor can still be stopped', async () => {
    mocks.data = { watch: WATCH, openPages: [], suggestedUrl: null, firecrawlReady: false }
    await render()
    expect(button('Turn off')).toBeTruthy()
    expect(button('Check now')).toBeUndefined()
  })

  it('the pages field accepts what is typed and refuses an out-of-range value', async () => {
    mocks.data = { watch: null, openPages: [], suggestedUrl: 'https://kensaur.us/yen-yen', firecrawlReady: true }
    await render()
    await act(async () => button('Turn on')!.click())
    const field = container.querySelector('input[type=number]') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(field, '150')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('Between 1 and 100.')
    const submit = Array.from(container.querySelectorAll('form button')).find((b) => b.textContent?.trim() === 'Turn on') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
