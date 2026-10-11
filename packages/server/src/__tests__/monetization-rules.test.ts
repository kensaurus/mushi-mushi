/**
 * `_shared/monetization/{catalog,rules}.ts` — the "why nobody can pay" checks
 * (ADR 0025) on the owner's shape: one RevenueCat hub holding the Android apps,
 * iOS apps still missing, a billing catalog in a spine repo.
 *
 * Covers: each rule's ok / finding / unknown paths; findings attributed to the
 * app that owns them (never to every app in the hub); unknown is never ok; an
 * old snapshot without the new fields reads unknown; the iOS check is by app
 * type, so a bundle id equal to the Android package does not pass; catalog
 * drift suggests the approved attach action; the legacy app check now covers
 * Android only.
 */
import { describe, expect, it } from 'vitest'
import { catalogPathOf, parseBillingCatalog, webhookUrlKey, type BillingCatalog } from '../../supabase/functions/_shared/monetization/catalog.ts'
import { evaluateMonetization, legacyRevenuecatDrift, type MonetizationHub, type MonetizationProject, type RuleOutcome } from '../../supabase/functions/_shared/monetization/rules.ts'
import type { RevenueCatProjectFacts } from '../../supabase/functions/_shared/connectors/revenuecat.ts'

const HUB = 'proj7ff5b439'
const YY = 'p-yenyen'
const HH = 'p-hhtp'

const CATALOG_JSON = JSON.stringify({
  project: { id: HUB },
  apps: [
    { id: 'yen-yen', store_apps: [{ platform: 'app_store', bundle_id: 'app.yenyen' }, { platform: 'play_store', package_name: 'app.yenyen', rc_app_id: 'appYY' }], webhook: 'kenji', offering: 'yenyen_default' },
    { id: 'hhtp', store_apps: [{ platform: 'app_store', bundle_id: 'com.k.hhtp' }, { platform: 'play_store', package_name: 'com.k.hhtp', rc_app_id: 'appHH' }], webhook: 'kenji', offering: 'hhtp_default' },
  ],
  entitlements: [{ lookup_key: 'yenyen_pro', app: 'yen-yen' }, { lookup_key: 'yenyen_family', app: 'yen-yen' }],
  products: [
    { app: 'yen-yen', platform: 'play_store', store_identifier: 'pro_monthly:monthly', entitlements: ['yenyen_pro'], store_state: 'active' },
    { app: 'yen-yen', platform: 'play_store', store_identifier: 'family_monthly:monthly', entitlements: ['yenyen_family'], store_state: 'active' },
    { app: 'yen-yen', platform: 'app_store', store_identifier: 'app.yenyen.pro.monthly', entitlements: ['yenyen_pro'] },
    { app: 'hhtp', platform: 'play_store', store_identifier: 'hhtp_pack_5', store_state: 'absent' },
  ],
  offerings: [
    { lookup_key: 'yenyen_default', app: 'yen-yen', packages: [{ lookup_key: 'pro_monthly', products: { app_store: 'app.yenyen.pro.monthly', play_store: 'pro_monthly:monthly' } }, { lookup_key: 'family_monthly', products: { play_store: 'family_monthly:monthly' } }] },
    { lookup_key: 'hhtp_default', app: 'hhtp', packages: [{ lookup_key: 'credits_5', products: { play_store: 'hhtp_pack_5' } }] },
  ],
  webhooks: [{ id: 'kenji', url: 'https://wallet.example.co/functions/v1/rc-webhook?token=s3cr3t', apps: 'all' }],
})

function catalog(): BillingCatalog {
  const r = parseBillingCatalog(CATALOG_JSON)
  if (!r.ok) throw new Error(r.error)
  return r.catalog
}

