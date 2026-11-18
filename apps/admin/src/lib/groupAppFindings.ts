/**
 * FILE: apps/admin/src/lib/groupAppFindings.ts
 * PURPOSE: One row per problem, not one sentence per app (2026-11-18; the owner on the Apps
 *          page: "what is this stupid long list uiux with bad design system and text wall?").
 *          The server words a finding per app ("yen-yen (app) has no version probe.", then the
 *          same for glot.it, twm…). These helpers strip the app's own name from the sentence,
 *          group the sentences that are then identical, and give each group a short title
 *          (six words at most) and one action word, so the page draws "No version probe",
 *          the icons of the N apps and "Add probe" once.
 *
 * Pure: no React, no fetch. The Apps tab (components/portfolio/PortfolioFindings) renders
 * what these return.
 */

import type { FindingGroup, PortfolioFindingsResponse, SdkSkewEntry } from './portfolioTypes'

type CrossProjectFinding = PortfolioFindingsResponse['crossProject'][number]
type IntegrationHole = PortfolioFindingsResponse['holes'][number]
type Severity = 'info' | 'warn' | 'error'

const SEV_RANK: Record<Severity, number> = { error: 2, warn: 1, info: 0 }

/** The most words a row title may have; longer text is clipped and kept whole in the tooltip. */
const TITLE_WORDS = 6

/** @internal Clips to `TITLE_WORDS` words, with an ellipsis when it cut. Exported for tests. */
export function clipWords(text: string, max = TITLE_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= max) return words.join(' ')
  return `${words.slice(0, max).join(' ').replace(/[,;:.]+$/, '')}…`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A per-app sentence with the app's own name taken out, so the same problem in two apps
 * reads the same. Only the finding's OWN apps are stripped ("glot.it shares credits with
 * yen-yen" keeps yen-yen when only glot.it is the finding's app). A "(kind)" right after the
 * name goes too. "has no X" becomes "No X"; the closing full stop goes.
 *
 *   normaliseAppSentence('yen-yen (app) has no version probe.', ['yen-yen']) → 'No version probe'
 *
 * @internal Exported for tests; the page reaches it through groupAcrossApps.
 */
export function normaliseAppSentence(message: string, ownNames: readonly string[]): string {
  let text = message
  // Longest names first, so "glot.it beta" is not left as " beta" by "glot.it".
  for (const name of [...ownNames].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`(^|[^\\w.-])${escapeRegExp(name)}(\\s*\\([a-z ]+\\))?(?=$|[^\\w-])`, 'gi'), '$1')
  }
  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,;–—-]+/, '')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
  text = text.replace(/^(has|have) no\s+/i, 'No ').replace(/^is missing\s+/i, 'Missing ')
  text = text.replace(/[.\s]+$/, '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : message.trim()
}

/** A finding with its app sentence, as the page lists it. */
interface GroupedFinding {
  key: string
  ruleId: string
  severity: Severity
  /** Six words at most. */
  title: string
  /** The whole normalised sentence (the tooltip, and the text a row opens to). */
  detail: string
  projectIds: string[]
  /** The fix prompt to copy; null when the server sent none. */
  fix: string | null
  /** One short verb phrase for the row's single button. */
  action: string
}

/** Action words for the per-app checklist items ("has no version probe" → "Add probe"). */
const ITEM_ACTION: ReadonlyArray<[RegExp, string]> = [
  [/version probe/i, 'Add probe'],
  [/crash report/i, 'Add crash reports'],
  [/deep-link file/i, 'Add link file'],
  [/security headers/i, 'Set headers'],
  [/release workflow/i, 'Add workflow'],
  [/campaign tag/i, 'Tag links'],
]

/** Cross-app rules the server names per app (portfolio-rules.ts); the rest fall back to "Copy fix". */
const CROSS_ACTION: Record<string, string> = {
  auth_config_divergent: 'Align login',
  auth_redirect_missing: 'Add redirect',
  billing_account_undeclared: 'Declare billing',
  billing_account_mismatch: 'Fix billing',
  stripe_price_missing: 'Add price',
  deep_link_broken: 'Fix links',
  cross_promo_link_broken: 'Fix link',
  cross_promo_untracked: 'Tag links',
  ci_cost_concentration: 'Trim CI',
  key_shared_across_apps: 'Split keys',
}

