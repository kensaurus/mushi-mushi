/**
 * FILE: reportsTableLayout.test.ts
 * PURPOSE: The sticky summary column must not cover triage sort headers.
 *
 * OVERVIEW:
 * - At a 390px scrollport the summary column is 544px (34rem) and sticky,
 *   so Status, Severity, Confidence, and Action centers stay under it even
 *   after scrolling fully right.
 * - The container query in styles/components.css unpins that column up to
 *   the width where those centers clear.
 *
 * DEPENDENCIES: node:fs, vitest, reportsTableLayout.
 *
 * NOTES: jsdom has no table layout, so this locks the geometry and the CSS
 * contract instead of calling elementFromPoint.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REPORTS_TABLE_COL,
  reportsColRem,
  reportsSortHeaderCenterCovered,
  reportsStickySummaryUnpinMaxPx,
  reportsStickySummaryUnpinMaxRem,
  type ReportsSortHeaderCol,
} from './reportsTableLayout'

const SORT_HEADERS: ReportsSortHeaderCol[] = ['status', 'severity', 'confidence', 'action']

describe('reports sticky summary', () => {
  it('keeps the summary column at 34rem (544px)', () => {
    expect(reportsColRem(REPORTS_TABLE_COL.summary)).toBe(34)
    expect(reportsColRem(REPORTS_TABLE_COL.summary) * 16).toBe(544)
  })

  it('covers every sort-header center at a 390px scrollport', () => {
    for (const header of SORT_HEADERS) {
      expect(reportsSortHeaderCenterCovered(390, header), header).toBe(true)
    }
  })

  it('clears those centers once the scrollport is past the sticky summary', () => {
    const max = reportsStickySummaryUnpinMaxPx()
    expect(max).toBe(846)
    expect(reportsSortHeaderCenterCovered(max, 'status')).toBe(true)
    for (const header of SORT_HEADERS) {
      expect(reportsSortHeaderCenterCovered(max + 1, header), header).toBe(false)
    }
  })

  it('unpins the summary in the triage container query at that width', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8')
    const rem = reportsStickySummaryUnpinMaxRem()
    expect(rem).toBe(52.875)
    expect(css).toContain('container-name: reports-triage')
    expect(css).toContain(`@container reports-triage (max-width: ${rem}rem)`)
    expect(css).toMatch(
      /table\.reports-triage-table thead th:nth-child\(3\)[\s\S]*?position:\s*static/,
    )
  })
})
