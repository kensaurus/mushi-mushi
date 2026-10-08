/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/content-quality/ContentBulkDismiss.test.tsx
 * PURPOSE: Bulk dismiss on the Content checks page. The dialog states the
 *          exact number of rows from a server dry run (not the list total),
 *          needs a reason, sends the confirmed count, and recounts when the
 *          server says the count changed. No window.confirm anywhere.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P1 = '1000000a-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), onDismissed: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))

import { ContentBulkDismissBar, type ContentDismissFilter } from './ContentBulkDismiss'

const FILTER: ContentDismissFilter = { status: 'open', reason: 'user_flag', source: null }
const PATH = `/v1/admin/projects/${P1}/content-quality/dismiss`

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))
const button = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text))!

function typeReason(value: string): void {
  const el = document.body.querySelector('textarea')!
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ContentBulkDismissBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.onDismissed.mockReset()
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('window.confirm must not be used')
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(selectedIds: string[] = [], matchingTotal = 6081): Promise<void> {
    await act(async () => {
      root.render(
        createElement(ContentBulkDismissBar, {
          projectId: P1,
          selectedIds,
          matchingTotal,
          filter: FILTER,
          onDismissed: mocks.onDismissed,
        }),
      )
      await flush()
    })
  }

  async function click(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.click()
      await flush()
    })
  }

  it('"Dismiss selected" is off until a row is ticked', async () => {
    await render([])
    expect(button('Dismiss selected').disabled).toBe(true)
    await render(['a'])
    expect(button('Dismiss selected').disabled).toBe(false)
  })

  it('states the exact count from a dry run, requires a reason, then sends the confirmed count', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ ok: true, data: { matched: 6081, will_dismiss: 6081, max_rows: 10000 } })
      .mockResolvedValueOnce({ ok: true, data: { dismissed: 6081, matched: 6081, remaining: 0 } })
    await render()
    await click(button('Dismiss all 6,081 matching'))

    const [path, init] = mocks.apiFetch.mock.calls[0]
    expect(path).toBe(PATH)
    expect(bodyOf([path, init])).toEqual({ filter: FILTER, dry_run: true })
    expect(document.body.textContent).toContain('This dismisses exactly 6,081 rows.')

    // No reason: nothing is sent.
    await click(button('Dismiss 6,081'))
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('Say why these rows are noise')

    await act(async () => {
      typeReason('zero-signal flags from the re-queue bug')
      await flush()
    })
    await click(button('Dismiss 6,081'))
    expect(bodyOf(mocks.apiFetch.mock.calls[1])).toEqual({
      filter: FILTER,
      reason: 'zero-signal flags from the re-queue bug',
      expected_count: 6081,
    })
    expect(mocks.onDismissed).toHaveBeenCalledWith({ dismissed: 6081, matched: 6081, remaining: 0 })
  })

  it('says when one run cannot cover every matching row', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true, data: { matched: 12500, will_dismiss: 10000, max_rows: 10000 } })
    await render([], 12500)
    await click(button('Dismiss all 12,500 matching'))
    expect(document.body.textContent).toContain('This dismisses 10,000 of 12,500 matching rows')
    expect(document.body.textContent).toContain('Run it again for the rest.')
  })

  it('recounts and asks again when the server says the count changed', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ ok: true, data: { matched: 2, will_dismiss: 2, max_rows: 10000 } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'COUNT_CHANGED', message: 'changed' } })
      .mockResolvedValueOnce({ ok: true, data: { matched: 3, will_dismiss: 3, max_rows: 10000 } })
    await render(['a', 'b'])
    await click(button('Dismiss selected'))
    expect(bodyOf(mocks.apiFetch.mock.calls[0])).toEqual({ ids: ['a', 'b'], dry_run: true })
    await act(async () => {
      typeReason('seed rows')
      await flush()
    })
    await click(button('Dismiss 2'))
    expect(bodyOf(mocks.apiFetch.mock.calls[1])).toMatchObject({ ids: ['a', 'b'], expected_count: 2 })
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain('The number of matching rows changed')
    expect(document.body.textContent).toContain('This dismisses exactly 3 rows.')
    expect(mocks.onDismissed).not.toHaveBeenCalled()
  })
})
