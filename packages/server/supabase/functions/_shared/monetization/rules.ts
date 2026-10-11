/**
 * FILE: packages/server/supabase/functions/_shared/monetization/rules.ts
 * PURPOSE: The "why nobody can pay" checks (ADR 0025 §4 Check). Pure: they
 *          read one RevenueCat hub project as read by the connector, the
 *          operator's billing catalog, each app's recipe and the store
 *          product states, and say per app what stops a purchase from
 *          working, in plain English, with the fix.
 *
 * Every rule answers per app with `ok`, `finding`, `unknown` or `error`.
 * `unknown` (could not look) is never healthy. Findings are attributed to the
 * app that owns them — through product app ids, then the catalog, then the
 * recipe — because every app binds the same RevenueCat project and a hub-wide
 * finding would otherwise read as "shared by five apps". What cannot be tied
 * to an app is returned as `unattributed` for the console card only.
 *
 * Planned, not built: `monetization_billing_library_outdated` (neither the
 * recipe nor the ingest reports the purchases SDK version yet).
 */

import type { DetectorState, RadarRuleId, RadarSeverity } from '../radar/types.ts'
import type { RcApp, RcOffering, RcProduct, RevenueCatProjectFacts } from '../connectors/revenuecat.ts'
import type { DriftFinding } from '../connectors/types.ts'
import type { BillingCatalog, CatalogApp, CatalogPlatform } from './catalog.ts'

export type MonetizationRuleId = Extract<RadarRuleId, `monetization_${string}`>

export const MONETIZATION_RULES: readonly MonetizationRuleId[] = [
  'monetization_app_outside_hub',
  'monetization_ios_app_missing',
  'monetization_offering_empty',
  'monetization_entitlement_unattached',
  'monetization_product_not_in_offering',
  'monetization_catalog_drift',
  'monetization_store_product_unready',
  'monetization_webhook_unhealthy',
]

/** At most this many findings per rule and app; the reason says how many were left out. */
const MAX_FINDINGS = 20

/** iOS product states that can be bought (or are only waiting for the operator to submit). */
const IOS_READY = new Set(['APPROVED', 'READY_TO_SUBMIT'])

export interface SuggestedAction {
  action: 'attach_products_to_package'
  payload: { rcProjectId: string; packageId: string; products: Array<{ productId: string; eligibilityCriteria: 'all' }> }
}

export interface MonetizationFinding {
  ruleId: MonetizationRuleId
  severity: RadarSeverity
  message: string
  fix: string
  /** What it is about: a bundle id, offering, entitlement or product. */
  target: string | null
  /** Apps it belongs to; empty = could not be tied to one. */
  projectIds: string[]
  /** An approved action that would fix it, when one exists. */
  action?: SuggestedAction
}

export interface RuleOutcome {
  ruleId: MonetizationRuleId
  state: DetectorState
  reason: string
  findings: MonetizationFinding[]
}

export interface StoreProduct {
  /** As RevenueCat names it: the iOS product id, the Play product id, or `<subscription>:<basePlan>`. */
  storeIdentifier: string
  state: string
}

/** A store product read; `unknown` = the store would not answer (blocked, no permission). */
export type StoreRead = { state: 'read'; items: StoreProduct[] } | { state: 'unknown'; reason: string }

export interface MonetizationProject {
  id: string
  name: string
  manifest: unknown
  /** The RevenueCat project this app's connector binds; null = not bound. */
  rcProjectId: string | null
  /** App Store products; null or absent = App Store Connect is not connected for this app. */
  ios?: StoreRead | null
  /** Play products; null or absent = Play Console is not connected for this app. */
  android?: StoreRead | null
}

export type CatalogInput =
  | { state: 'read'; catalog: BillingCatalog; source: string }
  | { state: 'error'; reason: string; source: string }
  | { state: 'none' }

export interface MonetizationHub {
  /** The hub RevenueCat project as last read; null = no readable snapshot. */
  rc: RevenueCatProjectFacts | null
  /** Why `rc` is null. */
  rcMissing?: { state: 'unknown' | 'error'; reason: string }
  catalog: CatalogInput
  projects: MonetizationProject[]
}

export interface MonetizationEvaluation {
  byProject: Record<string, RuleOutcome[]>
  unattributed: MonetizationFinding[]
}

// ── reading the recipe ──────────────────────────────────────────────────────

function o(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= 300 ? v.trim() : null
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(s).filter((x): x is string => Boolean(x)).slice(0, 50) : []
}

