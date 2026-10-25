/**
 * FILE: apps/admin/src/components/charts/kpiTileSparkReserve.test.tsx
 * PURPOSE: Pin the KPI tile's sparkline footer height across the loading
 *          boundary so a tile cannot grow a row when its series lands.
 *
 * OVERVIEW:
 * - `reserveSeriesSpace` tiles render a same-height spacer while `series` is empty
 * - Once the series arrives the spacer is gone and the sparkline takes the space
 * - Without the flag nothing is reserved (the default stays unchanged)
 *
 * DEPENDENCIES:
 * - react-dom/server renderToStaticMarkup, KpiTile
 *
 * USAGE:
 * - vitest src/components/charts
 *
 * NOTES:
 * - Static markup, the same as the other admin render tests (no extra test dependency)
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KpiTile } from '../charts'

/** Inline `height:` of the reserved spacer, or null when it is absent. */
function reservedHeight(html: string): string | null {
  const el = html.match(/<div[^>]*data-testid="kpi-spark-reserve"[^>]*>/)?.[0]
  if (!el) return null
  return el.match(/height:\s*([\d]+px)/)?.[1] ?? null
}

/** Inline `height:` of the rendered sparkline plot, or null when absent. */
function sparkHeight(html: string): string | null {
  return html.match(/<div class="h-full w-full" style="height:([\d]+px)"/)?.[1] ?? null
}

describe('KpiTile sparkline space reservation', () => {
  it('reserves the sparkline height while the series is still loading', () => {
    const html = renderToStaticMarkup(
      <KpiTile label="Critical · 14d" value="…" sublabel="last 14 days" series={[]} reserveSeriesSpace />,
    )
    expect(reservedHeight(html)).toBe('18px')
    expect(sparkHeight(html)).toBeNull()
  })

  it('hands exactly that height to the sparkline once the series lands', () => {
    const html = renderToStaticMarkup(
      <KpiTile
        label="Critical · open"
        value={3}
        sublabel="7 filed in 14d · 4 closed"
        series={[0, 1, 0, 2, 1, 0, 3, 1, 0, 0, 2, 1, 0, 1]}
        reserveSeriesSpace
      />,
    )
    expect(reservedHeight(html)).toBeNull()
    expect(sparkHeight(html)).toBe('18px')
  })

  it('reserves nothing for tiles that never show a sparkline', () => {
    const html = renderToStaticMarkup(<KpiTile label="Open" value={12} sublabel="right now" />)
    expect(reservedHeight(html)).toBeNull()
    expect(sparkHeight(html)).toBeNull()
  })
})
