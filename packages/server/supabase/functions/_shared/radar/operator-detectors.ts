/**
 * FILE: packages/server/supabase/functions/_shared/radar/operator-detectors.ts
 * PURPOSE: The operator detectors of Plan 020 §4.2 / §6 (Phase 2): holes in
 *          what one person runs across several apps — an app nobody uses that
 *          still spends, a provider key that stopped working, a store key
 *          missing a permission, keys nobody used for 90 days, a secret key in
 *          the built bundle, paid features with no off switch, and AI
 *          providers with no spending limit.
 *
 * Pure: every function takes rows the loader (operator.ts) or the host CI
 * already read. No I/O. Like every radar detector, a rule whose inputs are
 * missing returns `unknown` with the step that turns it on — never `ok`.
 * Mushi cannot see a provider's own limit or 2FA settings; the wording says
 * "declared" wherever the answer comes from the owner, not the provider.
 */

import type { DetectorResult, RadarFinding } from './types.ts'

const DAY = 86_400_000
export const DEAD_APP_DAYS = 30
export const KEY_UNUSED_DAYS = 90
/** A probe or snapshot older than this no longer answers "does the key still work". */
export const CREDENTIAL_FRESH_DAYS = 7
/** byok_keys.last_used_at exists from migration 20260806052917; "unused since" starts no earlier. */
export const BYOK_USE_TRACKED_SINCE = '2026-08-06T00:00:00Z'
/** project_api_keys.last_seen_at exists from migration 20260505000000. */
export const SDK_KEY_USE_TRACKED_SINCE = '2026-05-05T00:00:00Z'
/** Spend at or above this share of a declared limit is reported. */
export const LIMIT_ALERT_SHARE = 0.8

type Failure = 'credential_rejected' | 'permission_missing' | 'not_found' | 'rate_limited' | 'vendor_error' | 'other'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const days = (fromIso: string, now: Date) => Math.floor((now.getTime() - Date.parse(fromIso)) / DAY)
const isFresh = (iso: string | null, now: Date, maxDays: number) => iso != null && Number.isFinite(Date.parse(iso)) && now.getTime() - Date.parse(iso) < maxDays * DAY
const usd = (n: number) => `$${n.toFixed(2)}`

function latestIso(values: ReadonlyArray<string | null>): string | null {
  let best: string | null = null
  for (const v of values) {
    if (v && Number.isFinite(Date.parse(v)) && (best == null || Date.parse(v) > Date.parse(best))) best = v
  }
  return best
}

// ── dead_app_live_spend ──────────────────────────────────────────────────────

/** A native app's HTTP stack or a webview shell, from the heartbeat's User-Agent. */
const APP_CLIENT_UA = /okhttp|cfnetwork|darwin|dalvik|expo|react-?native|capacitor/i

/**
 * Was a key's latest heartbeat the app itself? A browser or webview sends an
 * Origin; a native app has a native HTTP stack. The host's CI (`mushi radar
 * scan --push`, recipe pushes) and server scripts send neither, so a retired
 * app whose CI still runs does not look alive.
 */
export function isAppHeartbeat(origin: string | null, userAgent: string | null): boolean {
  return Boolean(origin?.trim()) || Boolean(userAgent && APP_CLIENT_UA.test(userAgent))
}

export interface DeadAppInput {
  /** Latest SDK heartbeat that came from the app itself (see isAppHeartbeat), not from CI. */
  lastSdkHeartbeat: string | null
  lastReport: string | null
  lastPageView: string | null
  /** AI provider spend tied to this app over 30 days (llm_usage connector); null = no spend source read. */
  providerSpendUsd30d: number | null
  providerSpendVendor: string | null
  /** Edge functions still deployed (Supabase connector); null = not read. */
  liveFunctions: number | null
  /** Provider keys stored in Mushi for this app (byok_keys) that are not switched off. */
  liveProviderKeys: number
}

