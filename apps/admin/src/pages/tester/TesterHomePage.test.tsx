/**
 * @vitest-environment jsdom
 *
 * Tester home milestones: the "$400 KYC" caption has to sit under the tick,
 * which is at threshold/cap. A justify-between row parks the middle label
 * at 50%. The anchor is a percentage, so the same left holds at 1440x900
 * and at 390x844.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  apiFetch: vi.fn(),
  invalidateApiCache: vi.fn(),
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string) => {
    if (path === '/v1/me/tester-status') {
      return {
        data: {
          isTester: true,
          handle: 'ada',
          reputation: 10,
          balance: 100,
          totalEarned: 100,
          totalRedeemed: 0,
          acceptedSubmissions: 1,
          joinedApps: 1,
        },
        loading: false,
        error: null,
        reload: vi.fn(),
      }
    }
    if (path === '/v1/tester/wallet') {
      return {
        data: {
          ytdGiftCardUsd: 120,
          kycThresholdUsd: 400,
          kycCapUsd: 599,
          kycCleared: false,
          kycRequired: false,
          pendingRedemptions: [],
        },
        loading: false,
        error: null,
        reload: vi.fn(),
      }
    }
    if (path === '/v1/tester/apps') {
      return { data: [], loading: false, error: null, reload: vi.fn() }
    }
    return { data: { items: [], total: 0 }, loading: false, error: null, reload: vi.fn() }
  },
}))

import { TesterHomePage } from './TesterHomePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('TesterHomePage KYC scale', () => {
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

  it('anchors the KYC caption to the gate tick instead of the middle of the scale', () => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(TesterHomePage)))
    })

    const marker = host.querySelector<HTMLElement>('[title="KYC required at $400"]')
    const label = [...host.querySelectorAll('span')].find((el) => el.textContent === '$400 KYC') ?? null

    expect(marker).not.toBeNull()
    expect(label).not.toBeNull()
    expect(label!.textContent).toBe('$400 KYC')
    expect(label!.dataset.testid).toBe('home-kyc-gate-label')
    expect(label!.style.left).toBe(marker!.style.left)
    expect(label!.style.left).not.toBe('50%')
    expect(Number.parseFloat(label!.style.left)).toBeCloseTo((400 / 599) * 100, 5)
    expect(marker!.className).toContain('-translate-x-1/2')
    expect(label!.className).toContain('-translate-x-1/2')
    expect(label!.parentElement!.className).not.toContain('justify-between')
    const ends = label!.parentElement!.querySelector('.justify-between')
    expect(ends).not.toBeNull()
    expect(ends!.textContent).toContain('$120')
    expect(ends!.textContent).toContain('$599 cap')
    expect(ends!.textContent).not.toContain('KYC')
  })
})