/** @internal The one action word for a per-app finding. Exported for tests. */
export function crossFindingAction(ruleId: string, text: string): string {
  for (const [re, label] of ITEM_ACTION) if (re.test(text)) return label
  return CROSS_ACTION[ruleId] ?? 'Copy fix'
}

/**
 * "Across your apps": findings whose text differs only by the app name become one row with
 * every app's id. Grouped by rule and the normalised sentence; the fix prompt is NOT part of
 * the key (the app and the site version-probe fixes differ by one word and must stay one row).
 * Sorted serious first, then by apps affected.
 */
export function groupAcrossApps(findings: readonly CrossProjectFinding[], nameOf: (projectId: string) => string): GroupedFinding[] {
  const byKey = new Map<string, GroupedFinding>()
  for (const f of findings) {
    const detail = normaliseAppSentence(f.message, f.projectIds.map(nameOf))
    const key = `${f.ruleId}|${detail.toLowerCase()}`
    const g = byKey.get(key)
    if (!g) {
      byKey.set(key, {
        key,
        ruleId: f.ruleId,
        severity: f.severity,
        title: clipWords(detail),
        detail,
        projectIds: [...new Set(f.projectIds)],
        fix: f.suggestedFix ? `${detail}\n\nFix: ${f.suggestedFix}` : null,
        action: crossFindingAction(f.ruleId, detail),
      })
      continue
    }
    for (const id of f.projectIds) if (!g.projectIds.includes(id)) g.projectIds.push(id)
    if (SEV_RANK[f.severity] > SEV_RANK[g.severity]) g.severity = f.severity
    if (!g.fix && f.suggestedFix) g.fix = `${detail}\n\nFix: ${f.suggestedFix}`
  }
  return sortGroups([...byKey.values()])
}

function sortGroups<T extends { severity: Severity; projectIds: readonly string[]; title: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.projectIds.length - a.projectIds.length || a.title.localeCompare(b.title))
}

const INTEGRATION_NAME: Record<IntegrationHole['integration'], string> = {
  sentry: 'Sentry',
  slack: 'Slack',
  linear: 'Linear',
  supabase: 'Supabase',
  github: 'GitHub',
}

/** "Missing setups": one row per integration, with every app that lacks it. */
export function groupHoles(holes: readonly IntegrationHole[]): Array<{ integration: IntegrationHole['integration']; title: string; projectIds: string[]; detail: string }> {
  const byIntegration = new Map<IntegrationHole['integration'], { integration: IntegrationHole['integration']; title: string; projectIds: string[]; detail: string }>()
  for (const h of holes) {
    const label = INTEGRATION_NAME[h.integration] ?? h.integration
    const g = byIntegration.get(h.integration) ?? { integration: h.integration, title: `No ${label}`, projectIds: [], detail: `Most of your other apps use ${label}; these do not.` }
    if (!g.projectIds.includes(h.projectId)) g.projectIds.push(h.projectId)
    byIntegration.set(h.integration, g)
  }
  return [...byIntegration.values()].sort((a, b) => b.projectIds.length - a.projectIds.length || a.title.localeCompare(b.title))
}

/** "SDK versions": one row per package and state ("@mushi-mushi/web · behind → 1.33.0"). */
export function groupSdkSkew(entries: readonly SdkSkewEntry[]): Array<{ key: string; pkg: string | null; status: SdkSkewEntry['status']; latest: string | null; title: string; apps: Array<{ projectId: string; version: string | null; reason: string }> }> {
  const out = new Map<string, { key: string; pkg: string | null; status: SdkSkewEntry['status']; latest: string | null; title: string; apps: Array<{ projectId: string; version: string | null; reason: string }> }>()
  for (const e of entries) {
    if (e.status === 'current') continue
    // An unknown version groups by its reason (it names no app); a behind one by the target.
    const key = `${e.package ?? '-'}|${e.status}|${e.status === 'behind' ? e.latest ?? '' : e.reason}`
    const title = e.status === 'behind' ? `Behind${e.latest ? ` → ${e.latest}` : ''}` : clipWords(e.reason.replace(/\.$/, ''))
    const g = out.get(key) ?? { key, pkg: e.package, status: e.status, latest: e.latest, title, apps: [] }
    if (!g.apps.some((a) => a.projectId === e.projectId)) g.apps.push({ projectId: e.projectId, version: e.version, reason: e.reason })
    out.set(key, g)
  }
  return [...out.values()].sort((a, b) => (a.status === 'behind' ? 0 : 1) - (b.status === 'behind' ? 0 : 1) || b.apps.length - a.apps.length)
}