function billingOf(manifest: unknown): Record<string, any> {
  return o(o(o(manifest).links).billing)
}

const PLATFORM_LABEL: Record<CatalogPlatform, string> = { app_store: 'iOS', play_store: 'Android' }

/** Everything derived once per app. */
interface AppView {
  p: MonetizationProject
  bundleIds: Set<string>
  packages: Set<string>
  catalogApp: CatalogApp | null
  /** RevenueCat apps (in the hub) that are this app's store apps. */
  rcApps: RcApp[]
  sells: boolean
  sellsWhy: string | null
}

function catalogOf(hub: MonetizationHub): BillingCatalog | null {
  return hub.catalog.state === 'read' ? hub.catalog.catalog : null
}

function appView(hub: MonetizationHub, p: MonetizationProject): AppView {
  const m = o(p.manifest)
  const billing = billingOf(p.manifest)
  const bundleIds = new Set([s(m.app?.ids?.bundleId), s(m.store?.ios?.bundleId)].filter((x): x is string => Boolean(x)))
  const packages = new Set([s(m.app?.ids?.androidPackage), s(m.store?.android?.package)].filter((x): x is string => Boolean(x)))
  const catalog = catalogOf(hub)
  const explicit = s(billing.catalogApp)
  const catalogApp = catalog
    ? (explicit ? catalog.apps.find((a) => a.id === explicit) : catalog.apps.find((a) => a.storeApps.some((x) => (x.platform === 'app_store' ? bundleIds : packages).has(x.storeId)))) ?? null
    : null
  for (const x of catalogApp?.storeApps ?? []) (x.platform === 'app_store' ? bundleIds : packages).add(x.storeId)
  const rcAppIds = new Set((catalogApp?.storeApps ?? []).map((x) => x.rcAppId).filter(Boolean))
  const rcApps = (hub.rc?.apps ?? []).filter((a) =>
    rcAppIds.has(a.id) || (a.storeId !== null && ((a.type === 'app_store' && bundleIds.has(a.storeId)) || (a.type === 'play_store' && packages.has(a.storeId)))))
  const sellsWhy = billing.sells === true ? 'links.billing.sells' : catalogApp ? 'the billing catalog' : s(billing.catalog) ? 'links.billing.catalog' : s(billing.offering) ? 'links.billing.offering' : list(billing.entitlements).length ? 'links.billing.entitlements' : null
  return { p, bundleIds, packages, catalogApp, rcApps, sells: sellsWhy !== null, sellsWhy }
}

// ── attribution ─────────────────────────────────────────────────────────────

function productOwners(views: AppView[], product: RcProduct | undefined): string[] {
  if (!product) return []
  return views.filter((v) => v.rcApps.some((a) => a.id === product.appId)).map((v) => v.p.id)
}

function productsById(rc: RevenueCatProjectFacts | null): Map<string, RcProduct> {
  return new Map((rc?.products?.state === 'read' ? rc.products.items : []).map((p) => [p.id, p]))
}

function offeringOwners(hub: MonetizationHub, views: AppView[], off: RcOffering, byId: Map<string, RcProduct>): string[] {
  const owners = new Set<string>()
  for (const pkg of off.packages ?? []) for (const id of pkg.productIds) for (const pid of productOwners(views, byId.get(id))) owners.add(pid)
  const catalogApp = catalogOf(hub)?.offerings.find((x) => x.lookupKey === off.lookupKey)?.app ?? null
  for (const v of views) {
    if ((catalogApp && v.catalogApp?.id === catalogApp) || v.catalogApp?.offering === off.lookupKey || s(billingOf(v.p.manifest).offering) === off.lookupKey) owners.add(v.p.id)
  }
  return [...owners]
}

function entitlementOwners(hub: MonetizationHub, views: AppView[], lookupKey: string, productIds: readonly string[], byId: Map<string, RcProduct>): string[] {
  const owners = new Set<string>()
  for (const id of productIds) for (const pid of productOwners(views, byId.get(id))) owners.add(pid)
  const catalogApp = catalogOf(hub)?.entitlements.find((x) => x.lookupKey === lookupKey)?.app ?? null
  for (const v of views) {
    if ((catalogApp && v.catalogApp?.id === catalogApp) || list(billingOf(v.p.manifest).entitlements).includes(lookupKey)) owners.add(v.p.id)
  }
  return [...owners]
}

function platformOf(app: RcApp | undefined): CatalogPlatform | null {
  return app?.type === 'app_store' || app?.type === 'play_store' ? app.type : null
}

