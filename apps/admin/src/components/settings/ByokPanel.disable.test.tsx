/**
 * @vitest-environment jsdom
 *
 * Your AI keys → "Turn off" (suspected-bugs entry 251) took a working key out
 * of rotation in one click. It now asks first; turning a key on does not.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const ACTIVE = {
  id: 'key-1',
  provider_slug: 'anthropic',
  label: 'main',
  priority: 0,
  status: 'active',
  key_hint: '…AbCd',
  base_url: null,
  test_status: 'ok',
  last_tested_at: '2026-10-03T00:00:00Z',
  last_used_at: null,
  cooldown_until: null,
  created_at: '2026-10-01T00:00:00Z',
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  keys: [] as unknown[],
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
    reload: mocks.reload,
  }),
}))

import { ByokPanel } from './ByokPanel'

function button(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}

function patches() {
  return mocks.apiFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
}

describe('ByokPanel turn off', () => {
  let container: HTMLDivElement
  let root: Root

  async function render() {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ByokPanel)))
    })
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('asks before turning a working key off', async () => {
    mocks.keys = [ACTIVE]
    await render()
    await act(async () => button('Turn off').click())
    expect(patches()).toHaveLength(0)
    expect(document.body.textContent).toContain('Turn off this Anthropic (Claude) key?')
    await act(async () => button('Keep it on').click())
    expect(patches()).toHaveLength(0)

    await act(async () => button('Turn off').click())
    await act(async () => button('Turn off key').click())
    expect(patches()).toHaveLength(1)
    expect(JSON.parse(String((patches()[0]![1] as RequestInit).body))).toEqual({ status: 'disabled' })
  })

  it('turns a tested key back on without a dialog', async () => {
    mocks.keys = [{ ...ACTIVE, status: 'disabled' }]
    await render()
    await act(async () => button('Turn on').click())
    expect(patches()).toHaveLength(1)
    expect(document.body.textContent).not.toContain('Turn off this')
  })
})
