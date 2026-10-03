/**
 * `_shared/radar/operator-detectors.ts` — the Plan 020 Phase 2 operator
 * detectors, each pure. Every rule: a hole is a finding with a plain-English
 * message and a fix; missing inputs are `unknown`, never `ok`.
 */
import { describe, expect, it } from 'vitest'
import {
  byokObservation,
  BYOK_USE_TRACKED_SINCE,
  clientBundleFinding,
  evaluateDeadApp,
  evaluateKillSwitches,
  evaluateProviderKeys,
  evaluateProviderLimits,
  evaluateStoreScopes,
  evaluateUnusedKeys,
  integrationObservation,
  isAppHeartbeat,
  isUsableByokKey,
  paidFeaturesFromManifest,
  providerLimitsFromManifest,
  SDK_KEY_USE_TRACKED_SINCE,
  type ByokCredentialRow,
  type CredentialObservation,
  type StoreCredentialState,
} from '../../supabase/functions/_shared/radar/operator-detectors.ts'
import { historyHttpStatus } from '../../supabase/functions/_shared/integration-probes.ts'

const NOW = new Date('2026-10-03T12:00:00Z')
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe('dead_app_live_spend', () => {
  const quiet = { lastSdkHeartbeat: ago(45), lastReport: ago(60), lastPageView: null }
  it('is unknown when Mushi has never seen the app in use', () => {
    const r = evaluateDeadApp({ lastSdkHeartbeat: null, lastReport: null, lastPageView: null, providerSpendUsd30d: 12, providerSpendVendor: 'OpenAI', liveFunctions: 3, liveProviderKeys: 1 }, NOW)
    expect(r.state).toBe('unknown')
  })
  it('is ok while the app was used in the last 30 days, whatever it spends', () => {
    const r = evaluateDeadApp({ lastSdkHeartbeat: ago(2), lastReport: null, lastPageView: null, providerSpendUsd30d: 99, providerSpendVendor: 'OpenAI', liveFunctions: 9, liveProviderKeys: 2 }, NOW)
    expect(r).toMatchObject({ state: 'ok', findings: [] })
  })
  it('finds an idle app that still spends, names what is live and gives the retire checklist', () => {
    const r = evaluateDeadApp({ ...quiet, providerSpendUsd30d: 14.5, providerSpendVendor: 'OpenAI', liveFunctions: 2, liveProviderKeys: 1 }, NOW)
    expect(r.state).toBe('finding')
    const f = r.findings[0]
    expect(f).toMatchObject({ ruleId: 'dead_app_live_spend', severity: 'warn' })
    expect(f.message).toContain('45 days')
    expect(f.message).toContain('$14.50 of OpenAI spend')
    expect(f.message).toContain('2 edge functions still deployed')
    expect(f.fix).toMatch(/Pause project/)
  })
  it('is unknown, not ok, when the app is idle but no spend source is connected', () => {
    expect(evaluateDeadApp({ ...quiet, providerSpendUsd30d: null, providerSpendVendor: null, liveFunctions: null, liveProviderKeys: 0 }, NOW).state).toBe('unknown')
  })
  it('is ok when the app is idle and every spend source reads zero', () => {
    expect(evaluateDeadApp({ ...quiet, providerSpendUsd30d: 0, providerSpendVendor: 'OpenAI', liveFunctions: 0, liveProviderKeys: 0 }, NOW).state).toBe('ok')
  })
})

describe('isAppHeartbeat', () => {
  it('counts a browser (Origin) or a native client, never CI or a server script', () => {
    expect(isAppHeartbeat('https://glot.it', 'Mozilla/5.0')).toBe(true)
    expect(isAppHeartbeat('capacitor://localhost', null)).toBe(true)
    expect(isAppHeartbeat(null, 'okhttp/4.12.0')).toBe(true)
    expect(isAppHeartbeat(null, 'glot/412 CFNetwork/1494 Darwin/23.0.0')).toBe(true)
    expect(isAppHeartbeat(null, 'node')).toBe(false)
    expect(isAppHeartbeat('', null)).toBe(false)
  })
})