// ── outcome helpers ─────────────────────────────────────────────────────────

function rcGap(hub: MonetizationHub): { state: DetectorState; reason: string } | null {
  if (hub.rc) return null
  return hub.rcMissing ?? { state: 'unknown', reason: 'Not checked: connect RevenueCat and bind this app to its project to check this.' }
}

function outcome(ruleId: MonetizationRuleId, findings: MonetizationFinding[], okReason: string, partial: string | null = null): RuleOutcome {
  if (findings.length) {
    const shown = findings.slice(0, MAX_FINDINGS)
    const more = findings.length - shown.length
    return { ruleId, state: 'finding', reason: `${findings.length} to fix${more > 0 ? ` (showing ${shown.length})` : ''}.${partial ? ` ${partial}` : ''}`, findings: shown }
  }
  // Nothing found, but part of it could not be looked at: not a pass.
  if (partial) return { ruleId, state: 'unknown', reason: partial, findings: [] }
  return { ruleId, state: 'ok', reason: okReason, findings: [] }
}

function unknown(ruleId: MonetizationRuleId, reason: string, state: DetectorState = 'unknown'): RuleOutcome {
  return { ruleId, state, reason, findings: [] }
}

const NOT_RE_READ = 'RevenueCat has not been re-read since this check was added. It is read daily at 03:35 UTC.'

// ── the rules ───────────────────────────────────────────────────────────────

function appOutsideHub(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_app_outside_hub'
  if (!v.sells) return unknown(id, 'This app does not say it sells anything (links.billing in mushi.recipe.json) and no billing catalog lists it.')
  const hubId = catalogOf(hub)?.projectId ?? null
  if (!v.p.rcProjectId) {
    return outcome(id, [{
      ruleId: id, severity: 'warn', target: v.p.name, projectIds: [v.p.id],
      message: `${v.p.name} sells (per ${v.sellsWhy}) but is not bound to a RevenueCat project, so Mushi cannot see whether a purchase would work, and a pass bought in another app can never unlock it.`,
      fix: `Bind ${v.p.name} to RevenueCat project ${hubId ?? 'your hub project'} on the RevenueCat connector (Portfolio → Connected sources), and register its store apps in that project.`,
    }], '')
  }
  if (hubId && v.p.rcProjectId !== hubId) {
    return outcome(id, [{
      ruleId: id, severity: 'warn', target: v.p.rcProjectId, projectIds: [v.p.id],
      message: `${v.p.name} is bound to RevenueCat project ${v.p.rcProjectId}, but the billing catalog's hub is ${hubId}. Entitlements are shared only inside one project, so this app's purchases and the other apps' passes never meet.`,
      fix: `Move ${v.p.name}'s store apps into RevenueCat project ${hubId} and rebind it there.`,
    }], '')
  }
  return outcome(id, [], hubId ? `Bound to the hub RevenueCat project ${hubId}.` : `Bound to RevenueCat project ${v.p.rcProjectId}. Declare links.billing.catalog to name the hub.`)
}

function iosAppMissing(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_ios_app_missing'
  const gap = rcGap(hub)
  if (gap) return unknown(id, gap.reason, gap.state)
  if (v.bundleIds.size === 0) return unknown(id, 'No iOS bundle id is declared (app.ids.bundleId in the recipe, or the catalog), so there is nothing to check.')
  const rc = hub.rc!
  if (rc.truncated?.apps) return unknown(id, 'RevenueCat listed more apps than Mushi reads, so a missing one cannot be told apart.')
  const findings = [...v.bundleIds].filter((b) => !rc.apps.some((a) => a.type === 'app_store' && a.storeId === b)).map((b): MonetizationFinding => ({
    ruleId: id, severity: 'warn', target: b, projectIds: [v.p.id],
    message: `iPhone users of ${v.p.name} cannot pay: ${b} is not an App Store app in RevenueCat project ${rc.rcProjectId}, so iOS purchases are never validated and nothing unlocks.`,
    fix: `In RevenueCat, add an App Store app for ${b} (it needs an App Store Connect In-App Purchase key), then attach its products to ${v.catalogApp?.offering ?? "this app's offering"}.`,
  }))
  return outcome(id, findings, `Every iOS bundle id is an App Store app in RevenueCat project ${rc.rcProjectId}.`)
}

