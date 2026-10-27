/**
 * FILE: apps/admin/src/components/charts/countChartTicks.test.tsx
 * PURPOSE: Render a count chart and assert its y-axis labels are whole numbers.
 *
 * OVERVIEW:
 * - LineSparkline with valueFormat "count" goes through the integer tick scale
 * - A negative series must plot against the floor snapped to that step
 *
 * DEPENDENCIES:
 * - react-dom/server renderToStaticMarkup, LineSparkline
 *
 * USAGE:
 * - vitest src/components/charts
 *
 * NOTES:
 * - Static markup, the same as the other admin render tests (no extra test dependency)
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LineSparkline } from '../charts'

/** The y tick labels: whole-number text in the axis' `leading-none` spans. */
function yTickLabels(html: string): string[] {
  return [...html.matchAll(/<span[^>]*class="[^"]*leading-none[^"]*"[^>]*>(-?[\d.]+)<\/span>/g)].map((m) => m[1]!)
}

describe('count chart tick labels', () => {
  it('renders only whole-number y tick labels when valueFormat is count', () => {
    const html = renderToStaticMarkup(<LineSparkline values={[33, 10, 5]} showAxes valueFormat="count" ariaLabel="Reports" />)
    const labels = yTickLabels(html)
    expect(labels).toEqual(['40', '30', '20', '10', '0'])
    for (const label of labels) expect(label).toMatch(/^-?\d+$/)
  })

  it('plots a negative series against the snapped integer floor', () => {
    const html = renderToStaticMarkup(<LineSparkline values={[8, 0, -4]} showAxes valueFormat="count" ariaLabel="Reports" />)
    expect(yTickLabels(html)).toEqual(['10', '5', '0', '-5'])
    // Domain is the snapped floor -5 through the top tick 10 (pad 2).
    // The 0 point sits one third of the way up; an unsnapped floor of -4 would be 70.57.
    expect(html.match(/<polyline[^>]*points="([^"]*)"/)?.[1]).toContain('50.00,66.00')
  })
})
