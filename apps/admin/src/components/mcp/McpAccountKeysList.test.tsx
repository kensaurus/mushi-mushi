/**
 * Account keys have no project, so no project's Keys page lists them: this
 * list shows them and revokes one (ADR 0026).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))
const apiFetch = vi.fn()
vi.mock('../../lib/supabase', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))
const reload = vi.fn()
const page = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: page.data, loading: false, error: null, reload }),
}))

import { McpAccountKeysList, accountKeyReach } from './McpAccountKeysList'

const KEYS = [
  { id: 'k1', prefix: 'mushi_aaaaaa', label: 'mcp-oauth-account', scopes: ['mcp:read', 'mcp:write'], created_at: '2026-10-12T00:00:00Z', last_seen_at: null, all_projects: true, projects: [] },
  { id: 'k2', prefix: 'mushi_bbbbbb', label: 'mcp-oauth-selected', scopes: ['mcp:read'], created_at: '2026-10-12T00:00:00Z', last_seen_at: null, all_projects: false, projects: [{ id: 'p1', name: 'glot.it' }, { id: 'p2', name: 'yen-yen' }] },
]

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiFetch.mockReset()
  reload.mockReset()
  toast.success.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('accountKeyReach', () => {
  it('says what a key reaches', () => {
    expect(accountKeyReach(KEYS[0])).toMatch(/All your projects/)
    expect(accountKeyReach(KEYS[1])).toBe('glot.it, yen-yen')
    expect(accountKeyReach({ all_projects: false, projects: [] })).toMatch(/No projects/)
  })
})

describe('McpAccountKeysList', () => {
  it('lists each account key with what it reaches', () => {
    page.data = { keys: KEYS }
    act(() => root.render(createElement(McpAccountKeysList)))
    const text = host.textContent ?? ''
    expect(text).toContain('mcp-oauth-account')
    expect(text).toContain('All your projects')
    expect(text).toContain('glot.it, yen-yen')
  })

  it('revokes a key after confirmation and reloads the list', async () => {
    page.data = { keys: KEYS }
    apiFetch.mockResolvedValue({ ok: true, data: { revoked: 1 } })
    act(() => root.render(createElement(McpAccountKeysList)))
    const revoke = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.includes('mushi_bbbbbb'))!
    act(() => revoke.click())
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Revoke' && !b.getAttribute('aria-label'))!
    await act(async () => { confirm.click() })
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/mcp/account-keys/k2', { method: 'DELETE' })
    expect(toast.success).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('explains the empty state', () => {
    page.data = { keys: [] }
    act(() => root.render(createElement(McpAccountKeysList)))
    expect(host.querySelector('[data-testid="mcp-account-keys-empty"]')).not.toBeNull()
  })
})