function offeringEmpty(hub: MonetizationHub, views: AppView[]): { per: Map<string, RuleOutcome>; unattributed: MonetizationFinding[] } {
  const id = 'monetization_offering_empty'
  const per = new Map<string, RuleOutcome>()
  const gap = rcGap(hub)
  if (gap) {
    for (const v of views) per.set(v.p.id, unknown(id, gap.reason, gap.state))
    return { per, unattributed: [] }
  }
  const rc = hub.rc!
  if (rc.offerings.some((x) => x.packages === undefined) || rc.products === undefined) {
    for (const v of views) per.set(v.p.id, unknown(id, NOT_RE_READ))
    return { per, unattributed: [] }
  }
  const byId = productsById(rc)
  const found: MonetizationFinding[] = []
  let partial: string | null = rc.truncated?.offerings ? 'RevenueCat listed more offerings than Mushi reads; the rest were not checked.' : null
  for (const off of rc.offerings) {
    if (off.packagesTruncated) {
      partial = `The ${off.lookupKey} offering has more packages than Mushi reads; it was not checked.`
      continue
    }
    const pkgs = off.packages ?? []
    const owners = offeringOwners(hub, views, off, byId)
    const fullyEmpty = pkgs.every((p) => p.productIds.length === 0 && !p.truncated)
    if (fullyEmpty) {
      found.push({
        ruleId: id, severity: 'warn', target: off.lookupKey, projectIds: owners,
        message: pkgs.length === 0
          ? `The ${off.lookupKey} offering has no packages, so its paywall shows nothing and nobody can buy.`
          : `The ${off.lookupKey} offering's packages (${pkgs.map((p) => p.lookupKey).join(', ')}) have no products, so its paywall shows nothing and nobody can buy.`,
        fix: `In RevenueCat, open Product catalog → Offerings → ${off.lookupKey} and attach the store products to each package.`,
      })
      continue
    }
    // Per platform: an app whose RevenueCat app exists but whose packages carry no product for it.
    for (const ownerId of owners) {
      const v = views.find((x) => x.p.id === ownerId)!
      for (const app of v.rcApps) {
        const pf = platformOf(app)
        if (!pf) continue
        const empty = pkgs.filter((p) => !p.truncated && !p.productIds.some((pid) => byId.get(pid)?.appId === app.id))
        if (empty.length === 0) continue
        found.push({
          ruleId: id, severity: 'warn', target: `${off.lookupKey} (${PLATFORM_LABEL[pf]})`, projectIds: [ownerId],
          message: empty.length === pkgs.length
            ? `On ${PLATFORM_LABEL[pf]}, the ${off.lookupKey} offering has no product in any package, so the ${v.p.name} paywall there shows nothing.`
            : `On ${PLATFORM_LABEL[pf]}, the ${off.lookupKey} packages ${empty.map((p) => p.lookupKey).join(', ')} have no product, so ${v.p.name} users there cannot buy them.`,
          fix: `In RevenueCat, attach ${v.p.name}'s ${PLATFORM_LABEL[pf]} products to ${empty.map((p) => p.lookupKey).join(', ')} in the ${off.lookupKey} offering.`,
        })
      }
    }
  }
  for (const v of views) per.set(v.p.id, outcome(id, found.filter((f) => f.projectIds.includes(v.p.id)), "Every offering this app sells through has a product in each package on each of its platforms.", partial))
  return { per, unattributed: found.filter((f) => f.projectIds.length === 0) }
}

function entitlementUnattached(hub: MonetizationHub, views: AppView[]): { per: Map<string, RuleOutcome>; unattributed: MonetizationFinding[] } {
  const id = 'monetization_entitlement_unattached'
  const per = new Map<string, RuleOutcome>()
  const gap = rcGap(hub)
  if (gap) {
    for (const v of views) per.set(v.p.id, unknown(id, gap.reason, gap.state))
    return { per, unattributed: [] }
  }
  const rc = hub.rc!
  if (rc.entitlements.some((e) => e.productIds === undefined)) {
    for (const v of views) per.set(v.p.id, unknown(id, NOT_RE_READ))
    return { per, unattributed: [] }
  }
  const byId = productsById(rc)
  const found: MonetizationFinding[] = rc.entitlements.filter((e) => (e.productIds ?? []).length === 0 && !e.productsTruncated).map((e) => ({
    ruleId: id, severity: 'warn', target: e.lookupKey, projectIds: entitlementOwners(hub, views, e.lookupKey, [], byId),
    message: `The ${e.lookupKey} entitlement has no products, so no purchase grants it: someone who pays for it gets nothing.`,
    fix: `In RevenueCat, open Product catalog → Entitlements → ${e.lookupKey} and attach the products that should unlock it.`,
  }))
  const partial = rc.truncated?.entitlements ? 'RevenueCat listed more entitlements than Mushi reads; the rest were not checked.' : null
  for (const v of views) per.set(v.p.id, outcome(id, found.filter((f) => f.projectIds.includes(v.p.id)), "Every entitlement tied to this app is granted by at least one product.", partial))
  return { per, unattributed: found.filter((f) => f.projectIds.length === 0) }
}