function rc(over: Partial<RevenueCatProjectFacts> = {}): RevenueCatProjectFacts {
  return {
    rcProjectId: HUB,
    projectIds: [YY, HH],
    apps: [
      { id: 'appYY', name: 'yen-yen', type: 'play_store', storeId: 'app.yenyen' },
      { id: 'appHH', name: 'hhtp', type: 'play_store', storeId: 'com.k.hhtp' },
    ],
    products: {
      state: 'read',
      items: [
        { id: 'prodPro', storeIdentifier: 'pro_monthly:monthly', type: 'subscription', appId: 'appYY', state: 'active', displayName: null },
        { id: 'prodFam', storeIdentifier: 'family_monthly:monthly', type: 'subscription', appId: 'appYY', state: 'active', displayName: null },
        { id: 'prodOld', storeIdentifier: 'legacy_yearly:yearly', type: 'subscription', appId: 'appYY', state: 'active', displayName: null },
      ],
    },
    entitlements: [
      { id: 'entPro', lookupKey: 'yenyen_pro', name: 'Pro', productIds: ['prodPro'] },
      { id: 'entFam', lookupKey: 'yenyen_family', name: 'Family', productIds: [] },
    ],
    offerings: [
      { id: 'ofrY', lookupKey: 'yenyen_default', isCurrent: true, packages: [
        { id: 'pkgPro', lookupKey: 'pro_monthly', displayName: null, productIds: ['prodPro'], truncated: false },
        { id: 'pkgFam', lookupKey: 'family_monthly', displayName: null, productIds: [], truncated: false },
      ] },
      { id: 'ofrH', lookupKey: 'hhtp_default', isCurrent: false, packages: [{ id: 'pkgH5', lookupKey: 'credits_5', displayName: null, productIds: [], truncated: false }] },
    ],
    webhooks: { state: 'read', items: [] },
    metrics: { state: 'read', currency: 'USD', items: [] },
    ...over,
  }
}

function project(id: string, ids: { bundleId?: string; androidPackage?: string }, over: Partial<MonetizationProject> = {}, billing: Record<string, unknown> = {}): MonetizationProject {
  return { id, name: id === YY ? 'yen-yen' : 'hhtp', manifest: { app: { ids }, links: { billing } }, rcProjectId: HUB, ...over }
}

function hub(over: Partial<MonetizationHub> = {}): MonetizationHub {
  return {
    rc: rc(),
    catalog: { state: 'read', catalog: catalog(), source: 'yen-yen: kensaurus-spine/payments/catalog.json' },
    projects: [project(YY, { bundleId: 'app.yenyen', androidPackage: 'app.yenyen' }), project(HH, { androidPackage: 'com.k.hhtp' })],
    ...over,
  }
}

function rule(outcomes: RuleOutcome[] | undefined, id: string): RuleOutcome {
  const r = outcomes?.find((x) => x.ruleId === id)
  if (!r) throw new Error(`no ${id}`)
  return r
}

describe('billing catalog', () => {
  it('keeps the compared fields and drops a webhook query string', () => {
    const c = catalog()
    expect(c.projectId).toBe(HUB)
    expect(c.apps.map((a) => a.id)).toEqual(['yen-yen', 'hhtp'])
    expect(c.apps[0].storeApps).toContainEqual({ platform: 'play_store', storeId: 'app.yenyen', rcAppId: 'appYY' })
    expect(c.webhooks[0].url).toBe('wallet.example.co/functions/v1/rc-webhook')
    expect(JSON.stringify(c)).not.toContain('s3cr3t')
  })

  it('is an error, not an empty catalog, when the file is unusable', () => {
    expect(parseBillingCatalog('{ nope')).toEqual({ ok: false, error: 'The catalog is not valid JSON.' })
    expect(parseBillingCatalog('{"apps": []}')).toMatchObject({ ok: false })
    expect(parseBillingCatalog('x'.repeat(300 * 1024))).toMatchObject({ ok: false })
  })

  it('accepts only a repo-relative .json path', () => {
    expect(catalogPathOf({ links: { billing: { catalog: '/kensaurus-spine/payments/catalog.json' } } })).toBe('kensaurus-spine/payments/catalog.json')
    expect(catalogPathOf({ links: { billing: { catalog: '../secrets.json' } } })).toBeNull()
    expect(catalogPathOf({ links: { billing: { catalog: 'catalog.yaml' } } })).toBeNull()
    expect(catalogPathOf(null)).toBeNull()
    expect(webhookUrlKey('not a url')).toBe('')
  })
})