export function evaluateDeadApp(input: DeadAppInput, now: Date): DetectorResult {
  const ruleId = 'dead_app_live_spend' as const
  const lastSeen = latestIso([input.lastSdkHeartbeat, input.lastReport, input.lastPageView])
  if (!lastSeen) {
    return { ruleId, state: 'unknown', reason: 'Mushi has never seen this app in use (no SDK heartbeat, report or page view), so it cannot tell whether it is still alive. Install the Mushi SDK to check this.', findings: [] }
  }
  const idle = days(lastSeen, now)
  if (idle < DEAD_APP_DAYS) return { ruleId, state: 'ok', reason: `In use: last seen ${idle === 0 ? 'today' : `${plural(idle, 'day')} ago`}.`, findings: [] }

  const live: string[] = []
  if (input.providerSpendUsd30d != null && input.providerSpendUsd30d > 0) live.push(`${usd(input.providerSpendUsd30d)} of ${input.providerSpendVendor ?? 'AI provider'} spend in the last 30 days`)
  if (input.liveFunctions != null && input.liveFunctions > 0) live.push(`${plural(input.liveFunctions, 'edge function')} still deployed`)
  if (input.liveProviderKeys > 0) live.push(`${plural(input.liveProviderKeys, 'provider key')} still active in Mushi`)
  if (live.length === 0) {
    if (input.providerSpendUsd30d == null && input.liveFunctions == null) {
      return { ruleId, state: 'unknown', reason: `Nobody has used the app for ${idle} days, but no spend source is connected (AI provider spend or Supabase), so Mushi cannot tell whether it still costs money.`, findings: [] }
    }
    return { ruleId, state: 'ok', reason: `Nobody has used the app for ${idle} days, and nothing Mushi can see still spends.`, findings: [] }
  }
  return {
    ruleId,
    state: 'finding',
    reason: `No use for ${idle} days while ${live.length === 1 ? 'something still spends' : 'several things still spend'}.`,
    findings: [{
      ruleId,
      severity: 'warn',
      message: `Nobody has used this app for ${idle} days (no SDK heartbeat, report or page view since ${lastSeen.slice(0, 10)}), but it still has ${live.join(', ')}. If the app is retired, that is money and exposure for nothing.`,
      target: null,
      fix: 'If the app is retired: 1) pause its Supabase project (Dashboard → Project settings → General → Pause project); 2) delete its edge functions (`supabase functions delete <name>`) and unschedule its cron jobs; 3) revoke its provider keys at each provider and remove them in Mushi (Settings → API Keys). If it is still meant to be live, check that the Mushi SDK still loads in it.',
      evidence: { lastSeen, idleDays: idle, providerSpendUsd30d: input.providerSpendUsd30d, liveFunctions: input.liveFunctions, liveProviderKeys: input.liveProviderKeys },
    }],
  }
}

// ── provider_key_invalid ─────────────────────────────────────────────────────

/** The newest thing Mushi learned about one stored credential. */
export interface CredentialObservation {
  /**
   * Stable per credential: a connector instance id, `legacy:<kind>` for the
   * project-settings credentials (a connector snapshot and an integration
   * health check of the same token share it), `byok:<id>`, or `integration:<kind>`.
   */
  credentialId: string
  kind: string
  name: string
  /** Provider for an llm_usage connector or a BYOK key (`openai`, `anthropic`, ...), when known. */
  provider: string | null
  source: 'probe' | 'snapshot' | 'health_check' | 'key_test'
  at: string | null
  ok: boolean
  failure: Failure | null
  /**
   * The failure is the credential's current stored state, not only what a past
   * check saw: a BYOK key marked auth_failed stays that way until a test passes,
   * so it is judged however old its last test is.
   */
  standing?: boolean
}

export const STORE_CONNECTOR_KINDS = ['play_console', 'app_store_connect'] as const

/** Vendor HTTP status -> why the credential failed (same mapping as the connector probes). */
export function failureFromHttpStatus(status: number | null): Failure {
  if (status === 401) return 'credential_rejected'
  if (status === 403) return 'permission_missing'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status != null && status >= 500) return 'vendor_error'
  return 'other'
}

// -- BYOK keys (byok_keys: tested on save, by "Test key", and daily by integration-health-probe) --

export interface ByokCredentialRow {
  id: string
  provider_slug: string
  label: string | null
  key_hint: string | null
  /** pending_validation | active | disabled | quota_exhausted | auth_failed */
  status: string
  /** ok | error_auth | error_network | error_quota | null (never tested) */
  test_status: string | null
  last_tested_at: string | null
}

/** BYOK statuses that can still make paid calls (a revoked or quarantined key cannot). */
const USABLE_BYOK_STATUSES = new Set(['active', 'quota_exhausted'])
export const isUsableByokKey = (k: Pick<ByokCredentialRow, 'status'>): boolean => USABLE_BYOK_STATUSES.has(k.status)

/**
 * What the last test of a BYOK key said; null when it was never tested or is
 * switched off. A key marked auth_failed is rejected now, whenever it was last
 * tested: Mushi skips it until a test passes again.
 */
export function byokObservation(k: ByokCredentialRow): CredentialObservation | null {
  if (k.status === 'disabled') return null
  const base = { credentialId: `byok:${k.id}`, kind: 'byok', name: k.label || k.key_hint || k.provider_slug, provider: k.provider_slug, source: 'key_test' as const, at: k.last_tested_at }
  if (k.status === 'auth_failed') return { ...base, ok: false, failure: 'credential_rejected', standing: true }
  if (!k.last_tested_at) return null
  if (k.test_status === 'error_auth') return { ...base, ok: false, failure: 'credential_rejected' }
  if (k.test_status === 'ok') return { ...base, ok: true, failure: null }
  if (k.test_status === 'error_quota') return { ...base, ok: false, failure: 'rate_limited' }
  if (k.test_status === 'error_network') return { ...base, ok: false, failure: 'vendor_error' }
  return { ...base, ok: false, failure: 'other' }
}

