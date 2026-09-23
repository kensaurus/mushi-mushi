/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/NotificationPrefsMatrix.test.tsx
 * PURPOSE: The matrix renders the project's effective preferences, and hides
 *          itself only when they could not be loaded.
 *
 * Why (2026-09-23): the fix that stopped a failed load from rendering
 * all-ON defaults also treated a successful load with
 * `notificationPrefs: null` (a project that never saved prefs) as a failure,
 * so those projects could not configure notifications at all. Null means
 * "server defaults", which are exactly DEFAULT_PREFS.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => api)

import { NotificationPrefsMatrix } from './NotificationPrefsMatrix'

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function switches(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'))
}

describe('NotificationPrefsMatrix', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(NotificationPrefsMatrix, { projectId: PROJECT }))
      await flush()
    })
  }

  it('renders every toggle ON when the project has never saved prefs', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: { notificationPrefs: null } })
    await render()

    const toggles = switches(container)
    expect(toggles).toHaveLength(8)
    expect(toggles.every((t) => t.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(container.textContent).not.toContain("Couldn't load")
  })

  it('reflects saved prefs, defaulting the keys a project never set', async () => {
    api.apiFetch.mockResolvedValue({
      ok: true,
      data: { notificationPrefs: { 'fix.failed': false } },
    })
    await render()

    const fixFailed = container.querySelector('button[aria-label="Fix attempt failed"]')
    const fixMerged = container.querySelector('button[aria-label="Fix merged"]')
    expect(fixFailed?.getAttribute('aria-checked')).toBe('false')
    expect(fixMerged?.getAttribute('aria-checked')).toBe('true')
  })

  it('hides the toggles and offers Retry when the request fails', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'INTERNAL' } })
    await render()

    expect(switches(container)).toHaveLength(0)
    expect(container.textContent).toContain("Couldn't load notification preferences")
    expect(container.textContent).toContain('Retry')
  })
})
