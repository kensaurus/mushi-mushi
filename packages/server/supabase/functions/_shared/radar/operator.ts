/**
 * FILE: packages/server/supabase/functions/_shared/radar/operator.ts
 * PURPOSE: Read what the operator detectors need for one project and run
 *          them (Plan 020 Phase 2): heartbeats, reports and page views; the
 *          keys Mushi stores; connector probes and current snapshots; the
 *          recipe manifest's `spend` block. Called by runRadar (radar-scan,
 *          daily, and "Run now").
 *
 * Every read is checked: a read that fails turns the rules that need it into
 * `error` with the reason — never a quiet `ok` or `unknown`.
 * `key_in_client_bundle` is not here: only the host's CI sees built bundles
 * (`mushi radar scan --push`).
 */

import type { getServiceClient } from '../db.ts'
import { getConnector } from '../connectors/index.ts'
import type { ConnectorSnapshot } from '../connectors/types.ts'
import {
  BYOK_USE_TRACKED_SINCE,
  evaluateDeadApp,
  evaluateKillSwitches,
  evaluateProviderKeys,
  evaluateProviderLimits,
  evaluateStoreScopes,
  evaluateUnusedKeys,
  paidFeaturesFromManifest,
  providerLimitsFromManifest,
  SDK_KEY_USE_TRACKED_SINCE,
  STORE_CONNECTOR_KINDS,
  type CredentialObservation,
  type ProviderSpend,
  type ProviderUse,
  type ScopeCatalog,
  type StoreCredentialState,
  type StoredKey,
} from './operator-detectors.ts'
import type { DetectorResult, RadarRuleId } from './types.ts'

type Db = ReturnType<typeof getServiceClient>
type Failure = CredentialObservation['failure']

export const OPERATOR_RULES = [
  'dead_app_live_spend',
  'provider_key_invalid',
  'store_credential_scope_missing',
  'key_unused_90d',
  'paid_feature_no_kill_switch',
  'provider_limit_unset',
] as const satisfies readonly RadarRuleId[]
type OperatorRule = (typeof OPERATOR_RULES)[number]

/** Which reads each rule needs; a failed read errors exactly these rules. */
const NEEDS: Record<OperatorRule, ReadonlyArray<'keys' | 'byok' | 'activity' | 'connectors'>> = {
  dead_app_live_spend: ['keys', 'byok', 'activity', 'connectors'],
  provider_key_invalid: ['connectors'],
  store_credential_scope_missing: ['connectors'],
  key_unused_90d: ['keys', 'byok'],
  paid_feature_no_kill_switch: ['connectors'],
  provider_limit_unset: ['connectors', 'byok'],
}

/** Keys whose every use goes through apiKeyAuth, which stamps last_seen_at. */
const SDK_ONLY_SCOPES = new Set(['report:write'])
const LEGACY_CREDENTIAL_KINDS: Record<string, string> = { github: 'GitHub', supabase: 'Supabase', sentry: 'Sentry' }
const NO_CREDENTIAL_KINDS = new Set(['public_probe', 'http'])
const PROVIDER_VENDOR: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic' }

interface InstanceRow {
  id: string
  kind: string
  display_name: string
  config: Record<string, unknown> | null
  status: string
  enabled_capabilities: string[] | null
  missing_scopes: string[] | null
  last_probe_at: string | null
  last_probe_failure: Failure
}

interface SnapshotRow {
  kind: string
  connector_instance_id: string | null
  ok: boolean
  error_kind: Failure
  observed_at: string
  snapshot: ConnectorSnapshot | null
}

const INSTANCE_COLS = 'id, kind, display_name, config, status, enabled_capabilities, missing_scopes, last_probe_at, last_probe_failure'

function providerOf(config: Record<string, unknown> | null): string | null {
  const p = config?.provider
  return p === 'openai' || p === 'anthropic' ? p : null
}

/** Spend tied to this project in an llm_usage snapshot, or null when the snapshot has none for it. */
function llmSpend(snap: SnapshotRow, projectId: string): { provider: string | null; usd: number | null } {
  const facts = (snap.snapshot?.facts ?? {}) as { provider?: unknown; perProject?: Record<string, unknown> }
  const provider = facts.provider === 'openai' || facts.provider === 'anthropic' ? facts.provider : null
  const raw = facts.perProject?.[projectId]
  return { provider, usd: typeof raw === 'number' && Number.isFinite(raw) ? raw : snap.ok ? 0 : null }
}

