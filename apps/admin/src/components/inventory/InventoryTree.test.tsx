/**
 * FILE: apps/admin/src/components/inventory/InventoryTree.test.tsx
 * PURPOSE: Prove InventoryTree renders cells and row clicks on TanStack Table v9.
 *
 * OVERVIEW:
 * - Renders one covered row and one untested row.
 * - Checks header and cell text, then the onRowClick payload.
 *
 * DEPENDENCIES:
 * - vitest, react-dom/client, InventoryTree
 *
 * USAGE:
 * - `pnpm --filter @mushi-mushi/admin exec vitest run src/components/inventory/InventoryTree.test.tsx`
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryTree, type TreeRow } from './InventoryTree'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const covered: TreeRow = {
  id: 'home-save',
  pageId: 'home',
  pagePath: '/home',
  elementId: 'save-btn',
  actionLabel: 'Save the draft',
  status: 'verified',
  backendList: [{ method: 'POST', path: '/v1/drafts' }],
  testList: [{ file: 'draft.spec.ts', name: 'saves a draft', framework: 'playwright' }],
}

const bare: TreeRow = {
  id: 'settings-delete',
  pageId: 'settings',
  pagePath: '/settings',
  elementId: 'delete-btn',
  actionLabel: 'Delete the account',
  status: 'stub',
}

describe('InventoryTree', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('renders row cells and reports the clicked row', () => {
    const onRowClick = vi.fn()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(<InventoryTree rows={[covered, bare]} onRowClick={onRowClick} />)
    })

    const header = [...host.querySelectorAll('thead th')].map((th) => th.textContent ?? '')
    expect(header).toEqual(['Page', 'Element', 'Action', 'Status', 'Backend', 'Tests'])

    const bodyRows = [...host.querySelectorAll('tbody tr')]
    expect(bodyRows).toHaveLength(2)
    expect(bodyRows[0]?.textContent).toContain('/home')
    expect(bodyRows[0]?.textContent).toContain('save-btn')
    expect(bodyRows[0]?.textContent).toContain('Save the draft')
    expect(bodyRows[0]?.textContent).toContain('verified')
    expect(bodyRows[0]?.textContent).toContain('POST')
    expect(bodyRows[0]?.textContent).toContain('/v1/drafts')
    expect(bodyRows[0]?.textContent).toContain('playwright')
    expect(bodyRows[0]?.textContent).toContain('saves a draft')
    expect(bodyRows[1]?.textContent).toContain('/settings')
    expect(bodyRows[1]?.textContent).toContain('delete-btn')
    expect(bodyRows[1]?.textContent).toContain('Delete the account')
    expect(bodyRows[1]?.textContent).toContain('stub')
    expect(bodyRows[1]?.textContent).toContain('—')
    expect(bodyRows[1]?.textContent).toContain('untested')

    act(() => {
      bodyRows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledWith(covered)

    act(() => {
      bodyRows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRowClick).toHaveBeenCalledTimes(2)
    expect(onRowClick).toHaveBeenLastCalledWith(bare)
  })
})
