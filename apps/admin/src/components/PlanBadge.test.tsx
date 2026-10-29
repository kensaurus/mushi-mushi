/**
 * @vitest-environment jsdom
 *
 * Complimentary plan chip: the sidebar used to say "Admin" plus an
 * uppercased tier. It now uses the same label and tooltip as the header.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { visiblePlanTitle } from '../lib/visiblePlanLabel'

const mocks = vi.hoisted(() => ({
  plan: null as Record<string, unknown> | null,
}))

vi.mock('../lib/useActivePlan', () => ({
  useActivePlan: () => ({ plan: mocks.plan, loading: false, error: null, reload: () => {} }),
}))

import { PlanBadge } from './PlanBadge'

const COMP = {
  planId: 'pro',
  displayName: 'Pro',
  isComplimentary: true,
  billingMode: 'complimentary',
  monthlyPriceUsd: 0,
  diagnosesLimit: null,
  diagnosesUsagePct: null,
  includedReportsPerMonth: null,
  usagePct: null,
  cancelAtPeriodEnd: false,
  overQuota: false,
}

const PAID = { ...COMP, isComplimentary: false, billingMode: 'stripe', displayName: 'Studio', monthlyPriceUsd: 79 }

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

async function render(density: 'header' | 'sidebar' = 'sidebar') {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(PlanBadge, { density })))
  })
}

describe('PlanBadge complimentary label', () => {
  it('shows the tier with (complimentary), not Admin, and the shared tooltip', async () => {
    mocks.plan = COMP
    await render('sidebar')
    const link = host.querySelector('a')
    const expected = visiblePlanTitle({ displayName: 'Pro', planId: 'pro', billingMode: 'complimentary' })
    expect(link?.textContent).toBe('Pro (complimentary)')
    expect(link?.textContent).not.toMatch(/\bAdmin\b/)
    expect(link?.getAttribute('title')).toBe(expected)
    expect(link?.className).toContain('bg-brand-subtle')
    expect(link?.className).not.toMatch(/uppercase/)
  })

  it('leaves a paid plan as the catalog name', async () => {
    mocks.plan = PAID
    await render('header')
    expect(host.querySelector('a')?.textContent).toContain('Studio')
    expect(host.textContent).not.toContain('complimentary')
  })
})
