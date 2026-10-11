/**
 * FILE: packages/server/supabase/functions/_shared/connectors/revenuecat.ts
 * PURPOSE: `revenuecat` (ADR 0017, ADR 0025, Plan 020 §7): a read-only REST v2
 *          view of each bound RevenueCat project — apps, products,
 *          entitlements with their products, offerings with their packages
 *          and products, webhook integrations and the overview metrics — so
 *          Mushi can explain "why nobody can pay" (monetization/rules.ts).
 *          Mushi never holds balances and never reads customers.
 *
 * Act (ADR 0025 §4): `attach_products_to_package` and
 * `grant_promotional_entitlement` run ONLY through executeConnectorAction
 * (_shared/connector-actions.ts): a human-approved, hash-matched, single-use,
 * unexpired connector_actions row. This file re-checks the payload hash and
 * refuses a RevenueCat project the instance does not bind. Both need the
 * separate write key; without it the action says so and does nothing.
 *
 * Reads per RevenueCat project and snapshot: apps, products, entitlements
 * (expand=items.product), offerings (expand=items.package.product) and
 * webhook integrations on the Project Configuration domain (60/min), and one
 * metrics/overview call on Charts & Metrics (25/min). Webhooks and metrics
 * are optional: a refusal or a 429 makes that section `unknown` with the
 * reason, never "none" and never a failed snapshot. A list RevenueCat paged
 * past what Mushi reads is marked truncated, so rules read it as unknown.
 *
 * Bindings: externalId = the RevenueCat project id, one per Mushi project.
 * readCredential: a v2 secret key with read-only permissions.
 * writeCredential: a separate v2 secret key with
 *   project_configuration:packages:read_write and/or
 *   customer_information:customers:read_write.
 */

import { sha256Hex } from './jwt.ts'
import { canonicalJson } from './canonical.ts'
import { failureOfStatus, fetchJson, statusReason, vendorError, type JsonResponse } from './http-util.ts'
import { ConnectorError, notConnected, type ApprovedConnectorAction, type ConnectorActionResult, type ConnectorContext, type DriftFinding, type RecipeConnector } from './types.ts'
import { webhookUrlKey } from '../monetization/catalog.ts'
import { legacyRevenuecatDrift } from '../monetization/rules.ts'

const API_ORIGIN = 'https://api.revenuecat.com'
const API = `${API_ORIGIN}/v2`
const ID = /^[\w-]{3,64}$/
/** Pages read per list before it is marked truncated (100 items a page). */
const MAX_PAGES = 5
/** How far ahead a promotional grant may run. */
const MAX_GRANT_DAYS = 366
const READ_SCOPES = ['project_configuration:*:read']
const OPTIONAL_READ_SCOPES = ['charts_metrics:overview:read (headline numbers)']

export interface RcApp { id: string; name: string | null; type: string; storeId: string | null }
export interface RcProduct { id: string; storeIdentifier: string; type: string; appId: string; state: string; displayName: string | null }
export interface RcPackage { id: string; lookupKey: string; displayName: string | null; productIds: string[]; truncated: boolean }
export interface RcEntitlement { id?: string; lookupKey: string; name: string | null; productIds?: string[]; productsTruncated?: boolean }
export interface RcOffering { id?: string; lookupKey: string; isCurrent: boolean; displayName?: string | null; paywallId?: string | null; packages?: RcPackage[]; packagesTruncated?: boolean }
export interface RcWebhook { id: string; name: string | null; url: string; environment: string | null; appId: string | null; eventTypes: string[] | null }
export interface RcMetric { id: string; name: string; value: number; unit: string; period: string }

/** A read that may not have happened. `unknown` is never "none". */
export type RcSection<T> = { state: 'read'; items: T[]; truncated?: boolean } | { state: 'unknown'; reason: string }

export interface RevenueCatProjectFacts {
  rcProjectId: string
  projectIds: string[]
  entitlements: RcEntitlement[]
  offerings: RcOffering[]
  apps: RcApp[]
  /** Absent on snapshots taken before 2026-10-11: rules read that as unknown. */
  products?: RcSection<RcProduct>
  webhooks?: RcSection<RcWebhook>
  metrics?: { state: 'read'; currency: string; items: RcMetric[] } | { state: 'unknown'; reason: string }
  truncated?: { apps?: boolean; entitlements?: boolean; offerings?: boolean }
}

