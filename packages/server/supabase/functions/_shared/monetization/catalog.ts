/**
 * FILE: packages/server/supabase/functions/_shared/monetization/catalog.ts
 * PURPOSE: The operator's billing catalog as code (ADR 0025 §5): one reviewed
 *          JSON file in a spine repo listing, for every app, its store apps,
 *          entitlements, products, offerings and webhooks. A project points
 *          at it with `links.billing.catalog` in mushi.recipe.json; the GitHub
 *          connector reads it at the head SHA (github.ts `billingCatalog`).
 *
 * The file is repo text: parsed defensively, capped, and only the fields the
 * drift rules compare are kept. Prices are not kept — RevenueCat holds only
 * indicative prices, so price drift is a store-side check (planned).
 */

/** Largest catalog file read, in characters. */
const MAX_CATALOG_CHARS = 256 * 1024

export type CatalogPlatform = 'app_store' | 'play_store'

export interface CatalogStoreApp {
  platform: CatalogPlatform
  /** Bundle id (App Store) or package name (Play). */
  storeId: string
  rcAppId: string | null
}

export interface CatalogApp {
  id: string
  displayName: string | null
  storeApps: CatalogStoreApp[]
  /** Id of the catalog webhook this app's purchases go to. */
  webhook: string | null
  offering: string | null
}

export interface CatalogProduct {
  app: string
  platform: CatalogPlatform
  storeIdentifier: string
  entitlements: string[]
  /** What the catalog last recorded for the store (`absent`, `approved`, …); declared, not live. */
  storeState: string | null
}

export interface CatalogPackage {
  lookupKey: string
  products: Partial<Record<CatalogPlatform, string>>
}

export interface CatalogOffering {
  lookupKey: string
  app: string | null
  packages: CatalogPackage[]
}

export interface CatalogWebhook {
  id: string
  /** host + path, as webhookUrlKey() keeps it. */
  url: string
  /** `all`, or `<appId>:<platform>` entries. */
  apps: 'all' | string[]
}

export interface BillingCatalog {
  /** The RevenueCat project the catalog describes (the hub). */
  projectId: string | null
  apps: CatalogApp[]
  entitlements: Array<{ lookupKey: string; app: string | null }>
  products: CatalogProduct[]
  offerings: CatalogOffering[]
  webhooks: CatalogWebhook[]
}

/** A webhook URL as host + path: query strings can carry tokens. */
export function webhookUrlKey(raw: unknown): string {
  try {
    const u = new URL(String(raw))
    return `${u.host}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function s(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
}

function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : []
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function platform(v: unknown): CatalogPlatform | null {
  return v === 'app_store' || v === 'play_store' ? v : null
}

export type CatalogParse = { ok: true; catalog: BillingCatalog } | { ok: false; error: string }

/** Parse catalog text. Unknown fields are ignored; a file with no apps is an error, not an empty catalog. */
export function parseBillingCatalog(text: string): CatalogParse {
  if (text.length > MAX_CATALOG_CHARS) return { ok: false, error: `The catalog is over ${MAX_CATALOG_CHARS / 1024} KB.` }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The catalog is not valid JSON.' }
  }
  const root = obj(raw)
  const apps: CatalogApp[] = arr(root.apps, 50).map(obj).flatMap((a) => {
    const id = s(a.id, 120)
    if (!id) return []
    const storeApps = arr(a.store_apps, 10).map(obj).flatMap((x) => {
      const pf = platform(x.platform)
      const storeId = pf === 'app_store' ? s(x.bundle_id) : pf === 'play_store' ? s(x.package_name) : null
      return pf && storeId ? [{ platform: pf, storeId, rcAppId: s(x.rc_app_id, 120) }] : []
    })
    return [{ id, displayName: s(a.display_name, 200), storeApps, webhook: s(a.webhook, 120), offering: s(a.offering, 200) }]
  })
  if (apps.length === 0) return { ok: false, error: 'The catalog lists no apps.' }
  const products: CatalogProduct[] = arr(root.products, 500).map(obj).flatMap((p) => {
    const app = s(p.app, 120)
    const pf = platform(p.platform)
    const storeIdentifier = s(p.store_identifier)
    if (!app || !pf || !storeIdentifier) return []
    return [{ app, platform: pf, storeIdentifier, entitlements: arr(p.entitlements, 20).map((e) => s(e, 200)).filter((e): e is string => Boolean(e)), storeState: s(p.store_state, 60) }]
  })
  const offerings: CatalogOffering[] = arr(root.offerings, 100).map(obj).flatMap((o) => {
    const lookupKey = s(o.lookup_key, 200)
    if (!lookupKey) return []
    const packages = arr(o.packages, 50).map(obj).flatMap((p) => {
      const key = s(p.lookup_key, 200)
      if (!key) return []
      const prods = obj(p.products)
      const out: Partial<Record<CatalogPlatform, string>> = {}
      for (const pf of ['app_store', 'play_store'] as const) {
        const id = s(prods[pf])
        if (id) out[pf] = id
      }
      return [{ lookupKey: key, products: out }]
    })
    return [{ lookupKey, app: s(o.app, 120), packages }]
  })
  const webhooks: CatalogWebhook[] = arr(root.webhooks, 50).map(obj).flatMap((w) => {
    const id = s(w.id, 120)
    const url = webhookUrlKey(w.url)
    if (!id || !url) return []
    const apps = w.apps === 'all' ? 'all' as const : arr(w.apps, 50).map((x) => s(x, 200)).filter((x): x is string => Boolean(x))
    return [{ id, url, apps }]
  })
  return {
    ok: true,
    catalog: {
      projectId: s(obj(root.project).id, 120),
      apps,
      entitlements: arr(root.entitlements, 200).map(obj).flatMap((e) => {
        const lookupKey = s(e.lookup_key, 200)
        return lookupKey ? [{ lookupKey, app: s(e.app, 120) }] : []
      }),
      products,
      offerings,
      webhooks,
    },
  }
}

/** The repo path a recipe declares for its catalog (`links.billing.catalog`), or null. */
export function catalogPathOf(manifest: unknown): string | null {
  const path = s(obj(obj(obj(manifest).links).billing).catalog, 300)
  if (!path) return null
  const clean = path.replace(/^\/+/, '')
  return /^[\w./-]+\.json$/.test(clean) && !clean.includes('..') ? clean : null
}
