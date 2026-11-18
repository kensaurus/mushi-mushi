/**
 * @vitest-environment jsdom
 */

/**
 * Payments across apps (ADR 0025): the Monetization card and its labels.
 *   - a rule that could not look reads "Not checked", never OK; a number
 *     RevenueCat did not send reads "—", never $0;
 *   - each app shows entitlements → products and offerings → packages →
 *     products with the store state; "store not read" is neutral;
 *   - "Ask to fix" only asks: it posts the finding's payload to
 *     connector-actions and says an owner must approve it;
 *   - with no RevenueCat project connected it says so instead of passing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appStatus, appSummary, groupMonetizationFindings, kpiTile, metricText, offeringPlatforms, productState, productStatus, type MonetizationFinding, type MonetizationResponse } from './monetizationView'

const ORG = '0000000b-0000-4000-8000-000000000000'

const RESPONSE: MonetizationResponse = {
  hubs: [{
    rcProjectId: 'proj7ff5b439',
    dashboardUrl: 'https://app.revenuecat.com/projects/7ff5b439',
    observedAt: '2026-10-11T03:35:00Z',
    connector: { id: 'inst-rc', status: 'connected', canAct: false },
    read: { state: 'read' },
    catalog: { state: 'read', source: 'yen-yen: kensaurus-spine/payments/catalog.json', reason: null },
    metrics: { state: 'read', currency: 'USD', items: [{ id: 'mrr', name: 'MRR', value: 20.97, unit: '$', period: 'P0D' }] },
    apps: [{
      projectId: 'p-yy',
      name: 'yen-yen',
      rcApps: [{ id: 'appYY', platform: 'Android', storeId: 'app.yenyen' }],
      entitlements: [{ lookupKey: 'yenyen_family', name: 'Family', products: [] }],
      offerings: [{ lookupKey: 'yenyen_default', isCurrent: true, hasPaywall: false, packages: [{ id: 'pkgPro', lookupKey: 'pro_monthly', products: [{ id: 'prodPro', storeIdentifier: 'pro_monthly:monthly', platform: 'Android', storeState: null }] }] }],
      rules: [
        { ruleId: 'monetization_catalog_drift', state: 'finding', reason: '1 to fix.' },
        { ruleId: 'monetization_webhook_unhealthy', state: 'unknown', reason: 'Webhook integrations could not be read.' },
      ],
      findings: [{
        ruleId: 'monetization_catalog_drift', severity: 'warn', target: 'yenyen_default/family_monthly (Android)', projectIds: ['p-yy'],
        message: 'On Android, package family_monthly in yenyen_default should sell family_monthly:monthly but sells nothing.',
        fix: 'Attach family_monthly:monthly to package family_monthly in RevenueCat.',
        action: { action: 'attach_products_to_package', payload: { rcProjectId: 'proj7ff5b439', packageId: 'pkgFam', products: [{ productId: 'prodFam', eligibilityCriteria: 'all' }] } },
      }],
    }],
    unattributed: [],
  }],
  outsideHub: [],
  planned: ['monetization_billing_library_outdated'],
}

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), data: { value: null as unknown } }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: mocks.data.value, loading: false, error: null, reload: vi.fn() }),
}))

import { MonetizationCard } from './MonetizationCard'

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('monetization labels', () => {
  it('never shows a missing number as zero, or an unread store as ready', () => {
    expect(metricText(null, 'mrr')).toBe('—')
    expect(metricText({ state: 'unknown', reason: 'x' }, 'mrr')).toBe('—')
    expect(metricText(RESPONSE.hubs[0].metrics, 'active_trials')).toBe('—')
    expect(metricText(RESPONSE.hubs[0].metrics, 'mrr')).toBe('$21')
    expect(productState({ id: 'a', storeIdentifier: 'a', platform: 'iOS', storeState: null })).toEqual({ text: 'store not read', tone: 'neutral' })
    expect(productState({ id: 'a', storeIdentifier: 'a', platform: 'iOS', storeState: 'WAITING_FOR_REVIEW' }).tone).toBe('warnSubtle')
    expect(productState({ id: 'a', storeIdentifier: 'a', platform: 'Android', storeState: 'ACTIVE' }).tone).toBe('okSubtle')
  })

  it('an app with an unchecked rule is "partly checked", never "every check passed"', () => {
    expect(appSummary({ rules: [{ ruleId: 'x', state: 'ok', reason: '' }, { ruleId: 'y', state: 'unknown', reason: '' }], findings: [] }).text).toBe('Partly checked')
    expect(appSummary({ rules: [{ ruleId: 'x', state: 'ok', reason: '' }], findings: [] }).text).toBe('Every check passed')
    expect(appSummary({ rules: [], findings: [] }).text).toBe('Partly checked')
    expect(appSummary({ rules: [{ ruleId: 'x', state: 'error', reason: '' }], findings: [] }).tone).toBe('dangerSubtle')
  })
})

const unready = (id: string, state = 'IN_REVIEW'): MonetizationFinding => ({
  ruleId: 'monetization_store_product_unready', severity: 'warn', target: id, projectIds: ['p'],
  message: `The App Store product ${id} is ${state}, so buying it fails until Apple approves it, and the paywall offers it.`,
  fix: `In App Store Connect, finish ${id} (metadata, review screenshot) and submit it with an app version.`,
})

describe('payments signals', () => {
  it('groups products in the same store state into one row with one action', () => {
    const groups = groupMonetizationFindings(
      [unready('pack_5'), unready('pack_10'), unready('pack_25'), unready('pro', 'MISSING_METADATA'), RESPONSE.hubs[0].apps[0].findings[0]],
      [{ id: '1', storeIdentifier: 'pack_5', platform: 'iOS', storeState: 'IN_REVIEW' }],
    )
    expect(groups.map((g) => [g.title, g.targets, g.action])).toEqual([
      ['3 products in review', ['pack_5', 'pack_10', 'pack_25'], 'Submit in App Store Connect'],
      ['1 product missing metadata', ['pro'], 'Submit in App Store Connect'],
      // A rule on its own keeps its words and its fix.
      ['On Android, package family_monthly in yenyen_default should sell family_monthly:monthly but sells nothing.', ['yenyen_default/family_monthly (Android)'], 'Attach family_monthly:monthly to package family_monthly in RevenueCat.'],
    ])
  })

  it('reads $0 as "no revenue yet" and a missing number as not sent, never $0', () => {
    const metrics = { state: 'read' as const, currency: 'USD', items: [{ id: 'mrr', name: 'MRR', value: 0, unit: '$', period: 'P0D' }, { id: 'active_trials', name: 'Trials', value: 0, unit: '#', period: 'P0D' }, { id: 'revenue', name: 'Revenue', value: 42, unit: '$', period: 'P28D' }] }
    expect(kpiTile(metrics, 'mrr')).toEqual({ value: '$0', sublabel: 'No revenue yet' })
    expect(kpiTile(metrics, 'active_trials')).toEqual({ value: '0', sublabel: 'None yet' })
    expect(kpiTile(metrics, 'revenue')).toEqual({ value: '$42', sublabel: undefined })
    expect(kpiTile(null, 'mrr')).toEqual({ value: '—', sublabel: 'Not sent' })
  })

  it('colours a product by its store state and marks each app once', () => {
    expect(productStatus({ platform: 'iOS', storeState: 'IN_REVIEW' })).toBe('waiting')
    expect(productStatus({ platform: 'iOS', storeState: 'APPROVED' })).toBe('passed')
    expect(productStatus({ platform: 'Android', storeState: 'NOT_IN_STORE' })).toBe('failed')
    expect(productStatus({ platform: 'Android', storeState: null })).toBe('idle')
    expect(appStatus({ rules: [{ ruleId: 'x', state: 'ok', reason: '' }], findings: [] })).toEqual({ status: 'passed', label: 'Every check passed' })
    expect(appStatus({ rules: [{ ruleId: 'x', state: 'unknown', reason: '' }], findings: [] })).toEqual({ status: 'waiting', label: 'Partly checked' })
    expect(appStatus({ rules: [], findings: [unready('a')] }).status).toBe('failed')
    expect(offeringPlatforms({ offerings: [], rcApps: [{ id: 'a', platform: 'Android', storeId: null }, { id: 'b', platform: 'iOS', storeId: null }] })).toEqual(['iOS', 'Android'])
  })
})

describe('MonetizationCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { id: 'a1' } })
    mocks.data.value = RESPONSE
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(MonetizationCard, { orgId: ORG })))
      await flush()
    })
  }

  it('shows what each app sells, the fix, the dashboard link and the numbers as context', async () => {
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('yen-yen')
    expect(text).toContain('1 to fix')
    expect(text).toContain('should sell family_monthly:monthly but sells nothing')
    expect(text).toContain('yenyen_family')
    expect(text).toContain('no products')
    // Offerings are packages × platform: the Android cell holds the product chip, its state as a mark.
    const cell = container.querySelector('[data-testid="offering-row-pro_monthly"] td[data-platform="Android"]')!
    const chip = cell.querySelector('[data-testid="status-pill"]')!
    expect(chip.textContent).toBe('pro_monthly:monthly')
    expect(chip.getAttribute('title')).toBe('Android · pro_monthly:monthly: store not read')
    expect(chip.getAttribute('data-status')).toBe('idle')
    // The app row: one mark with its words, red for something to fix.
    const pill = container.querySelector('[data-testid="payments-app-p-yy"]')!.closest('button')!.querySelector('[data-testid="status-pill"]')!
    expect([pill.getAttribute('data-status'), pill.textContent]).toEqual(['failed', '1 to fix'])
    expect(text).toContain('$21')
    expect(text).toContain('Planned, not checked yet')
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('Open in RevenueCat'))
    expect(link?.getAttribute('href')).toBe('https://app.revenuecat.com/projects/7ff5b439')
    expect(link?.getAttribute('rel')).toBe('noreferrer')
  })

  it('"Ask to fix" only asks for the approved action, with the exact payload', async () => {
    await render()
    const ask = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Ask to fix')!
    await act(async () => {
      ask.click()
      await flush()
    })
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/v1/admin/orgs/${ORG}/connector-actions`)
    expect(JSON.parse(String(init.body))).toMatchObject({ connectorId: 'inst-rc', action: 'attach_products_to_package', projectId: 'p-yy', payload: { packageId: 'pkgFam' } })
    expect(container.textContent).toContain('Nothing runs until an owner or admin approves it')
    expect(container.textContent).toContain('add its write key there first')
  })

  it('shows the numbers as tiles, $0 as no revenue yet, and in-review products as one row', async () => {
    const hub = RESPONSE.hubs[0]
    mocks.data.value = {
      ...RESPONSE,
      hubs: [{
        ...hub,
        metrics: { state: 'read', currency: 'USD', items: [{ id: 'mrr', name: 'MRR', value: 0, unit: '$', period: 'P0D' }] },
        apps: [{ ...hub.apps[0], findings: [unready('pack_5'), unready('pack_10'), unready('pack_25')] }],
      }],
    }
    await render()
    const tiles = container.querySelector('[data-testid="payments-kpis"]')!
    expect(tiles.textContent).toContain('MRR$0No revenue yet')
    const rows = container.querySelectorAll('[data-testid="payments-finding-monetization_store_product_unready"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('3 products in review:')
    expect(rows[0]!.querySelector('[data-testid="payments-finding-targets"]')!.textContent).toBe('pack_5· pack_10· pack_25')
    expect(rows[0]!.textContent).toContain('→ Submit in App Store Connect')
    // The per-product sentences open on request, not by default.
    expect(container.textContent).not.toContain('so buying it fails')
    await act(async () => (rows[0]!.querySelector('button[aria-expanded]') as HTMLButtonElement).click())
    expect(container.textContent).toContain('The App Store product pack_10 is IN_REVIEW')
  })

  it('says nothing is checked when no RevenueCat project is connected', async () => {
    mocks.data.value = { hubs: [], outsideHub: [], planned: [] }
    await render()
    expect(container.textContent).toContain('No RevenueCat project is connected yet, so nothing here is checked.')
  })
})
