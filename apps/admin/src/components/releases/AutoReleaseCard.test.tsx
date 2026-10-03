/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/releases/AutoReleaseCard.test.tsx
 * PURPOSE: The auto-release opt-in is off by default, writes only
 *          `auto_release_enabled` when toggled, and is disabled (not a dead
 *          switch) when the server does not know the setting yet. A stuck
 *          automatic draft (it pauses auto-release) is shown with a way to
 *          it, and a failed status read is an error, never "nothing stuck".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { AutoReleaseCard } from './AutoReleaseCard'

const PROJECT = '11111111-1111-4111-8111-111111111111'

type ApiReply = { ok: boolean; data?: unknown; error?: { message: string } }

/** Replies by path, so the card's two parallel reads cannot swap answers. */
function serve(settings: ApiReply, autoRelease: ApiReply = { ok: true, data: { blockingDraft: null } }, patch?: ApiReply) {
  api.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/v1/admin/releases/auto-release') return autoRelease
    if (init?.method === 'PATCH') return patch ?? { ok: true, data: {} }
    return settings
  })
}

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
      root.render(createElement(MemoryRouter, null, createElement(AutoReleaseCard, { projectId: PROJECT })))
      await flush()
    })
    return container.querySelector<HTMLButtonElement>('button[role="switch"]')!
  }

  it('shows the saved OFF state and turns it on with a one-field PATCH', async () => {
    serve({ ok: true, data: { auto_release_enabled: false } })
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
    serve({ ok: true, data: { auto_release_enabled: true } }, undefined, { ok: false, error: { message: 'Project admins only' } })
    const toggle = await render()
    await act(async () => {
      toggle.click()
      await flush()
    })
    expect(container.querySelector('button[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    expect(toast.error).toHaveBeenCalledWith('Could not change auto-release', 'Project admins only')
  })

  it('is disabled with an explanation when the server has no such setting yet', async () => {
    serve({ ok: true, data: { stage2_model: 'claude-sonnet-5-5' } })
    const toggle = await render()
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).toContain('after the next server update')
  })

  it('says auto-release is paused by a stuck automatic draft and links to Drafts', async () => {
    serve(
      { ok: true, data: { auto_release_enabled: true } },
      {
        ok: true,
        data: {
          blockingDraft: { id: 'rel-1', version: '1.4.0', createdAt: '2026-10-01T09:00:00Z', autoSource: 'recipe_event', stale: true },
        },
      },
    )
    await render()
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/admin/releases/auto-release')
    expect(container.textContent).toContain('Auto-release is paused')
    expect(container.textContent).toContain('1.4.0')
    const link = container.querySelector<HTMLAnchorElement>('a[href="/releases?tab=drafts"]')
    expect(link?.textContent).toContain('Open drafts')
  })

  it('a fresh automatic draft is "being published", not a pause', async () => {
    serve(
      { ok: true, data: { auto_release_enabled: true } },
      { ok: true, data: { blockingDraft: { id: 'rel-2', version: '1.5.0', createdAt: new Date().toISOString(), autoSource: 'github_release', stale: false } } },
    )
    await render()
    expect(container.textContent).not.toContain('Auto-release is paused')
    expect(container.textContent).toContain('Publishing the automatic release 1.5.0')
  })

  it('a failed status read shows an error instead of claiming nothing is stuck', async () => {
    serve({ ok: true, data: { auto_release_enabled: true } }, { ok: false, error: { message: 'reading automatic drafts failed: timeout' } })
    await render()
    expect(container.textContent).toContain('reading automatic drafts failed: timeout')
    expect(container.textContent).not.toContain('Auto-release is paused')
  })
})
