/**
 * @vitest-environment jsdom
 *
 * Reporter updates leads with told / opened / replied, counted in bug
 * reports. Shares are of the reports told, and the sentence names how many
 * reporters have not opened their update.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReporterUpdateFunnel, funnelPct, funnelSentence } from './ReporterUpdateFunnel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('funnel helpers', () => {
  it('shares are of the reports told, capped at 100%', () => {
    expect(funnelPct(10, 40)).toBe(25)
    expect(funnelPct(5, 0)).toBe(0)
    expect(funnelPct(50, 40)).toBe(100)
  })

  it('names the reporters who have not opened their update', () => {
    expect(funnelSentence({ told: 40, opened: 10, replied: 2 })).toMatch(/^30 of 40 reporters have not opened/)
    expect(funnelSentence({ told: 4, opened: 4, replied: 0 })).toBe('Every reporter opened their update.')
    expect(funnelSentence({ told: 0, opened: 0, replied: 0 })).toBe('No reporter has been told about a bug yet.')
  })
})

describe('ReporterUpdateFunnel', () => {
  it('shows told, opened and replied with their shares', () => {
    act(() => root.render(createElement(ReporterUpdateFunnel, { funnel: { told: 40, opened: 10, replied: 2 } })))
    const rows = Array.from(host.querySelectorAll('dl > div')).map((d) => d.textContent)
    expect(rows).toEqual(['Told40', 'Opened10(25%)', 'Replied2(5%)'])
  })
})
