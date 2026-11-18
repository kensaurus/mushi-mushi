/**
 * @vitest-environment jsdom
 *
 * Graph round-2 fixes (fresh-eyes 2026-11-18): the "Hide isolated nodes" box
 * shows the filter actually in effect, type counts are labelled, the backend
 * card states the storage mode once and drops SQL-to-AGE sync rows when AGE is
 * not in use, and the clear banner is neutral and never repeats "current".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuickViewsRow, typeCountsLabel } from './GraphFilters'
import { buildBackendRows } from './GraphBackendPanel'
import { graphClearTitle } from './GraphStatusBanner'
import { usesLabel } from './OntologyPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const noop = () => {}

describe('QuickViewsRow isolated toggle', () => {
  it('renders unticked and disabled with the reason when no node is linked', () => {
    act(() =>
      root.render(
        createElement(QuickViewsRow, {
          isolatedToggle: { checked: false, disabled: true, reason: 'no links yet' },
          singletonCount: 0,
          onApplyView: noop,
          onToggleSingletons: noop,
          onRelayout: noop,
        }),
      ),
    )
    const box = host.querySelector<HTMLInputElement>('[data-testid="graph-hide-isolated"]')!
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
    expect(host.textContent).toContain('no links yet')
  })
})

describe('typeCountsLabel', () => {
  it('names what is counted instead of "12/12 · 19/19"', () => {
    expect(typeCountsLabel(12, 12, 19, 19)).toBe('All item and link types')
    expect(typeCountsLabel(3, 12, 19, 19)).toBe('3 of 12 item types · 19 of 19 link types')
  })
})

describe('buildBackendRows', () => {
  const sqlOnly = {
    backend: 'sql_only' as const,
    ageAvailable: false,
    latestAudit: null,
    unsynced: { nodes: 211, edges: 5 },
  }

  it('states the mode once, AGE as optional and neutral, and no sync rows in SQL-only mode', () => {
    const rows = buildBackendRows(sqlOnly)
    expect(rows.map((r) => r.label)).toEqual(['Stored in', 'Apache AGE (optional)'])
    expect(rows[1]).toMatchObject({ value: 'Not installed', tone: 'muted' })
  })

  it('shows copy-to-AGE counts as a warning only when AGE is in use', () => {
    const rows = buildBackendRows({ ...sqlOnly, backend: 'age_dual', ageAvailable: true })
    const items = rows.find((r) => r.label === 'Items not copied to AGE')
    expect(items).toMatchObject({ value: '211', tone: 'warn' })
  })
})

describe('graph clear banner and ontology counts', () => {
  it('describes a link-less map neutrally, without "current"', () => {
    const t = graphClearTitle({ reportNodes: 2, edgeCount: 0 }, 'glot.it')
    expect(t).toBe('glot.it: 2 bug groups, no links between them yet')
    expect(t).not.toMatch(/current/)
  })

  it('gives ontology usage a unit', () => {
    expect(usesLabel(211)).toBe('211 reports')
    expect(usesLabel(1)).toBe('1 report')
  })
})
