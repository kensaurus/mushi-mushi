/**
 * @vitest-environment jsdom
 *
 * Your AI keys → Cursor: removing a key emptied the key list but left the
 * removed key listed under "Spend down expiring credits" and selectable in
 * the "Review follow-ups" key picker, both of which read from their own
 * endpoint. Both sections now refetch when the Cursor key list changes.
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

function cursorKey(id: string, hint: string) {
  return {
    id,
    provider_slug: 'cursor',
    label: null,
    priority: 0,
    status: 'active',
    key_hint: hint,
    base_url: null,
    test_status: 'ok',
    last_tested_at: '2026-10-03T00:00:00Z',
    last_used_at: null,
    cooldown_until: null,
    created_at: '2026-10-01T00:00:00Z',
    scope: 'project',
  }
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  keys: [] as unknown[],
  spendDownKeys: [] as unknown[],
  followupKeys: [] as unknown[],
  reload: vi.fn(),
  /** Set by the mocked pool hook so `reload()` can re-render the panel. */
  rerender: null as null | (() => void),
  /** What the server now has, applied by `reload()` like the real pool does. */
  afterReload: null as null | (() => void),
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, has: () => true, planName: 'Studio' }),
  isByokLocked: () => false,
}))
// The real pool refetches on reload() and re-renders the panel with what the
// server now has. The mock does the same so the test walks the whole removal
// path instead of re-rendering by hand.
vi.mock('./ByokPoolContext', () => ({
  useByokPool: () => {
    const [, bump] = useState(0)
    mocks.rerender = () => bump((n) => n + 1)
    return {
      data: { keys: mocks.keys, legacyKeys: [] },
      loading: false,
      error: null,
      reload: mocks.reload,
    }
  },
}))

import { ByokPanel } from './ByokPanel'

function button(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}

function spendDownReads() {
  return mocks.apiFetch.mock.calls.filter(([path]) => path === '/v1/admin/byok/spend-down')
}

function followupReads() {
  return mocks.apiFetch.mock.calls.filter(([path]) => path === '/v1/admin/byok/review-followups')
}

describe('ByokPanel spend-down freshness', () => {
  let container: HTMLDivElement
  let root: Root

  async function render() {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ByokPanel)))
    })
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/byok/spend-down') {
        return { ok: true, data: { projectId: 'p', keys: mocks.spendDownKeys } }
      }
      if (path === '/v1/admin/byok/review-followups') {
        return {
          ok: true,
          data: {
            available: true,
            organizationId: 'org',
            canManage: true,
            settings: { enabled: false, keyId: null, model: null, dailyLimit: 30 },
            keys: mocks.followupKeys,
          },
        }
      }
      return { ok: true, data: {} }
    })
    mocks.reload.mockReset()
    mocks.reload.mockImplementation(() => {
      mocks.afterReload?.()
      mocks.rerender?.()
    })
    mocks.afterReload = null
    mocks.rerender = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('re-reads spend-down and the follow-ups key picker after a Cursor key is removed', async () => {
    mocks.keys = [cursorKey('key-1', '…a1b2'), cursorKey('key-2', '…c3d4')]
    mocks.followupKeys = [
      { id: 'key-1', label: null, keyHint: '…a1b2', scope: 'project', appName: 'glot.it', status: 'active' },
      { id: 'key-2', label: null, keyHint: '…c3d4', scope: 'project', appName: 'glot.it', status: 'active' },
    ]
    mocks.spendDownKeys = [
      {
        id: 'key-1',
        label: null,
        keyHint: '…a1b2',
        scope: 'project',
        status: 'active',
        enabled: false,
        creditsExpireAt: null,
        model: null,
        dailyLimit: 10,
        windowDays: 14,
        state: 'off',
        startsAt: null,
        dispatchedToday: 0,
        remainingToday: 0,
        projects: [],
        lastRunAt: null,
        lastSummary: null,
      },
    ]
    await render()
    expect(spendDownReads()).toHaveLength(1)
    expect(followupReads()).toHaveLength(1)
    expect(document.body.textContent).toContain('…a1b2')

    // The follow-ups key picker offers the key that is about to be removed.
    await act(async () => button('Change review follow-ups').click())
    expect(document.body.querySelector('option[value="key-1"]')).not.toBeNull()

    // What the server has once the delete lands: the pool's reload() returns
    // one key, and both sections' own endpoints answer without the removed one.
    mocks.afterReload = () => {
      mocks.keys = [cursorKey('key-2', '…c3d4')]
      mocks.spendDownKeys = []
      mocks.followupKeys = [
        { id: 'key-2', label: null, keyHint: '…c3d4', scope: 'project', appName: 'glot.it', status: 'active' },
      ]
    }
    const remove = document.body.querySelector<HTMLButtonElement>('button[aria-label="Remove key …a1b2"]')
    if (!remove) throw new Error('no remove button for the first key')
    await act(async () => remove.click())
    await act(async () => button('Remove key').click())

    expect(mocks.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Key removed.')
    expect(spendDownReads()).toHaveLength(2)
    expect(document.body.querySelector('[aria-label="Spend down expiring credits"]')).toBeNull()
    expect(followupReads()).toHaveLength(2)
    expect(document.body.querySelector('option[value="key-1"]')).toBeNull()
    expect(document.body.querySelector('option[value="key-2"]')).not.toBeNull()
  })
})
