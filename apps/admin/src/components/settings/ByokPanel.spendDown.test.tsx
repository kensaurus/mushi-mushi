/**
 * @vitest-environment jsdom
 *
 * Your AI keys → Cursor: removing a key emptied the key list but left the
 * removed key listed under "Spend down expiring credits", which reads from
 * its own endpoint. The section now refetches when the Cursor key list
 * changes.
 */

import { act, createElement } from 'react'
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
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, has: () => true, planName: 'Pro' }),
}))
vi.mock('./ByokPoolContext', () => ({
  useByokPool: () => ({
    data: { keys: mocks.keys, legacyKeys: [] },
    loading: false,
    error: null,
    reload: () => {},
  }),
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
      return { ok: true, data: {} }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('re-reads spend-down after a Cursor key is removed', async () => {
    mocks.keys = [cursorKey('key-1', '…a1b2'), cursorKey('key-2', '…c3d4')]
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
    expect(document.body.textContent).toContain('…a1b2')

    // The server deleted the key; the pool now returns one key, which is what
    // a reload() of the pool gives this panel.
    const remove = document.body.querySelector<HTMLButtonElement>('button[aria-label="Remove key …a1b2"]')
    if (!remove) throw new Error('no remove button for the first key')
    await act(async () => remove.click())
    await act(async () => button('Remove key').click())
    mocks.keys = [cursorKey('key-2', '…c3d4')]
    mocks.spendDownKeys = []
    await render()

    expect(spendDownReads()).toHaveLength(2)
    expect(document.body.querySelector('[aria-label="Spend down expiring credits"]')).toBeNull()
  })
})
