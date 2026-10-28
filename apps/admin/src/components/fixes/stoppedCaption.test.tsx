/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/fixes/stoppedCaption.test.tsx
 * PURPOSE: The Stopped summary and the status sentence print the same cause
 *          list the Fixes banner prints (formatFixCauseBreakdown).
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { EMPTY_FIXES_STATS } from './FixesStatsTypes'
import { FixSummaryRow } from './FixSummaryRow'
import { FixesSnapshotStrip } from './FixesSnapshotStrip'
import { formatFixCauseBreakdown } from '../../lib/fixReportTruth'
import type { FixSummary } from './types'

const breakdown = [
  { category: 'ci_failed', count: 24 },
  { category: 'needs_human', count: 11 },
  { category: 'sandbox_timeout', count: 7 },
]

describe('stopped caption matches the banner breakdown', () => {
  const caption = formatFixCauseBreakdown(breakdown)

  it('the summary card and the status sentence use that caption, not a bare top cause', () => {
    const summary: FixSummary = {
      total: 51,
      completed: 10,
      failed: 42,
      inProgress: 0,
      prsOpen: 0,
      prsCiPassing: 0,
      failureBreakdown: breakdown,
      days: [],
    }
    const card = renderToStaticMarkup(createElement(FixSummaryRow, { summary, successRate: 0.2 }))
    const strip = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(FixesSnapshotStrip, {
          stats: { ...EMPTY_FIXES_STATS, failed: 42, totalAttempts: 51, failureBreakdown: breakdown },
          statsFetchedAt: null,
        }),
      ),
    )
    expect(caption).toBe('CI failed (24), Needs your decision (11), Ran out of time (7)')
    expect(card).toContain(caption)
    expect(strip).toContain(caption)
    expect(card).not.toContain('>Failed<')
  })
})
