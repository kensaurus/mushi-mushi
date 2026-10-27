/**
 * FILE: apps/admin/src/components/DataTable.test.tsx
 * PURPOSE: Prove DataTable still sorts on TanStack Table v9.
 *
 * OVERVIEW:
 * - Renders a two-column table and clicks the sortable header.
 * - Checks that an unsorted column stays plain text.
 * - Checks numeric order (including negatives) and a case-sensitive natural sort.
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

  it('sorts a numeric column by number, negatives included', () => {
    const numericColumns: ColumnDef<Person, unknown>[] = [
      { id: 'name', header: 'Name', accessorKey: 'name', enableSorting: false },
      { id: 'score', header: 'Score', accessorKey: 'score', enableSorting: true, sortFn: 'basic' },
    ]
    const numericRows: Person[] = [
      { name: 'mid', score: -1 },
      { name: 'low', score: -10 },
      { name: 'high', score: 2 },
    ]
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <DataTable data={numericRows} columns={numericColumns} getRowId={(row) => row.name} ariaLabel="Scores" />,
      )
    })

    const order = () =>
      [...host!.querySelectorAll('tbody tr')].map((tr) => {
        const text = tr.textContent ?? ''
        if (text.includes('high')) return 'high'
        if (text.includes('mid')) return 'mid'
        return 'low'
      })

    const scoreButton = host!.querySelector('th button') as HTMLButtonElement
    expect(scoreButton.textContent).toContain('Score')

    act(() => {
      scoreButton.click()
    })
    expect(order()).toEqual(['high', 'mid', 'low'])
    expect(scoreButton.closest('th')?.getAttribute('aria-sort')).toBe('descending')

    act(() => {
      scoreButton.click()
    })
    expect(order()).toEqual(['low', 'mid', 'high'])
    expect(scoreButton.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
  })

  it('sorts item2 before item10 when the column asks for alphanumericCaseSensitive', () => {
    interface LabelRow {
      id: string
      label: string
    }
    const labelColumns: ColumnDef<LabelRow, unknown>[] = [
      {
        id: 'label',
        header: 'Label',
        accessorKey: 'label',
        enableSorting: true,
        sortFn: 'alphanumericCaseSensitive',
      },
    ]
    const labelRows: LabelRow[] = [
      { id: '10', label: 'item10' },
      { id: '2', label: 'item2' },
      { id: 'I', label: 'Item2' },
    ]
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <DataTable data={labelRows} columns={labelColumns} getRowId={(row) => row.id} ariaLabel="Labels" />,
      )
    })

    const order = () => [...host!.querySelectorAll('tbody tr')].map((tr) => (tr.textContent ?? '').trim())
    const labelButton = host!.querySelector('th button') as HTMLButtonElement
    act(() => {
      labelButton.click()
    })
    expect(order()).toEqual(['Item2', 'item2', 'item10'])
  })

  it('uses textCaseSensitive instead of the numeric basic fallback', () => {
    const caseColumns: ColumnDef<Person, unknown>[] = [
      {
        id: 'score',
        header: 'Score',
        accessorKey: 'score',
        enableSorting: true,
        sortFn: 'textCaseSensitive',
      },
    ]
    const caseRows: Person[] = [
      { name: 'ten', score: 10 },
      { name: 'two', score: 2 },
    ]
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <DataTable data={caseRows} columns={caseColumns} getRowId={(row) => row.name} ariaLabel="Case scores" />,
      )
    })

    const order = () => [...host!.querySelectorAll('tbody tr')].map((tr) => (tr.textContent ?? '').trim())
    const scoreButton = host!.querySelector('th button') as HTMLButtonElement
    act(() => {
      scoreButton.click()
    })
    // "10" < "2" as text, so the first (descending) click puts 2 first.
    // Numeric basic would put 10 first.
    expect(order()).toEqual(['2', '10'])
    expect(scoreButton.closest('th')?.getAttribute('aria-sort')).toBe('descending')
  })
})
