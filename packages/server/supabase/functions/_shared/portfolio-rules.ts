/**
 * FILE: packages/server/supabase/functions/_shared/portfolio-rules.ts
 * PURPOSE: Pure cross-project rules for the portfolio (Plan 019 Phase P2,
 *          §3b; Plan 020 §6–§8): the shared resources each recipe declares,
 *          and the rules that only make sense across an organization's apps —
 *          a shared auth provider set up differently, billing that does not
 *          line up, a broken deep link into a sibling app, shared channels,
 *          CI cost concentrated in a few repos, recipe holes per kind, and one
 *          API key shared by several apps.
 *
 * No I/O. Manifests are untrusted repo text and are read defensively. A rule
 * that cannot decide (a file that failed to load, a malformed document)
 * returns an `unknown` entry where the signature allows it — never a finding.
 */

export type ProjectKindValue = 'app' | 'site' | 'service' | 'library' | 'other'

export interface PortfolioProject {
  id: string
  name: string
  kind: ProjectKindValue | null
  /** mushi.recipe.json; untrusted, read defensively. */
  manifest: unknown
}

export const PORTFOLIO_RESOURCE_KINDS = [
  'auth_provider',
  'supabase_project',
  'stripe_account',
  'domain',
  'deep_link_domain',
  'bundle_id',
  'push_channel',
  'slack_channel',
  'posthog_project',
  'sentry_project',
  'repo',
  'legacy_system',
  'revenuecat_project',
] as const
export type PortfolioResourceKind = (typeof PORTFOLIO_RESOURCE_KINDS)[number]

export interface PortfolioResource {
  id: string
  kind: PortfolioResourceKind
  externalId: string
  metadata: Record<string, unknown>
}

export interface PortfolioResourceUse {
  resourceId: string
  projectId: string
  role: string
}

export interface DerivedResourceUse {
  kind: PortfolioResourceKind
  externalId: string
  role: string
  projectId: string
  source: 'manifest'
}

export type PortfolioRuleSeverity = 'info' | 'warn' | 'error'

export interface PortfolioRuleFinding {
  ruleId: string
  severity: PortfolioRuleSeverity
  projectIds: string[]
  /** `${kind}:${externalId}` of the shared resource, when there is one. */
  resourceKey: string | null
  message: string
  evidence: Record<string, unknown>
  suggestedFix: string
}

/** A check that could not decide. Shown as "not checked", never as a finding. */
export interface PortfolioRuleUnknown {
  ruleId: string
  projectIds: string[]
  resourceKey: string | null
  reason: string
}

// ── defensive readers ────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}

function str(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null
}

function strList(v: unknown, max = 50): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => x !== null).slice(0, max) : []
}

function names(projects: readonly { id: string; name: string }[], ids: readonly string[]): string {
  const byId = new Map(projects.map((p) => [p.id, p.name]))
  return ids.map((id) => byId.get(id) ?? id.slice(0, 8)).join(', ')
}

function resourceKey(kind: PortfolioResourceKind, externalId: string): string {
  return `${kind}:${externalId}`
}