describe('provider_key_invalid', () => {
  const obs = (over: Partial<CredentialObservation>): CredentialObservation => ({
    credentialId: 'c1', kind: 'llm_usage', name: 'OpenAI costs', provider: 'openai', source: 'snapshot', at: ago(1), ok: true, failure: null, ...over,
  })
  it('is unknown with no credential, and with only stale checks', () => {
    expect(evaluateProviderKeys([], NOW).state).toBe('unknown')
    expect(evaluateProviderKeys([obs({ at: ago(30), ok: false, failure: 'credential_rejected' })], NOW).state).toBe('unknown')
  })
  it('a 401 is an error finding with the provider page to rotate it', () => {
    const r = evaluateProviderKeys([obs({ ok: false, failure: 'credential_rejected' })], NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0]).toMatchObject({ severity: 'error', target: 'OpenAI costs' })
    expect(r.findings[0].message).toMatch(/OpenAI rejects the key/)
    expect(r.findings[0].fix).toContain('platform.openai.com')
  })
  it('the newest observation wins: a later successful probe clears an older failed snapshot', () => {
    const r = evaluateProviderKeys([obs({ at: ago(3), ok: false, failure: 'credential_rejected' }), obs({ source: 'probe', at: ago(1), ok: true })], NOW)
    expect(r.state).toBe('ok')
  })
  it('a store key denied a permission is left to store_credential_scope_missing', () => {
    const r = evaluateProviderKeys([obs({ kind: 'play_console', provider: null, name: 'Play', ok: false, failure: 'permission_missing' })], NOW)
    expect(r.findings).toHaveLength(0)
    expect(r.state).toBe('unknown')
  })
  it('a vendor outage is not a bad key: unknown when nothing else could be checked', () => {
    expect(evaluateProviderKeys([obs({ ok: false, failure: 'vendor_error' })], NOW).state).toBe('unknown')
  })
  it('legacy credentials (GitHub token) are checked too', () => {
    const r = evaluateProviderKeys([obs({ credentialId: 'legacy:github', kind: 'github', provider: null, name: 'GitHub', ok: false, failure: 'credential_rejected' })], NOW)
    expect(r.findings[0].fix).toContain('github.com/settings/tokens')
  })
})

