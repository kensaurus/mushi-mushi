/**
 * monetizationView — shapes and labels for the Monetization card (ADR 0025).
 * The server does the checking (`_shared/monetization/rules.ts`); this file
 * only turns its answer into words and tones. Not checked is never shown as
 * a pass, and a number RevenueCat did not send reads "—", never 0.
 */

import type { BadgeTone } from '../ui'

type RuleState = 'ok' | 'finding' | 'unknown' | 'error'

interface SuggestedAction {
  action: 'attach_products_to_package'
  payload: { rcProjectId: string; packageId: string; products: Array<{ productId: string; eligibilityCriteria: 'all' }> }
}

export interface MonetizationFinding {
  ruleId: string
  severity: 'info' | 'warn' | 'error'
  message: string
  fix: string
  target: string | null
  projectIds: string[]
  action?: SuggestedAction
}

interface ProductView {
  id: string
  storeIdentifier: string
  platform: string
  storeState: string | null
}

export interface MonetizationAppView {
  projectId: string
  name: string
  rcApps: Array<{ id: string; platform: string; storeId: string | null }>
  entitlements: Array<{ lookupKey: string; name: string | null; products: ProductView[] | null }>
  offerings: Array<{ lookupKey: string; isCurrent: boolean; hasPaywall: boolean; packages: Array<{ id: string; lookupKey: string; products: ProductView[] }> | null }>
  rules: Array<{ ruleId: string; state: RuleState; reason: string }>
  findings: MonetizationFinding[]
}

export interface MonetizationHubView {
  rcProjectId: string
  dashboardUrl: string
  observedAt: string | null
  connector: { id: string; status: string | null; canAct: boolean } | null
  read: { state: 'read' } | { state: 'unknown' | 'error'; reason: string }
  catalog: { state: 'read' | 'none' | 'error'; source: string | null; reason: string | null }
  metrics: { state: 'read'; currency: string; items: Array<{ id: string; name: string; value: number; unit: string; period: string }> } | { state: 'unknown'; reason: string } | null
  apps: MonetizationAppView[]
  unattributed: MonetizationFinding[]
}

export interface MonetizationResponse {
  hubs: MonetizationHubView[]
  outsideHub: Array<{ projectId: string; name: string; finding: MonetizationFinding }>
  planned: string[]
}

export const RULE_TITLE: Record<string, string> = {
  monetization_app_outside_hub: 'In the RevenueCat hub',
  monetization_ios_app_missing: 'iOS app in RevenueCat',
  monetization_offering_empty: 'Offerings have products',
  monetization_entitlement_unattached: 'Entitlements granted by a product',
  monetization_product_not_in_offering: 'Products on a paywall',
  monetization_catalog_drift: 'Matches the billing catalog',
  monetization_store_product_unready: 'Store products can be bought',
  monetization_webhook_unhealthy: 'Purchases reach your backend',
  monetization_billing_library_outdated: 'Purchases SDK up to date',
}

export const RULE_STATE: Record<RuleState, { label: string; tone: BadgeTone }> = {
  ok: { label: 'OK', tone: 'okSubtle' },
  finding: { label: 'To fix', tone: 'warnSubtle' },
  unknown: { label: 'Not checked', tone: 'neutral' },
  error: { label: 'Could not check', tone: 'dangerSubtle' },
}

/** One badge for an app: what to fix first, else whether every check could look. */
export function appSummary(app: Pick<MonetizationAppView, 'rules' | 'findings'>): { text: string; tone: BadgeTone } {
  const serious = app.findings.filter((f) => f.severity !== 'info').length
  if (serious > 0) return { text: `${serious} to fix`, tone: 'warnSubtle' }
  if (app.rules.some((r) => r.state === 'error')) return { text: 'Could not check', tone: 'dangerSubtle' }
  if (app.rules.length === 0 || app.rules.some((r) => r.state === 'unknown')) return { text: app.findings.length ? `${app.findings.length} notes, partly checked` : 'Partly checked', tone: 'neutral' }
  if (app.findings.length > 0) return { text: `${app.findings.length} notes`, tone: 'infoSubtle' }
  return { text: 'Every check passed', tone: 'okSubtle' }
}

const IOS_READY = new Set(['APPROVED', 'READY_TO_SUBMIT'])

/** A product's store state as a chip: not read is neutral, never ready. */
export function productState(p: ProductView): { text: string; tone: BadgeTone } {
  if (p.storeState === null) return { text: 'store not read', tone: 'neutral' }
  if (p.storeState === 'NOT_IN_STORE') return { text: 'not in the store', tone: 'warnSubtle' }
  const ready = p.platform === 'iOS' ? IOS_READY.has(p.storeState) : p.storeState === 'ACTIVE'
  return { text: p.storeState.toLowerCase().replace(/_/g, ' '), tone: ready ? 'okSubtle' : 'warnSubtle' }
}

export const HEADLINE_METRICS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'active_subscriptions', label: 'Active subscriptions' },
  { id: 'active_trials', label: 'Trials' },
  { id: 'mrr', label: 'MRR' },
  { id: 'revenue', label: 'Revenue, 28 days' },
]

/** One headline number as RevenueCat sent it; "—" when it did not. */
export function metricText(metrics: MonetizationHubView['metrics'], id: string): string {
  if (!metrics || metrics.state !== 'read') return '—'
  const m = metrics.items.find((x) => x.id === id)
  if (!m) return '—'
  if (m.unit === '$' || id === 'mrr' || id === 'revenue') {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: metrics.currency, maximumFractionDigits: 0 }).format(m.value)
    } catch {
      return `${Math.round(m.value)} ${metrics.currency}`
    }
  }
  return new Intl.NumberFormat('en-US').format(m.value)
}

/** The connector-actions request for a finding's suggested fix. */
export function actionRequest(hub: Pick<MonetizationHubView, 'connector'>, finding: MonetizationFinding, projectId: string | null): Record<string, unknown> | null {
  if (!finding.action || !hub.connector) return null
  return { connectorId: hub.connector.id, action: finding.action.action, payload: finding.action.payload, ...(projectId ? { projectId } : {}), reason: finding.message.slice(0, 500) }
}

/** A finding as a prompt to paste into an editor or a support note. */
export function fixPrompt(f: MonetizationFinding): string {
  return `${f.message}\n\nFix: ${f.fix}`
}
