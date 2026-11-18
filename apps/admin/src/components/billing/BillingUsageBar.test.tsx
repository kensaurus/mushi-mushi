/**
 * @vitest-environment jsdom
 */

/**
 * Team → Billing app card (round-2 review 2026-11-18): "24 / 3,000" and
 * "1% used" drew twice, "Fixes merged 0" (this app) sat beside the team's
 * "Fixes merged 191", and "0 reports · 0 active days" had no scope.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillingUsageBar, type BillingUsageBarProps } from './BillingUsageBar'

const DAYS = Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, reports: 0 }))

function props(over: Partial<BillingUsageBarProps> = {}): BillingUsageBarProps {
  return {
    usage: { reports: 0, fixes: 28, fixesSucceeded: 0, tokens: 0 },
    limitReports: null,
    pct: 1,
    periodStart: '2026-11-01T00:00:00Z',
    periodEnd: '2026-12-01T00:00:00Z',
    llmCostUsd: 0.019,
    overQuota: false,
    overageRate: null,
    tierId: 'pro',
    usageSeries: { days: DAYS },
    diagnosesUsed: 24,
    diagnosesLimit: 3000,
    complimentary: true,
    appName: 'kensaur.us',
    projectId: 'p1',
    ...over,
  }
}

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

async function renderBar(over: Partial<BillingUsageBarProps> = {}) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(BillingUsageBar, props(over))))
  })
  return container.textContent ?? ''
}

describe('BillingUsageBar', () => {
  it('a free app on its own AI key past the cap reads Own AI key, never paused (ADR 0063)', async () => {
    const over = { tierId: 'free_cloud', diagnosesUsed: 340, diagnosesLimit: 300, pct: 113, overQuota: false, overageRateDiagnoses: null }
    const paused = await renderBar(over)
    expect(paused).toMatch(/paused/)
    const own = await renderBar({ ...over, byokUncapped: true })
    expect(own).toContain('Own AI key')
    expect(own).not.toMatch(/paused|Limit reached/)
  })

  it('with the team meters shown, draws no second quota meter or fixes count', async () => {
    const text = await renderBar({ quotaInStrip: true })
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(text).not.toContain('/ 3,000')
    expect(text).not.toMatch(/% used/)
    expect(text).not.toMatch(/Fixes merged/)
  })

  it('scopes the 30-day line to the app and links an empty app to SDK health', async () => {
    const text = await renderBar({ quotaInStrip: true })
    expect(text).toContain('Reports from kensaur.us · last 30 days')
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Check SDK health')
    expect(link?.getAttribute('href')).toBe('/connect?project=p1#connect-sdk-health')
  })

  it('draws a zero count grey and the cost in ink', async () => {
    await renderBar({ quotaInStrip: true })
    const values = [...container.querySelectorAll('span.tabular-nums.font-medium')]
    expect(values.map((v) => v.textContent)).toEqual(['0', '$0.0190'])
    expect(values[0].className).toContain('text-fg-faint')
    expect(values[1].className).toContain('text-fg')
  })

  it('keeps the meter when it is the only one on the page (Quick mode)', async () => {
    const text = await renderBar({ quotaInStrip: false })
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(text).toMatch(/Fixes merged/)
  })
})
