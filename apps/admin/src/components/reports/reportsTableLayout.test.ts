/**
 * FILE: reportsTableLayout.test.ts
 * PURPOSE: Lock the /reports width contract from skill run 284dd3fb.
 *
 * At 390px the triage table used to pin a 34rem summary over the other
 * columns and the 53.5rem min-width widened the page. Below `md` the row
 * stacks and the min-width drops; sticky columns stay desktop-only.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGE_CONTENT_STACK } from '../../lib/pageLayout'
import { TABLE_CELL } from '../../lib/tableLayout'
import { REPORTS_TABLE_COL, REPORTS_TABLE_MIN_W } from './reportsTableLayout'

const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8')

describe('reports layout at 390px and 1440px', () => {
  it('lets the page column shrink so a wide child cannot widen <main>', () => {
    expect(PAGE_CONTENT_STACK).toContain('min-w-0')
    expect(PAGE_CONTENT_STACK).toContain('[&>*]:min-w-0')
  })

  it('drops the desktop table min-width below md and unsets fixed column widths', () => {
    expect(REPORTS_TABLE_MIN_W).toBe('min-w-[53.5rem] max-md:min-w-0')
    expect(REPORTS_TABLE_COL.summary).toContain('w-[34rem]')
    expect(REPORTS_TABLE_COL.summary).toContain('max-md:w-auto')
    expect(REPORTS_TABLE_COL.action).toContain('max-md:w-auto')
  })

  it('keeps row controls on the 24px floor', () => {
    expect(TABLE_CELL.hit).toContain('h-6')
    expect(TABLE_CELL.hit).toContain('w-6')
    expect(TABLE_CELL.hitText).toContain('min-h-6')
    const row = readFileSync(resolve(__dirname, 'ReportRowView.tsx'), 'utf8')
    const dispatch = readFileSync(resolve(__dirname, 'DispatchFixPreflight.tsx'), 'utf8')
    expect(row).toContain('TABLE_CELL.hit')
    expect(row).toContain('TABLE_CELL.hitText')
    expect(row).not.toContain('h-5 shrink-0')
    expect(dispatch).not.toContain('h-5 min-h-0')
    expect(dispatch).toContain('min-h-6 shrink-0')
    const sort = readFileSync(resolve(__dirname, 'SortHeader.tsx'), 'utf8')
    expect(sort).toContain('inline-flex min-h-6')
  })

  it('pins sticky columns only from 64rem, and stacks the triage row under md', () => {
    const sticky = css.indexOf('@media (min-width: 64rem)')
    const stickyRule = css.indexOf('.responsive-table[data-sticky-lead="3"]', sticky)
    expect(sticky).toBeGreaterThan(-1)
    expect(stickyRule).toBeGreaterThan(sticky)
    expect(css).toContain('@media (max-width: 47.9375rem)')
    expect(css).toContain('.reports-triage-table tbody tr')
    expect(css).toContain('content: "Action"')
    const scroll = css.slice(css.indexOf('.responsive-table-scroll {'), css.indexOf('.responsive-table::before'))
    expect(scroll).toContain('min-width: 0')
    expect(scroll).toContain('overflow-x: auto')
  })
})
