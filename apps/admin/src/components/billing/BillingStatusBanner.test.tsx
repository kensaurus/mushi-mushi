/**
 * @vitest-environment jsdom
 */

/**
 * Billing for an admin account opened on a red-toned "Admin account — no
 * charges" banner that repeated "70 / 2,000 diagnoses · 4% used" (also the
 * tile right below and the plan card), spoke of "Stripe charges", and its
 * button "View LLM cost" went to a page named AI spend (2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillingStatusBanner } from './BillingStatusBanner'
import { EMPTY_BILLING_STATS } from './types'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('BillingStatusBanner', () => {
  it('tells an admin account plainly that nothing is billed, once', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(BillingStatusBanner, {
            plainBanner: true,
            stats: {
              ...EMPTY_BILLING_STATS,
              projectName: 'mushi-mushi',
              projectCount: 1,
              planDisplayName: 'Pro',
              isComplimentary: true,
              reportsUsed: 70,
              reportsLimit: 2000,
              usagePct: 4,
            },
          }),
        ),
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Admin account — no charges')
    expect(text).toContain('nothing is billed')
    expect(text).not.toMatch(/Stripe|2,000|4%/)
    expect(container.querySelector('a[href="/team?view=spend"]')?.textContent).toBe('See AI spend')
    expect(container.querySelector('.bg-brand')).toBeNull()
  })
})
