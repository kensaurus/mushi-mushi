/**
 * @vitest-environment jsdom
 *
 * "Others who hit this": "Search again" runs the lookup now, and a report
 * with an error but no results yet offers "Search now". Reports without an
 * error (feature requests, UX notes) show nothing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))

import { KnownIssuesSection, reportHasSearchableError } from './KnownIssuesSection'

const sentryError = {
  description: 'Error: Request was aborted. in analyze (captured by Sentry)\n\nmore',
  console_logs: null,
  custom_metadata: { source: 'sentry_webhook' },
}

describe('reportHasSearchableError', () => {
  it('is true for a Sentry exception or an error-level console line', () => {
    expect(reportHasSearchableError(sentryError)).toBe(true)
    expect(
      reportHasSearchableError({
        description: 'Button broken',
        console_logs: [{ level: 'error', message: 'TypeError: x is undefined', timestamp: 1 }],
        custom_metadata: null,
      }),
    ).toBe(true)
  })

  it('is false for telemetry messages and plain feedback', () => {
    expect(reportHasSearchableError({ ...sentryError, description: 'Poor TTFB: 2467 on /account' })).toBe(false)
    expect(reportHasSearchableError({ description: 'Add dark mode', console_logs: [], custom_metadata: null })).toBe(false)
  })
})

describe('KnownIssuesSection', () => {
  let container: HTMLDivElement
  let root: Root
  const onReload = vi.fn()

  async function render(report: Parameters<typeof KnownIssuesSection>[0]['report']) {
    await act(async () => root.render(createElement(KnownIssuesSection, { report, onReload })))
  }
  const button = (text: string) =>
    Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)

  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue({ ok: true, data: { attached: 2 } })
    onReload.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders nothing for a report without an error or results', async () => {
    await render({ id: 'r1', known_issues: [], description: 'Add dark mode', console_logs: [], custom_metadata: null })
    expect(container.textContent).toBe('')
  })

  it('offers "Search now" on an error report with no results, and reloads after', async () => {
    await render({ id: 'r1', known_issues: [], ...sentryError })
    await act(async () => button('Search now')!.click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/reports/r1/known-issues', { method: 'POST' })
    expect(mocks.toast.success).toHaveBeenCalledWith('2 new results', 'Added below.')
    expect(onReload).toHaveBeenCalled()
  })

  it('shows results with "Search again"', async () => {
    await render({
      id: 'r1',
      known_issues: [{ id: 's1', url: 'https://github.com/o/r/pull/9', title: 'Fix abort', snippet: 'merged', attached_by: null }],
      ...sentryError,
    } as never)
    expect(container.textContent).toContain('Fix abort')
    expect(container.textContent).toContain('github.com/o/r')
    expect(button('Search again')).toBeTruthy()
  })
})