// -- integration health checks (integration_health_history: every 15 minutes, and "Test") --

/**
 * Integration kinds whose health check uses this project's own credential.
 * Not here: `anthropic` / `openai` / `firecrawl` / `browserbase` (their rows
 * describe BYOK keys, read from byok_keys, or the platform's env key) and
 * `reward_webhook` (an endpoint, not a key).
 */
export const INTEGRATION_CREDENTIAL_KINDS = ['github', 'sentry', 'langfuse', 'linear', 'cursor_cloud', 'claude_code_agent', 'jira', 'github_issues', 'pagerduty', 'slack'] as const
type IntegrationCredentialKind = (typeof INTEGRATION_CREDENTIAL_KINDS)[number]

const INTEGRATION_NAMES: Record<IntegrationCredentialKind, string> = {
  github: 'GitHub', sentry: 'Sentry', langfuse: 'Langfuse', linear: 'Linear', cursor_cloud: 'Cursor Cloud',
  claude_code_agent: 'Claude Code agent', jira: 'Jira', github_issues: 'GitHub Issues', pagerduty: 'PagerDuty', slack: 'Slack',
}
/** These two share the project-settings token with the legacy connector snapshot of the same kind. */
const SHARED_WITH_LEGACY_SNAPSHOT = new Set<string>(['github', 'sentry'])

export interface IntegrationHealthRow {
  kind: string
  /** ok | degraded | down | unknown */
  status: string
  /** Null for rows written before 20261003170200, or when no response came back. */
  http_status: number | null
  checked_at: string
}

const isIntegrationCredentialKind = (k: string): k is IntegrationCredentialKind => (INTEGRATION_CREDENTIAL_KINDS as readonly string[]).includes(k)

/** The newest health check of one integration as a credential observation; null when it says nothing about a key. */
export function integrationObservation(row: IntegrationHealthRow): CredentialObservation | null {
  const kind = row.kind
  if (!isIntegrationCredentialKind(kind)) return null
  // `unknown` means no credential is configured: nothing to judge.
  if (row.status === 'unknown') return null
  const ok = row.status === 'ok'
  // PagerDuty answers a bad routing key with 400.
  const failure: Failure | null = ok ? null : kind === 'pagerduty' && row.http_status === 400 ? 'credential_rejected' : failureFromHttpStatus(row.http_status)
  return {
    credentialId: SHARED_WITH_LEGACY_SNAPSHOT.has(kind) ? `legacy:${kind}` : `integration:${kind}`,
    kind, name: INTEGRATION_NAMES[kind], provider: null, source: 'health_check', at: row.checked_at, ok, failure,
  }
}

interface CredentialHelp {
  vendor: string
  where: string
  /** What stops working when this key is rejected (default: Mushi's reads from the vendor). */
  impact?: string
}

interface ByokVendor { vendor: string; keysAt: string; impact?: string }
const BYOK_VENDORS: Record<string, ByokVendor> = {
  anthropic: { vendor: 'Anthropic', keysAt: 'https://console.anthropic.com/settings/keys' },
  openai: { vendor: 'OpenAI', keysAt: 'https://platform.openai.com/api-keys' },
  firecrawl: { vendor: 'Firecrawl', keysAt: 'https://www.firecrawl.dev/app/api-keys' },
  browserbase: { vendor: 'Browserbase', keysAt: 'https://www.browserbase.com/settings' },
  cursor: { vendor: 'Cursor', keysAt: 'https://cursor.com/dashboard/integrations' },
  // A personal access token: the Schema-Repair diagnostic and backend-drift-scanner read the app's Supabase project with it.
  supabase: { vendor: 'Supabase', keysAt: 'https://supabase.com/dashboard/account/tokens', impact: "Mushi's Supabase schema checks for this app (the Schema-Repair diagnostic and the daily backend drift scan) have stopped." },
}

