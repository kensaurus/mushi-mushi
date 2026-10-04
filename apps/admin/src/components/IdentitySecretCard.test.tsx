/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 33: "Rotate secret" replaced the live signed-identity secret with no
 * confirm. QA bug 260: "Disable" used window.confirm. QA bug 128: a failed GET (a
 * member) rendered "Not configured / Generate secret".
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/supabase', () => api)
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

import { IdentitySecretCard } from './IdentitySecretCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement

describe('IdentitySecretCard', () => {
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
    act(() => root.render(createElement(IdentitySecretCard, { projectId: PROJECT })))
    await flush()
  }

  it('Rotate asks first and only POSTs on confirm', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: { configured: true, createdAt: '2026-10-01T00:00:00Z' } })
    await mount()
    act(() => button(/^Rotate secret$/).click())
    expect(api.apiFetch).toHaveBeenCalledTimes(1) // only the GET
    expect(document.body.textContent).toContain('Rotate the signed-identity secret?')
    const confirmBtn = Array.from(document.body.querySelectorAll('button[data-primary]')).pop() as HTMLButtonElement
    act(() => confirmBtn.click())
    await flush()
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${PROJECT}/identity-secret`, { method: 'POST' })
  })

  it('Disable uses the themed confirm, not window.confirm', async () => {
    const native = vi.spyOn(window, 'confirm')
    api.apiFetch.mockResolvedValue({ ok: true, data: { configured: true, createdAt: '2026-10-01T00:00:00Z' } })
    await mount()
    act(() => button(/^Disable$/).click())
    expect(native).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Disable signed identity?')
    native.mockRestore()
  })

  it('a member sees why, not "Not configured"', async () => {
    api.apiFetch.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Only project owners and admins can view the signed-identity secret. Ask an owner or admin of this project.' },
    })
    await mount()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Only project owners and admins')
    expect(text).not.toContain('Not configured')
    expect(button(/Generate secret/)).toBeUndefined()
  })
})
