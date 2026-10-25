/**
 * @vitest-environment jsdom
 *
 * Tester wallet milestone bar: the "$400 · KYC gate" caption has to sit under
 * the tick it describes, which is at threshold/cap — not at the midpoint a
 * justify-between row would give it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: false, error: null, reload: vi.fn() }),
}))

import { MilestoneBar } from './TesterWalletPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('MilestoneBar', () => {
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

  function render(props: { ytd: number; threshold: number; cap: number; kycCleared: boolean }) {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(MilestoneBar, props)))
    })
  }

  it('anchors the gate caption to the same percentage as the gate marker', () => {
    render({ ytd: 120, threshold: 400, cap: 599, kycCleared: false })

    const marker = host.querySelector<HTMLElement>('[title="KYC required at $400"]')
    const label = host.querySelector<HTMLElement>('[data-testid="kyc-gate-label"]')

    expect(marker).not.toBeNull()
    expect(label).not.toBeNull()
    expect(label!.style.left).toBe(marker!.style.left)
    expect(label!.style.left).not.toBe('50%')
    // Both are centred on the anchor point rather than starting at it.
    expect(marker!.className).toContain('-translate-x-1/2')
    expect(label!.className).toContain('-translate-x-1/2')
  })

  it('clamps the anchor point when the threshold exceeds the cap', () => {
    render({ ytd: 700, threshold: 900, cap: 599, kycCleared: true })

    expect(host.querySelector<HTMLElement>('[data-testid="kyc-gate-label"]')!.style.left).toBe('100%')
  })
})