function productNotInOffering(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_product_not_in_offering'
  const gap = rcGap(hub)
  if (gap) return unknown(id, gap.reason, gap.state)
  const rc = hub.rc!
  if (rc.products === undefined || rc.offerings.some((x) => x.packages === undefined)) return unknown(id, NOT_RE_READ)
  if (rc.products.state !== 'read') return unknown(id, rc.products.reason)
  if (v.rcApps.length === 0) return unknown(id, "None of this app's store apps are in RevenueCat yet, so it has no products to check.")
  if (rc.products.truncated || rc.truncated?.offerings || rc.offerings.some((x) => x.packagesTruncated || (x.packages ?? []).some((p) => p.truncated))) {
    return unknown(id, 'RevenueCat listed more products or packages than Mushi reads, so a product cannot be said to be in no offering.')
  }
  const sold = new Set(rc.offerings.flatMap((x) => (x.packages ?? []).flatMap((p) => p.productIds)))
  const appIds = new Set(v.rcApps.map((a) => a.id))
  const findings = rc.products.items.filter((p) => appIds.has(p.appId) && p.state !== 'inactive' && !sold.has(p.id)).map((p): MonetizationFinding => {
    const pf = platformOf(v.rcApps.find((a) => a.id === p.appId))
    return {
      ruleId: id, severity: 'info', target: p.storeIdentifier, projectIds: [v.p.id],
      message: `${p.storeIdentifier}${pf ? ` (${PLATFORM_LABEL[pf]})` : ''} is a ${v.p.name} product in RevenueCat but in no offering, so no paywall can sell it.`,
      fix: `Attach ${p.storeIdentifier} to a package in ${v.catalogApp?.offering ?? "this app's offering"}, or archive it in RevenueCat if it is retired.`,
    }
  })
  return outcome(id, findings, "Every active product of this app is in at least one offering.")
}

