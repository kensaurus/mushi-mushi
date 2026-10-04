/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/CommandPalette.test.tsx
 * PURPOSE: B18 — the Cmd+K palette finds pages by plain or former names and
 *          finds bug reports by their words: typing searches the reports API
 *          (debounced, top 5), shows each report's title, and Enter opens the
 *          best result.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../lib/supabase', () => ({ apiFetch: api.apiFetch }))
vi.mock('../lib/paletteAssist', () => ({ sendPaletteAssist: vi.fn() }))
vi.mock('../lib/pageContext', () => ({ usePageContext: () => null }))
vi.mock('../lib/recentEntities', () => ({ useRecentEntities: () => [] }))
const viewer = vi.hoisted(() => ({ isSuperAdmin: false, isOperator: false }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => viewer }))

import { CommandPalette } from './CommandPalette'
import { commandPalette } from '../lib/useCommandPalette'

let container: HTMLDivElement
let root: Root
let currentPath = ''

function PathProbe() {
  currentPath = useLocation().pathname
  return null
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/dashboard'] },
        createElement(CommandPalette),
        createElement(Routes, null, createElement(Route, { path: '*', element: createElement(PathProbe) })),
      ),
    )
  })
  await act(async () => {
    commandPalette.open()
  })
}

function input(): HTMLInputElement {
  const el = document.querySelector('input[cmdk-input]') as HTMLInputElement | null
  if (!el) throw new Error('palette input not rendered')
  return el
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  api.apiFetch.mockReset()
  api.apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/admin/reports')) {
      return {
        ok: true,
        data: {
          total: 1,
          reports: [
            {
              id: 'r-1',
              summary: 'Checkout button does nothing on Safari',
              description: 'when I click pay nothing happens',
              category: 'bug',
              severity: 'high',
              status: 'new',
            },
          ],
        },
      }
    }
    return { ok: true, data: { fixes: [] } }
  })
})

afterEach(() => {
  act(() => commandPalette.close())
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('CommandPalette search', () => {
  it('lists Settings first for "api key"', async () => {
    await render()
    await act(async () => typeInto(input(), 'api key'))
    const items = [...document.querySelectorAll('[cmdk-item]')].map((el) => el.textContent ?? '')
    expect(items[0]).toContain('Settings')
  })

  it('searches reports after a pause, shows titles, and Enter opens the best result', async () => {
    await render()
    await act(async () => typeInto(input(), 'checkout'))
    // Debounced: nothing sent while typing.
    expect(api.apiFetch).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const reportCall = api.apiFetch.mock.calls.find(([p]) => String(p).startsWith('/v1/admin/reports'))
    expect(reportCall?.[0]).toBe('/v1/admin/reports?q=checkout&limit=5&sort=created_at&dir=desc')
    expect(document.body.textContent).toContain('Checkout button does nothing on Safari')

    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(currentPath).toBe('/reports/r-1')
  })
})

describe('CommandPalette role gating (QA #72)', () => {
  afterEach(() => {
    viewer.isSuperAdmin = false
    viewer.isOperator = false
  })

  const pageLabels = () =>
    [...document.querySelectorAll('[cmdk-item]')].map((el) => el.textContent ?? '')

  it('hides operator and super-admin pages from everyone else', async () => {
    await render()
    await act(async () => typeInto(input(), 'growth'))
    expect(pageLabels().some((t) => t.includes('Growth'))).toBe(false)
    await act(async () => typeInto(input(), 'all users'))
    expect(pageLabels().some((t) => t.includes('All users'))).toBe(false)
  })

  it('lists them for the people who can open them', async () => {
    viewer.isOperator = true
    viewer.isSuperAdmin = true
    await render()
    await act(async () => typeInto(input(), 'growth'))
    expect(pageLabels().some((t) => t.includes('Growth'))).toBe(true)
  })
})