/**
 * The findings without some apps (the public demo, 2026-11-18: keep-but-hide). Every list the
 * Apps tab draws per app goes through here once: a Fix once group left in fewer than two apps
 * is not "fix once" any more and goes; a per-app finding, SDK row or missing setup of a hidden
 * app goes.
 */
export function withoutApps(data: PortfolioFindingsResponse, hidden: ReadonlySet<string>): PortfolioFindingsResponse {
  if (hidden.size === 0) return data
  const keep = (id: string) => !hidden.has(id)
  return {
    ...data,
    groups: data.groups.map((g) => ({ ...g, projectIds: g.projectIds.filter(keep) })).filter((g) => new Set(g.projectIds).size >= 2),
    crossProject: data.crossProject.map((f) => ({ ...f, projectIds: f.projectIds.filter(keep) })).filter((f) => f.projectIds.length > 0),
    sdkSkew: data.sdkSkew.filter((e) => keep(e.projectId)),
    holes: data.holes.filter((h) => keep(h.projectId)),
  }
}

// ── Fix once ─────────────────────────────────────────────────────────────────

/**
 * A problem title (not the passing state the rule catalog names) and one action word, by
 * rule id. The server's titles read as passes ("Security headers set"), and the Mushi setup
 * rules have none, so a long sample sentence would lead. Unknown rules fall back to the
 * gate's action and a six-word clip of the title.
 */
const FIX_ONCE: Record<string, { title: string; action: string }> = {
  // Mushi setup checks (gate "radar")
  byok_key_invalid: { title: 'AI key rejected', action: 'Fix key' },
  spend_cap_unset: { title: 'No AI spend limit', action: 'Set budget' },
  webhook_never_delivered: { title: 'Webhooks never arrive', action: 'Fix webhook' },
  index_branch_mismatch: { title: 'Code index on wrong branch', action: 'Fix branch' },
  index_stale: { title: 'Code index out of date', action: 'Re-index' },
  // Hole checks (RADAR_RULES)
  store_name_mismatch: { title: 'Store names differ', action: 'Match names' },
  listing_locale_missing: { title: 'Store listing language missing', action: 'Add language' },
  domain_expiring: { title: 'Domain about to expire', action: 'Renew domain' },
  tls_expiring: { title: 'Certificate about to expire', action: 'Renew cert' },
  security_headers_missing: { title: 'Security headers missing', action: 'Set headers' },
  review_risk_privacy_url: { title: 'Privacy link broken', action: 'Fix link' },
  storage_sql_delete: { title: 'Storage deleted through SQL', action: 'Use storage API' },
  play_target_sdk_behind: { title: 'Android target SDK behind', action: 'Upgrade SDK' },
  ios_sdk_behind: { title: 'iOS SDK below upload rules', action: 'Upgrade SDK' },
  rpc_secret_reachable_by_anon: { title: 'Secret function open to anyone', action: 'Lock function' },
  storage_orphaned_bytes: { title: 'Orphaned storage files', action: 'Clean storage' },
  edge_fn_unauthenticated_paid: { title: 'Paid function without auth', action: 'Add auth' },
  pitr_disabled: { title: 'Point-in-time recovery off', action: 'Turn on PITR' },
  storage_not_backed_up: { title: 'Storage files not backed up', action: 'Back up' },
  key_shared_across_apps: { title: 'One AI key, several apps', action: 'Split keys' },
  revenuecat_project_split: { title: 'Purchases split across projects', action: 'Merge projects' },
  revenuecat_app_missing: { title: 'Store app not in RevenueCat', action: 'Add app' },
  revenuecat_offering_missing: { title: 'No current offering', action: 'Add offering' },
  monetization_app_outside_hub: { title: 'Selling outside the hub', action: 'Move app' },
  monetization_ios_app_missing: { title: 'iOS app not in RevenueCat', action: 'Add iOS app' },
  monetization_offering_empty: { title: 'Offering with no products', action: 'Add products' },
  monetization_entitlement_unattached: { title: 'Entitlement no product grants', action: 'Attach product' },
  monetization_product_not_in_offering: { title: 'Product on no paywall', action: 'Add to paywall' },
  monetization_catalog_drift: { title: 'RevenueCat differs from catalog', action: 'Sync catalog' },
  monetization_store_product_unready: { title: 'Store product not buyable', action: 'Submit product' },
  monetization_webhook_unhealthy: { title: 'Purchases not reaching backend', action: 'Fix webhook' },
  dead_app_live_spend: { title: 'Spend on an unused app', action: 'Stop spend' },
  provider_key_invalid: { title: 'A connected key stopped working', action: 'Fix key' },
  store_credential_scope_missing: { title: 'Store key missing permissions', action: 'Fix key' },
  key_unused_90d: { title: 'Key unused for 90 days', action: 'Revoke key' },
  key_in_client_bundle: { title: 'Secret key in the build', action: 'Remove key' },
  paid_feature_no_kill_switch: { title: 'Paid feature has no switch', action: 'Add switch' },
  provider_limit_unset: { title: 'No AI provider spending limit', action: 'Set limit' },
  // The sample names one app's package; the others may differ, so the action stays general.
  known_vulnerable_dependency: { title: 'Known hole in a dependency', action: 'Upgrade deps' },
  runtime_end_of_life: { title: 'Runtime out of security fixes', action: 'Upgrade runtime' },
  spend_down_idle: { title: 'Spend-down key is idle', action: 'Check key' },
}

