/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/releases/AutoReleaseCard.test.tsx
 * PURPOSE: The auto-release opt-in is off by default, writes only
 *          `auto_release_enabled` when toggled, and is disabled (not a dead
 *          switch) when the server does not know the setting yet.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { AutoReleaseCard } from './AutoReleaseCard'

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('AutoReleaseCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<HTMLButtonElement> {
    await act(async () => {
      root.render(createElement(AutoReleaseCard, { projectId: PROJECT }))
      await flush()
    })
    return container.querySelector<HTMLButtonElement>('button[role="switch"]')!
  }

  it('shows the saved OFF state and turns it on with a one-field PATCH', async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: { auto_release_enabled: false } })
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: {} })
    const toggle = await render()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(false)

    await act(async () => {
      toggle.click()
      await flush()
    })
    expect(api.apiFetch).toHaveBeenLastCalledWith('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ auto_release_enabled: true }),
    })
    expect(container.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(toast.success).toHaveBeenCalledWith('Auto-release is on')
  })

  it('keeps the old state and reports the error when the save is refused', async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: { auto_release_enabled: true } })
    api.apiFetch.mockResolvedValueOnce({ ok: false, error: { message: 'Project admins only' } })
    const toggle = await render()
    await act(async () => {
      toggle.click()
      await flush()
    })
    expect(container.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(toast.error).toHaveBeenCalledWith('Could not change auto-release', 'Project admins only')
  })

  it('is disabled with an explanation when the server has no such setting yet', async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, data: { stage2_model: 'claude-sonnet-5-5' } })
    const toggle = await render()
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).toContain('after the next server update')
  })
})
