/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/timeline/Timeline.test.tsx
 * PURPOSE: The Timeline's pure helpers and its two controls (ADR 0072):
 *          the comparison handle moves by keyboard (arrows 2 %, Shift 10 %,
 *          Home/End) and the rail picks a stop with the arrow keys.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompareSlider } from './CompareSlider'
import { TimelineRail } from './TimelineRail'
import { defaultPair, formatCost, judgeLine, pointTone, reuseShare, scoreDelta, seriesOf, sliderStep, suggestVersion, type TimelinePoint } from '../../lib/timeline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function point(over: Partial<TimelinePoint>): TimelinePoint {
  return {
    id: 'p',
    kind: 'release',
    at: '2026-11-20T00:00:00Z',
    label: '1.0.0',
    title: null,
    status: 'published',
    version: '1.0.0',
    runs: [],
    cost_usd: null,
    judged: 0,
    cached: 0,
    score: null,
    improved_screens: 0,
    reports_closed: 0,
    reports: [],
    baselines: 0,
    ...over,
  }
}

describe('timeline helpers', () => {
  it('formats cost honestly: nothing recorded, free, tiny, dollars', () => {
    expect(formatCost(null)).toBe('–')
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(0.4213)).toBe('$0.42')
    expect(formatCost(31.6)).toBe('$32')
  })

  it('says how many verdicts were model calls and how many were reused', () => {
    expect(judgeLine(0, 0)).toBeNull()
    expect(judgeLine(3, 9)).toBe('3 scored · 9 reused')
    expect(reuseShare(3, 9)).toBe(75)
    expect(reuseShare(0, 0)).toBeNull()
  })

  it('tones a stop by what it is', () => {
    expect(pointTone(point({}))).toBe('ok')
    expect(pointTone(point({ status: 'draft' }))).toBe('neutral')
    expect(pointTone(point({ kind: 'unreleased' }))).toBe('info')
    expect(pointTone(point({ kind: 'run', status: 'failed' }))).toBe('danger')
  })

  it('draws only the stops that have a value', () => {
    const pts = [point({ score: 5, cost_usd: 0.2 }), point({ score: null, cost_usd: null }), point({ score: 7.5, cost_usd: 0 })]
    expect(seriesOf(pts, 'score')).toEqual([5, 7.5])
    expect(seriesOf(pts, 'cost')).toEqual([0.2, 0])
  })

  it('signs a score change and opens the comparison on the oldest and newest shot', () => {
    expect(scoreDelta(4, 8)).toBe('+4')
    expect(scoreDelta(8, 6)).toBe('−2')
    expect(scoreDelta(5, 5)).toBeNull()
    const frames = [
      { id: 'a', viewport: 'desktop', url: 'u1' },
      { id: 'm', viewport: 'mobile', url: 'u2' },
      { id: 'b', viewport: 'desktop', url: null },
      { id: 'c', viewport: 'desktop', url: 'u3' },
    ]
    expect(defaultPair(frames, 'desktop')).toEqual({ before: frames[0], after: frames[3] })
    expect(defaultPair(frames, 'mobile')).toEqual({ before: null, after: frames[1] })
  })

  it('suggests the newest release with no pinned screens, else today', () => {
    const today = new Date('2026-11-27T10:00:00Z')
    expect(suggestVersion([point({ version: '1.0.0', baselines: 3 }), point({ version: '1.1.0' })], today)).toBe('1.1.0')
    expect(suggestVersion([point({ version: '1.0.0', baselines: 3 })], today)).toBe('2026-11-27')
  })

  it('steps the comparison handle within 0 to 100', () => {
    expect(sliderStep('ArrowRight', false, 50)).toBe(52)
    expect(sliderStep('ArrowLeft', true, 5)).toBe(0)
    expect(sliderStep('End', false, 10)).toBe(100)
    expect(sliderStep('PageUp', false, 90)).toBe(100)
    expect(sliderStep('a', false, 10)).toBeNull()
  })
})

describe('timeline controls', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('moves the comparison with the keyboard and reveals the newer shot to the right of the handle', async () => {
    await act(async () => {
      root.render(createElement(CompareSlider, { screen: 'Home', before: { url: 'b.png', label: '1.0.0' }, after: { url: 'a.png', label: '1.1.0' } }))
    })
    const input = host.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toContain('1.0.0 on the left, 1.1.0 on the right')
    const after = host.querySelectorAll('img')[1] as HTMLImageElement
    expect(after.style.clipPath).toBe('inset(0 0 0 50%)')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    })
    expect(input.value).toBe('40')
    expect(after.style.clipPath).toBe('inset(0 0 0 40%)')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(input.getAttribute('aria-valuetext')).toBe('100% shows 1.1.0')
  })

  it('picks a stop with the arrow keys and marks it current', async () => {
    let picked = 1
    const points = [point({ id: 'a', label: '1.0.0' }), point({ id: 'b', label: '1.1.0', reports_closed: 2, cost_usd: 0.31 }), point({ id: 'c', label: 'Unreleased', kind: 'unreleased' })]
    const render = () => root.render(createElement(TimelineRail, { points, selected: picked, onSelect: (i: number) => ((picked = i), render()) }))
    await act(async () => render())
    const current = host.querySelector('[aria-current="step"]') as HTMLButtonElement
    expect(current.textContent).toContain('1.1.0')
    expect(current.textContent).toContain('2 fixed')
    expect(current.textContent).toContain('$0.31')
    await act(async () => {
      current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(picked).toBe(2)
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('Unreleased')
    expect((host.querySelector('input[aria-label="Scrub through releases and runs"]') as HTMLInputElement).value).toBe('2')
  })
})