describe('provider_key_invalid inputs: BYOK key tests and integration health checks', () => {
  const key = (over: Partial<ByokCredentialRow>): ByokCredentialRow => ({
    id: 'b1', provider_slug: 'anthropic', label: 'main', key_hint: 'sk-ant-...9', status: 'active', test_status: 'ok', last_tested_at: ago(1), ...over,
  })

  it('a BYOK key the provider rejected (error_auth / auth_failed) is an error finding pointing at Settings → API Keys', () => {
    const o = byokObservation(key({ status: 'auth_failed', test_status: 'error_auth' }))
    expect(o).toMatchObject({ credentialId: 'byok:b1', kind: 'byok', provider: 'anthropic', ok: false, failure: 'credential_rejected', source: 'key_test' })
    const r = evaluateProviderKeys([o!], NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0]).toMatchObject({ severity: 'error', target: 'main' })
    expect(r.findings[0].message).toMatch(/Anthropic rejects the key for "main"/)
    expect(r.findings[0].message).not.toMatch(/Everything Mushi reads/)
    expect(r.findings[0].fix).toMatch(/Settings → API Keys/)
    expect(r.findings[0].fix).toContain('console.anthropic.com')
  })

  it('a BYOK key that passed its test is ok; a never-tested or switched-off key says nothing; quota and network are not a bad key', () => {
    expect(evaluateProviderKeys([byokObservation(key({}))!], NOW).state).toBe('ok')
    expect(byokObservation(key({ status: 'pending_validation', test_status: null, last_tested_at: null }))).toBeNull()
    expect(byokObservation(key({ status: 'disabled', test_status: 'error_auth' }))).toBeNull()
    expect(byokObservation(key({ status: 'quota_exhausted', test_status: 'error_quota' }))).toMatchObject({ ok: false, failure: 'rate_limited' })
    expect(evaluateProviderKeys([byokObservation(key({ test_status: 'error_network' }))!], NOW).state).toBe('unknown')
  })

  it('an auth_failed key stays rejected after its last test goes stale, even next to a fresh working key', () => {
    const revoked = byokObservation(key({ id: 'b2', provider_slug: 'supabase', label: 'drift PAT', status: 'auth_failed', test_status: 'error_auth', last_tested_at: ago(30) }))!
    const working = byokObservation(key({}))!
    const r = evaluateProviderKeys([revoked, working], NOW)
    expect(r.state).toBe('finding')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ severity: 'error', target: 'drift PAT', evidence: { alsoReportedBy: 'byok_key_invalid' } })
    expect(r.findings[0].message).toMatch(/Supabase rejects the key for "drift PAT"/)
    expect(r.findings[0].message).toMatch(/last tested 2026-09-03 and stays marked rejected until a test passes/)
    expect(r.findings[0].message).toMatch(/schema checks/)
    expect(r.findings[0].message).toMatch(/setup check \(byok_key_invalid\) reports the same key/)
    expect(r.findings[0].fix).toContain('supabase.com/dashboard/account/tokens')
  })

  it('an auth_failed key with no recorded test date is still a rejected key', () => {
    const o = byokObservation(key({ status: 'auth_failed', test_status: null, last_tested_at: null }))
    expect(o).toMatchObject({ ok: false, failure: 'credential_rejected', standing: true, at: null })
    const r = evaluateProviderKeys([o!], NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toMatch(/no recorded test date/)
  })

  it('a key whose last test failed with 401 but that is not marked auth_failed is not tied to the setup check', () => {
    const r = evaluateProviderKeys([byokObservation(key({ status: 'active', test_status: 'error_auth' }))!], NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).not.toMatch(/byok_key_invalid/)
    expect(r.findings[0].evidence).not.toHaveProperty('alsoReportedBy')
    // A stale test that is not a standing rejection is not judged.
    expect(evaluateProviderKeys([byokObservation(key({ status: 'active', test_status: 'error_auth', last_tested_at: ago(30) }))!], NOW).state).toBe('unknown')
  })

  it('says how many keys were not re-checked instead of counting them as ok', () => {
    const r = evaluateProviderKeys([byokObservation(key({}))!, byokObservation(key({ id: 'b3', last_tested_at: ago(20) }))!], NOW)
    expect(r.state).toBe('ok')
    expect(r.reason).toMatch(/^1 key checked/)
    expect(r.reason).toMatch(/1 more key was not re-checked in the last 7 days/)
  })

  it('only usable BYOK keys count as live spend', () => {
    expect(['active', 'quota_exhausted', 'auth_failed', 'pending_validation', 'disabled'].filter((status) => isUsableByokKey({ status }))).toEqual(['active', 'quota_exhausted'])
  })

  it('an integration health check that got a 401 is a rejected key; 403 is a missing permission; an outage is not', () => {
    const linear = integrationObservation({ kind: 'linear', status: 'down', http_status: 401, checked_at: ago(0) })
    expect(linear).toMatchObject({ credentialId: 'integration:linear', name: 'Linear', ok: false, failure: 'credential_rejected', source: 'health_check' })
    const r = evaluateProviderKeys([linear!], NOW)
    expect(r.findings[0].message).toMatch(/Linear rejects the key for "Linear"/)
    expect(r.findings[0].fix).toMatch(/Settings → Integrations → Linear/)
    expect(integrationObservation({ kind: 'cursor_cloud', status: 'down', http_status: 403, checked_at: ago(0) })).toMatchObject({ failure: 'permission_missing' })
    expect(integrationObservation({ kind: 'claude_code_agent', status: 'degraded', http_status: 503, checked_at: ago(0) })).toMatchObject({ failure: 'vendor_error' })
    // A row from before http_status existed, or a probe that threw, says nothing about the key.
    expect(integrationObservation({ kind: 'sentry', status: 'down', http_status: null, checked_at: ago(0) })).toMatchObject({ failure: 'other' })
    expect(integrationObservation({ kind: 'pagerduty', status: 'down', http_status: 400, checked_at: ago(0) })).toMatchObject({ failure: 'credential_rejected' })
  })

  it('the health probes store the vendor status, or null when no response came back', () => {
    expect(historyHttpStatus({ httpStatus: 401 })).toBe(401)
    expect(historyHttpStatus({ httpStatus: 0 })).toBeNull()
  })

  it('skips checks that are not about this project’s own key: not configured, BYOK-backed, platform or webhook rows', () => {
    expect(integrationObservation({ kind: 'linear', status: 'unknown', http_status: null, checked_at: ago(0) })).toBeNull()
    for (const kind of ['anthropic', 'openai', 'firecrawl', 'reward_webhook']) {
      expect(integrationObservation({ kind, status: 'down', http_status: 401, checked_at: ago(0) })).toBeNull()
    }
  })

  it('a GitHub health check and the legacy GitHub snapshot are one credential: the newest wins', () => {
    const health = integrationObservation({ kind: 'github', status: 'ok', http_status: 200, checked_at: ago(0) })!
    expect(health.credentialId).toBe('legacy:github')
    const snapshot: CredentialObservation = { credentialId: 'legacy:github', kind: 'github', name: 'GitHub', provider: null, source: 'snapshot', at: ago(1), ok: false, failure: 'credential_rejected' }
    expect(evaluateProviderKeys([snapshot, health], NOW).state).toBe('ok')
  })
})

