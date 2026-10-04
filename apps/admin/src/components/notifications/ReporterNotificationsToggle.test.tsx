/**
 * @vitest-environment jsdom
 *
 * "Enable reporter notifications" pointed at Settings, which had no such
 * control (suspected-bugs entry 118). The switch lives on Notifications →
 * Setup and only reports success when the setting reads back changed.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { ReporterNotificationsToggle } from './ReporterNotificationsToggle'

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

describe('ReporterNotificationsToggle', () => {
  let container: HTMLDivElement
  let root: Root
  const onChanged = vi.fn()

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    onChanged.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(ReporterNotificationsToggle, { enabled: false, onChanged })))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function toggle(): HTMLButtonElement {
    return container.querySelector('button')!
  }

  it('turns updates on and confirms it from the saved setting', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? { ok: true } : { ok: true, data: { reporter_notifications_enabled: true } },
    )
    await act(async () => toggle().click())
    await flush()
    const patch = mocks.apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ reporter_notifications_enabled: true })
    expect(container.textContent).toContain('Reporters now get updates in the bug widget.')
    expect(onChanged).toHaveBeenCalled()
  })

  it('says "not saved" when the server answered ok but kept nothing', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? { ok: true } : { ok: true, data: { reporter_notifications_enabled: false } },
    )
    await act(async () => toggle().click())
    await flush()
    expect(container.textContent).toContain('Not saved')
  })

  it('says it could not confirm when the read-back fails, not "not saved"', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? { ok: true } : { ok: false, error: { code: 'HTTP_ERROR', message: '503: down' } },
    )
    await act(async () => toggle().click())
    await flush()
    expect(container.textContent).toContain("Saved, but Mushi couldn't confirm it")
    expect(container.textContent).not.toContain('Not saved')
  })

  it("shows the server's refusal for a non-admin", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only organization owners and admins can turn reporter updates on or off.' },
    })
    await act(async () => toggle().click())
    await flush()
    expect(container.textContent).toContain('Only organization owners and admins')
  })
})