export async function operatorRadarResults(db: Db, projectId: string, manifest: unknown, now: Date): Promise<DetectorResult[]> {
  const errors: Partial<Record<'keys' | 'byok' | 'activity' | 'connectors', string>> = {}
  const note = (k: keyof typeof errors, what: string, err: { message: string } | null) => {
    if (err && !errors[k]) errors[k] = `Could not read ${what}: ${err.message.slice(0, 200)}`
  }

  const [keysRes, byokRes, reportRes, eventRes, snapRes, bindRes, ownedRes] = await Promise.all([
    db.from('project_api_keys').select('id, label, scopes, is_active, created_at, last_seen_at').eq('project_id', projectId),
    db.from('byok_keys').select('provider_slug, label, key_hint, status, created_at, last_used_at').eq('project_id', projectId),
    db.from('reports').select('created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('product_events').select('ts').eq('project_id', projectId).order('ts', { ascending: false }).limit(1).maybeSingle(),
    db.from('connector_snapshots').select('kind, connector_instance_id, ok, error_kind, observed_at, snapshot').eq('project_id', projectId).eq('is_current', true),
    db.from('connector_bindings').select('connector_instance_id').eq('project_id', projectId),
    db.from('connector_instances').select(INSTANCE_COLS).eq('project_id', projectId),
  ])
  note('keys', 'the Mushi keys', keysRes.error)
  note('byok', 'the stored provider keys', byokRes.error)
  note('activity', 'the latest report', reportRes.error)
  note('activity', 'the latest page view', eventRes.error)
  note('connectors', 'the connector snapshots', snapRes.error)
  note('connectors', 'the connector bindings', bindRes.error)
  note('connectors', 'the connectors', ownedRes.error)

  const instances = new Map<string, InstanceRow>(((ownedRes.data ?? []) as InstanceRow[]).map((r) => [r.id, r]))
  const boundIds = [...new Set(((bindRes.data ?? []) as Array<{ connector_instance_id: string }>).map((b) => b.connector_instance_id))].filter((id) => !instances.has(id))
  if (boundIds.length > 0) {
    const bound = await db.from('connector_instances').select(INSTANCE_COLS).in('id', boundIds)
    note('connectors', 'the bound connectors', bound.error)
    for (const r of (bound.data ?? []) as InstanceRow[]) instances.set(r.id, r)
  }

  const apiKeys = (keysRes.data ?? []) as Array<{ label: string | null; scopes: string[] | null; is_active: boolean | null; created_at: string; last_seen_at: string | null }>
  const byok = ((byokRes.data ?? []) as Array<{ provider_slug: string; label: string | null; key_hint: string | null; status: string; created_at: string; last_used_at: string | null }>)
    .filter((k) => k.status !== 'disabled')
  const snaps = (snapRes.data ?? []) as SnapshotRow[]
  const llmSnaps = snaps.filter((s) => s.kind === 'llm_usage')

  // ── inputs ──
  const lastSdkHeartbeat = apiKeys.map((k) => k.last_seen_at).filter((x): x is string => Boolean(x)).sort().pop() ?? null
  let providerSpend: number | null = null
  let providerSpendVendor: string | null = null
  for (const s of llmSnaps.filter((x) => x.ok)) {
    const sp = llmSpend(s, projectId)
    if (sp.usd == null) continue
    providerSpend = (providerSpend ?? 0) + sp.usd
    providerSpendVendor = providerSpendVendor ? 'AI provider' : sp.provider ? PROVIDER_VENDOR[sp.provider] : 'AI provider'
  }
  const supa = snaps.find((s) => s.kind === 'supabase' && s.connector_instance_id == null && s.ok)
  const fnFacts = (supa?.snapshot?.facts as { functions?: unknown } | undefined)?.functions
  const liveFunctions = Array.isArray(fnFacts) ? fnFacts.length : null

  const observations: CredentialObservation[] = []
  for (const inst of instances.values()) {
    if (NO_CREDENTIAL_KINDS.has(inst.kind) || inst.status === 'not_connected') continue
    const base = { credentialId: inst.id, kind: inst.kind, name: inst.display_name, provider: providerOf(inst.config) }
    if (inst.last_probe_at) observations.push({ ...base, source: 'probe', at: inst.last_probe_at, ok: inst.status === 'connected', failure: inst.last_probe_failure ?? null })
    for (const s of snaps.filter((x) => x.connector_instance_id === inst.id)) {
      observations.push({ ...base, source: 'snapshot', at: s.observed_at, ok: s.ok, failure: s.ok ? null : s.error_kind ?? null })
    }
  }
  for (const s of snaps.filter((x) => x.connector_instance_id == null && LEGACY_CREDENTIAL_KINDS[x.kind])) {
    observations.push({ credentialId: `legacy:${s.kind}`, kind: s.kind, name: LEGACY_CREDENTIAL_KINDS[s.kind], provider: null, source: 'snapshot', at: s.observed_at, ok: s.ok, failure: s.ok ? null : s.error_kind ?? null })
  }

  const catalog: Record<string, ScopeCatalog[string]> = {}
  for (const k of STORE_CONNECTOR_KINDS) catalog[k] = getConnector(k).requiredScopes
  const storeStates: StoreCredentialState[] = [...instances.values()]
    .filter((i): i is InstanceRow & { kind: StoreCredentialState['kind'] } => (STORE_CONNECTOR_KINDS as readonly string[]).includes(i.kind))
    .map((i) => {
      const denied = snaps.find((s) => s.connector_instance_id === i.id && !s.ok && s.error_kind === 'permission_missing')
      return {
        id: i.id, kind: i.kind, name: i.display_name, status: i.status,
        enabledCapabilities: i.enabled_capabilities ?? ['snapshot', 'drift'],
        missingScopes: i.missing_scopes, lastProbeAt: i.last_probe_at, snapshotDeniedAt: denied?.observed_at ?? null,
      }
    })

  const storedKeys: StoredKey[] = []
  let untracked = 0
  for (const k of apiKeys) {
    if (!k.is_active) continue
    const scopes = k.scopes ?? []
    if (scopes.length > 0 && scopes.every((s) => SDK_ONLY_SCOPES.has(s))) {
      storedKeys.push({ kind: 'mushi_sdk', label: k.label ?? 'default', provider: null, createdAt: k.created_at, lastUsedAt: k.last_seen_at, trackedSince: SDK_KEY_USE_TRACKED_SINCE })
    } else {
      untracked++
    }
  }
  for (const k of byok) {
    storedKeys.push({ kind: 'byok', label: k.label || k.key_hint || k.provider_slug, provider: k.provider_slug, createdAt: k.created_at, lastUsedAt: k.last_used_at, trackedSince: BYOK_USE_TRACKED_SINCE })
  }

  const spendRows: ProviderSpend[] = []
  const uses: ProviderUse[] = []
  for (const inst of [...instances.values()].filter((i) => i.kind === 'llm_usage' && i.status !== 'not_connected')) {
    const provider = providerOf(inst.config)
    if (!provider) continue
    const snap = llmSnaps.find((s) => s.connector_instance_id === inst.id && s.ok)
    const usd = snap ? llmSpend(snap, projectId).usd : null
    uses.push({ provider, via: 'connector', spendUsd30d: usd })
    if (usd != null) spendRows.push({ vendor: PROVIDER_VENDOR[provider], usd })
  }
  for (const k of byok) {
    if (k.provider_slug === 'openai' || k.provider_slug === 'anthropic') uses.push({ provider: k.provider_slug, via: 'byok', spendUsd30d: null })
  }

  // ── evaluate ──
  const evaluated: Record<OperatorRule, () => DetectorResult> = {
    dead_app_live_spend: () => evaluateDeadApp({
      lastSdkHeartbeat,
      lastReport: (reportRes.data as { created_at?: string } | null)?.created_at ?? null,
      lastPageView: (eventRes.data as { ts?: string } | null)?.ts ?? null,
      providerSpendUsd30d: providerSpend,
      providerSpendVendor,
      liveFunctions,
      liveProviderKeys: byok.length,
    }, now),
    provider_key_invalid: () => evaluateProviderKeys(observations, now),
    store_credential_scope_missing: () => evaluateStoreScopes(storeStates, catalog, now),
    key_unused_90d: () => evaluateUnusedKeys(storedKeys, untracked, now),
    paid_feature_no_kill_switch: () => evaluateKillSwitches({ manifestPresent: manifest != null && typeof manifest === 'object', paidFeatures: paidFeaturesFromManifest(manifest), spend: spendRows }),
    provider_limit_unset: () => evaluateProviderLimits(uses, providerLimitsFromManifest(manifest)),
  }
  return OPERATOR_RULES.map((ruleId) => {
    const failed = NEEDS[ruleId].map((k) => errors[k]).find(Boolean)
    return failed ? { ruleId, state: 'error' as const, reason: failed, findings: [] } : evaluated[ruleId]()
  })
}
