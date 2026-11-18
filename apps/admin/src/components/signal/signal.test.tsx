/**
 * @vitest-environment jsdom
 *
 * The shared signal kit (2026-11-18): alert cards lead with the worst problem and carry a
 * shape, heat cells grade on their column's scale, linked rows light together, bars repeat
 * their number, vitals grade against Google's thresholds, and stages colour only when stuck.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AlertCards, type SignalAlert } from './AlertCards'
import { BarCell, ThresholdBar, barPct } from './BarCell'
import { Chip } from './Chip'
import { HeatGrid, columnMax, heatCellClass, type HeatColumn, type HeatRow } from './HeatGrid'
import { HighlightProvider } from './linkedHighlight'
import { StageTrain } from './StageTrain'
import { StatusGlyph } from './StatusGlyph'
import { VitalBadge, formatVital, gradeVital, parseVitalName } from './VitalBadge'
import { badnessClass, divergeClass, heatClass } from './scale'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.forEach((f) => f())
  cleanup = []
})

function mount(el: ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(MemoryRouter, null, el)))
  cleanup.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

const alert = (id: string, severity: SignalAlert['severity'], keys?: string[]): SignalAlert => ({
  id,
  severity,
  label: 'Stale',
  app: 'glot.it',
  title: `${id} title`,
  detail: 'one line',
  metric: { value: '14', unit: 'd' },
  keys,
  action: { label: 'Re-run', onClick: () => {} },
})

describe('scales', () => {
  it('grade counts, failures and targets', () => {
    expect(heatClass(null, 10)).toBe('ci-nodata')
    expect(heatClass(0, 10)).toBe('ci-cell-0')
    expect(heatClass(10, 10)).toBe('ci-heat-6')
    expect(badnessClass(0, 5)).toBe('ci-cell-0')
    expect(badnessClass(1, 5)).toBe('ci-fail-1')
    expect(badnessClass(50, 5)).toBe('ci-fail-5')
    expect(divergeClass(0.8, 0.8)).toBe('ci-mid')
    expect(divergeClass(0.5, 0.8)).toBe('ci-divr-4')
    expect(divergeClass(0.92, 0.8)).toBe('ci-divb-3')
  })
})

describe('AlertCards', () => {
  it('says nothing needs you when there are no alerts', () => {
    const host = mount(createElement(AlertCards, { alerts: [], emptyText: 'All clear' }))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('All clear')
  })

  it('renders nothing when there are no alerts and no empty text', () => {
    const host = mount(createElement(AlertCards, { alerts: [], emptyText: null }))
    expect(host.querySelector('[data-testid="signal-alerts"]')).toBeNull()
  })

  it('shows the big number, a shape per severity, the action, and folds the rest', () => {
    const alerts = [alert('a', 'critical'), alert('b', 'serious'), alert('c', 'serious'), alert('d', 'serious')]
    const host = mount(createElement(AlertCards, { alerts, emptyText: null, testIdPrefix: 'apps' }))
    const cards = host.querySelectorAll('[data-testid^="apps-alert-"]')
    expect(cards).toHaveLength(3)
    expect(cards[0]!.getAttribute('data-severity')).toBe('critical')
    expect(cards[0]!.textContent).toContain('Critical')
    expect(cards[0]!.querySelector('svg[data-tone="danger"]')).not.toBeNull()
    expect(cards[1]!.querySelector('svg[data-tone="warn"]')).not.toBeNull()
    expect(cards[0]!.textContent).toContain('14')
    expect(cards[0]!.textContent).toContain('Re-run')
    expect(host.textContent).toContain('Show 1 more')
    expect(host.querySelector('h2.sr-only')?.textContent).toContain('4 problems, 1 critical')
  })

  it('pins a card with keys and names it in the trail', () => {
    const host = mount(
      createElement(
        HighlightProvider,
        null,
        createElement(AlertCards, { alerts: [alert('a', 'critical', ['app:glot'])], emptyText: null, keyLabel: (k: string) => `label ${k}` }),
      ),
    )
    const card = host.querySelector('[data-testid="signal-alert-a"]') as HTMLElement
    act(() => card.click())
    expect(host.querySelector('[data-testid="signal-pinned"]')?.textContent).toContain('label app:glot')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[data-testid="signal-pinned"]')).toBeNull()
  })
})

describe('HeatGrid', () => {
  const columns: HeatColumn[] = [
    { id: 'bugs', label: 'Open bugs', scale: 'bad' },
    { id: 'jobs', label: 'Jobs', scale: 'heat' },
    { id: 'sdk', label: 'SDK', scale: 'state' },
  ]
  const rows: HeatRow[] = [
    { id: 'a', label: 'Alpha', keys: ['app:a'], cells: { bugs: { value: 10 }, jobs: { value: 4 }, sdk: { value: 2, tone: 'danger', display: '2 behind' } } },
    { id: 'b', label: 'Beta', keys: ['app:b'], cells: { bugs: { value: 0 }, jobs: { value: null }, sdk: { value: 0, tone: 'ok', display: 'latest' } } },
  ]

  it('grades each cell on its own column', () => {
    expect(columnMax(columns[0]!, rows)).toBe(10)
    expect(heatCellClass(columns[0]!, rows[0]!.cells.bugs, 10)).toBe('ci-fail-5')
    expect(heatCellClass(columns[0]!, rows[1]!.cells.bugs, 10)).toBe('ci-cell-0')
    expect(heatCellClass(columns[1]!, rows[1]!.cells.jobs, 4)).toBe('ci-nodata')
    expect(heatCellClass(columns[2]!, rows[0]!.cells.sdk, 0)).toContain('bg-danger-muted')
  })

  it('is a real table with a caption, a legend and shapes for states', () => {
    const host = mount(createElement(HeatGrid, { caption: 'Apps by signal', columns, rows }))
    expect(host.querySelector('caption')?.textContent).toBe('Apps by signal')
    expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(4)
    expect(host.querySelectorAll('th[scope="row"]')).toHaveLength(2)
    expect(host.querySelector('[data-testid="heat-row-a"] svg[data-tone="danger"]')).not.toBeNull()
    const legend = host.querySelector('[data-testid="heat-grid-legend"]')!.textContent!
    expect(legend).toContain('worse')
    expect(legend).toContain('more')
    expect(legend).toContain('no data')
  })

  it('lights linked rows and dims the rest on hover', () => {
    const host = mount(createElement(HighlightProvider, null, createElement(HeatGrid, { caption: 'x', columns, rows })))
    const a = host.querySelector('[data-testid="heat-row-a"]') as HTMLElement
    act(() => a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(a.getAttribute('data-hl')).toBe('on')
    expect(host.querySelector('[data-testid="heat-row-b"]')!.getAttribute('data-hl')).toBe('dim')
  })
})

describe('BarCell', () => {
  it('clamps and keeps the number as text', () => {
    expect(barPct(5, 10)).toBe(50)
    expect(barPct(50, 10)).toBe(100)
    expect(barPct(5, 0)).toBe(0)
    const host = mount(createElement(BarCell, { value: 3, max: 4, text: '3 min' }))
    expect(host.textContent).toContain('3 min')
    expect((host.querySelector('[data-testid="bar-cell-fill"]') as HTMLElement).style.width).toBe('75%')
  })

  it('is a named meter without visible text', () => {
    const host = mount(createElement(BarCell, { value: 1, max: 4, label: 'Progress 25%' }))
    const meter = host.querySelector('[role="meter"]')!
    expect(meter.getAttribute('aria-label')).toBe('Progress 25%')
    expect(meter.getAttribute('aria-valuenow')).toBe('25')
  })
})

describe('VitalBadge', () => {
  it("grades against Google's thresholds", () => {
    expect(gradeVital('LCP', 2500)).toBe('good')
    expect(gradeVital('LCP', 3000)).toBe('needs-work')
    expect(gradeVital('LCP', 7444)).toBe('poor')
    expect(gradeVital('CLS', 0.3)).toBe('poor')
    expect(gradeVital('INP', 150)).toBe('good')
    expect(formatVital('LCP', 7444)).toBe('7.4 s')
    expect(formatVital('INP', 180)).toBe('180 ms')
    expect(formatVital('CLS', 0.312)).toBe('0.31')
    expect(parseVitalName('web_vitals.lcp')).toBe('LCP')
    expect(parseVitalName('INP_MS')).toBe('INP')
    expect(parseVitalName('error rate')).toBeNull()
  })

  it('carries the grade in words and shape, plus a sparkline with history', () => {
    const host = mount(createElement(VitalBadge, { name: 'LCP', value: 7444, history: [5000, 6000, 7444] }))
    const badge = host.querySelector('[data-testid="vital-LCP"]')!
    expect(badge.getAttribute('aria-label')).toBe('LCP 7.4 s, poor')
    expect(badge.getAttribute('data-grade')).toBe('poor')
    expect(badge.querySelector('svg[data-tone="danger"]')).not.toBeNull()
    expect(badge.querySelectorAll('svg')).toHaveLength(2)
  })
})

describe('StageTrain and StatusGlyph', () => {
  it('colours only the stages that need attention and summarises all of them', () => {
    const host = mount(
      createElement(StageTrain, {
        label: 'Release train',
        stages: [
          { id: 'draft', label: 'Drafted', count: 4 },
          { id: 'held', label: 'Held', count: 2, tone: 'danger', note: 'key used up' },
          { id: 'merged', label: 'Merged', count: 9, to: '#merged' },
        ],
      }),
    )
    expect(host.querySelector('[data-testid="train-stage-draft"]')!.getAttribute('data-tone')).toBe('neutral')
    expect(host.querySelector('[data-testid="train-stage-held"]')!.getAttribute('data-tone')).toBe('danger')
    expect(host.querySelector('figcaption')!.textContent).toContain('Drafted 4, Held 2, Merged 9')
    expect(host.querySelector('a[href="#merged"]')).not.toBeNull()
  })

  it('names a standalone glyph and hides a decorative one', () => {
    const named = mount(createElement(StatusGlyph, { tone: 'ok', label: 'Passing' }))
    expect(named.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Passing')
    const plain = mount(createElement(StatusGlyph, { tone: 'warn' }))
    expect(plain.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ThresholdBar and Chip', () => {
  it('fills to the level colour with warn and crit ticks, the number as text', () => {
    const host = mount(createElement(ThresholdBar, { fill: 0.85, warn: 0.7, crit: 0.9, level: 'warn', label: '85% used' }))
    const bar = host.querySelector('[data-level]')!
    expect(bar.getAttribute('data-level')).toBe('warn')
    expect(bar.querySelector('.bg-st-slow')!.getAttribute('style')).toContain('85%')
    expect(bar.textContent).toBe('85% used')
  })

  it('draws a problem chip in the failed colours', () => {
    const host = mount(createElement(Chip, { tone: 'danger' }, 'tried last'))
    expect(host.querySelector('span')!.className).toContain('text-st-failed-ink')
  })
})