describe('store_credential_scope_missing', () => {
  const catalog = {
    play_console: { snapshot: ['View app information (read-only)'], act: ['Release apps to testing tracks'] },
    app_store_connect: { snapshot: ['a team API key with a read role (Developer or App Manager)'] },
  }
  const state = (over: Partial<StoreCredentialState>): StoreCredentialState => ({
    id: 'i1', kind: 'play_console', name: 'Play glot', status: 'connected', enabledCapabilities: ['snapshot', 'drift'],
    missingScopes: [], lastProbeAt: ago(1), snapshotDeniedAt: null, snapshotOkAt: null, ...over,
  })
  it('is unknown with no store connector', () => {
    expect(evaluateStoreScopes([], catalog, NOW).state).toBe('unknown')
    expect(evaluateStoreScopes([state({ status: 'not_connected' })], catalog, NOW).state).toBe('unknown')
  })
  it('ignores a release permission the read-only connector does not use', () => {
    const r = evaluateStoreScopes([state({ missingScopes: ['Release apps to testing tracks'] })], catalog, NOW)
    expect(r.state).toBe('ok')
  })
  it('flags the release permission once act is switched on (error), naming where to grant it', () => {
    const r = evaluateStoreScopes([state({ enabledCapabilities: ['snapshot', 'drift', 'act'], missingScopes: ['Release apps to testing tracks'] })], catalog, NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0].severity).toBe('error')
    expect(r.findings[0].message).toContain('Release apps to testing tracks')
    expect(r.findings[0].fix).toMatch(/Users and permissions/)
  })
  it('a daily snapshot that got a 403 flags the read permission', () => {
    const r = evaluateStoreScopes([state({ kind: 'app_store_connect', missingScopes: null, lastProbeAt: null, snapshotDeniedAt: ago(1) })], catalog, NOW)
    expect(r.findings[0].message).toContain('read role')
    expect(r.findings[0].fix).toMatch(/cannot gain a role/)
  })
  it('a probe from before the column existed (missing_scopes null) is undecided, not ok', () => {
    expect(evaluateStoreScopes([state({ missingScopes: null })], catalog, NOW).state).toBe('unknown')
  })
  it('a daily snapshot that succeeded after the probe clears the read permission the probe found missing', () => {
    const probedMissing = { missingScopes: ['View app information (read-only)'], lastProbeAt: ago(3) }
    expect(evaluateStoreScopes([state(probedMissing)], catalog, NOW).state).toBe('finding')
    expect(evaluateStoreScopes([state({ ...probedMissing, snapshotOkAt: ago(1) })], catalog, NOW).state).toBe('ok')
    // An OK snapshot from before the probe proves nothing.
    expect(evaluateStoreScopes([state({ ...probedMissing, snapshotOkAt: ago(5) })], catalog, NOW).state).toBe('finding')
  })
  it('a newer OK snapshot does not clear a release permission (reading never uses it)', () => {
    const r = evaluateStoreScopes([state({ enabledCapabilities: ['snapshot', 'drift', 'act'], missingScopes: ['Release apps to testing tracks'], lastProbeAt: ago(3), snapshotOkAt: ago(1) })], catalog, NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toContain('Release apps to testing tracks')
  })
})

describe('key_unused_90d', () => {
  it('is unknown with no key it can judge, and says which keys it skipped', () => {
    const r = evaluateUnusedKeys([], 2, NOW)
    expect(r.state).toBe('unknown')
    expect(r.reason).toMatch(/2 console or MCP keys were not judged/)
  })
  it('flags an SDK key last used over 90 days ago', () => {
    const r = evaluateUnusedKeys([{ kind: 'mushi_sdk', label: 'old web', provider: null, createdAt: ago(400), lastUsedAt: ago(120), trackedSince: SDK_KEY_USE_TRACKED_SINCE }], 0, NOW)
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toMatch(/"old web" has not been used for 120 days/)
    expect(r.findings[0].fix).toMatch(/Revoke/)
  })
  it('never-used BYOK keys count only from when Mushi started recording use', () => {
    // Created long ago, never used: but last_used_at only exists since 2026-08-06, so not yet 90 days.
    const k = { kind: 'byok' as const, label: 'OpenAI main', provider: 'openai', createdAt: ago(300), lastUsedAt: null, trackedSince: BYOK_USE_TRACKED_SINCE }
    expect(evaluateUnusedKeys([k], 0, NOW).state).toBe('ok')
    const later = new Date(Date.parse(BYOK_USE_TRACKED_SINCE) + 95 * 86_400_000)
    expect(evaluateUnusedKeys([k], 0, later).state).toBe('finding')
  })
})

