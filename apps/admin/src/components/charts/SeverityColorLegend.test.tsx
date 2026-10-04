/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { SeverityColorLegend } from './SeverityColorLegend'

describe('SeverityColorLegend', () => {
  it('shows a text label next to every swatch, not just dots', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(SeverityColorLegend, { showUnscored: true })))
    expect(host.textContent).toBe('CriticalHighMediumLowUnscored')
    act(() => root.unmount())
  })
})
