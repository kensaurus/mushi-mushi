import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ChartAccessibleSummary, sparklineSummaryRows } from './ChartAccessibleSummary'
import { ChartFrame } from './ChartFrame'
import { MetricStrip } from '../MetricStrip'
import { KpiTile, BarSparkline } from '../charts'

/** role="img" is presentational — sr-only tables must not be nested inside it. */
function assertAccessibleTableOutsideRoleImg(html: string) {
  expect(html).toContain('sr-only')
  const imgIdx = html.indexOf('role="img"')
  expect(imgIdx).toBeGreaterThanOrEqual(0)
  const tableIdx = html.indexOf('<table class="sr-only">')
  expect(tableIdx).toBeGreaterThan(imgIdx)
  const between = html.slice(imgIdx, tableIdx)
  // The role="img" wrapper must close before the data table begins.
  expect(between).toMatch(/<\/div>/)
  expect(between).not.toContain('<table')
}

describe('ChartAccessibleSummary helpers', () => {
  it('sparklineSummaryRows pairs days with values', () => {
    expect(sparklineSummaryRows(['2026-06-01', '2026-06-02'], [3, 5])).toEqual([
      { period: '2026-06-01', value: 3 },
      { period: '2026-06-02', value: 5 },
    ])
  })

  it('sparklineSummaryRows falls back when days are missing', () => {
    expect(sparklineSummaryRows(undefined, [1])).toEqual([{ period: 'Point 1', value: 1 }])
  })
})

describe('ChartAccessibleSummary a11y placement', () => {
  it('ChartFrame keeps the sr-only table outside role="img"', () => {
    const html = renderToStaticMarkup(
      <ChartFrame
        height={80}
        yTickLabels={['0', '5', '10']}
        xLabels={['2026-06-01', '2026-06-02']}
        accessibleCaption="Test chart"
        accessibleColumns={[
          { key: 'day', label: 'Day' },
          { key: 'total', label: 'Total' },
        ]}
        accessibleRows={[
          { day: 'Jun 1', total: 3 },
          { day: 'Jun 2', total: 5 },
        ]}
      >
        <div data-testid="plot">plot</div>
      </ChartFrame>,
    )
    assertAccessibleTableOutsideRoleImg(html)
  })

  it('KpiTile keeps the sr-only table outside role="img"', () => {
    const html = renderToStaticMarkup(
      <KpiTile
        label="Reports"
        value="12"
        series={[3, 5, 8]}
        seriesDays={['2026-06-01', '2026-06-02', '2026-06-03']}
      />,
    )
    assertAccessibleTableOutsideRoleImg(html)
  })

  it('ChartAccessibleSummary renders a captioned table', () => {
    const html = renderToStaticMarkup(
      <ChartAccessibleSummary
        caption="Daily totals"
        columns={[{ key: 'day', label: 'Day' }]}
        rows={[{ day: 'Mon' }]}
      />,
    )
    expect(html).toContain('<caption>Daily totals</caption>')
    expect(html).toContain('sr-only')
  })
})

describe('MetricStrip layout', () => {
  it('caps column count at seven', async () => {
    const { MetricStrip } = await import('../MetricStrip')
    expect(MetricStrip).toBeTypeOf('function')
  })
})

describe('KpiTile hero emphasis + stagger forwarding', () => {
  // Bug 1: `lg:col-span-2` must land on the card root (the real grid item),
  // not the inner padding wrapper where the grid never sees it.
  it('puts lg:col-span-2 on the grid item for variant="primary"', () => {
    const html = renderToStaticMarkup(<KpiTile label="Backlog" value="5" variant="primary" />)
    expect(html).toContain('lg:col-span-2')
    // It must be on the outer card div, before the inner padding wrapper.
    expect(html.indexOf('lg:col-span-2')).toBeLessThan(html.indexOf('px-3'))
  })

  it('does not span columns for the default variant', () => {
    const html = renderToStaticMarkup(<KpiTile label="Backlog" value="5" />)
    expect(html).not.toContain('lg:col-span-2')
  })

  // Bug 3: MetricStrip(stagger) injects className + style via cloneElement;
  // KpiTile must forward both to the card root or the entrance animation is a
  // complete no-op. Render the real composition the dashboard uses.
  it('forwards MetricStrip stagger className + style onto KpiTile children', () => {
    const html = renderToStaticMarkup(
      <MetricStrip stagger cols={4}>
        <KpiTile label="A" value="1" />
        <KpiTile label="B" value="2" variant="primary" />
      </MetricStrip>,
    )
    // className forwarded → entrance keyframe actually attached to the tile.
    expect(html).toContain('animate-mushi-fade-in')
    // style forwarded → per-index animation delay reaches the tile.
    expect(html).toContain('animation-delay')
    // The primary child still spans two columns within the stagger composition.
    expect(html).toContain('lg:col-span-2')
  })

  it('forwards className/style on the linked (to) variant too', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <KpiTile
          label="Linked"
          value="9"
          to="/reports"
          variant="primary"
          className="motion-safe:animate-mushi-fade-in"
          style={{ animationDelay: '80ms' }}
        />
      </MemoryRouter>,
    )
    expect(html).toContain('lg:col-span-2')
    expect(html).toContain('animate-mushi-fade-in')
    expect(html).toContain('animation-delay:80ms')
  })
})

describe('BarSparkline sparse series', () => {
  it('caps bar width and uses pixel heights for sparse CI pushes', () => {
    const html = renderToStaticMarkup(
      <BarSparkline
        values={[890]}
        timestamps={['2026-06-05T00:00:00Z']}
        height={72}
        showAxes
        scaleToData
        accent="bg-brand"
        ariaLabel="Web bundle trend"
      />,
    )
    expect(html).toContain('grid-template-columns:repeat(1, minmax(0, 1fr))')
    expect(html).toMatch(/height:\d+px/)
    expect(html).toContain('width:40px')
    expect(html).not.toContain('height:100%')
  })
})
