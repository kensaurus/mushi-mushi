/**
 * `_shared/connectors/revenuecat.ts` and `_shared/monetization/load.ts` — the
 * RevenueCat snapshot (ADR 0025), its approved actions, and the radar
 * answering the monetization rules from stored snapshots.
 *
 * Covers: products, entitlements with products, offerings with packages and
 * products, paywall ids; a list paged past what Mushi reads is truncated;
 * webhooks and metrics refused or rate-limited are `unknown`, never "none",
 * and never fail the snapshot; a webhook signing secret and URL query never
 * reach the snapshot; no customer endpoint is read; act checks the hash
 * first, needs the write key and a bound project, sends RevenueCat's body,
 * caps a grant and keeps no customer data; the radar ties findings to the app.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let rcMod: typeof import('../../supabase/functions/_shared/connectors/revenuecat.ts')
let canonical: typeof import('../../supabase/functions/_shared/connectors/canonical.ts')
let jwt: typeof import('../../supabase/functions/_shared/connectors/jwt.ts')
let run: typeof import('../../supabase/functions/_shared/radar/run.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  rcMod = await import('../../supabase/functions/_shared/connectors/revenuecat.ts')
  canonical = await import('../../supabase/functions/_shared/connectors/canonical.ts')
  jwt = await import('../../supabase/functions/_shared/connectors/jwt.ts')
  run = await import('../../supabase/functions/_shared/radar/run.ts')
})

const NOW = new Date('2026-10-11T12:00:00Z')
const HUB = 'proj7ff5b439'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function ctx(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, over: Record<string, unknown> = {}) {
  return { db: makeFakeDb({}) as never, organizationId: 'org-1', projectId: 'p1', instanceId: 'inst-1', readCredential: 'sk_read', writeCredential: null, config: {}, fetch: fetchImpl, now: () => NOW, ...over }
}

const product = (id: string, sid: string, app: string) => ({ object: 'product', id, store_identifier: sid, type: 'subscription', app_id: app, state: 'active', display_name: sid })

function vendor(opts: { webhooks?: number; metrics?: number; productsNext?: boolean } = {}) {
  const calls: string[] = []
  const fn = vi.fn(async (url: string) => {
    calls.push(url)
    const u = new URL(url)
    if (u.pathname.endsWith('/apps')) return json(200, { items: [{ id: 'appYY', name: 'yen-yen', type: 'play_store', play_store: { package_name: 'app.yenyen' } }], next_page: null })
    if (u.pathname.endsWith('/products')) {
      if (u.searchParams.get('starting_after')) return json(200, { items: [product('prod3', 'p3', 'appYY')], next_page: opts.productsNext ? `/v2/projects/${HUB}/products?starting_after=prod3` : null })
      return json(200, { items: [product('prod1', 'pro_monthly:monthly', 'appYY')], next_page: `/v2/projects/${HUB}/products?starting_after=prod1` })
    }
    if (u.pathname.endsWith('/entitlements')) return json(200, { items: [{ id: 'ent1', lookup_key: 'yenyen_pro', display_name: 'Pro', products: { items: [product('prod1', 'pro_monthly:monthly', 'appYY')], next_page: null } }] })
    if (u.pathname.endsWith('/offerings')) {
      return json(200, { items: [{ id: 'ofr1', lookup_key: 'yenyen_default', is_current: true, display_name: 'Plans', paywall_id: 'pw1', packages: { items: [{ id: 'pkg1', lookup_key: 'pro_monthly', display_name: 'Pro', products: { items: [{ product: product('prod1', 'pro_monthly:monthly', 'appYY'), eligibility_criteria: 'all' }], next_page: null } }], next_page: null } }] })
    }
    if (u.pathname.endsWith('/integrations/webhooks')) {
      if (opts.webhooks && opts.webhooks !== 200) return json(opts.webhooks, {})
      return json(200, { items: [{ id: 'wh1', name: 'kenji', url: 'https://wallet.example.co/functions/v1/rc?token=abc', environment: 'production', app_id: null, event_types: null, signing_secret: 'whsec_should_not_be_kept' }], next_page: null })
    }
    if (u.pathname.endsWith('/metrics/overview')) {
      if (opts.metrics && opts.metrics !== 200) return json(opts.metrics, {})
      return json(200, { object: 'overview_metrics', currency: 'USD', metrics: [{ id: 'active_subscriptions', name: 'Active Subscriptions', value: 3, unit: '', period: 'P0D' }, { id: 'mrr', name: 'MRR', value: 20.97, unit: '$', period: 'P0D' }] })
    }
    return json(404, {})
  })
  return { fn, calls }
}

describe('RevenueCat snapshot', () => {
  it('reads apps, products, entitlements with products, offerings with packages, webhooks and metrics', async () => {
    const v = vendor()
    const snap = await rcMod.revenuecatConnector.snapshot(ctx(v.fn) as never, [{ projectId: 'p1', externalId: HUB, role: 'billing' }])
    const facts = (snap.facts.projects as Array<Record<string, any>>)[0]
    expect(facts.apps).toEqual([{ id: 'appYY', name: 'yen-yen', type: 'play_store', storeId: 'app.yenyen' }])
    expect(facts.products).toMatchObject({ state: 'read', truncated: false, items: [{ id: 'prod1' }, { id: 'prod3' }] })
    expect(facts.entitlements[0]).toMatchObject({ lookupKey: 'yenyen_pro', productIds: ['prod1'], productsTruncated: false })
    expect(facts.offerings[0]).toMatchObject({ lookupKey: 'yenyen_default', paywallId: 'pw1', packages: [{ id: 'pkg1', productIds: ['prod1'], truncated: false }] })
    expect(facts.webhooks).toEqual({ state: 'read', truncated: false, items: [{ id: 'wh1', name: 'kenji', url: 'wallet.example.co/functions/v1/rc', environment: 'production', appId: null, eventTypes: null }] })
    expect(facts.metrics).toMatchObject({ state: 'read', currency: 'USD', items: [{ id: 'active_subscriptions', value: 3 }, { id: 'mrr', value: 20.97 }] })
    const text = JSON.stringify(snap)
    expect(text).not.toContain('whsec_should_not_be_kept')
    expect(text).not.toContain('token=abc')
    // Never a customer endpoint, and the expand parameters RevenueCat documents.
    expect(v.calls.some((c) => c.includes('/customers'))).toBe(false)
    expect(v.calls.some((c) => c.includes('expand=items.product'))).toBe(true)
    expect(v.calls.some((c) => c.includes('expand=items.package.product'))).toBe(true)
  })

  it('marks a list paged past what it reads as truncated', async () => {
    const v = vendor({ productsNext: true })
    const snap = await rcMod.revenuecatConnector.snapshot(ctx(v.fn) as never, [{ projectId: 'p1', externalId: HUB, role: 'billing' }])
    expect((snap.facts.projects as Array<Record<string, any>>)[0].products.truncated).toBe(true)
    expect(v.calls.filter((c) => c.includes('/products')).length).toBe(5)
  })

  it('a refused webhook read or a rate-limited metrics read is unknown, and the snapshot still succeeds', async () => {
    const snap = await rcMod.revenuecatConnector.snapshot(ctx(vendor({ webhooks: 403, metrics: 429 }).fn) as never, [{ projectId: 'p1', externalId: HUB, role: 'billing' }])
    const facts = (snap.facts.projects as Array<Record<string, any>>)[0]
    expect(facts.webhooks).toMatchObject({ state: 'unknown', reason: /lacks a permission/ })
    expect(facts.metrics).toMatchObject({ state: 'unknown', reason: /rate-limiting/ })
  })

  it('a refused core read fails the snapshot with the reason', async () => {
    await expect(rcMod.revenuecatConnector.snapshot(ctx(async () => json(401, {})) as never, [{ projectId: 'p1', externalId: HUB, role: 'billing' }])).rejects.toMatchObject({ failure: 'credential_rejected' })
  })
})

describe('RevenueCat approved actions', () => {
  async function approved(action: string, payload: Record<string, unknown>) {
    return { id: 'a1', action, payload, payloadSha256: await jwt.sha256Hex(canonical.canonicalJson(payload)) }
  }
  const bound = () => makeFakeDb({ connector_bindings: [{ connector_instance_id: 'inst-1', project_id: 'p1', external_id: HUB, role: 'billing' }] }) as never
  const attach = { rcProjectId: HUB, packageId: 'pkgFam', products: [{ productId: 'prodFam', eligibilityCriteria: 'all' }] }

  it('checks the payload hash before anything else', async () => {
    const fetchSpy = vi.fn()
    const r = await rcMod.revenuecatConnector.act!(ctx(fetchSpy) as never, { ...(await approved('attach_products_to_package', attach)), payloadSha256: 'f'.repeat(64) })
    expect(r).toMatchObject({ ok: false, detail: /does not match/ })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('without the write key the action is unavailable and says why', async () => {
    const r = await rcMod.revenuecatConnector.act!(ctx(vi.fn(), { db: bound() }) as never, await approved('attach_products_to_package', attach))
    expect(r).toMatchObject({ ok: false, detail: /write key/ })
  })

  it('refuses a RevenueCat project the connector does not bind', async () => {
    const fetchSpy = vi.fn()
    const r = await rcMod.revenuecatConnector.act!(ctx(fetchSpy, { db: bound(), writeCredential: 'sk_write' }) as never, await approved('attach_products_to_package', { ...attach, rcProjectId: 'projOther' }))
    expect(r).toMatchObject({ ok: false, detail: /not bound/ })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('attaches products with the write key and the body RevenueCat documents', async () => {
    const fetchSpy = vi.fn(async () => json(200, { object: 'package', id: 'pkgFam' }))
    const r = await rcMod.revenuecatConnector.act!(ctx(fetchSpy, { db: bound(), writeCredential: 'sk_write' }) as never, await approved('attach_products_to_package', attach))
    expect(r).toMatchObject({ ok: true, result: { packageId: 'pkgFam', productIds: ['prodFam'] } })
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.revenuecat.com/v2/projects/${HUB}/packages/pkgFam/actions/attach_products`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_write')
    expect(JSON.parse(String(init.body))).toEqual({ products: [{ product_id: 'prodFam', eligibility_criteria: 'all' }] })
  })

  it('grants a promotional entitlement once, caps how long, and keeps no customer data', async () => {
    const fetchSpy = vi.fn(async () => json(201, { object: 'customer', id: 'u1', attributes: { items: [{ name: '$email', value: 'someone@example.com' }] } }))
    const c = ctx(fetchSpy, { db: bound(), writeCredential: 'sk_write' }) as never
    const ok = await rcMod.revenuecatConnector.act!(c, await approved('grant_promotional_entitlement', { rcProjectId: HUB, appUserId: 'user/42', entitlementId: 'entPro', expiresAt: '2026-11-11T00:00:00Z' }))
    expect(ok).toMatchObject({ ok: true, result: { entitlementId: 'entPro', expiresAt: '2026-11-11T00:00:00.000Z' } })
    expect(JSON.stringify(ok)).not.toContain('someone@example.com')
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.revenuecat.com/v2/projects/${HUB}/customers/user%2F42/actions/grant_entitlement`)
    expect(JSON.parse(String(init.body))).toEqual({ entitlement_id: 'entPro', expires_at: Date.parse('2026-11-11T00:00:00Z') })
    expect(await rcMod.revenuecatConnector.act!(c, await approved('grant_promotional_entitlement', { rcProjectId: HUB, appUserId: 'u', entitlementId: 'entPro', expiresAt: '2026-10-01T00:00:00Z' }))).toMatchObject({ ok: false, detail: /past/ })
    expect(await rcMod.revenuecatConnector.act!(c, await approved('grant_promotional_entitlement', { rcProjectId: HUB, appUserId: 'u', entitlementId: 'entPro', expiresAt: '2028-01-01T00:00:00Z' }))).toMatchObject({ ok: false, detail: /366 days/ })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('monetization radar', () => {
  const ORG = 'org-1'
  const P_YY = '1000000a-0000-4000-8000-000000000000'
  const P_HH = '1000000b-0000-4000-8000-000000000000'
  const rcFacts = {
    rcProjectId: HUB, projectIds: [P_YY, P_HH],
    apps: [{ id: 'appHH', name: null, type: 'play_store', storeId: 'com.k.hhtp' }, { id: 'appYY', name: null, type: 'play_store', storeId: 'app.yenyen' }],
    products: { state: 'read', items: [] },
    entitlements: [],
    offerings: [{ id: 'ofrH', lookupKey: 'hhtp_default', isCurrent: false, packages: [{ id: 'pkgH5', lookupKey: 'credits_5', displayName: null, productIds: [], truncated: false }] }],
    webhooks: { state: 'read', items: [] },
  }
  function db() {
    return makeFakeDb({
      projects: [{ id: P_YY, name: 'yen-yen', organization_id: ORG }, { id: P_HH, name: 'hhtp', organization_id: ORG }],
      app_recipe_snapshots: [
        { project_id: P_YY, is_current: true, manifest: { app: { ids: { androidPackage: 'app.yenyen' } }, links: { billing: { offering: 'yenyen_default' } } } },
        { project_id: P_HH, is_current: true, manifest: { app: { ids: { androidPackage: 'com.k.hhtp' } }, links: { billing: { offering: 'hhtp_default' } } } },
      ],
      connector_instances: [{ id: 'inst-1', organization_id: ORG, kind: 'revenuecat', status: 'connected', enabled_capabilities: ['snapshot', 'drift'] }],
      connector_bindings: [
        { connector_instance_id: 'inst-1', project_id: P_YY, external_id: HUB, role: 'billing' },
        { connector_instance_id: 'inst-1', project_id: P_HH, external_id: HUB, role: 'billing' },
      ],
      connector_snapshots: [
        { kind: 'revenuecat', project_id: P_YY, is_current: true, ok: true, error: null, observed_at: NOW.toISOString(), snapshot: { facts: { projects: [rcFacts] } } },
        { kind: 'revenuecat', project_id: P_HH, is_current: true, ok: true, error: null, observed_at: NOW.toISOString(), snapshot: { facts: { projects: [rcFacts] } } },
      ],
    } as never)
  }

  it('answers every monetization rule and ties the empty offering to its own app only', async () => {
    const hh = await run.monetizationRadarResults(db() as never, P_HH)
    const yy = await run.monetizationRadarResults(db() as never, P_YY)
    expect(hh.map((r) => r.ruleId)).toHaveLength(8)
    expect(hh.find((r) => r.ruleId === 'monetization_offering_empty')?.state).toBe('finding')
    expect(yy.find((r) => r.ruleId === 'monetization_offering_empty')?.state).toBe('ok')
    // No catalog declared anywhere: not checked, never a pass.
    expect(yy.find((r) => r.ruleId === 'monetization_catalog_drift')).toMatchObject({ state: 'unknown' })
  })
})