describe('manifest spend block', () => {
  it('reads paid features and provider limits defensively', () => {
    const m = { spend: { paidFeatures: [{ name: 'AI tutor', provider: 'openai', killSwitch: 'env:AI_TUTOR' }, { name: '' }, 'junk', { name: 'TTS' }], providerLimits: { OpenAI: 50, anthropic: -1, x: 'big' } } }
    expect(paidFeaturesFromManifest(m)).toEqual({ declared: true, features: [{ name: 'AI tutor', provider: 'openai', killSwitch: 'env:AI_TUTOR' }, { name: 'TTS', provider: null, killSwitch: null }] })
    expect(providerLimitsFromManifest(m)).toEqual({ openai: 50 })
    expect(paidFeaturesFromManifest(null)).toEqual({ declared: false, features: [] })
    expect(providerLimitsFromManifest({ spend: [] })).toEqual({})
  })
})

describe('paid_feature_no_kill_switch', () => {
  const none = { declared: false, features: [] }
  it('is unknown without a manifest, and without a declaration or spend', () => {
    expect(evaluateKillSwitches({ manifestPresent: false, paidFeatures: none, spend: [] }).state).toBe('unknown')
    const r = evaluateKillSwitches({ manifestPresent: true, paidFeatures: none, spend: [] })
    expect(r.state).toBe('unknown')
    expect(r.reason).toContain('paidFeatures')
  })
  it('flags each declared paid feature without a kill switch', () => {
    const r = evaluateKillSwitches({ manifestPresent: true, paidFeatures: { declared: true, features: [{ name: 'TTS', provider: 'elevenlabs', killSwitch: null }, { name: 'AI tutor', provider: 'openai', killSwitch: 'flag:ai_tutor' }] }, spend: [] })
    expect(r.state).toBe('finding')
    expect(r.findings.map((f) => f.target)).toEqual(['TTS'])
  })
  it('flags provider spend with no paid feature declared', () => {
    const r = evaluateKillSwitches({ manifestPresent: true, paidFeatures: none, spend: [{ vendor: 'OpenAI', usd: 30 }] })
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toContain('$30.00 on OpenAI')
  })
  it('is ok when every declared feature has a switch', () => {
    expect(evaluateKillSwitches({ manifestPresent: true, paidFeatures: { declared: true, features: [{ name: 'AI tutor', provider: 'openai', killSwitch: 'env:AI' }] }, spend: [{ vendor: 'OpenAI', usd: 3 }] }).state).toBe('ok')
  })
})

describe('provider_limit_unset', () => {
  it('is unknown with no OpenAI or Anthropic key or connector', () => {
    expect(evaluateProviderLimits([{ provider: 'firecrawl', via: 'byok', spendUsd30d: null }], {}).state).toBe('unknown')
  })
  it('flags a provider with no declared limit, says Mushi cannot cap it, and links the provider page', () => {
    const r = evaluateProviderLimits([{ provider: 'openai', via: 'connector', spendUsd30d: 20 }], {})
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toMatch(/No monthly spending limit is declared for OpenAI/)
    expect(r.findings[0].message).toMatch(/Mushi cannot cap/)
    expect(r.findings[0].fix).toContain('platform.openai.com/settings/organization/limits')
  })
  it('is ok under the declared limit, and warns at 80% of it', () => {
    expect(evaluateProviderLimits([{ provider: 'anthropic', via: 'byok', spendUsd30d: null }], { anthropic: 100 }).state).toBe('ok')
    const close = evaluateProviderLimits([{ provider: 'openai', via: 'connector', spendUsd30d: 45 }], { openai: 50 })
    expect(close.findings[0]).toMatchObject({ severity: 'warn' })
    expect(close.findings[0].message).toContain('90%')
    expect(evaluateProviderLimits([{ provider: 'openai', via: 'connector', spendUsd30d: 60 }], { openai: 50 }).findings[0].severity).toBe('error')
  })
})

describe('key_in_client_bundle', () => {
  it('writes the message server-side from where and which kind, never the key', () => {
    const f = clientBundleFinding('dist/assets/index-abc.js', 3, 'OpenAI-style key')
    expect(f).toMatchObject({ ruleId: 'key_in_client_bundle', severity: 'error', filePath: 'dist/assets/index-abc.js', line: 3 })
    expect(f.message).toContain('contains an OpenAI-style key at dist/assets/index-abc.js:3')
    expect(f.fix).toMatch(/Revoke that key now/)
  })
})
