/**
 * monetizationView — shapes and labels for the Monetization card (ADR 0025).
 * The server does the checking (`_shared/monetization/rules.ts`); this file
 * only turns its answer into words and tones. Not checked is never shown as
 * a pass, and a number RevenueCat did not send reads "—", never 0.
 */

import type { BadgeTone } from '../ui'
import type { RunStatus } from '../signal/StatusMark'
import { ruleProblem } from '../../lib/groupAppFindings'

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

/**
 * One label for an app: what to fix first, else whether every check could look.
 * @internal Exported for tests; the card draws it through appStatus.
 */
export function appSummary(app: Pick<MonetizationAppView, 'rules' | 'findings'>, planned: readonly string[] = []): { text: string; tone: BadgeTone } {
  // Round 2 (2026-11-18): red only for a failure. Products waiting in store review are warnings
  // (amber "3 to fix"); one serious (error) finding makes the whole count red.
  const errors = app.findings.filter((f) => f.severity === 'error').length
  const serious = errors + app.findings.filter((f) => f.severity === 'warn').length
  // Round 3 (2026-11-19): "3 to fix" sat over rows that said "in review". Products only waiting on
  // the store's review are named as that; anything else to do keeps "to fix".
  const inReview = (f: MonetizationFinding) => f.ruleId === 'monetization_store_product_unready' && /\bis (IN_REVIEW|WAITING_FOR_REVIEW)\b/.test(f.message)
  if (serious > 0 && errors === 0 && app.findings.filter((f) => f.severity === 'warn').every(inReview)) {
    return { text: `${serious} in review`, tone: 'warnSubtle' }
  }
  if (serious > 0) return { text: `${serious} to fix`, tone: errors > 0 ? 'dangerSubtle' : 'warnSubtle' }
  if (app.rules.some((r) => r.state === 'error')) return { text: 'Could not check', tone: 'dangerSubtle' }
  if (app.rules.length === 0 || app.rules.some((r) => r.state === 'unknown')) return { text: app.findings.length ? `${app.findings.length} notes, partly checked` : 'Partly checked', tone: 'neutral' }
  if (app.findings.length > 0) return { text: `${app.findings.length} notes`, tone: 'infoSubtle' }
  // A planned rule never ran: "Every check passed" would claim a check nobody made.
  const checked = app.rules.length
  const notRun = planned.filter((id) => !app.rules.some((r) => r.ruleId === id)).length
  if (notRun > 0) return { text: `${checked} of ${checked + notRun} checked`, tone: 'neutral' }
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

/**
 * One headline number as RevenueCat sent it; "—" when it did not.
 * @internal Exported for tests; the card draws it through kpiTile.
 */
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

// ── Signal pass (2026-11-18): states as marks, repeated findings as one row ──────

/** A product's store state as a status mark: not read is idle, missing is failed, in review waits. */
export function productStatus(p: Pick<ProductView, 'platform' | 'storeState'>): RunStatus {
  if (p.storeState === null) return 'idle'
  if (p.storeState === 'NOT_IN_STORE') return 'failed'
  const ready = p.platform === 'iOS' ? IOS_READY.has(p.storeState) : p.storeState === 'ACTIVE'
  return ready ? 'passed' : 'waiting'
}

const SUMMARY_STATUS: Partial<Record<string, RunStatus>> = {
  // Amber for a warning, red for a failure, grey for "not (fully) checked".
  warnSubtle: 'waiting',
  dangerSubtle: 'failed',
  neutral: 'idle',
  infoSubtle: 'idle',
  okSubtle: 'passed',
}

/** The app row's mark: ✕ serious or could not check, ◷ N to fix (warnings), ○ partly checked or notes, ✓ every check passed. */
export function appStatus(app: Pick<MonetizationAppView, 'rules' | 'findings'>, planned: readonly string[] = []): { status: RunStatus; label: string } {
  const s = appSummary(app, planned)
  return { status: SUMMARY_STATUS[s.tone] ?? 'idle', label: s.text }
}

/** Findings of one rule (and, for store products, one platform and state) shown as one row. */
export interface MonetizationFindingGroup {
  key: string
  ruleId: string
  severity: MonetizationFinding['severity']
  /** "3 products in review", or the finding itself when it stands alone. */
  title: string
  /** What the findings point at (store product ids, package paths), in order. */
  targets: string[]
  /** One instruction for the row. */
  action: string
  /** Products the store is still reviewing: a waiting state (◷), not a failure (✕). */
  waiting: boolean
  findings: MonetizationFinding[]
}

/** Store states that wait on the store (review, processing), not on you. */
const WAITING_STATE = /REVIEW|PENDING|PROCESSING/

const SEV_RANK: Record<MonetizationFinding['severity'], number> = { error: 2, warn: 1, info: 0 }

const STORE_ACTION: Record<'app_store' | 'play', string> = {
  app_store: 'Submit in App Store Connect',
  play: 'Activate in Play Console',
}

/**
 * "Fix · pack_5 is IN_REVIEW…", "Fix · pack_10 is IN_REVIEW…" become ONE row: "3 products in
 * review: pack_5 · pack_10 · pack_25 → Submit in App Store Connect". The state comes from the
 * app's own product list (by store identifier); the message is only a fallback. Other rules
 * group by rule; a group of one keeps its own message and fix.
 */
export function groupMonetizationFindings(findings: readonly MonetizationFinding[], products: readonly ProductView[] = []): MonetizationFindingGroup[] {
  const stateOf = new Map(products.map((p) => [p.storeIdentifier, p]))
  const groups = new Map<string, MonetizationFindingGroup & { store: 'app_store' | 'play' | null; state: string | null }>()
  for (const f of findings) {
    let store: 'app_store' | 'play' | null = null
    let state: string | null = null
    if (f.ruleId === 'monetization_store_product_unready') {
      const known = f.target ? stateOf.get(f.target) : undefined
      store = known ? (known.platform === 'iOS' ? 'app_store' : 'play') : /App Store/.test(f.message) ? 'app_store' : 'play'
      state = known?.storeState ?? /\bis ([A-Z][A-Z_]+)\b/.exec(f.message)?.[1] ?? null
    }
    const key = store ? `${f.ruleId}|${store}|${state ?? '?'}` : f.ruleId
    const g = groups.get(key) ?? { key, ruleId: f.ruleId, severity: f.severity, title: '', targets: [], action: '', waiting: false, findings: [], store, state }
    g.findings.push(f)
    if (f.target && !g.targets.includes(f.target)) g.targets.push(f.target)
    if (SEV_RANK[f.severity] > SEV_RANK[g.severity]) g.severity = f.severity
    groups.set(key, g)
  }
  const out: MonetizationFindingGroup[] = []
  for (const { store, state, ...g } of groups.values()) {
    const n = g.findings.length
    if (store) {
      const words = state ? state.toLowerCase().replace(/_/g, ' ') : 'not ready'
      g.title = `${n} product${n === 1 ? '' : 's'} ${words}`
      g.action = STORE_ACTION[store]
      g.waiting = state != null && WAITING_STATE.test(state)
    } else if (n === 1) {
      g.title = g.findings[0]!.message
      g.action = g.findings[0]!.fix
    } else {
      const problem = ruleProblem(g.ruleId)
      g.title = `${n} × ${problem?.title ?? RULE_TITLE[g.ruleId] ?? g.ruleId}`
      g.action = problem?.action ?? 'Copy fix'
    }
    out.push(g)
  }
  return out.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.findings.length - a.findings.length)
}

