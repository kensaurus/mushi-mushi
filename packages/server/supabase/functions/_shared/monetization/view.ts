/**
 * FILE: packages/server/supabase/functions/_shared/monetization/view.ts
 * PURPOSE: The console's Monetization card read model (ADR 0025): per
 *          RevenueCat hub, each app's entitlements → products and offerings
 *          → packages → products with their store state, the drift the rules
 *          found with the fix, and the headline numbers as context. Built
 *          from the same evaluation the radar stores, so both agree.
 */

import type { RcProduct, RevenueCatProjectFacts } from '../connectors/revenuecat.ts'
import { catalogFor, type MonetizationSources, type OrgHub } from './load.ts'
import { evaluateMonetization, hubOwnership, type MonetizationFinding, type MonetizationHub, type MonetizationProject, type RuleOutcome, type StoreRead } from './rules.ts'

export interface ProductView {
  id: string
  storeIdentifier: string
  platform: 'iOS' | 'Android' | string
  /** The store's own state when its connector read it; null = not read. */
  storeState: string | null
}

export interface MonetizationAppView {
  projectId: string
  name: string
  rcApps: Array<{ id: string; platform: string; storeId: string | null }>
  entitlements: Array<{ lookupKey: string; name: string | null; products: ProductView[] | null }>
  offerings: Array<{ lookupKey: string; isCurrent: boolean; hasPaywall: boolean; packages: Array<{ id: string; lookupKey: string; products: ProductView[] }> | null }>
  rules: Array<Pick<RuleOutcome, 'ruleId' | 'state' | 'reason'>>
  findings: MonetizationFinding[]
}

export interface MonetizationHubView {
  rcProjectId: string
  /** The RevenueCat dashboard for this project. */
  dashboardUrl: string
  observedAt: string | null
  connector: { id: string; status: string | null; canAct: boolean } | null
  read: { state: 'read' } | { state: 'unknown' | 'error'; reason: string }
  catalog: { state: 'read' | 'none' | 'error'; source: string | null; reason: string | null }
  metrics: RevenueCatProjectFacts['metrics'] | null
  apps: MonetizationAppView[]
  /** Findings no app could be tied to (an empty offering no catalog or recipe names). */
  unattributed: MonetizationFinding[]
}

export interface MonetizationResponse {
  hubs: MonetizationHubView[]
  /** Apps that sell but are bound to no RevenueCat project. */
  outsideHub: Array<{ projectId: string; name: string; finding: MonetizationFinding }>
  /** Rule ids Mushi names but does not check yet. */
  planned: string[]
}

const PLATFORM: Record<string, string> = { app_store: 'iOS', play_store: 'Android' }

/** The dashboard URL takes the project id without its `proj` prefix (app.revenuecat.com/projects/<id>). */
export function revenuecatDashboardUrl(rcProjectId: string): string {
  return `https://app.revenuecat.com/projects/${encodeURIComponent(rcProjectId.replace(/^proj/, ''))}`
}

function storeStateOf(p: MonetizationProject | undefined, platform: string, storeIdentifier: string): string | null {
  const read: StoreRead | null | undefined = platform === 'iOS' ? p?.ios : platform === 'Android' ? p?.android : null
  if (!read || read.state !== 'read') return null
  return read.items.find((x) => x.storeIdentifier === storeIdentifier)?.state ?? 'NOT_IN_STORE'
}

function hubView(sources: MonetizationSources, org: OrgHub): MonetizationHubView {
  const { hub } = org
  const evaluation = evaluateMonetization(hub)
  const owners = hubOwnership(hub)
  const rc = hub.rc
  const products = new Map<string, RcProduct>((rc?.products?.state === 'read' ? rc.products.items : []).map((p) => [p.id, p]))
  const appOf = new Map((rc?.apps ?? []).map((a) => [a.id, a]))
  const ownerOfProduct = (p: RcProduct) => hub.projects.find((x) => owners[x.id]?.rcAppIds.includes(p.appId))
  const productView = (id: string): ProductView => {
    const p = products.get(id)
    if (!p) return { id, storeIdentifier: id, platform: '', storeState: null }
    const platform = PLATFORM[appOf.get(p.appId)?.type ?? ''] ?? appOf.get(p.appId)?.type ?? ''
    return { id, storeIdentifier: p.storeIdentifier, platform, storeState: storeStateOf(ownerOfProduct(p), platform, p.storeIdentifier) }
  }
  const instance = sources.rcInstances.find((i) => i.id === org.instanceId)
  return {
    rcProjectId: org.rcProjectId,
    dashboardUrl: revenuecatDashboardUrl(org.rcProjectId),
    observedAt: org.observedAt,
    connector: instance ? { id: instance.id, status: instance.status, canAct: instance.enabledCapabilities.includes('act') } : null,
    read: rc ? { state: 'read' } : hub.rcMissing ?? { state: 'unknown', reason: 'RevenueCat has not been read yet.' },
    catalog: hub.catalog.state === 'read'
      ? { state: 'read', source: hub.catalog.source, reason: null }
      : hub.catalog.state === 'error' ? { state: 'error', source: hub.catalog.source, reason: hub.catalog.reason } : { state: 'none', source: null, reason: null },
    metrics: rc?.metrics ?? null,
    apps: hub.projects.map((p) => {
      const own = owners[p.id] ?? { rcAppIds: [], offerings: [], entitlements: [] }
      const outcomes = evaluation.byProject[p.id] ?? []
      return {
        projectId: p.id,
        name: p.name,
        rcApps: own.rcAppIds.map((id) => ({ id, platform: PLATFORM[appOf.get(id)?.type ?? ''] ?? appOf.get(id)?.type ?? '', storeId: appOf.get(id)?.storeId ?? null })),
        entitlements: (rc?.entitlements ?? []).filter((e) => own.entitlements.includes(e.lookupKey)).map((e) => ({ lookupKey: e.lookupKey, name: e.name, products: e.productIds ? e.productIds.map(productView) : null })),
        offerings: (rc?.offerings ?? []).filter((o) => own.offerings.includes(o.lookupKey)).map((o) => ({
          lookupKey: o.lookupKey,
          isCurrent: o.isCurrent,
          hasPaywall: Boolean(o.paywallId),
          packages: o.packages ? o.packages.map((k) => ({ id: k.id, lookupKey: k.lookupKey, products: k.productIds.map(productView) })) : null,
        })),
        rules: outcomes.map((r) => ({ ruleId: r.ruleId, state: r.state, reason: r.reason })),
        findings: outcomes.flatMap((r) => r.findings),
      }
    }),
    unattributed: evaluation.unattributed,
  }
}

/** Every hub in the team plus the apps selling outside any hub. */
export function monetizationResponse(sources: MonetizationSources, org: { hubs: OrgHub[]; unbound: MonetizationProject[] }): MonetizationResponse {
  const outside: MonetizationHub = { rc: null, catalog: catalogFor(sources, null), projects: org.unbound }
  const unbound = evaluateMonetization(outside)
  return {
    hubs: org.hubs.map((h) => hubView(sources, h)),
    outsideHub: org.unbound.flatMap((p) => {
      const f = unbound.byProject[p.id]?.find((r) => r.ruleId === 'monetization_app_outside_hub')?.findings[0]
      return f ? [{ projectId: p.id, name: p.name, finding: f }] : []
    }),
    planned: ['monetization_billing_library_outdated'],
  }
}