function catalogDrift(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_catalog_drift'
  if (hub.catalog.state === 'none') return unknown(id, 'No billing catalog is declared. Set links.billing.catalog in the mushi.recipe.json of the repo that holds it.')
  if (hub.catalog.state === 'error') return unknown(id, `The billing catalog (${hub.catalog.source}) could not be read: ${hub.catalog.reason}`, 'error')
  const catalog = hub.catalog.catalog
  const gap = rcGap(hub)
  if (gap) return unknown(id, gap.reason, gap.state)
  const rc = hub.rc!
  if (catalog.projectId && catalog.projectId !== rc.rcProjectId) return unknown(id, `The catalog describes RevenueCat project ${catalog.projectId}; this app is bound to ${rc.rcProjectId}.`)
  const ca = v.catalogApp
  if (!ca) return unknown(id, 'This app is not in the billing catalog (no store id matches; set links.billing.catalogApp to name it).')
  if (rc.products === undefined || rc.entitlements.some((e) => e.productIds === undefined) || rc.offerings.some((x) => x.packages === undefined)) return unknown(id, NOT_RE_READ)
  if (rc.products.state !== 'read') return unknown(id, rc.products.reason)
  const live = rc.products.items
  const findings: MonetizationFinding[] = []
  const add = (severity: RadarSeverity, target: string, message: string, fix: string, action?: SuggestedAction) => findings.push({ ruleId: id, severity, target, projectIds: [v.p.id], message, fix, ...(action ? { action } : {}) })

  // Platforms whose RevenueCat app exists; the others are monetization_ios_app_missing / revenuecat_app_missing.
  const rcAppFor = new Map<CatalogPlatform, RcApp>()
  for (const x of ca.storeApps) {
    const app = rc.apps.find((a) => (x.rcAppId && a.id === x.rcAppId) || (a.type === x.platform && a.storeId === x.storeId))
    if (app) rcAppFor.set(x.platform, app)
  }
  const skipped = ca.storeApps.filter((x) => !rcAppFor.has(x.platform)).map((x) => PLATFORM_LABEL[x.platform])
  const liveProduct = (pf: CatalogPlatform, sid: string) => live.find((p) => p.appId === rcAppFor.get(pf)?.id && p.storeIdentifier === sid)

  for (const cp of catalog.products.filter((p) => p.app === ca.id && rcAppFor.has(p.platform))) {
    const lp = liveProduct(cp.platform, cp.storeIdentifier)
    if (!lp) {
      add(cp.storeState === 'absent' ? 'info' : 'warn', cp.storeIdentifier,
        `The catalog lists ${cp.storeIdentifier} on ${PLATFORM_LABEL[cp.platform]}, but RevenueCat has no such product for ${v.p.name}${cp.storeState === 'absent' ? ' (the catalog notes it is not in the store yet)' : ''}.`,
        `Add ${cp.storeIdentifier} to the ${PLATFORM_LABEL[cp.platform]} app in RevenueCat, or re-run the catalog sync.`)
      continue
    }
    for (const key of cp.entitlements) {
      const ent = rc.entitlements.find((e) => e.lookupKey === key)
      if (ent && !ent.productsTruncated && !(ent.productIds ?? []).includes(lp.id)) {
        add('warn', `${cp.storeIdentifier} → ${key}`,
          `Buying ${cp.storeIdentifier} on ${PLATFORM_LABEL[cp.platform]} does not grant ${key} in RevenueCat, so the buyer pays and nothing unlocks.`,
          `In RevenueCat, attach ${cp.storeIdentifier} to the ${key} entitlement.`)
      }
    }
  }
  for (const [pf, app] of rcAppFor) {
    for (const lp of live.filter((p) => p.appId === app.id && p.state !== 'inactive')) {
      if (!catalog.products.some((cp) => cp.app === ca.id && cp.platform === pf && cp.storeIdentifier === lp.storeIdentifier)) {
        add('info', lp.storeIdentifier, `RevenueCat has ${lp.storeIdentifier} on ${PLATFORM_LABEL[pf]} for ${v.p.name}, which the catalog does not list.`, `Add ${lp.storeIdentifier} to the catalog, or archive it in RevenueCat.`)
      }
    }
  }
  for (const ce of catalog.entitlements.filter((e) => e.app === ca.id)) {
    if (!rc.entitlements.some((e) => e.lookupKey === ce.lookupKey)) {
      add('warn', ce.lookupKey, `The catalog's ${ce.lookupKey} entitlement does not exist in RevenueCat, so nothing ${v.p.name} sells can unlock it.`, `Create the ${ce.lookupKey} entitlement in RevenueCat, or re-run the catalog sync.`)
    }
  }
  for (const co of catalog.offerings.filter((x) => x.app === ca.id)) {
    const lo = rc.offerings.find((x) => x.lookupKey === co.lookupKey)
    if (!lo) {
      add('warn', co.lookupKey, `The catalog's ${co.lookupKey} offering does not exist in RevenueCat, so the ${v.p.name} paywall that asks for it gets nothing.`, `Create the ${co.lookupKey} offering in RevenueCat, or re-run the catalog sync.`)
      continue
    }
    if (lo.packagesTruncated) continue
    for (const cpk of co.packages) {
      const lpk = (lo.packages ?? []).find((x) => x.lookupKey === cpk.lookupKey)
      if (!lpk) {
        add('warn', `${co.lookupKey}/${cpk.lookupKey}`, `The ${co.lookupKey} offering has no ${cpk.lookupKey} package, which the catalog lists.`, `Add the ${cpk.lookupKey} package to ${co.lookupKey} in RevenueCat.`)
        continue
      }
      if (lpk.truncated) continue
      for (const [pf, sid] of Object.entries(cpk.products) as Array<[CatalogPlatform, string]>) {
        const app = rcAppFor.get(pf)
        if (!app) continue
        const expected = liveProduct(pf, sid)
        if (!expected) continue // reported above as a missing product
        if (lpk.productIds.includes(expected.id)) continue
        const others = lpk.productIds.map((pid) => live.find((p) => p.id === pid)).filter((p): p is RcProduct => p?.appId === app.id).map((p) => p.storeIdentifier)
        add('warn', `${co.lookupKey}/${cpk.lookupKey} (${PLATFORM_LABEL[pf]})`,
          `On ${PLATFORM_LABEL[pf]}, package ${cpk.lookupKey} in ${co.lookupKey} should sell ${sid} but ${others.length ? `sells ${others.join(', ')}` : 'sells nothing'}.`,
          `Attach ${sid} to package ${cpk.lookupKey} in RevenueCat${others.length ? ` and detach ${others.join(', ')}` : ''}.`,
          { action: 'attach_products_to_package', payload: { rcProjectId: rc.rcProjectId, packageId: lpk.id, products: [{ productId: expected.id, eligibilityCriteria: 'all' }] } })
      }
    }
  }
  const partial = rc.products.truncated ? 'RevenueCat listed more products than Mushi reads; extra products were not compared.' : null
  const skippedNote = skipped.length ? ` ${skipped.join(' and ')} not compared: its RevenueCat app is missing (see the app-registration checks).` : ''
  return outcome(id, findings, `RevenueCat matches the catalog for ${v.p.name}.${skippedNote}`, partial)
}