function auth(key: string | null) {
  return { Authorization: `Bearer ${key}` }
}

function rc(ctx: ConnectorContext, path: string) {
  return fetchJson<any>(ctx, `${API}${path}`, { headers: auth(ctx.readCredential) })
}

/** Every page of a v2 list, up to MAX_PAGES. A non-200 page returns its status and nothing else. */
async function listAll(ctx: ConnectorContext, path: string): Promise<{ status: number; items: Array<Record<string, any>>; truncated: boolean }> {
  const items: Array<Record<string, any>> = []
  let url: string | null = `${API}${path}`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: JsonResponse<any> = await fetchJson<any>(ctx, url, { headers: auth(ctx.readCredential) })
    if (res.status !== 200) return { status: res.status, items: [], truncated: false }
    items.push(...((res.body?.items ?? []) as Array<Record<string, any>>))
    const next: string | null = typeof res.body?.next_page === 'string' ? res.body.next_page : null
    // next_page is a path on the same API (`/v2/projects/...`); anything else is not followed.
    url = next && next.startsWith('/v2/') ? `${API_ORIGIN}${next}` : null
  }
  return { status: 200, items, truncated: url !== null }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function product(p: Record<string, any>): RcProduct {
  return { id: String(p.id ?? ''), storeIdentifier: String(p.store_identifier ?? ''), type: String(p.type ?? ''), appId: String(p.app_id ?? ''), state: String(p.state ?? 'active'), displayName: str(p.display_name) }
}

function nestedTruncated(list: unknown): boolean {
  return typeof (list as { next_page?: unknown } | null)?.next_page === 'string'
}

async function readProject(ctx: ConnectorContext, rcId: string, projectIds: string[]): Promise<RevenueCatProjectFacts> {
  const [apps, products, ent, off] = await Promise.all([
    listAll(ctx, `/projects/${rcId}/apps?limit=100`),
    listAll(ctx, `/projects/${rcId}/products?limit=100`),
    listAll(ctx, `/projects/${rcId}/entitlements?limit=100&expand=items.product`),
    listAll(ctx, `/projects/${rcId}/offerings?limit=100&expand=items.package.product`),
  ])
  for (const r of [apps, products, ent, off]) if (r.status !== 200) throw vendorError('RevenueCat', r.status)

  // Optional reads: a refusal (no scope), a 404 or a rate limit is `unknown`, never a failed snapshot.
  const hooks = await listAll(ctx, `/projects/${rcId}/integrations/webhooks?limit=100`)
  const webhooks: RcSection<RcWebhook> = hooks.status === 200
    ? {
        state: 'read',
        truncated: hooks.truncated,
        // signing_secret is never kept, and the URL loses its query string.
        items: hooks.items.map((w) => ({ id: String(w.id ?? ''), name: str(w.name), url: webhookUrlKey(w.url), environment: str(w.environment), appId: str(w.app_id), eventTypes: Array.isArray(w.event_types) ? w.event_types.map(String) : null })),
      }
    : { state: 'unknown', reason: `Webhook integrations could not be read: ${statusReason('RevenueCat', hooks.status)}` }
  const m = await rc(ctx, `/projects/${rcId}/metrics/overview`)
  const metrics: RevenueCatProjectFacts['metrics'] = m.status === 200 && Array.isArray(m.body?.metrics)
    ? {
        state: 'read',
        currency: String(m.body.currency ?? 'USD'),
        items: (m.body.metrics as Array<Record<string, any>>).filter((x) => typeof x.value === 'number').map((x) => ({ id: String(x.id ?? ''), name: String(x.name ?? x.id ?? ''), value: x.value as number, unit: String(x.unit ?? ''), period: String(x.period ?? '') })),
      }
    : { state: 'unknown', reason: m.status === 200 ? 'RevenueCat answered without metrics.' : `Metrics could not be read: ${statusReason('RevenueCat', m.status)}` }

  return {
    rcProjectId: rcId,
    projectIds,
    apps: apps.items.map((a) => ({ id: String(a.id ?? ''), name: str(a.name), type: String(a.type ?? ''), storeId: a.app_store?.bundle_id ?? a.play_store?.package_name ?? null })),
    products: { state: 'read', truncated: products.truncated, items: products.items.map(product) },
    entitlements: ent.items.map((e) => ({
      id: String(e.id ?? ''),
      lookupKey: String(e.lookup_key ?? ''),
      name: e.display_name ?? null,
      productIds: ((e.products?.items ?? []) as Array<Record<string, any>>).map((p) => String(p.id ?? '')),
      productsTruncated: nestedTruncated(e.products),
    })),
    offerings: off.items.map((o) => ({
      id: String(o.id ?? ''),
      lookupKey: String(o.lookup_key ?? ''),
      isCurrent: o.is_current === true,
      displayName: str(o.display_name),
      paywallId: str(o.paywall_id),
      packagesTruncated: nestedTruncated(o.packages),
      packages: ((o.packages?.items ?? []) as Array<Record<string, any>>).map((p) => ({
        id: String(p.id ?? ''),
        lookupKey: String(p.lookup_key ?? ''),
        displayName: str(p.display_name),
        productIds: ((p.products?.items ?? []) as Array<Record<string, any>>).map((x) => String(x.product?.id ?? '')).filter(Boolean),
        truncated: nestedTruncated(p.products),
      })),
    })),
    webhooks,
    metrics,
    truncated: { apps: apps.truncated, entitlements: ent.truncated, offerings: off.truncated },
  }
}

