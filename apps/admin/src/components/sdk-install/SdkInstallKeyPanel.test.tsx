/**
 * @vitest-environment jsdom
 *
 * Settings → Health "Rotate key" (suspected-bugs entry 27): one click used to
 * revoke every active key of the project. Now only a bug-widget key can be
 * rotated here, only after a dialog that names it, and only that key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const apiFetch = vi.fn()

vi.mock('../../lib/supabase', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  invalidateApiCache: vi.fn(),
}))
vi.mock('../RevealedKeyCard', () => ({
  RevealedKeyCard: ({ scopes }: { scopes: string[] }) => createElement('div', { 'data-testid': 'revealed' }, scopes.join(',')),
}))

import { SdkInstallKeyPanel } from './SdkInstallKeyPanel'

const PROJECT = 'p-1'
const KEYS = [
  { id: 'k-sdk', key_prefix: 'mushi_aaa111', label: 'sdk-ingest', scopes: ['report:write'], is_active: true, created_at: '2026-10-01T00:00:00Z' },
  { id: 'k-mcp', key_prefix: 'mushi_bbb222', label: 'mcp-readwrite', scopes: ['mcp:read', 'mcp:write'], is_active: true, created_at: '2026-10-01T00:00:00Z' },
]

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[]
}

beforeEach(async () => {
  apiFetch.mockReset()
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/v1/admin/projects') return { ok: true, data: { projects: [{ id: PROJECT, api_keys: KEYS }] } }
    return {
      ok: true,
      data: { key: 'mushi_ccc333ffffffffffffffffffffffff', prefix: 'mushi_ccc333', label: 'sdk-ingest', scopes: ['report:write'] },
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(SdkInstallKeyPanel, { projectId: PROJECT, onRotatedKeyChange: () => {}, onError: () => {} }),
      ),
    )
  })
  await flush()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('SdkInstallKeyPanel rotate', () => {
  it('offers Rotate on the bug-widget key only', () => {
    const rotate = buttons('Rotate')
    expect(rotate).toHaveLength(1)
    expect(rotate[0]!.getAttribute('aria-label')).toBe('Rotate key mushi_aaa111')
    expect(container.textContent).toContain('Keys for coding agents, phones or CI are rotated on')
  })

  it('asks first, naming the key, and does nothing on Keep', async () => {
    await act(async () => buttons('Rotate')[0]!.click())
    expect(document.body.textContent).toContain('Rotate this API key?')
    expect(document.body.textContent).toContain('mushi_aaa111… is revoked right away, with no undo')
    expect(document.body.textContent).toContain('stops sending bug reports')
    await act(async () => buttons('Keep this key')[0]!.click())
    expect(apiFetch.mock.calls.some(([p]) => String(p).includes('/keys/rotate'))).toBe(false)
  })

  it('rotates only the named key and keeps the others listed', async () => {
    await act(async () => buttons('Rotate')[0]!.click())
    await act(async () => buttons('Rotate key')[0]!.click())
    await flush()
    const call = apiFetch.mock.calls.find(([p]) => String(p).includes('/keys/rotate'))
    expect(call?.[0]).toBe(`/v1/admin/projects/${PROJECT}/keys/rotate`)
    expect(JSON.parse(call?.[1].body)).toEqual({ key_prefix: 'mushi_aaa111' })
    expect(container.textContent).toContain('mushi_bbb222')
    expect(container.textContent).toContain('mushi_ccc333')
    expect(container.textContent).not.toContain('mushi_aaa111')
    expect(container.querySelector('[data-testid="revealed"]')?.textContent).toBe('report:write')
  })
})
