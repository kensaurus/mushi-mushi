/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/SpendLimitsPanel.test.tsx
 * PURPOSE: The spend-limits editor loads the saved limits, refuses invalid
 *          input before sending anything, and PATCHes only what changed.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => api)

import { SpendLimitsPanel } from './SpendLimitsPanel'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const FIELD_BY_LABEL: Record<string, string> = {
  'Auto-fix spend limit': 'autofix_max_spend_usd',
  'Automatic fixes per day': 'autofix_max_dispatches_per_day',
  'Monthly AI budget': 'monthly_llm_budget_usd',
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#spend-limit-${FIELD_BY_LABEL[label]}`)
  if (!input) throw new Error(`no input for "${label}"`)
  // The visible label is part of the contract too.
  expect(container.textContent).toContain(label)
  return input
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes(text))
  if (!b) throw new Error(`no button "${text}"`)
  return b as HTMLButtonElement
}

describe('SpendLimitsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.apiFetch.mockImplementation(async (_path: string, opts?: { method?: string }) =>
      opts?.method === 'PATCH'
        ? { ok: true, data: null }
        : {
            ok: true,
            data: {
              autofix_max_spend_usd: 2,
              autofix_max_dispatches_per_day: 3,
              autofix_approval_cost_threshold_usd: null,
              monthly_llm_budget_usd: null,
            },
          },
    )
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
      root.render(createElement(SpendLimitsPanel))
      await flush()
    })
  }

  it('shows the saved limits, and empty for no limit', async () => {
    await render()
    expect(inputByLabel(container, 'Auto-fix spend limit').value).toBe('2')
    expect(inputByLabel(container, 'Automatic fixes per day').value).toBe('3')
    expect(inputByLabel(container, 'Monthly AI budget').value).toBe('')
    expect(container.textContent).toContain('Fixes you start yourself still run')
  })

  it('PATCHes only the changed fields', async () => {
    await render()
    await act(async () => {
      type(inputByLabel(container, 'Monthly AI budget'), '25')
      type(inputByLabel(container, 'Automatic fixes per day'), '')
      await flush()
    })
    await act(async () => {
      button(container, 'Save spend limits').click()
      await flush()
    })
    const patch = api.apiFetch.mock.calls.find(([, o]) => o?.method === 'PATCH')
    expect(patch?.[0]).toBe('/v1/admin/settings')
    expect(JSON.parse(patch?.[1].body)).toEqual({ monthly_llm_budget_usd: 25, autofix_max_dispatches_per_day: null })
  })

  it('sends nothing and explains the problem when an input is invalid', async () => {
    await render()
    await act(async () => {
      type(inputByLabel(container, 'Auto-fix spend limit'), '-3')
      await flush()
    })
    await act(async () => {
      button(container, 'Save spend limits').click()
      await flush()
    })
    expect(api.apiFetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false)
    expect(container.textContent).toContain('above $0')
  })
})
