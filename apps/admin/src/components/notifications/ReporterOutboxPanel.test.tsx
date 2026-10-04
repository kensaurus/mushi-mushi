/**
 * @vitest-environment jsdom
 *
 * Notifications → Outbox "Discard" (suspected-bugs entry 28) dropped a held
 * reporter update in one click. It now asks first and shows the message.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const MESSAGE = {
  id: 'm-1',
  report_id: null,
  report_title: null,
  notification_type: 'fixed',
  text: 'Your bug is fixed in v2.1.',
  body_override: null,
  created_at: '2026-10-04T00:00:00Z',
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path?.startsWith('/v1/admin/reporter-outbox') ? { messages: [MESSAGE] } : { mode: 'review' },
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { ReporterOutboxPanel } from './ReporterOutboxPanel'

function button(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}

function discardCalls() {
  return mocks.apiFetch.mock.calls.filter(([p]) => String(p).endsWith('/discard'))
}

describe('ReporterOutboxPanel discard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ReporterOutboxPanel, { projectId: 'p-1' })))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('asks before discarding and shows the message that would be lost', async () => {
    await act(async () => button('Discard').click())
    expect(discardCalls()).toHaveLength(0)
    expect(document.body.textContent).toContain('Discard this update?')
    expect(document.body.textContent).toContain('The reporter will never get it')
    await act(async () => button('Keep it').click())
    expect(discardCalls()).toHaveLength(0)
  })

  it('discards only after the confirm', async () => {
    await act(async () => button('Discard').click())
    await act(async () => button('Discard update').click())
    expect(discardCalls()).toHaveLength(1)
    expect(discardCalls()[0]![0]).toBe('/v1/admin/reporter-outbox/m-1/discard')
  })
})
