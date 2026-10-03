/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/DesignActionsCard.test.tsx
 * PURPOSE: The deviance actions card shows the project's settings (off by
 *          default), saves each toggle and the threshold with PUT, refuses a
 *          threshold outside 0–100, warns when the design auto-fix is on but
 *          the project's Autofix is off, and is read-only for members.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignActionSettingsView } from '../../lib/recipeTypes'

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))
const pageData = vi.hoisted(() => ({ usePageData: vi.fn() }))

vi.mock('../../lib/supabase', () => api)
vi.mock('../../lib/usePageData', () => pageData)

import { DesignActionsCard } from './DesignActionsCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PATH = `/v1/admin/projects/${PROJECT}/design/settings`

function settings(over: Partial<DesignActionSettingsView> = {}): DesignActionSettingsView {
  return { threshold: 40, failCi: false, autofix: false, autofixEnabled: true, canEdit: true, ...over }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('DesignActionsCard', () => {
  let container: HTMLDivElement
  let root: Root
  const reload = vi.fn()

  beforeEach(() => {
    api.apiFetchMutate.mockReset()
    api.apiFetchMutate.mockResolvedValue({ ok: true, data: settings() })
    pageData.usePageData.mockReset()
    reload.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(view: DesignActionSettingsView, score: number | null = 55) {
    pageData.usePageData.mockReturnValue({ data: view, loading: false, error: null, reload })
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(DesignActionsCard, { projectId: PROJECT, score })))
    })
  }

  const switchFor = (label: string) => container.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`)!
  const button = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text))!

  it('starts off, and saves a toggle with PUT', async () => {
    render(settings())
    expect(pageData.usePageData).toHaveBeenCalledWith(PATH)
    expect(switchFor('Fail the CI check above the threshold').getAttribute('aria-checked')).toBe('false')
    expect(switchFor('Dispatch a fix for new design drift above the threshold').getAttribute('aria-checked')).toBe('false')
    expect(container.textContent).toContain('Latest score 55, above the threshold')
    await act(async () => {
      switchFor('Fail the CI check above the threshold').click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(PATH, { method: 'PUT', body: JSON.stringify({ failCi: true }) })
    expect(reload).toHaveBeenCalled()
  })

  it('saves a changed threshold and refuses one outside 0–100', async () => {
    render(settings())
    const input = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!
    expect(button('Save threshold').disabled).toBe(true)
    const type = (value: string) => act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    for (const bad of ['150', '-1', '4.5', '']) {
      type(bad)
      expect(container.textContent).toContain('The threshold is a whole number from 0 to 100.')
      expect(button('Save threshold').disabled).toBe(true)
    }
    type('40')
    expect(button('Save threshold').disabled).toBe(true) // unchanged
    type('25')
    expect(button('Save threshold').disabled).toBe(false)
    await act(async () => {
      button('Save threshold').click()
      await flush()
    })
    expect(api.apiFetchMutate).toHaveBeenCalledWith(PATH, { method: 'PUT', body: JSON.stringify({ threshold: 25 }) })
    expect(container.textContent).toContain('Saved.')
  })

  it('warns when the design auto-fix is on but the project Autofix is off', () => {
    render(settings({ autofix: true, autofixEnabled: false }))
    expect(container.textContent).toContain('Autofix is off for this project')
    expect(container.querySelector('a[href="/integrations/config"]')).not.toBeNull()
  })

  it('shows a failed save', async () => {
    api.apiFetchMutate.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'Only project owners and admins can open design PRs.' } })
    render(settings())
    await act(async () => {
      switchFor('Dispatch a fix for new design drift above the threshold').click()
      await flush()
    })
    expect(container.textContent).toContain('Only project owners and admins')
  })

  it('is read-only for members', () => {
    render(settings({ canEdit: false }), null)
    expect(container.textContent).toContain('Read-only')
    expect(container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.disabled).toBe(true)
    expect(container.textContent).not.toContain('Latest score')
  })
})
