/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/inventory/PageActionMap.test.tsx
 * PURPOSE: The /inventory story map answers "what broke?" first: pages with a
 *          broken action (regressed, or a stub with no code) sort first, the
 *          broken actions sort first inside a page and read red, and each
 *          action opens the detail drawer.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageActionMap, actionHealth, buildPageActionMap } from './PageActionMap'
import type { TreeRow } from './InventoryTree'

function row(pagePath: string, actionLabel: string, status: string): TreeRow {
  return { id: `${pagePath}-${actionLabel}`, pageId: pagePath, pagePath, elementId: actionLabel, actionLabel, status }
}

const rows: TreeRow[] = [
  row('/settings', 'Save profile', 'verified'),
  row('/checkout', 'Apply coupon', 'verified'),
  row('/checkout', 'Pay', 'regressed'),
  row('/checkout', 'Gift wrap', 'stub'),
  row('/home', 'Search', 'mocked'),
]

describe('actionHealth', () => {
  it('treats regressed and stub as broken, mocked as a warning, verified and wired as working', () => {
    expect(actionHealth('regressed')).toBe('broken')
    expect(actionHealth('stub')).toBe('broken')
    expect(actionHealth('mocked')).toBe('warn')
    expect(actionHealth('verified')).toBe('ok')
    expect(actionHealth('wired')).toBe('ok')
    expect(actionHealth('unknown')).toBe('unknown')
    expect(actionHealth(null)).toBe('unknown')
  })
})

describe('buildPageActionMap', () => {
  it('puts pages with broken actions first and broken actions first within a page', () => {
    const pages = buildPageActionMap(rows)
    expect(pages.map((p) => p.path)).toEqual(['/checkout', '/home', '/settings'])
    expect(pages[0]!.broken).toBe(2)
    expect(pages[0]!.actions.map((a) => a.row.actionLabel)).toEqual(['Pay', 'Gift wrap', 'Apply coupon'])
  })
})

describe('PageActionMap', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders one card per page, marks broken actions red and opens an action on click', () => {
    const onSelect = vi.fn()
    act(() => root.render(createElement(PageActionMap, { rows, onSelect })))
    const cards = host.querySelectorAll('[data-testid="inventory-page-map-page"]')
    expect(cards).toHaveLength(3)
    expect(cards[0]!.textContent).toContain('2 broken')
    const pay = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Pay'))!
    expect(pay.dataset.health).toBe('broken')
    expect(pay.className).toContain('text-danger')
    act(() => pay.click())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ actionLabel: 'Pay' }))
  })

  it('renders nothing when the map file has no actions', () => {
    act(() => root.render(createElement(PageActionMap, { rows: [] })))
    expect(host.innerHTML).toBe('')
  })

  it('caps a long page and offers the full list', () => {
    const many = Array.from({ length: 11 }, (_, i) => row('/big', `Action ${i}`, 'verified'))
    const onShowAll = vi.fn()
    act(() => root.render(createElement(PageActionMap, { rows: many, onShowAll })))
    const more = [...host.querySelectorAll('button')].find((b) => b.textContent === '+3 more')!
    expect(more).toBeDefined()
    act(() => more.click())
    expect(onShowAll).toHaveBeenCalled()
  })
})