/** Where the owner replaces a key, per connector kind. */
export function credentialHelp(kind: string, provider: string | null): CredentialHelp {
  switch (kind) {
    case 'github': return { vendor: 'GitHub', where: 'Create a new token at https://github.com/settings/tokens (or reinstall the Mushi GitHub App), then save it in Mushi under Settings → Integrations → GitHub.' }
    case 'supabase': return { vendor: 'Supabase', where: 'Create a new access token at https://supabase.com/dashboard/account/tokens, then save it in Mushi under Settings → API Keys → Supabase.' }
    case 'sentry': return { vendor: 'Sentry', where: 'Create a new auth token at https://sentry.io/settings/account/api/auth-tokens/, then save it in Mushi under Settings → Integrations → Sentry.' }
    case 'llm_usage': return provider === 'anthropic'
      ? { vendor: 'Anthropic', where: 'Create a new admin key at https://console.anthropic.com/settings/admin-keys, then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
      : { vendor: 'OpenAI', where: 'Create a new admin key at https://platform.openai.com/settings/organization/admin-keys, then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
    case 'revenuecat': return { vendor: 'RevenueCat', where: 'Create a new secret API key (v2, read-only) in the RevenueCat project settings, then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
    case 'play_console': return { vendor: 'Google Play', where: 'Create a new JSON key for the service account in Google Cloud (IAM → Service accounts → Keys), then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
    case 'app_store_connect': return { vendor: 'App Store Connect', where: 'Create a new team API key in App Store Connect (Users and Access → Integrations), then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
    case 'byok': {
      const v: ByokVendor = (provider ? BYOK_VENDORS[provider] : undefined) ?? { vendor: provider ?? 'the provider', keysAt: 'the provider dashboard' }
      return { vendor: v.vendor, where: `Create a new key at ${v.keysAt}, add it in Mushi under Settings → API Keys, then remove the old one there.`, impact: v.impact ?? `Mushi's ${v.vendor} calls for this app can no longer use it (they fail, or fall back to another key).` }
    }
    case 'langfuse': return { vendor: 'Langfuse', where: 'Create new API keys in your Langfuse project settings, then save them in Mushi under Settings → Integrations → Langfuse.', impact: "Mushi's Langfuse traces for this app have stopped." }
    case 'linear': return { vendor: 'Linear', where: 'Reconnect Linear in Mushi under Settings → Integrations → Linear, or paste a new key from https://linear.app/settings/api.', impact: 'Mushi can no longer create or sync Linear issues for this app.' }
    case 'cursor_cloud': return { vendor: 'Cursor', where: 'Create a new API key at https://cursor.com/dashboard/integrations, then save it in Mushi under Settings → Integrations → Cursor Cloud.', impact: 'Fixes dispatched to Cursor Cloud for this app fail.' }
    case 'claude_code_agent': return { vendor: 'Anthropic', where: 'Create a new key at https://console.anthropic.com/settings/keys, then save it in Mushi under Settings → Integrations → Claude Code.', impact: 'Fixes dispatched to the Claude Code agent for this app fail.' }
    case 'jira': return { vendor: 'Jira', where: 'Create a new API token at https://id.atlassian.com/manage-profile/security/api-tokens, then update the Jira routing in Mushi under Settings → Integrations.', impact: 'Mushi can no longer file Jira issues for this app.' }
    case 'github_issues': return { vendor: 'GitHub', where: 'Create a new token at https://github.com/settings/tokens, then update the GitHub Issues routing in Mushi under Settings → Integrations.', impact: 'Mushi can no longer file GitHub issues for this app.' }
    case 'pagerduty': return { vendor: 'PagerDuty', where: 'Copy the integration (routing) key from the PagerDuty service, then update the PagerDuty routing in Mushi under Settings → Integrations.', impact: 'Mushi can no longer page you through PagerDuty for this app.' }
    case 'slack': return { vendor: 'Slack', where: 'Reconnect Slack in Mushi under Settings → Integrations → Slack.', impact: "Mushi's Slack messages for this app have stopped." }
    default: return { vendor: kind, where: 'Create a new key with the provider, then rotate it on the connector in Mushi (Portfolio → Connected sources).' }
  }
}

/** Newest observation per credential. */
function newestPerCredential(obs: readonly CredentialObservation[]): CredentialObservation[] {
  const best = new Map<string, CredentialObservation>()
  for (const o of obs) {
    const cur = best.get(o.credentialId)
    if (!cur || (o.at != null && (cur.at == null || Date.parse(o.at) > Date.parse(cur.at)))) best.set(o.credentialId, o)
  }
  return [...best.values()]
}

export function evaluateProviderKeys(obs: readonly CredentialObservation[], now: Date): DetectorResult {
  const ruleId = 'provider_key_invalid' as const
  const latest = newestPerCredential(obs)
  if (latest.length === 0) return { ruleId, state: 'unknown', reason: 'No provider credential is connected for this app, so there is no key to check.', findings: [] }
  // A check older than a week no longer says whether the key works, except a standing rejection (it holds until a test passes).
  const judged = latest.filter((o) => isFresh(o.at, now, CREDENTIAL_FRESH_DAYS) || o.standing === true)
  const stale = latest.length - judged.length
  if (judged.length === 0) return { ruleId, state: 'unknown', reason: `The newest check of each credential is over ${CREDENTIAL_FRESH_DAYS} days old. Press Probe on the connector or Test on the key (Settings → API Keys), or wait for the next scheduled check.`, findings: [] }
  const isStore = (k: string) => (STORE_CONNECTOR_KINDS as readonly string[]).includes(k)
  const findings: RadarFinding[] = []
  for (const o of judged) {
    if (o.ok) continue
    // A store key's missing permission is store_credential_scope_missing; here only a rejected key counts.
    const rejected = o.failure === 'credential_rejected'
    const denied = o.failure === 'permission_missing' && !isStore(o.kind)
    if (!rejected && !denied) continue
    const help = credentialHelp(o.kind, o.provider)
    const lastCheck = o.at == null ? 'It has no recorded test date.' : isFresh(o.at, now, CREDENTIAL_FRESH_DAYS) ? '' : `It was last tested ${o.at.slice(0, 10)} and stays marked rejected until a test passes.`
    // byok_key_invalid (Mushi's own setup check) flags every auth_failed key too: say so, so one key reads as one problem.
    const sameAsSetup = o.kind === 'byok' && o.standing === true ? "Mushi's setup check (byok_key_invalid) reports the same key; replacing it clears both." : ''
    findings.push({
      ruleId,
      severity: rejected ? 'error' : 'warn',
      message: [
        rejected
          ? `${help.vendor} rejects the key for "${o.name}" (it was revoked, rotated or mistyped). ${help.impact ?? `Everything Mushi reads from ${help.vendor} for this app has stopped.`}`
          : `${help.vendor} accepts the key for "${o.name}" but refuses what Mushi does with it: the key lacks a permission.`,
        lastCheck,
        sameAsSetup,
      ].filter(Boolean).join(' '),
      target: o.name,
      fix: rejected ? help.where : `Give the key the read permission listed on the connector, or create one that has it. ${help.where}`,
      evidence: { kind: o.kind, checkedBy: o.source, checkedAt: o.at, failure: o.failure, ...(sameAsSetup ? { alsoReportedBy: 'byok_key_invalid' } : {}) },
    })
  }
  if (findings.length > 0) return { ruleId, state: 'finding', reason: `${plural(findings.length, 'key')} ${findings.length === 1 ? 'does' : 'do'} not work.`, findings }
  const working = judged.filter((o) => o.ok).length
  const notRechecked = stale ? ` ${plural(stale, 'more key')} ${stale === 1 ? 'was' : 'were'} not re-checked in the last ${CREDENTIAL_FRESH_DAYS} days, so ${stale === 1 ? 'it is' : 'they are'} not judged.` : ''
  if (working === 0) return { ruleId, state: 'unknown', reason: `Mushi could not reach the providers to check ${plural(judged.length, 'key')} (they failed for another reason than the key).${notRechecked}`, findings: [] }
  const undecided = judged.length - working
  return { ruleId, state: 'ok', reason: `${plural(working, 'key')} checked in the last ${CREDENTIAL_FRESH_DAYS} days; every provider accepted ${working === 1 ? 'it' : 'them'}${undecided ? ` (${undecided} could not be reached)` : ''}.${notRechecked}`, findings: [] }
}

// ── store_credential_scope_missing ──────────────────────────────────────────

export interface StoreCredentialState {
  id: string
  kind: (typeof STORE_CONNECTOR_KINDS)[number]
  name: string
  /** connector_instances.status */
  status: string
  enabledCapabilities: readonly string[]
  /** What the last probe found missing; null = never probed since the column existed. */
  missingScopes: readonly string[] | null
  lastProbeAt: string | null
  /** The newest daily snapshot failed with a 403 at this time. */
  snapshotDeniedAt: string | null
  /** The newest daily snapshot succeeded at this time, so the snapshot scopes were granted then. */
  snapshotOkAt: string | null
}

export type ScopeCatalog = Readonly<Record<string, Partial<Record<string, readonly string[]>>>>

const STORE_GRANT_STEP: Record<StoreCredentialState['kind'], string> = {
  play_console: 'In Play Console → Users and permissions, open the service account, give it the permissions above for this app, then press Probe on the connector in Mushi.',
  app_store_connect: 'An App Store Connect key cannot gain a role after it is made: create a new team key with the role above (Users and Access → Integrations), rotate it on the connector in Mushi, and revoke the old one.',
}

/** Scopes the enabled capabilities need (`drift` reads the same data as `snapshot`). */
function neededScopes(kind: string, caps: readonly string[], catalog: ScopeCatalog): Map<string, string[]> {
  const need = new Map<string, string[]>()
  for (const cap of caps) {
    const scopes = catalog[kind]?.[cap === 'drift' ? 'snapshot' : cap] ?? []
    for (const s of scopes) need.set(s, [...(need.get(s) ?? []), cap])
  }
  return need
}

export function evaluateStoreScopes(states: readonly StoreCredentialState[], catalog: ScopeCatalog, now: Date): DetectorResult {
  const ruleId = 'store_credential_scope_missing' as const
  const connected = states.filter((s) => s.status !== 'not_connected')
  if (connected.length === 0) return { ruleId, state: 'unknown', reason: 'No Google Play or App Store Connect key is connected, so there are no store permissions to check.', findings: [] }
  const findings: RadarFinding[] = []
  let undecided = 0
  for (const s of connected) {
    const need = neededScopes(s.kind, s.enabledCapabilities, catalog)
    const probeFresh = isFresh(s.lastProbeAt, now, CREDENTIAL_FRESH_DAYS) && s.missingScopes != null
    const deniedFresh = isFresh(s.snapshotDeniedAt, now, CREDENTIAL_FRESH_DAYS)
    if (!probeFresh && !deniedFresh) {
      undecided++
      continue
    }
    const missing = new Set<string>()
    // A snapshot that succeeded after the probe proves the snapshot scopes were granted since.
    const readWorksSinceProbe = s.snapshotOkAt != null && s.lastProbeAt != null && Date.parse(s.snapshotOkAt) > Date.parse(s.lastProbeAt)
    const snapshotScopes = new Set(catalog[s.kind]?.snapshot ?? [])
    if (probeFresh) for (const m of s.missingScopes ?? []) if (need.has(m) && !(readWorksSinceProbe && snapshotScopes.has(m))) missing.add(m)
    if (deniedFresh) for (const m of catalog[s.kind]?.snapshot ?? []) missing.add(m)
    if (missing.size === 0) continue
    const caps = [...new Set([...missing].flatMap((m) => need.get(m) ?? ['snapshot']))]
    const title = s.kind === 'play_console' ? 'Google Play' : 'App Store Connect'
    findings.push({
      ruleId,
      severity: caps.some((c) => c === 'act' || c === 'propose') ? 'error' : 'warn',
      message: `The ${title} key "${s.name}" lacks ${[...missing].map((m) => `"${m}"`).join(', ')}, which ${caps.includes('act') ? 'releasing' : 'reading the store'} needs. Those calls fail until it is granted.`,
      target: s.name,
      fix: STORE_GRANT_STEP[s.kind],
      evidence: { kind: s.kind, missing: [...missing], capabilities: caps, probedAt: s.lastProbeAt, deniedAt: s.snapshotDeniedAt },
    })
  }
  if (findings.length > 0) return { ruleId, state: 'finding', reason: `${plural(findings.length, 'store key')} ${findings.length === 1 ? 'lacks' : 'lack'} a permission.`, findings }
  if (undecided === connected.length) {
    return { ruleId, state: 'unknown', reason: `No store key was probed in the last ${CREDENTIAL_FRESH_DAYS} days. Press Probe on the connector to check its permissions.`, findings: [] }
  }
  return { ruleId, state: 'ok', reason: `Every probed store key has the permissions its switched-on capabilities need${undecided ? ` (${undecided} not probed recently)` : ''}.`, findings: [] }
}

// ── key_unused_90d ───────────────────────────────────────────────────────────

export interface StoredKey {
  kind: 'mushi_sdk' | 'byok'
  label: string
  provider: string | null
  createdAt: string
  lastUsedAt: string | null
  /** When Mushi started recording uses of this kind of key. */
  trackedSince: string
}

export function evaluateUnusedKeys(keys: readonly StoredKey[], untracked: number, now: Date): DetectorResult {
  const ruleId = 'key_unused_90d' as const
  const skipped = untracked > 0 ? ` ${plural(untracked, 'console or MCP key')} ${untracked === 1 ? 'was' : 'were'} not judged: Mushi does not record every use of ${untracked === 1 ? 'it' : 'them'}.` : ''
  if (keys.length === 0) return { ruleId, state: 'unknown', reason: `No stored key whose use Mushi records.${skipped}`, findings: [] }
  const findings: RadarFinding[] = []
  for (const k of keys) {
    const since = k.lastUsedAt ?? latestIso([k.createdAt, k.trackedSince]) ?? k.createdAt
    const idle = days(since, now)
    if (idle < KEY_UNUSED_DAYS) continue
    const what = k.kind === 'mushi_sdk' ? `The Mushi SDK key "${k.label}"` : `The ${k.provider ?? 'provider'} key "${k.label}"`
    findings.push({
      ruleId,
      severity: 'warn',
      message: `${what} has not been used for ${idle} days${k.lastUsedAt ? ` (last used ${k.lastUsedAt.slice(0, 10)})` : ' (never used since Mushi started recording)'}. An unused key can still leak and be abused.`,
      target: k.label,
      fix: k.kind === 'mushi_sdk'
        ? 'If no build ships this key any more, revoke it in the console (Projects → API keys → Revoke). Keys that a live app still ships stay; their next use resets this.'
        : `Remove it in Mushi (Settings → API Keys) and revoke it at ${k.provider ?? 'the provider'} too, so a copy elsewhere stops working.`,
      evidence: { kind: k.kind, idleDays: idle, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt },
    })
  }
  if (findings.length > 0) return { ruleId, state: 'finding', reason: `${plural(findings.length, 'key')} unused for ${KEY_UNUSED_DAYS}+ days.${skipped}`, findings }
  return { ruleId, state: 'ok', reason: `${plural(keys.length, 'key')} checked; each was used in the last ${KEY_UNUSED_DAYS} days.${skipped}`, findings: [] }
}

// ── manifest declarations (spend block) ─────────────────────────────────────

export interface PaidFeatureDecl {
  name: string
  provider: string | null
  killSwitch: string | null
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)

function spendBlock(manifest: unknown): Record<string, unknown> | null {
  if (!manifest || typeof manifest !== 'object') return null
  const s = (manifest as Record<string, unknown>).spend
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : null
}

/**
 * `spend.paidFeatures` from mushi.recipe.json (untrusted, read defensively):
 *   [{ "name": "AI tutor", "provider": "openai", "killSwitch": "env:AI_TUTOR_ENABLED" }]
 * `declared` is false when the key is absent; an empty array is a declaration.
 */
export function paidFeaturesFromManifest(manifest: unknown): { declared: boolean; features: PaidFeatureDecl[] } {
  const raw = spendBlock(manifest)?.paidFeatures
  if (!Array.isArray(raw)) return { declared: false, features: [] }
  const features: PaidFeatureDecl[] = []
  for (const f of raw.slice(0, 50)) {
    if (!f || typeof f !== 'object') continue
    const r = f as Record<string, unknown>
    const name = text(r.name, 120)
    if (!name) continue
    features.push({ name, provider: text(r.provider, 60), killSwitch: text(r.killSwitch, 200) })
  }
  return { declared: true, features }
}

/** `spend.providerLimits` from mushi.recipe.json: `{ "openai": 50 }` = a $50/month limit the owner set at OpenAI. */
export function providerLimitsFromManifest(manifest: unknown): Record<string, number> {
  const raw = spendBlock(manifest)?.providerLimits
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k.toLowerCase()] = v
  }
  return out
}

// ── paid_feature_no_kill_switch ─────────────────────────────────────────────

export interface ProviderSpend { vendor: string; usd: number }

export function evaluateKillSwitches(input: { manifestPresent: boolean; paidFeatures: { declared: boolean; features: PaidFeatureDecl[] }; spend: readonly ProviderSpend[] }): DetectorResult {
  const ruleId = 'paid_feature_no_kill_switch' as const
  const declareStep = 'Declare each feature that costs money per use in mushi.recipe.json, with the switch that turns it off without a new build: `"spend": { "paidFeatures": [{ "name": "AI tutor", "provider": "openai", "killSwitch": "env:AI_TUTOR_ENABLED" }] }`.'
  const spending = input.spend.filter((s) => s.usd > 0)
  if (!input.manifestPresent) return { ruleId, state: 'unknown', reason: 'This app has no mushi.recipe.json yet, so Mushi does not know its paid features.', findings: [] }
  const missing = input.paidFeatures.features.filter((f) => !f.killSwitch)
  if (missing.length > 0) {
    return {
      ruleId,
      state: 'finding',
      reason: `${plural(missing.length, 'paid feature')} declared without a kill switch.`,
      findings: missing.map((f) => ({
        ruleId,
        severity: 'warn' as const,
        message: `"${f.name}"${f.provider ? ` (${f.provider})` : ''} costs money per use and has no kill switch. If it loops or is abused, it keeps spending until a new build ships.`,
        target: f.name,
        fix: `Read a flag or env var before every paid call in "${f.name}" (for example \`if (process.env.AI_TUTOR_ENABLED !== 'true') return fallback\`, or a remote-config flag), so you can turn it off in one place. Then add "killSwitch": "env:<NAME>" (or "flag:<name>") to its entry in mushi.recipe.json.`,
        evidence: { feature: f.name, provider: f.provider },
      })),
    }
  }
  if (input.paidFeatures.declared && input.paidFeatures.features.length > 0) {
    return { ruleId, state: 'ok', reason: `${plural(input.paidFeatures.features.length, 'paid feature')} declared, each with a kill switch.`, findings: [] }
  }
  if (spending.length > 0) {
    const what = spending.map((s) => `${usd(s.usd)} on ${s.vendor}`).join(' and ')
    return {
      ruleId,
      state: 'finding',
      reason: 'The app spends on an AI provider but declares no paid feature with a kill switch.',
      findings: [{
        ruleId,
        severity: 'warn',
        message: `This app spent ${what} in the last 30 days, and mushi.recipe.json declares no paid feature with a kill switch. If a paid call loops or is abused, nothing turns it off without a new build.`,
        target: null,
        fix: declareStep,
        evidence: { spend: spending },
      }],
    }
  }
  if (input.paidFeatures.declared) return { ruleId, state: 'ok', reason: 'mushi.recipe.json declares no paid features, and no AI provider spend is tied to this app.', findings: [] }
  return { ruleId, state: 'unknown', reason: `Not declared yet. ${declareStep}`, findings: [] }
}

// ── provider_limit_unset ─────────────────────────────────────────────────────

/** Providers whose console lets the owner set a monthly spending limit. */
export const PROVIDER_LIMIT_PAGES: Readonly<Record<string, { vendor: string; url: string }>> = {
  openai: { vendor: 'OpenAI', url: 'https://platform.openai.com/settings/organization/limits' },
  anthropic: { vendor: 'Anthropic', url: 'https://console.anthropic.com/settings/limits' },
}

export interface ProviderUse {
  provider: string
  /** `connector`: an llm_usage cost connector; `byok`: a key stored in Mushi. */
  via: 'connector' | 'byok'
  /** Spend tied to this app over 30 days, when a cost connector reads it. */
  spendUsd30d: number | null
}

export function evaluateProviderLimits(uses: readonly ProviderUse[], limits: Readonly<Record<string, number>>): DetectorResult {
  const ruleId = 'provider_limit_unset' as const
  const byProvider = new Map<string, { vias: Set<string>; spend: number | null }>()
  for (const u of uses) {
    const p = u.provider.toLowerCase()
    if (!PROVIDER_LIMIT_PAGES[p]) continue
    const cur = byProvider.get(p) ?? { vias: new Set<string>(), spend: null }
    cur.vias.add(u.via)
    if (u.spendUsd30d != null) cur.spend = (cur.spend ?? 0) + u.spendUsd30d
    byProvider.set(p, cur)
  }
  if (byProvider.size === 0) return { ruleId, state: 'unknown', reason: 'No OpenAI or Anthropic key or cost connector is tied to this app, so there is no provider limit to check.', findings: [] }
  const findings: RadarFinding[] = []
  for (const [p, u] of byProvider) {
    const page = PROVIDER_LIMIT_PAGES[p]
    const limit = limits[p]
    if (limit == null) {
      findings.push({
        ruleId,
        severity: 'warn',
        message: `No monthly spending limit is declared for ${page.vendor}${u.spend != null ? ` (this app spent ${usd(u.spend)} there in 30 days)` : ''}. Mushi cannot cap what your own ${page.vendor} key spends; only ${page.vendor} can.`,
        target: page.vendor,
        fix: `Set a monthly limit at ${page.url}, then record it in mushi.recipe.json so Mushi can warn before you reach it: \`"spend": { "providerLimits": { "${p}": 50 } }\` (US dollars per month).`,
        evidence: { provider: p, via: [...u.vias], spendUsd30d: u.spend },
      })
    } else if (u.spend != null && u.spend >= limit * LIMIT_ALERT_SHARE) {
      findings.push({
        ruleId,
        severity: u.spend >= limit ? 'error' : 'warn',
        message: `This app spent ${usd(u.spend)} at ${page.vendor} in 30 days, ${Math.round((u.spend / limit) * 100)}% of the ${usd(limit)} monthly limit you declared. Calls stop when ${page.vendor} enforces it.`,
        target: page.vendor,
        fix: `Check what drives the spend before the limit cuts the feature off, and raise the limit at ${page.url} only on purpose (then update spend.providerLimits.${p}).`,
        evidence: { provider: p, spendUsd30d: u.spend, declaredLimitUsd: limit },
      })
    }
  }
  if (findings.length > 0) return { ruleId, state: 'finding', reason: `${plural(findings.length, 'provider')} without a declared limit or close to it.`, findings }
  return { ruleId, state: 'ok', reason: `A monthly limit is declared for ${[...byProvider.keys()].map((p) => PROVIDER_LIMIT_PAGES[p].vendor).join(' and ')}, and spend is under ${Math.round(LIMIT_ALERT_SHARE * 100)}% of it where Mushi can see spend.`, findings: [] }
}

// ── key_in_client_bundle (host CI) ──────────────────────────────────────────

/**
 * Server-written text for a secret the host's CI found in a built bundle. The
 * CI sends where and which kind of key, never the key itself.
 */
export function clientBundleFinding(filePath: string, line: number | null, label: string | null): RadarFinding {
  const where = `${filePath}${line ? `:${line}` : ''}`
  const what = label ? `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}` : 'a secret key'
  return {
    ruleId: 'key_in_client_bundle',
    severity: 'error',
    message: `The built app contains ${what} at ${where}. Anyone who downloads the app or opens the site can read it and spend on it.`,
    target: filePath,
    filePath,
    line,
    fix: `Revoke that key now and create a new one, because it has already shipped. Then move the call that needs it behind your server (an edge function or API route that holds the key), and make sure the key's env var is not one the bundler inlines (NEXT_PUBLIC_*, VITE_*, EXPO_PUBLIC_* are public by design).`,
    evidence: label ? { kind: label } : undefined,
  }
}