/** A rule's problem title and action word; null when the rule has none here. */
export function ruleProblem(ruleId: string): { title: string; action: string } | null {
  return Object.prototype.hasOwnProperty.call(FIX_ONCE, ruleId) ? FIX_ONCE[ruleId]! : null
}

/** The action word for a gate when the rule is not in FIX_ONCE. */
const GATE_ACTION: Record<string, string> = {
  ci_drift: 'Fix CI',
  design_drift: 'Use tokens',
  code_health: 'Split file',
  env_drift: 'Add env var',
  deploy_drift: 'Deploy',
  schema_drift: 'Check schema',
  dead_handler: 'Wire handler',
  mock_leak: 'Remove mock',
  api_contract: 'Fix contract',
  unknown_call: 'Fix call',
  orphan_endpoint: 'Remove route',
  spec_drift: 'Sync spec',
  crawl: 'Fix page',
  status_claim: 'Fix status',
  store_review: 'Fix listing',
}

/** One row of the findings × apps matrix. */
export interface FixOnceRow {
  ruleId: string
  severity: Severity
  title: string
  action: string
  projectIds: string[]
  /** What opens under the row: the gate, and one sample of the finding. */
  gateLabel: string | null
  explanation: string
  fix: string
}

/**
 * "Fix once": the server's repeated-finding groups as matrix rows, serious first and then by
 * apps affected. `fallbackTitle` is the page's title for a group (findingGroupTitle).
 */
export function fixOnceRows(groups: readonly FindingGroup[], fallbackTitle: (g: FindingGroup) => string): FixOnceRow[] {
  const rows = groups.map((g): FixOnceRow => {
    const known = ruleProblem(g.ruleId)
    return {
      ruleId: g.ruleId,
      severity: g.severity,
      title: known?.title ?? clipWords(fallbackTitle(g)),
      action: known?.action ?? GATE_ACTION[g.gate] ?? 'Copy fix',
      projectIds: [...new Set(g.projectIds)],
      gateLabel: g.gateLabel ?? null,
      explanation: g.sampleMessage || fallbackTitle(g),
      fix: g.suggestedFix,
    }
  })
  return sortGroups(rows)
}