describe('monetization rules', () => {
  it('flags a selling app that is not bound to RevenueCat, and leaves the rest unknown, never ok', () => {
    const e = evaluateMonetization({ rc: null, catalog: { state: 'none' }, projects: [project(YY, { androidPackage: 'app.yenyen' }, { rcProjectId: null }, { sells: true })] })
    const out = e.byProject[YY]
    expect(rule(out, 'monetization_app_outside_hub')).toMatchObject({ state: 'finding', findings: [{ severity: 'warn', projectIds: [YY] }] })
    for (const r of out.filter((x) => x.ruleId !== 'monetization_app_outside_hub')) expect(r.state).not.toBe('ok')
    expect(rule(out, 'monetization_catalog_drift').reason).toMatch(/links\.billing\.catalog/)
  })

  it('does not call an app that never says it sells "outside the hub"', () => {
    const e = evaluateMonetization({ rc: null, catalog: { state: 'none' }, projects: [project(YY, {}, { rcProjectId: null })] })
    expect(rule(e.byProject[YY], 'monetization_app_outside_hub').state).toBe('unknown')
  })

  it('flags an app bound to a different RevenueCat project than the catalog hub', () => {
    const e = evaluateMonetization(hub({ rc: rc({ rcProjectId: 'projOther' }), projects: [project(YY, { androidPackage: 'app.yenyen' }, { rcProjectId: 'projOther' })] }))
    expect(rule(e.byProject[YY], 'monetization_app_outside_hub').findings[0].message).toMatch(/projOther.*proj7ff5b439/)
    expect(rule(e.byProject[YY], 'monetization_catalog_drift').state).toBe('unknown')
  })

  it('a failed RevenueCat read is an error for the rules that need it', () => {
    const e = evaluateMonetization(hub({ rc: null, rcMissing: { state: 'error', reason: 'RevenueCat could not be read: 401' } }))
    expect(rule(e.byProject[YY], 'monetization_ios_app_missing')).toMatchObject({ state: 'error', reason: /401/ })
  })

  it('checks iOS by app type, so a bundle id equal to the Android package does not pass', () => {
    const e = evaluateMonetization(hub())
    const ios = rule(e.byProject[YY], 'monetization_ios_app_missing')
    expect(ios.state).toBe('finding')
    expect(ios.findings[0]).toMatchObject({ target: 'app.yenyen', projectIds: [YY] })
    // hhtp declares no bundle id itself, but the catalog lists its App Store app.
    expect(rule(e.byProject[HH], 'monetization_ios_app_missing').findings[0].target).toBe('com.k.hhtp')
  })

  it('ties an empty offering to its own app only, and keeps an untied one for the card', () => {
    const e = evaluateMonetization(hub())
    expect(rule(e.byProject[HH], 'monetization_offering_empty').findings.map((f) => f.target)).toEqual(['hhtp_default'])
    const yy = rule(e.byProject[YY], 'monetization_offering_empty').findings
    expect(yy.map((f) => f.target)).toEqual(['yenyen_default (Android)'])
    expect(yy[0].message).toMatch(/family_monthly/)
    const lone = evaluateMonetization(hub({ catalog: { state: 'none' }, rc: rc({ offerings: [{ id: 'o1', lookupKey: 'mystery', isCurrent: false, packages: [] }] }) }))
    expect(lone.unattributed.map((f) => [f.ruleId, f.target])).toEqual([['monetization_offering_empty', 'mystery'], ['monetization_entitlement_unattached', 'yenyen_family']])
    expect(rule(lone.byProject[YY], 'monetization_offering_empty').state).toBe('ok')
  })

  it('flags an entitlement no product grants, on the app the catalog ties it to', () => {
    const e = evaluateMonetization(hub())
    expect(rule(e.byProject[YY], 'monetization_entitlement_unattached').findings.map((f) => f.target)).toEqual(['yenyen_family'])
    expect(rule(e.byProject[HH], 'monetization_entitlement_unattached').state).toBe('ok')
  })

  it('flags a product that no offering sells, as info', () => {
    const e = evaluateMonetization(hub())
    const r = rule(e.byProject[YY], 'monetization_product_not_in_offering')
    expect(r.findings.map((f) => [f.target, f.severity])).toEqual([['family_monthly:monthly', 'info'], ['legacy_yearly:yearly', 'info']])
    expect(rule(e.byProject[HH], 'monetization_product_not_in_offering').state).toBe('ok')
  })

  it('compares RevenueCat to the catalog and suggests the approved attach action', () => {
    const e = evaluateMonetization(hub())
    const r = rule(e.byProject[YY], 'monetization_catalog_drift')
    const pkg = r.findings.find((f) => f.target === 'yenyen_default/family_monthly (Android)')
    expect(pkg?.action).toEqual({ action: 'attach_products_to_package', payload: { rcProjectId: HUB, packageId: 'pkgFam', products: [{ productId: 'prodFam', eligibilityCriteria: 'all' }] } })
    expect(r.findings.some((f) => f.target === 'family_monthly:monthly → yenyen_family')).toBe(true)
    expect(r.findings.find((f) => f.target === 'legacy_yearly:yearly')?.severity).toBe('info')
    // iOS is not compared item by item: its RevenueCat app is missing, which ios_app_missing reports once.
    expect(r.findings.some((f) => f.target?.includes('app.yenyen.pro.monthly'))).toBe(false)
    // A product the catalog says is not in the store yet is info.
    expect(rule(e.byProject[HH], 'monetization_catalog_drift').findings).toEqual([expect.objectContaining({ target: 'hhtp_pack_5', severity: 'info' })])
  })

  it('reads a snapshot taken before the new fields as unknown, never as empty', () => {
    const old = rc({ products: undefined, webhooks: undefined, entitlements: [{ lookupKey: 'yenyen_pro', name: null }], offerings: [{ lookupKey: 'yenyen_default', isCurrent: true }] })
    const e = evaluateMonetization(hub({ rc: old }))
    for (const id of ['monetization_offering_empty', 'monetization_entitlement_unattached', 'monetization_product_not_in_offering', 'monetization_catalog_drift', 'monetization_webhook_unhealthy']) {
      expect(rule(e.byProject[YY], id).state).toBe('unknown')
    }
  })

  it('store states: a product the paywall offers but Apple has not approved is a warning; an unread store is not a pass', () => {
    const withIos = rc({
      apps: [...rc().apps, { id: 'appYYi', name: null, type: 'app_store', storeId: 'app.yenyen' }],
      products: { state: 'read', items: [...(rc().products as { items: never[] }).items, { id: 'prodIos', storeIdentifier: 'app.yenyen.pro.monthly', type: 'subscription', appId: 'appYYi', state: 'active', displayName: null }] },
      offerings: [{ id: 'ofrY', lookupKey: 'yenyen_default', isCurrent: true, packages: [{ id: 'pkgPro', lookupKey: 'pro_monthly', displayName: null, productIds: ['prodPro', 'prodIos'], truncated: false }] }],
    })
    const yy = project(YY, { bundleId: 'app.yenyen', androidPackage: 'app.yenyen' }, {
      ios: { state: 'read', items: [{ storeIdentifier: 'app.yenyen.pro.monthly', state: 'WAITING_FOR_REVIEW' }, { storeIdentifier: 'app.yenyen.extra', state: 'MISSING_METADATA' }, { storeIdentifier: 'app.yenyen.ok', state: 'APPROVED' }] },
      android: { state: 'unknown', reason: 'Products could not be read: Google Play accepted the credential but it lacks a permission this needs.' },
    })
    const r = rule(evaluateMonetization(hub({ rc: withIos, projects: [yy] })).byProject[YY], 'monetization_store_product_unready')
    expect(r.state).toBe('finding')
    expect(r.findings.map((f) => [f.target, f.severity])).toEqual([['app.yenyen.pro.monthly', 'warn'], ['app.yenyen.extra', 'info']])
    expect(r.reason).toMatch(/Android not checked/)
    const none = rule(evaluateMonetization(hub()).byProject[YY], 'monetization_store_product_unready')
    expect(none.state).toBe('unknown')
    expect(none.reason).toMatch(/connect App Store Connect/)
    const clean = rule(evaluateMonetization(hub({ projects: [project(HH, { androidPackage: 'com.k.hhtp' }, { android: { state: 'read', items: [{ storeIdentifier: 'x:y', state: 'ACTIVE' }] } })] })).byProject[HH], 'monetization_store_product_unready')
    // The catalog also lists hhtp's iOS app, which was not read: still not a pass.
    expect(clean.state).toBe('unknown')
  })

  it('webhooks: a missing expected webhook is a warning; a covering one is ok and says delivery is not checked', () => {
    expect(rule(evaluateMonetization(hub()).byProject[YY], 'monetization_webhook_unhealthy').findings[0]).toMatchObject({ severity: 'warn', target: 'wallet.example.co/functions/v1/rc-webhook' })
    const covered = hub({ rc: rc({ webhooks: { state: 'read', items: [{ id: 'w1', name: 'kenji', url: 'wallet.example.co/functions/v1/rc-webhook', environment: 'production', appId: null, eventTypes: null }] } }) })
    const ok = rule(evaluateMonetization(covered).byProject[YY], 'monetization_webhook_unhealthy')
    expect(ok.state).toBe('ok')
    expect(ok.reason).toMatch(/delivery itself is not checked/)
    const scoped = hub({ rc: rc({ webhooks: { state: 'read', items: [{ id: 'w1', name: null, url: 'wallet.example.co/functions/v1/rc-webhook', environment: null, appId: 'appHH', eventTypes: null }] } }) })
    expect(rule(evaluateMonetization(scoped).byProject[YY], 'monetization_webhook_unhealthy').state).toBe('finding')
    const unread = hub({ rc: rc({ webhooks: { state: 'unknown', reason: 'Webhook integrations could not be read: RevenueCat accepted the credential but it lacks a permission this needs.' } }) })
    expect(rule(evaluateMonetization(unread).byProject[YY], 'monetization_webhook_unhealthy')).toMatchObject({ state: 'unknown', reason: /lacks a permission/ })
  })

  it('no catalog and no expected webhook: an uncovered app is info, not a warning', () => {
    const r = rule(evaluateMonetization(hub({ catalog: { state: 'none' } })).byProject[HH], 'monetization_webhook_unhealthy')
    expect(r.findings.map((f) => f.severity)).toEqual(['info'])
  })

  it('a catalog that could not be read is an error for the catalog check only', () => {
    const e = evaluateMonetization(hub({ catalog: { state: 'error', reason: 'No file at that path on the default branch.', source: 'yen-yen: x.json' } }))
    expect(rule(e.byProject[YY], 'monetization_catalog_drift')).toMatchObject({ state: 'error', reason: /No file/ })
    expect(rule(e.byProject[YY], 'monetization_entitlement_unattached').state).toBe('ok')
  })
})

describe('legacy RevenueCat drift', () => {
  it('checks the Android package against Play apps only, by type', () => {
    const facts = rc({ apps: [{ id: 'a', name: null, type: 'app_store', storeId: 'app.yenyen' }] })
    const out = legacyRevenuecatDrift([facts], { [YY]: { app: { ids: { bundleId: 'app.yenyen', androidPackage: 'app.yenyen' } } } })
    expect(out.filter((f) => f.ruleId === 'revenuecat_app_missing').map((f) => f.message)).toEqual([expect.stringMatching(/Play app app\.yenyen/)])
    expect(legacyRevenuecatDrift([rc()], { [YY]: { app: { ids: { bundleId: 'app.yenyen', androidPackage: 'app.yenyen' } } } }).filter((f) => f.ruleId === 'revenuecat_app_missing')).toEqual([])
  })
})