function hostOf(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase() || value.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

// ── resource uses from manifests ─────────────────────────────────────────────

/**
 * Shared resources each manifest declares (Plan 019 §2 `links`, `data`,
 * `integrations`, `app.ids`). Duplicates within one project are dropped.
 */
export function deriveResourceUses(projects: readonly PortfolioProject[]): DerivedResourceUse[] {
  const out: DerivedResourceUse[] = []
  for (const p of projects) {
    const m = obj(p.manifest)
    const seen = new Set<string>()
    const add = (kind: PortfolioResourceKind, externalId: string | null, role: string) => {
      if (!externalId) return
      const id = (kind === 'domain' || kind === 'deep_link_domain') && role !== 'deep_link_scheme' ? hostOf(externalId) : externalId
      const key = `${kind}|${id}|${role}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ kind, externalId: id, role, projectId: p.id, source: 'manifest' })
    }
    const links = obj(m.links)
    for (const d of strList(links.domains)) add('domain', d, 'domain')
    const deep = obj(links.deepLinks)
    for (const d of strList(deep.universalLinkDomains)) add('deep_link_domain', d, 'deep_link_host')
    for (const s of strList(deep.schemes)) add('deep_link_domain', `${s.replace(/:\/*$/, '')}://`, 'deep_link_scheme')
    const auth = obj(links.auth)
    const provider = str(auth.provider)
    if (provider) add('auth_provider', `${provider}:${str(auth.ref) ?? 'default'}`, 'auth')
    const billing = obj(links.billing)
    add('stripe_account', str(billing.stripeAccount), 'billing')
    const notifications = obj(links.notifications)
    add('slack_channel', str(notifications.slackChannel), 'notifications')
    add('push_channel', str(notifications.pushProvider), 'push')
    add('supabase_project', str(obj(m.data).projectRef), 'data')
    const integrations = obj(m.integrations)
    add('sentry_project', str(obj(integrations.sentry).project), 'monitoring')
    add('posthog_project', str(obj(integrations.posthog).project), 'analytics')
    const ids = obj(obj(m.app).ids)
    add('bundle_id', str(ids.bundleId), 'ios_bundle')
    add('bundle_id', str(ids.androidPackage), 'android_package')
  }
  return out
}

// ── shared auth ──────────────────────────────────────────────────────────────

export interface AuthConfigInput {
  projectId: string
  provider: string
  ref: string
  settings: {
    siteUrl?: string
    redirectUrls?: string[]
    providers?: string[]
    emailConfirm?: boolean
    mfa?: boolean
  }
  /** What the project declares should be able to log in: its domains and deep-link schemes. */
  declaredOrigins?: string[]
  /**
   * false: this project's settings were not read (no config file in its repo).
   * It is left out of the settings comparison; its origins are still checked
   * against the allowlist the others declare. Default true.
   */
  settingsKnown?: boolean
  /** Where the settings came from, e.g. "owner/repo/supabase/config.toml" (declared, not live). */
  source?: string
}

/** Does an allowlist entry (exact or `*` wildcard, Supabase style) cover this URL? */
export function redirectAllowed(allowlist: readonly string[], url: string): boolean {
  // A bare scheme (`glotit://`) keeps its slashes; a web URL loses a trailing one.
  const target = /^[a-z][\w+.-]*:\/\/$/i.test(url) ? url : url.replace(/\/+$/, '')
  const candidates = [target, `${target}/`]
  return allowlist.some((entry) => {
    const e = entry.trim()
    if (!e) return false
    if (!e.includes('*')) {
      const exact = e.replace(/\/+$/, '')
      return target === exact || target === e || target.startsWith(`${exact}/`)
    }
    const re = new RegExp(`^${e.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return candidates.some((c) => re.test(c))
  })
}

/**
 * Projects on one auth provider + ref must agree on the settings that change
 * how login works, and every sibling's domain or scheme must be allowed to
 * receive the login redirect — or login breaks inside that app.
 */
export function authConfigDivergent(configs: readonly AuthConfigInput[], projects: readonly { id: string; name: string }[] = []): PortfolioRuleFinding[] {
  const groups = new Map<string, AuthConfigInput[]>()
  for (const c of configs) {
    const key = `${c.provider}:${c.ref}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const out: PortfolioRuleFinding[] = []
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const rk = `auth_provider:${key}`
    const ids = group.map((g) => g.projectId)
    const diffs: string[] = []
    const known = group.filter((g) => g.settingsKnown !== false)
    const providersOf = (g: AuthConfigInput) => [...(g.settings.providers ?? [])].sort().join(',')
    if (new Set(known.map(providersOf)).size > 1) diffs.push('sign-in methods')
    if (new Set(known.map((g) => String(g.settings.emailConfirm ?? 'unset'))).size > 1) diffs.push('email confirmation')
    if (new Set(known.map((g) => String(g.settings.mfa ?? 'unset'))).size > 1) diffs.push('two-factor sign-in')
    if (diffs.length && known.length >= 2) {
      out.push({
        ruleId: 'auth_config_divergent',
        severity: 'warn',
        projectIds: ids,
        resourceKey: rk,
        message: `${names(projects, ids)} share one login setup but ${known.some((g) => g.source) ? 'their config files declare different' : 'disagree on'} ${diffs.join(', ')}.`,
        evidence: { differences: diffs, perProject: known.map((g) => ({ projectId: g.projectId, providers: g.settings.providers ?? [], emailConfirm: g.settings.emailConfirm ?? null, mfa: g.settings.mfa ?? null, source: g.source ?? null })) },
        suggestedFix: 'These apps use the same auth project, so the settings are shared. Decide which setting is right and check each app still signs in, then note the choice in each mushi.recipe.json.',
      })
    }
    const allowlist = [...new Set(known.flatMap((g) => [...(g.settings.redirectUrls ?? []), ...(g.settings.siteUrl ? [g.settings.siteUrl] : [])]))]
    // Nothing declares the allowlist: there is nothing to check against.
    if (known.length === 0) continue
    const sources = [...new Set(known.map((g) => g.source).filter((x): x is string => Boolean(x)))]
    for (const g of group) {
      for (const origin of g.declaredOrigins ?? []) {
        const url = origin.includes('://') ? origin : `https://${origin}`
        if (redirectAllowed(allowlist, url)) continue
        out.push({
          ruleId: 'auth_redirect_missing',
          // A declared file can lag the dashboard, so a declared-only miss is a warning.
          severity: sources.length ? 'warn' : 'error',
          projectIds: [g.projectId],
          resourceKey: rk,
          message: sources.length
            ? `${names(projects, [g.projectId])} sends logins back to ${url}, which is not in the redirect list declared in ${sources.join(', ')}. If the live project does not allow it either, login breaks there.`
            : `${names(projects, [g.projectId])} sends logins back to ${url}, which the shared auth setup does not allow. Login breaks there.`,
          evidence: { missing: url, allowlist, sources },
          suggestedFix: `Add ${url.endsWith('://') ? `${url}**` : `${url.replace(/\/+$/, '')}/**`} to the redirect URL allowlist of the shared auth project.`,
        })
      }
    }
  }
  return out
}

// ── billing ──────────────────────────────────────────────────────────────────

export interface StripeFacts {
  /** The account the project's key actually belongs to. */
  account: string
  /** Price ids that exist in that account. */
  priceIds: string[]
  /** Price ids found in the project's code. */
  priceIdsInCode?: string[]
}

/**
 * Apps that share credits must bill through the same Stripe account, and
 * every price id the code uses must exist in that account.
 */
export function billingConsistency(projects: readonly PortfolioProject[], stripe: Readonly<Record<string, StripeFacts | undefined>> = {}): PortfolioRuleFinding[] {
  const out: PortfolioRuleFinding[] = []
  const declared = new Map<string, string | null>()
  const bySlugOrName = new Map<string, PortfolioProject>()
  for (const p of projects) {
    const billing = obj(obj(obj(p.manifest).links).billing)
    declared.set(p.id, str(billing.stripeAccount) ?? stripe[p.id]?.account ?? null)
    bySlugOrName.set(p.name, p)
    bySlugOrName.set(p.id, p)
  }
  const reported = new Set<string>()
  for (const p of projects) {
    const billing = obj(obj(obj(p.manifest).links).billing)
    for (const sibling of strList(billing.sharedCreditsWith)) {
      const other = bySlugOrName.get(sibling)
      if (!other) continue
      const pair = [p.id, other.id].sort().join('|')
      if (reported.has(pair)) continue
      const a = declared.get(p.id) ?? null
      const b = declared.get(other.id) ?? null
      if (a && b && a === b) continue
      reported.add(pair)
      if (!a || !b) {
        // Not a mismatch Mushi can see: one side names no account.
        const missing = [!a ? p : null, !b ? other : null].filter((x): x is PortfolioProject => x !== null)
        out.push({
          ruleId: 'billing_account_undeclared',
          severity: 'info',
          projectIds: [p.id, other.id],
          resourceKey: null,
          message: `${p.name} shares credits with ${other.name}, but ${missing.map((m) => m.name).join(' and ')} ${missing.length === 1 ? 'names' : 'name'} no Stripe account, so Mushi cannot check they bill through the same one.`,
          evidence: { [p.id]: a, [other.id]: b },
          suggestedFix: 'Set `links.billing.stripeAccount` in each mushi.recipe.json to the Stripe account id the app bills through.',
        })
        continue
      }
      out.push({
        ruleId: 'billing_account_mismatch',
        severity: 'error',
        projectIds: [p.id, other.id],
        resourceKey: resourceKey('stripe_account', a),
        message: `${p.name} shares credits with ${other.name}, but they bill through different Stripe accounts. A credit bought in one will not show up in the other.`,
        evidence: { [p.id]: a, [other.id]: b },
        suggestedFix: 'Point both apps at the same Stripe account and set `links.billing.stripeAccount` to it in each mushi.recipe.json.',
      })
    }
  }
  for (const p of projects) {
    const facts = stripe[p.id]
    if (!facts?.priceIdsInCode?.length) continue
    const known = new Set(facts.priceIds)
    const missing = [...new Set(facts.priceIdsInCode)].filter((id) => !known.has(id))
    if (!missing.length) continue
    out.push({
      ruleId: 'stripe_price_missing',
      severity: 'error',
      projectIds: [p.id],
      resourceKey: resourceKey('stripe_account', facts.account),
      message: `${p.name} uses ${missing.length === 1 ? 'a price' : `${missing.length} prices`} that ${missing.length === 1 ? 'does' : 'do'} not exist in its Stripe account: ${missing.slice(0, 5).join(', ')}. Checkout fails there.`,
      evidence: { missing, account: facts.account },
      suggestedFix: 'Create the price in Stripe, or change the code to a price id that exists in this account (check test vs live mode).',
    })
  }
  return out
}

// ── deep links ───────────────────────────────────────────────────────────────

export interface DeepLinkTarget {
  bundleId?: string
  appleTeamId?: string
  androidPackage?: string
  sha256CertFingerprints?: string[]
}

export interface DeepLinkFiles {
  aasa: string | null
  assetlinks: string | null
  fetchError?: string
}

export interface DeepLinkEvaluation {
  findings: PortfolioRuleFinding[]
  unknown: PortfolioRuleUnknown[]
}

/** App ids listed in an apple-app-site-association file, or null when it is not readable. */
export function parseAasaAppIds(text: string): string[] | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  const applinks = obj(obj(doc).applinks)
  if (!Array.isArray(applinks.details)) return null
  const ids: string[] = []
  for (const d of applinks.details) {
    const det = obj(d)
    const single = str(det.appID)
    if (single) ids.push(single)
    ids.push(...strList(det.appIDs))
  }
  return ids
}

/** Android packages (with their cert fingerprints) in an assetlinks.json, or null when it is not readable. */
export function parseAssetLinks(text: string): Array<{ packageName: string; fingerprints: string[] }> | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(doc)) return null
  const out: Array<{ packageName: string; fingerprints: string[] }> = []
  for (const s of doc) {
    const target = obj(obj(s).target)
    const pkg = str(target.package_name)
    if (pkg) out.push({ packageName: pkg, fingerprints: strList(target.sha256_cert_fingerprints).map((f) => f.toUpperCase()) })
  }
  return out
}

/**
 * For every declared link into a sibling app: the domain's AASA must list
 * the target's `TEAMID.bundle` and its assetlinks.json the target's package
 * (and signing certificate, when known). A file that failed to load or does
 * not parse goes to `unknown`, never to a finding.
 */
export function evaluateDeepLinks(
  appLinks: ReadonlyArray<{ fromProjectId: string; toProjectId: string; domain: string }>,
  files: Readonly<Record<string, DeepLinkFiles | undefined>>,
  targets: Readonly<Record<string, DeepLinkTarget | undefined>>,
  projects: readonly { id: string; name: string }[] = [],
): DeepLinkEvaluation {
  const findings: PortfolioRuleFinding[] = []
  const unknown: PortfolioRuleUnknown[] = []
  for (const link of appLinks) {
    const domain = hostOf(link.domain)
    const rk = resourceKey('deep_link_domain', domain)
    const ids = [link.fromProjectId, link.toProjectId]
    const file = files[domain] ?? files[link.domain]
    const target = targets[link.toProjectId]
    const toName = names(projects, [link.toProjectId])
    if (!file || file.fetchError) {
      unknown.push({ ruleId: 'deep_link_broken', projectIds: ids, resourceKey: rk, reason: `Could not read the link files on ${domain}${file?.fetchError ? `: ${file.fetchError}` : ''}.` })
      continue
    }
    if (!target || (!target.bundleId && !target.androidPackage)) {
      unknown.push({ ruleId: 'deep_link_broken', projectIds: ids, resourceKey: rk, reason: `${toName} declares no bundle id or Android package to look for.` })
      continue
    }
    if (target.bundleId) {
      const appIds = file.aasa === null ? null : parseAasaAppIds(file.aasa)
      if (file.aasa === null) {
        findings.push(deepLinkFinding(ids, rk, `${domain} has no apple-app-site-association file, so links to ${toName} open in the browser on iPhone.`, { platform: 'ios', domain }))
      } else if (appIds === null) {
        unknown.push({ ruleId: 'deep_link_broken', projectIds: ids, resourceKey: rk, reason: `The apple-app-site-association file on ${domain} could not be read as JSON.` })
      } else {
        const want = target.appleTeamId ? [`${target.appleTeamId}.${target.bundleId}`] : null
        const ok = want ? appIds.includes(want[0]) : appIds.some((id) => id.endsWith(`.${target.bundleId}`))
        if (!ok) findings.push(deepLinkFinding(ids, rk, `${domain}'s apple-app-site-association does not list ${want?.[0] ?? target.bundleId}, so links to ${toName} open in the browser on iPhone.`, { platform: 'ios', domain, listed: appIds }))
      }
    }
    if (target.androidPackage) {
      const statements = file.assetlinks === null ? null : parseAssetLinks(file.assetlinks)
      if (file.assetlinks === null) {
        findings.push(deepLinkFinding(ids, rk, `${domain} has no assetlinks.json, so links to ${toName} open in the browser on Android.`, { platform: 'android', domain }))
      } else if (statements === null) {
        unknown.push({ ruleId: 'deep_link_broken', projectIds: ids, resourceKey: rk, reason: `The assetlinks.json on ${domain} could not be read as JSON.` })
      } else {
        const entry = statements.find((s) => s.packageName === target.androidPackage)
        const wantFp = (target.sha256CertFingerprints ?? []).map((f) => f.toUpperCase())
        if (!entry) {
          findings.push(deepLinkFinding(ids, rk, `${domain}'s assetlinks.json does not list ${target.androidPackage}, so links to ${toName} open in the browser on Android.`, { platform: 'android', domain, listed: statements.map((s) => s.packageName) }))
        } else if (wantFp.length && !wantFp.some((f) => entry.fingerprints.includes(f))) {
          findings.push(deepLinkFinding(ids, rk, `${domain}'s assetlinks.json lists ${target.androidPackage} with a different signing certificate, so Android will not trust the link.`, { platform: 'android', domain, listedFingerprints: entry.fingerprints }))
        }
      }
    }
  }
  return { findings, unknown }
}

function deepLinkFinding(projectIds: string[], rk: string, message: string, evidence: Record<string, unknown>): PortfolioRuleFinding {
  return {
    ruleId: 'deep_link_broken',
    severity: 'error',
    projectIds,
    resourceKey: rk,
    message,
    evidence,
    suggestedFix: evidence.platform === 'ios'
      ? 'Serve /.well-known/apple-app-site-association (JSON, no redirect) with an applinks entry for "<TEAMID>.<bundle id>".'
      : 'Serve /.well-known/assetlinks.json with a delegate_permission/common.handle_all_urls entry for the package and its SHA-256 signing certificate fingerprint.',
  }
}

// ── shared channels ──────────────────────────────────────────────────────────

export interface ChannelSettings {
  projectId: string
  slackChannelId: string | null
  pushKeyId: string | null
}

/** Above this many apps on one Slack channel, suggest per-app channels. */
export const SHARED_CHANNEL_SPLIT_AT = 3

export function sharedChannels(settings: readonly ChannelSettings[], projects: readonly { id: string; name: string }[] = []): PortfolioRuleFinding[] {
  const out: PortfolioRuleFinding[] = []
  const group = (pick: (s: ChannelSettings) => string | null) => {
    const m = new Map<string, string[]>()
    for (const s of settings) {
      const k = pick(s)
      if (k) m.set(k, [...(m.get(k) ?? []), s.projectId])
    }
    return m
  }
  for (const [channel, ids] of group((s) => s.slackChannelId)) {
    if (ids.length <= SHARED_CHANNEL_SPLIT_AT) continue
    out.push({
      ruleId: 'shared_channel_untagged',
      severity: 'info',
      projectIds: ids,
      resourceKey: resourceKey('slack_channel', channel),
      message: `${ids.length} apps post to one Slack channel (${names(projects, ids)}). Mushi names the app in every message, but it gets busy.`,
      evidence: { channel, count: ids.length },
      suggestedFix: 'Give the busiest apps their own channel, or keep one channel and filter by app name.',
    })
  }
  for (const [key, ids] of group((s) => s.pushKeyId)) {
    if (ids.length < 2) continue
    out.push({
      ruleId: 'push_key_shared',
      severity: 'info',
      projectIds: ids,
      resourceKey: resourceKey('push_channel', key),
      message: `${names(projects, ids)} send push notifications with one key. If it expires or leaks, push stops in every one of them.`,
      evidence: { pushKeyId: key },
      suggestedFix: 'Use one push key per app, so a rotation touches one app at a time.',
    })
  }
  return out
}

// ── CI cost ──────────────────────────────────────────────────────────────────

/** Top two repos above this share of the estimated minutes. */
export const CI_CONCENTRATION_SHARE = 0.6

/** Advanced-mode only: CI cost alone fails the drift test (ADR 0016). Minutes are estimated. */
export function ciCostConcentration(perRepoMinutes: ReadonlyArray<{ projectId: string; repo: string; minutes30d: number }>): PortfolioRuleFinding[] {
  const rows = perRepoMinutes.filter((r) => Number.isFinite(r.minutes30d) && r.minutes30d > 0)
  if (rows.length < 3) return []
  const total = rows.reduce((n, r) => n + r.minutes30d, 0)
  const top = [...rows].sort((a, b) => b.minutes30d - a.minutes30d).slice(0, 2)
  const share = top.reduce((n, r) => n + r.minutes30d, 0) / total
  if (share <= CI_CONCENTRATION_SHARE) return []
  return [{
    ruleId: 'ci_cost_concentration',
    severity: 'info',
    projectIds: [...new Set(top.map((r) => r.projectId))],
    resourceKey: null,
    message: `${top.map((r) => r.repo).join(' and ')} use about ${Math.round(share * 100)}% of your estimated CI minutes over 30 days.`,
    evidence: { estimated: true, totalMinutes: Math.round(total), top: top.map((r) => ({ repo: r.repo, minutes: Math.round(r.minutes30d) })) },
    suggestedFix: 'Check those workflows for a missing concurrency group, a missing timeout, path filters and macOS jobs that run on every push.',
  }]
}

// ── recipe completeness ──────────────────────────────────────────────────────

export interface CompletenessSignals {
  hasCrashReporting?: boolean
  hasVersionProbe?: boolean
  hasDeepLinkFile?: boolean
  hasSecurityHeaders?: boolean
  hasReleaseWorkflow?: boolean
}

const CHECKLIST: Record<ProjectKindValue, Array<{ key: keyof CompletenessSignals; item: string; fix: string }>> = {
  app: [
    { key: 'hasCrashReporting', item: 'crash reporting', fix: 'Connect Sentry, Crashlytics or the Mushi SDK so crashes become reports.' },
    { key: 'hasVersionProbe', item: 'a version probe', fix: 'Publish a version.json (version and commit) with each build and add it as a deploy target probe.' },
    { key: 'hasDeepLinkFile', item: 'a deep-link file', fix: 'Serve apple-app-site-association and assetlinks.json so links open the app.' },
  ],
  site: [
    { key: 'hasVersionProbe', item: 'a version probe', fix: 'Publish a version.json (version and commit) with each deploy and add it as a deploy target probe.' },
    { key: 'hasSecurityHeaders', item: 'security headers', fix: 'Set HSTS, a Content-Security-Policy with frame-ancestors, X-Content-Type-Options and Referrer-Policy.' },
  ],
  library: [
    { key: 'hasReleaseWorkflow', item: 'a release workflow', fix: 'Add a release workflow so every published version comes from CI.' },
  ],
  service: [],
  other: [],
}

/**
 * One `recipe_incomplete` info per missing item for the project's kind. A
 * project with no kind is skipped. A signal that is `undefined` was not
 * checked, so it is not reported as missing either.
 */
export function completenessChecklist(projects: ReadonlyArray<{ id: string; name: string; kind: ProjectKindValue | null; signals: CompletenessSignals }>): PortfolioRuleFinding[] {
  const out: PortfolioRuleFinding[] = []
  for (const p of projects) {
    if (!p.kind) continue
    for (const c of CHECKLIST[p.kind] ?? []) {
      if (p.signals[c.key] !== false) continue
      out.push({
        ruleId: 'recipe_incomplete',
        severity: 'info',
        projectIds: [p.id],
        resourceKey: null,
        message: `${p.name} (${p.kind}) has no ${c.item}.`,
        evidence: { kind: p.kind, missing: c.key },
        suggestedFix: c.fix,
      })
    }
  }
  return out
}

// ── keys ─────────────────────────────────────────────────────────────────────

/** One provider key used by several apps: spend cannot be split, and one leak hits them all (Plan 020 §6). */
export function keySharedAcrossApps(keys: ReadonlyArray<{ provider: string; keyFingerprint: string; projectId: string }>, projects: readonly { id: string; name: string }[] = []): PortfolioRuleFinding[] {
  const m = new Map<string, { provider: string; ids: Set<string> }>()
  for (const k of keys) {
    if (!k.keyFingerprint) continue
    const key = `${k.provider}:${k.keyFingerprint}`
    const e = m.get(key) ?? { provider: k.provider, ids: new Set<string>() }
    e.ids.add(k.projectId)
    m.set(key, e)
  }
  const out: PortfolioRuleFinding[] = []
  for (const [, e] of m) {
    if (e.ids.size < 2) continue
    const ids = [...e.ids].sort()
    out.push({
      ruleId: 'key_shared_across_apps',
      severity: 'info',
      projectIds: ids,
      resourceKey: null,
      message: `${names(projects, ids)} use the same ${e.provider} key. Its spend cannot be split by app, and one leak hits all of them.`,
      evidence: { provider: e.provider, apps: ids.length },
      suggestedFix: `Create one ${e.provider} key per app and set each app's key separately.`,
    })
  }
  return out
}