function storeProductUnready(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_store_product_unready'
  const platforms: Array<{ pf: CatalogPlatform; read: StoreRead | null | undefined; connector: string }> = []
  if (v.bundleIds.size) platforms.push({ pf: 'app_store', read: v.p.ios, connector: 'App Store Connect' })
  if (v.packages.size) platforms.push({ pf: 'play_store', read: v.p.android, connector: 'Google Play Console' })
  if (platforms.length === 0) return unknown(id, 'No store app is declared for this app (app.ids in the recipe, or the catalog).')
  const byId = productsById(hub.rc)
  const sold = new Set<string>()
  for (const off of hub.rc?.offerings ?? []) for (const pkg of off.packages ?? []) for (const pid of pkg.productIds) {
    const p = byId.get(pid)
    if (p) sold.add(`${platformOf(hub.rc!.apps.find((a) => a.id === p.appId))}:${p.storeIdentifier}`)
  }
  const findings: MonetizationFinding[] = []
  const unread: string[] = []
  for (const { pf, read, connector } of platforms) {
    if (!read) {
      unread.push(`${PLATFORM_LABEL[pf]} not checked: connect ${connector} for this app.`)
      continue
    }
    if (read.state === 'unknown') {
      unread.push(`${PLATFORM_LABEL[pf]} not checked: ${read.reason}`)
      continue
    }
    for (const item of read.items) {
      const ready = pf === 'app_store' ? IOS_READY.has(item.state) : item.state === 'ACTIVE'
      if (ready) continue
      const onPaywall = sold.has(`${pf}:${item.storeIdentifier}`)
      findings.push({
        ruleId: id, severity: onPaywall ? 'warn' : 'info', target: item.storeIdentifier, projectIds: [v.p.id],
        message: pf === 'app_store'
          ? `The App Store product ${item.storeIdentifier} is ${item.state}, so buying it fails until Apple approves it${onPaywall ? ', and the paywall offers it' : ''}.`
          : `The Play product ${item.storeIdentifier} is ${item.state}, so buying it fails until it is active${onPaywall ? ', and the paywall offers it' : ''}.`,
        fix: pf === 'app_store'
          ? `In App Store Connect, finish ${item.storeIdentifier} (metadata, review screenshot) and submit it with an app version.`
          : `In Play Console, activate ${item.storeIdentifier} (Monetize → Products).`,
      })
    }
  }
  return outcome(id, findings, 'Every store product of this app can be bought.', unread.length ? unread.join(' ') : null)
}

function webhookUnhealthy(hub: MonetizationHub, v: AppView): RuleOutcome {
  const id = 'monetization_webhook_unhealthy'
  const gap = rcGap(hub)
  if (gap) return unknown(id, gap.reason, gap.state)
  const rc = hub.rc!
  if (!rc.webhooks) return unknown(id, NOT_RE_READ)
  if (rc.webhooks.state !== 'read') return unknown(id, rc.webhooks.reason)
  if (v.rcApps.length === 0) return unknown(id, "None of this app's store apps are in RevenueCat yet, so no webhook can carry its purchases.")
  const hooks = rc.webhooks.items
  const covers = (appId: string) => hooks.filter((w) => w.appId === null || w.appId === appId)
  const catalog = catalogOf(hub)
  const findings: MonetizationFinding[] = []
  for (const app of v.rcApps) {
    const pf = platformOf(app)
    const label = pf ? PLATFORM_LABEL[pf] : app.type
    const expected = catalog && v.catalogApp && pf
      ? catalog.webhooks.filter((w) => w.apps === 'all' || w.apps.includes(`${v.catalogApp!.id}:${pf}`) || w.apps.includes(v.catalogApp!.id))
      : []
    for (const w of expected) {
      if (!covers(app.id).some((h) => h.url === w.url)) {
        findings.push({
          ruleId: id, severity: 'warn', target: w.url, projectIds: [v.p.id],
          message: `RevenueCat does not send ${v.p.name} ${label} purchases to ${w.url} (the catalog's ${w.id} webhook), so that backend never hears about them${v.sells ? ' and purchased credits never arrive' : ''}.`,
          fix: `In RevenueCat, open Integrations → Webhooks and add ${w.url} for ${w.apps === 'all' ? 'all apps' : `the ${label} app`}.`,
        })
      }
    }
    if (expected.length === 0 && covers(app.id).length === 0) {
      findings.push({
        ruleId: id, severity: 'info', target: app.storeId, projectIds: [v.p.id],
        message: `No RevenueCat webhook covers ${v.p.name} on ${label}, so no backend hears about its purchases. That is fine only if the app reads entitlements from the SDK alone.`,
        fix: 'In RevenueCat, open Integrations → Webhooks and add your backend endpoint, or list the expected webhook in the billing catalog.',
      })
    }
  }
  return outcome(id, findings, "Every expected webhook is set for this app. RevenueCat's API does not report delivery failures, so delivery itself is not checked.")
}