/** True when this connector instance binds the RevenueCat project (a payload cannot pick another one). */
async function bindsProject(ctx: ConnectorContext, rcProjectId: string): Promise<boolean> {
  if (!ctx.instanceId) return false
  const { data } = await ctx.db.from('connector_bindings').select('external_id').eq('connector_instance_id', ctx.instanceId).eq('external_id', rcProjectId).limit(1)
  return Array.isArray(data) && data.length > 0
}

async function attachProducts(ctx: ConnectorContext, p: Record<string, unknown>): Promise<ConnectorActionResult> {
  const packageId = str(p.packageId)
  const products = Array.isArray(p.products) ? p.products as Array<Record<string, unknown>> : []
  if (!packageId || !ID.test(packageId) || products.length === 0 || products.length > 20) return { ok: false, detail: 'attach_products_to_package needs packageId and 1 to 20 products.' }
  const body = products.map((x) => ({ product_id: str(x.productId) ?? '', eligibility_criteria: str(x.eligibilityCriteria) ?? 'all' }))
  if (body.some((x) => !ID.test(x.product_id) || !['all', 'google_sdk_lt_6', 'google_sdk_ge_6'].includes(x.eligibility_criteria))) return { ok: false, detail: 'Each product needs a productId and, optionally, an eligibilityCriteria of all, google_sdk_lt_6 or google_sdk_ge_6.' }
  const res = await fetchJson<any>(ctx, `${API}/projects/${p.rcProjectId}/packages/${packageId}/actions/attach_products`, {
    method: 'POST', headers: { ...auth(ctx.writeCredential), 'Content-Type': 'application/json' }, body: JSON.stringify({ products: body }),
  })
  if (res.status !== 200) return { ok: false, detail: statusReason('RevenueCat', res.status) }
  return { ok: true, detail: `Attached ${body.length} product${body.length === 1 ? '' : 's'} to package ${packageId}.`, result: { packageId, productIds: body.map((x) => x.product_id) } }
}

async function grantEntitlement(ctx: ConnectorContext, p: Record<string, unknown>): Promise<ConnectorActionResult> {
  const appUserId = str(p.appUserId)
  const entitlementId = str(p.entitlementId)
  const expiresAt = typeof p.expiresAt === 'string' ? Date.parse(p.expiresAt) : NaN
  if (!appUserId || appUserId.length > 1500 || !entitlementId || !ID.test(entitlementId) || !Number.isFinite(expiresAt)) {
    return { ok: false, detail: 'grant_promotional_entitlement needs appUserId, entitlementId and expiresAt (an ISO date).' }
  }
  const now = ctx.now().getTime()
  if (expiresAt <= now) return { ok: false, detail: 'expiresAt is in the past. Ask again with a later date.' }
  if (expiresAt > now + MAX_GRANT_DAYS * 86400_000) return { ok: false, detail: `A promotional grant can run at most ${MAX_GRANT_DAYS} days.` }
  const res = await fetchJson<unknown>(ctx, `${API}/projects/${p.rcProjectId}/customers/${encodeURIComponent(appUserId)}/actions/grant_entitlement`, {
    method: 'POST', headers: { ...auth(ctx.writeCredential), 'Content-Type': 'application/json' }, body: JSON.stringify({ entitlement_id: entitlementId, expires_at: expiresAt }),
  })
  if (res.status !== 200 && res.status !== 201) return { ok: false, detail: statusReason('RevenueCat', res.status) }
  // The answer is a customer object (it can carry an email): only what was granted is kept.
  return { ok: true, detail: `Granted ${entitlementId} until ${new Date(expiresAt).toISOString()}.`, result: { entitlementId, expiresAt: new Date(expiresAt).toISOString() } }
}

