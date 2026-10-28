/**
 * FILE: reportsTableLayout.test.ts
 * PURPOSE: The triage table's min-width is the sum of its columns, each
 *          column fits its header and a 24px control, and that floor still
 *          fits the 1440px content area. Narrower widths scroll inside the
 *          table box instead of widening the page.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  REPORTS_COL_REM,
  REPORTS_STICKY_LEAD,
  REPORTS_TABLE_MIN_REM,
  REPORTS_TABLE_MIN_W,
} from './reportsTableLayout'

const here = dirname(fileURLToPath(import.meta.url))

describe('reports triage column floors', () => {
  it('sets the table min-width to the sum of the columns', () => {
    const sum = (Object.values(REPORTS_COL_REM) as number[]).reduce((a, b) => a + b, 0)
    expect(REPORTS_TABLE_MIN_REM).toBe(sum)
    expect(REPORTS_TABLE_MIN_W).toBe(`min-w-[${sum}rem]`)
    expect(sum).toBe(65.75)
  })

  it('pins the summary after the stripe and the checkbox', () => {
    expect(REPORTS_STICKY_LEAD.col2Left).toBe('4px')
    expect(REPORTS_STICKY_LEAD.col3Left).toBe(`${REPORTS_COL_REM.stripe + REPORTS_COL_REM.checkbox}rem`)
    expect(REPORTS_COL_REM.checkbox * 16).toBeGreaterThanOrEqual(24)
  })

  it('fits the severity header and the 24px action row inside their columns', () => {
    // "SEVERITY" at 12px with tracking-wider, the sort arrow, and cell padding.
    expect(REPORTS_COL_REM.severity * 16).toBeGreaterThanOrEqual(96)
    // Three 24px icon buttons plus "Triage →" (~96px with padding), after the 4px side insets.
    const actionInner = REPORTS_COL_REM.action * 16 - 8
    expect(actionInner).toBeGreaterThanOrEqual(24 * 3 + 96)
  })

  it('fits beside the sidebar at 1440px and scrolls inside the box when narrower', () => {
    const tablePx = REPORTS_TABLE_MIN_REM * 16
    const desktopContent = 1440 - 240 - 40
    expect(tablePx).toBeLessThanOrEqual(desktopContent)
    expect(tablePx).toBeGreaterThan(390 - 32)
  })

  it('contains the wide table and keeps touch kebabs tappable', () => {
    const css = readFileSync(join(here, '../../styles/components.css'), 'utf8')
    const scroll = css.match(/\.responsive-table-scroll \{[^}]*\}/)?.[0] ?? ''
    expect(scroll).toContain('overflow-x: auto')
    expect(scroll).toContain('min-width: 0')
    expect(css).toContain('.row-kebab-reveal.pointer-events-none')
    expect(css).toMatch(/\(hover: none\), \(pointer: coarse\)[\s\S]*?\.row-kebab-reveal\.pointer-events-none \{\s*pointer-events: auto;/)
  })
})