/** How bad an app's payments are: something to fix, then could not check, partly checked, notes, every check passed. */
function appRank(app: Pick<MonetizationAppView, 'rules' | 'findings'>): number {
  if (app.findings.some((f) => f.severity !== 'info')) return 0
  if (app.rules.some((r) => r.state === 'error')) return 1
  if (app.rules.length === 0 || app.rules.some((r) => r.state === 'unknown')) return 2
  if (app.findings.length > 0) return 3
  return 4
}

/** Worst first: apps with something to fix lead (most first), "Every check passed" comes last. */
export function sortAppsWorstFirst<T extends Pick<MonetizationAppView, 'rules' | 'findings' | 'name'>>(apps: readonly T[]): T[] {
  const serious = (a: T) => a.findings.filter((f) => f.severity !== 'info').length
  return [...apps].sort((a, b) => appRank(a) - appRank(b) || serious(b) - serious(a) || a.name.localeCompare(b.name))
}

/** Every product an app lists (entitlements and offering packages), for the grouping above. */
export function appProducts(app: Pick<MonetizationAppView, 'entitlements' | 'offerings'>): ProductView[] {
  const out: ProductView[] = []
  for (const e of app.entitlements) out.push(...(e.products ?? []))
  for (const o of app.offerings) for (const k of o.packages ?? []) out.push(...k.products)
  return out
}

/** The platform columns of the offerings grid: iOS then Android, then anything else seen. */
export function offeringPlatforms(app: Pick<MonetizationAppView, 'offerings' | 'rcApps'>): string[] {
  const seen = new Set<string>()
  for (const o of app.offerings) for (const k of o.packages ?? []) for (const p of k.products) if (p.platform) seen.add(p.platform)
  for (const a of app.rcApps) if (a.platform) seen.add(a.platform)
  const order = ['iOS', 'Android']
  const rest = [...seen].filter((p) => !order.includes(p)).sort()
  const known = order.filter((p) => seen.has(p))
  return known.length + rest.length > 0 ? [...known, ...rest] : order
}

/** A headline tile: the number as RevenueCat sent it, and a word when it is zero or missing. */
export function kpiTile(metrics: MonetizationHubView['metrics'], id: string): { value: string; sublabel: string | undefined } {
  const value = metricText(metrics, id)
  if (value === '—') return { value, sublabel: 'Not sent' }
  const m = metrics?.state === 'read' ? metrics.items.find((x) => x.id === id) : undefined
  if (m && m.value === 0) return { value, sublabel: id === 'mrr' || id === 'revenue' ? 'No revenue yet' : 'None yet' }
  return { value, sublabel: undefined }
}