export const revenuecatConnector: RecipeConnector = {
  kind: 'revenuecat',
  title: 'RevenueCat',
  capabilities: ['snapshot', 'drift', 'act'],
  requiredScopes: {
    snapshot: [...READ_SCOPES, ...OPTIONAL_READ_SCOPES],
    act: ['project_configuration:packages:read_write (attach products)', 'customer_information:customers:read_write (promotional grant)'],
  },
  credentialNote: 'Use a v2 secret key with read-only project configuration permissions (and charts_metrics:overview:read for the headline numbers). Mushi reads apps, products, entitlements, offerings and webhooks; it never reads customers or changes purchases. Approved actions use a separate write key, and every one is approved by a person first.',
  actions: ['attach_products_to_package', 'grant_promotional_entitlement'],
  async probe(ctx) {
    if (!ctx.readCredential) return notConnected('Add a RevenueCat v2 secret key with read-only permissions.')
    const res = await rc(ctx, '/projects?limit=1')
    if (res.status === 200) return { ok: true, status: 'connected', granted: READ_SCOPES, missing: [] }
    return { ok: false, status: 'error', granted: [], missing: res.status === 403 ? READ_SCOPES : [], reason: statusReason('RevenueCat', res.status), failure: failureOfStatus(res.status) }
  },
  async snapshot(ctx, bindings) {
    if (!ctx.readCredential) throw new ConnectorError('RevenueCat is not connected.', 'not_connected')
    const byRc = new Map<string, string[]>()
    for (const b of bindings) if (ID.test(b.externalId)) byRc.set(b.externalId, [...(byRc.get(b.externalId) ?? []), b.projectId])
    const projects: RevenueCatProjectFacts[] = []
    for (const [rcId, projectIds] of [...byRc].slice(0, 10)) projects.push(await readProject(ctx, rcId, projectIds))
    return {
      observedAt: ctx.now().toISOString(),
      elements: { integrations: { summary: { revenuecatProjects: projects.length } } },
      resources: projects.map((p) => ({ kind: 'revenuecat_project', externalId: p.rcProjectId, role: 'billing' })),
      facts: { projects },
    }
  },
  detectDrift(_prev, next, manifests): DriftFinding[] {
    // `manifests` here is { [projectId]: manifest } — the radar passes each app's recipe.
    return legacyRevenuecatDrift((next.facts.projects ?? []) as RevenueCatProjectFacts[], manifests)
  },
  async act(ctx, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
    if (await sha256Hex(canonicalJson(action.payload)) !== action.payloadSha256) return { ok: false, detail: 'The payload does not match what was approved.' }
    if (!ctx.writeCredential) return { ok: false, detail: 'No RevenueCat write key is stored for this connector. Add a separate v2 secret key with write permissions on the connector first; the read-only key cannot change anything.' }
    const p = action.payload
    if (typeof p.rcProjectId !== 'string' || !ID.test(p.rcProjectId)) return { ok: false, detail: 'The payload has no valid rcProjectId.' }
    if (!await bindsProject(ctx, p.rcProjectId)) return { ok: false, detail: `This connector is not bound to RevenueCat project ${p.rcProjectId}.` }
    if (action.action === 'attach_products_to_package') return attachProducts(ctx, p)
    if (action.action === 'grant_promotional_entitlement') return grantEntitlement(ctx, p)
    return { ok: false, detail: `Unknown RevenueCat action ${action.action}.` }
  },
}
