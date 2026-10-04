/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 31: "Rotate key" revoked EVERY project key (MCP, voice, CI, OAuth) with
 * no confirm. Rotation is now per key, behind a confirm that lists exactly
 * the key being revoked and warns that live apps using it stop reporting.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidateApiCache: vi.fn() }))
vi.mock('../../lib/supabase', () => api)

import { SdkInstallKeyPanel } from './SdkInstallKeyPanel'
import { rotateKeyConfirmCopy, canRotateKey } from '../../lib/projectKeys'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'
const SDK_KEY = {
  id: '22222222-2222-4222-8222-222222222222',
  key_prefix: 'mushi_sdk001',
  label: 'sdk-ingest',
  scopes: ['report:write'],
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_seen_at: '2026-10-03T00:00:00Z',
}
const MCP_KEY = {
  id: '33333333-3333-4333-8333-333333333333',
  key_prefix: 'mushi_mcp001',
  label: 'MCP · Cursor · 2026-10-01 · read+write',
  scopes: ['mcp:read', 'mcp:write'],
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

const buttons = () => Array.from(document.body.querySelectorAll('button'))

describe('SdkInstallKeyPanel rotation', () => {
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

  async function mount() {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/v1/admin/projects') return { ok: true, data: { projects: [{ id: PROJECT, api_keys: [SDK_KEY, MCP_KEY] }] } }
      return {
        ok: true,
        data: { id: '44444444-4444-4444-8444-444444444444', key: 'mushi_newkey0000', prefix: 'mushi_newkey', scopes: ['report:write'], label: 'sdk-ingest · rotated', old_key_still_active: false },
      }
    })
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(SdkInstallKeyPanel, { projectId: PROJECT, onRotatedKeyChange: () => {}, onError: () => {} }),
        ),
      )
    })
    await flush()
  }

  it('has no project-wide "Rotate key" button, only one Rotate per key', async () => {
    await mount()
    expect(buttons().some((b) => b.textContent === 'Rotate key')).toBe(false)
    expect(buttons().filter((b) => b.textContent === 'Rotate')).toHaveLength(2)
  })

  it('confirms first, lists only the chosen key, then rotates exactly that key', async () => {
    await mount()
    act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Rotate key mushi_sdk001"]')!.click())
    expect(api.apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/keys/rotate'), expect.anything())
    const details = document.body.querySelector('[data-testid="rotate-key-details"]')!.textContent ?? ''
    expect(details).toContain('mushi_sdk001')
    expect(details).not.toContain('mushi_mcp001')
    expect(document.body.textContent).toContain('stops working')

    act(() => buttons().find((b) => b.textContent === 'Rotate this key')!.click())
    await flush()
    const call = api.apiFetch.mock.calls.find(([p]) => String(p).endsWith('/keys/rotate'))!
    expect(JSON.parse(call[1].body)).toEqual({ keyId: SDK_KEY.id })
  })
})

describe('projectKeys helpers', () => {
  it('only rows with a real key id can be rotated', () => {
    expect(canRotateKey({ id: SDK_KEY.id })).toBe(true)
    expect(canRotateKey({ id: 'mushi_sdk001' })).toBe(false)
  })

  it('confirm copy names the key, its access and warns that live apps stop reporting', () => {
    const copy = rotateKeyConfirmCopy(MCP_KEY)
    expect(copy.title).toBe('Rotate key mushi_mcp001…?')
    expect(copy.lines.join(' ')).toContain('mcp:read, mcp:write')
    expect(copy.lines.join(' ')).toContain('never used by an app yet')
    expect(copy.body).toMatch(/bug reports from a live app stop arriving/)
    expect(copy.body).toMatch(/other keys keep working/)
  })
})
