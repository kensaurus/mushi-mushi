/**
 * @vitest-environment jsdom
 *
 * /reports chrome that used to appear after first paint (status banner,
 * triage recommendation, severity sparklines) keeps its loaded height
 * while the fetches are in flight.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: true, error: null, reload: () => {} }),
}))

import { FilterChip } from '../ui/misc'
import { ReportsKpiStrip } from './ReportsKpiStrip'
import { ReportsRecommendationReserve, ReportsStatusBannerReserve } from './ReportsStatusBanner'

describe('reports chrome reserves', () => {
  it('holds the status banner and the triage recommendation at their loaded size', () => {
    const status = renderToStaticMarkup(createElement(ReportsStatusBannerReserve))
    expect(status).toContain('data-testid="reports-status-reserve"')
    expect(status).toContain('text-xs')
    expect(status).toContain('text-2xs')
    expect(status).toContain('min-h-6')

    const recommendation = renderToStaticMarkup(createElement(ReportsRecommendationReserve))
    expect(recommendation).toContain('data-testid="reports-recommendation-reserve"')
    expect(recommendation).toContain('text-sm')
    expect(recommendation).toContain('leading-relaxed')
    expect(recommendation).toContain('mb-3')
  })

  it('reserves quick-filter count width before stats arrive and keeps it once they do', () => {
    const pending = renderToStaticMarkup(
      createElement(FilterChip, {
        label: 'New',
        count: null,
        reserveCount: true,
        active: false,
        onClick: () => {},
      }),
    )
    expect(pending).toContain('min-w-[2.5rem]')
    expect(pending).toContain('invisible')
    expect(pending).not.toContain('aria-label')

    const loaded = renderToStaticMarkup(
      createElement(FilterChip, {
        label: 'New',
        count: 12,
        reserveCount: true,
        active: false,
        onClick: () => {},
      }),
    )
    expect(loaded).toContain('min-w-[2.5rem]')
    expect(loaded).not.toContain('invisible')
    expect(loaded).toContain('aria-label="12 results"')

    const plain = renderToStaticMarkup(
      createElement(FilterChip, { label: 'Open', count: 3, active: false, onClick: () => {} }),
    )
    expect(plain).toContain('min-w-[1rem]')
    expect(plain).not.toContain('min-w-[2.5rem]')
  })

  it('keeps a spark row and a primary critical tile before severity stats arrive', () => {
    const html = renderToStaticMarkup(createElement(ReportsKpiStrip, { onFilter: () => {} }))
    expect(html.match(/data-testid="kpi-spark-reserve"/g)).toHaveLength(4)
    expect(html).toContain('ring-1 ring-brand/25')
  })
})
