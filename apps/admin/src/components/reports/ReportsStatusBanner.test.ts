/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.test.ts
 * PURPOSE: Fresh-eyes sweep 2026-11-18 on /reports: "3 reports waiting for
 *          review" (status banner) and "3 reports are waiting for triage" (a
 *          second card) said the same thing. While the banner counts the
 *          queue, the page drops the card.
 */

import { describe, expect, it } from 'vitest'
import { reportsBannerCoversQueue } from './ReportsStatusBanner'

describe('reportsBannerCoversQueue', () => {
  it('covers the queue while a backlog, untriaged or critical banner shows', () => {
    for (const topPriority of ['backlog', 'untriaged', 'critical'] as const) {
      expect(reportsBannerCoversQueue({ hasIngest: true, topPriority }, true)).toBe(true)
    }
  })

  it('leaves the card when the banner is hidden, all clear, or still waiting for a first report', () => {
    expect(reportsBannerCoversQueue({ hasIngest: true, topPriority: 'backlog' }, false)).toBe(false)
    expect(reportsBannerCoversQueue({ hasIngest: true, topPriority: 'clear' }, true)).toBe(false)
    expect(reportsBannerCoversQueue({ hasIngest: false, topPriority: 'waiting_ingest' }, true)).toBe(false)
  })
})