// ── entry points ────────────────────────────────────────────────────────────

/** Every monetization rule for every app in the hub, plus findings that belong to no app. */
export function evaluateMonetization(hub: MonetizationHub): MonetizationEvaluation {
  const views = hub.projects.map((p) => appView(hub, p))
  const offer = offeringEmpty(hub, views)
  const ent = entitlementUnattached(hub, views)
  const byProject: Record<string, RuleOutcome[]> = {}
  for (const v of views) {
    byProject[v.p.id] = [
      appOutsideHub(hub, v),
      iosAppMissing(hub, v),
      offer.per.get(v.p.id)!,
      ent.per.get(v.p.id)!,
      productNotInOffering(hub, v),
      catalogDrift(hub, v),
      storeProductUnready(hub, v),
      webhookUnhealthy(hub, v),
    ]
  }
  return { byProject, unattributed: [...offer.unattributed, ...ent.unattributed] }
}

/**
 * The three rules that predate ADR 0025, as connector drift. `revenuecat_app_missing`
 * now checks Android packages against Play apps only (by type: a bundle id that
 * equals the package no longer passes for the iOS app); iOS is
 * monetization_ios_app_missing.
 */
export function legacyRevenuecatDrift(projects: readonly RevenueCatProjectFacts[], manifests: unknown): DriftFinding[] {
  const ms = (manifests && typeof manifests === 'object' ? manifests : {}) as Record<string, any>
  const rcOf = new Map<string, string>()
  for (const p of projects) for (const id of p.projectIds) rcOf.set(id, p.rcProjectId)
  const out: DriftFinding[] = []
  for (const [projectId, m] of Object.entries(ms)) {
    for (const other of list(m?.links?.billing?.sharedCreditsWith)) {
      const a = rcOf.get(projectId)
      const b = rcOf.get(other)
      if (a && b && a !== b) {
        out.push({ gate: 'portfolio_radar', ruleId: 'revenuecat_project_split', severity: 'warn', message: `These apps share credits, but sit in two RevenueCat projects (${a} and ${b}). Entitlements are only shared inside one project, so a purchase in one app will not unlock the other.`, suggestedFix: { kind: 'prompt', text: 'Move both apps into one RevenueCat project, or stop declaring shared credits.' } })
      }
    }
    const rcProject = projects.find((p) => p.projectIds.includes(projectId))
    if (!rcProject) continue
    const pkg = s(m?.app?.ids?.androidPackage)
    if (pkg && !rcProject.apps.some((a) => a.type === 'play_store' && a.storeId === pkg)) {
      out.push({ gate: 'portfolio_radar', ruleId: 'revenuecat_app_missing', severity: 'warn', message: `The Play app ${pkg} is not registered in its RevenueCat project, so its purchases will not be seen.`, suggestedFix: { kind: 'prompt', text: `Add ${pkg} as a Play Store app in RevenueCat project ${rcProject.rcProjectId}.` } })
    }
    if (rcProject.entitlements.length > 0 && !rcProject.offerings.some((x) => x.isCurrent)) {
      out.push({ gate: 'portfolio_radar', ruleId: 'revenuecat_offering_missing', severity: 'info', message: `RevenueCat project ${rcProject.rcProjectId} has entitlements but no current offering, so the paywall has nothing to show.`, suggestedFix: { kind: 'prompt', text: 'Mark one offering as current in RevenueCat.' } })
    }
  }
  return out
}
