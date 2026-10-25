/**
 * FILE: apps/admin/src/components/DataTable.test.tsx
 * PURPOSE: Prove DataTable still sorts on TanStack Table v9.
 *
 * OVERVIEW:
 * - Renders a two-column table and clicks the sortable header.
 * - Checks that an unsorted column stays plain text.
 *
 * DEPENDENCIES:
 * - vitest, react-dom/client, DataTable
 *
 * USAGE:
 * - `pnpm --filter @mushi-mushi/admin exec vitest run src/components/DataTable.test.tsx`
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DataTable, type ColumnDef } from './DataTable'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Person {
  name: string
  score: number
}

const columns: ColumnDef<Person, unknown>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name', enableSorting: true },
  { id: 'score', header: 'Score', accessorKey: 'score', enableSorting: false },
]

const rows: Person[] = [
  { name: 'b', score: 2 },
  { name: 'a', score: 1 },
]

describe('DataTable', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('sorts an enabled column and leaves a disabled column as text', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <DataTable data={rows} columns={columns} getRowId={(row) => row.name} ariaLabel="People" />,
      )
    })

    const bodyRows = () => [...host!.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
    expect(bodyRows().map((text) => text.trim().startsWith('b'))).toEqual([true, false])

    const buttons = [...host!.querySelectorAll('th button')]
    expect(buttons).toHaveLength(1)
    const nameButton = buttons[0] as HTMLButtonElement
    expect(nameButton.textContent).toContain('Name')
    expect(host!.querySelector('th')?.textContent).toContain('Name')
    const scoreHeader = [...host!.querySelectorAll('th')].find((th) => th.textContent?.includes('Score'))
    expect(scoreHeader?.querySelector('button')).toBeNull()

    act(() => {
      nameButton.click()
    })
    expect(bodyRows()[0]).toContain('a')
    expect(bodyRows()[1]).toContain('b')
    expect(host!.querySelector('th')?.getAttribute('aria-sort')).toBe('ascending')
  })
})
