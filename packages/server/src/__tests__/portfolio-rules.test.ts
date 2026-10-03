/**
 * `_shared/portfolio-rules.ts` — the cross-project rules (Plan 019 Phase P2,
 * Plan 020 §6–§8) on the owner's 7-project shape: shared resources from the
 * manifests, shared-auth divergence and missing redirects, billing
 * consistency, deep links into sibling apps, shared channels, CI cost
 * concentration, the recipe checklist per kind, and shared provider keys.
 * Malformed input is `unknown` or skipped, never a finding.
 */
import { describe, expect, it } from 'vitest'
import {
  authConfigDivergent,
  billingConsistency,
  crossPromoChecks,
  crossPromoLinksFrom,
  ciCostConcentration,
  completenessChecklist,
  deriveResourceUses,
  evaluateDeepLinks,
  keySharedAcrossApps,
  parseAasaAppIds,
  parseAssetLinks,
  redirectAllowed,
  sharedChannels,
  type PortfolioProject,
} from '../../supabase/functions/_shared/portfolio-rules.ts'

const SLACK = 'C0B82A322RW'
const AUTH_REF = 'abcdefghijklmnop'

const PROJECTS: PortfolioProject[] = [
  {
    id: 'glot', name: 'glot.it', kind: 'app',
    manifest: {
      app: { ids: { bundleId: 'com.glotit.app', androidPackage: 'com.glotit.app' } },
      links: {
        domains: ['glot.it', 'https://GLOT.it/'],
        deepLinks: { schemes: ['glotit'], universalLinkDomains: ['glot.it'], appLinks: [{ toProject: 'yen-yen', path: '/open' }] },
        auth: { provider: 'supabase', ref: AUTH_REF },
        billing: { stripeAccount: 'acct_1', sharedCreditsWith: ['yen-yen'] },
        notifications: { slackChannel: SLACK },
      },
      data: { projectRef: AUTH_REF },
      integrations: { sentry: { project: 'glot-web' } },
    },
  },
  {
    id: 'yen', name: 'yen-yen', kind: 'app',
    manifest: {
      app: { ids: { bundleId: 'com.yenyen.app' } },
      links: { auth: { provider: 'supabase', ref: AUTH_REF }, billing: { stripeAccount: 'acct_2' }, notifications: { slackChannel: SLACK } },
    },
  },
  { id: 'twm', name: 'the-wanting-mind', kind: 'app', manifest: { links: { notifications: { slackChannel: SLACK } } } },
  { id: 'hhtp', name: 'Help Her Take Photo', kind: 'app', manifest: null },
  { id: 'sbc', name: 'solo-boss-cloud', kind: 'site', manifest: 'not an object' },
  { id: 'tsu', name: 'tsumagoi', kind: 'site', manifest: { links: { domains: [42, null, 'tsumagoi.example'] } } },
  { id: 'demo', name: 'mushi-demo', kind: null, manifest: { links: 'nope' } },
]

describe('deriveResourceUses', () => {
  it('turns each manifest into shared-resource uses and skips malformed manifests', () => {
    const uses = deriveResourceUses(PROJECTS)
    const of = (pid: string) => uses.filter((u) => u.projectId === pid).map((u) => `${u.kind}:${u.externalId}:${u.role}`).sort()
    expect(of('glot')).toEqual([
      'auth_provider:supabase:abcdefghijklmnop:auth',
      'bundle_id:com.glotit.app:android_package',
      'bundle_id:com.glotit.app:ios_bundle',
      'deep_link_domain:glot.it:deep_link_host',
      'deep_link_domain:glotit://:deep_link_scheme',
      'domain:glot.it:domain',
      'sentry_project:glot-web:monitoring',
      'slack_channel:C0B82A322RW:notifications',
      'stripe_account:acct_1:billing',
      'supabase_project:abcdefghijklmnop:data',
    ])
    expect(of('hhtp')).toEqual([])
    expect(of('sbc')).toEqual([])
    expect(of('demo')).toEqual([])
    expect(of('tsu')).toEqual(['domain:tsumagoi.example:domain'])
    expect(uses.every((u) => u.source === 'manifest')).toBe(true)
  })

  it('finds the Slack channel three apps share', () => {
    const shared = deriveResourceUses(PROJECTS).filter((u) => u.kind === 'slack_channel').map((u) => u.projectId)
    expect(shared.sort()).toEqual(['glot', 'twm', 'yen'])
  })
})

describe('authConfigDivergent', () => {
  const base = { provider: 'supabase', ref: AUTH_REF }

  it('flags two apps on one auth project that disagree, and a sibling domain the redirect list misses', () => {
    const out = authConfigDivergent([
      { ...base, projectId: 'glot', settings: { siteUrl: 'https://glot.it', redirectUrls: ['https://glot.it/**', 'glotit://**'], providers: ['email', 'google'], emailConfirm: true, mfa: false }, declaredOrigins: ['glot.it', 'glotit://'] },
      { ...base, projectId: 'yen', settings: { redirectUrls: [], providers: ['email'], emailConfirm: true, mfa: false }, declaredOrigins: ['yenyen.app'] },
    ], PROJECTS)
    const div = out.find((f) => f.ruleId === 'auth_config_divergent')!
    expect(div).toMatchObject({ severity: 'warn', projectIds: ['glot', 'yen'], resourceKey: `auth_provider:supabase:${AUTH_REF}` })
    expect(div.message).toContain('sign-in methods')
    const missing = out.filter((f) => f.ruleId === 'auth_redirect_missing')
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ severity: 'error', projectIds: ['yen'] })
    expect(missing[0].message).toContain('https://yenyen.app')
  })

  it('says nothing when the shared settings agree and every origin is allowed', () => {
    const settings = { siteUrl: 'https://glot.it', redirectUrls: ['https://*.example/**', 'https://glot.it/**'], providers: ['email'], emailConfirm: true }
    expect(authConfigDivergent([
      { ...base, projectId: 'glot', settings, declaredOrigins: ['glot.it'] },
      { ...base, projectId: 'tsu', settings, declaredOrigins: ['tsumagoi.example'] },
    ])).toEqual([])
  })

  it('compares only apps whose settings were read, and labels a declared-only miss as a warning', () => {
    const out = authConfigDivergent([
      { ...base, projectId: 'glot', settings: { redirectUrls: ['https://glot.it/**'], providers: ['email', 'google'] }, declaredOrigins: ['glot.it'], source: 'k/glot/supabase/config.toml' },
      { ...base, projectId: 'yen', settings: {}, settingsKnown: false, declaredOrigins: ['yenyen.app'] },
    ], PROJECTS)
    expect(out.some((f) => f.ruleId === 'auth_config_divergent')).toBe(false)
    const missing = out.filter((f) => f.ruleId === 'auth_redirect_missing')
    expect(missing).toEqual([expect.objectContaining({ severity: 'warn', projectIds: ['yen'] })])
    expect(missing[0].message).toContain('declared in k/glot/supabase/config.toml')
  })

  it('says nothing when no app in the group declares its settings', () => {
    expect(authConfigDivergent([
      { ...base, projectId: 'glot', settings: {}, settingsKnown: false, declaredOrigins: ['glot.it'] },
      { ...base, projectId: 'yen', settings: {}, settingsKnown: false, declaredOrigins: ['yenyen.app'] },
    ])).toEqual([])
  })

  it('ignores a provider used by only one app', () => {
    expect(authConfigDivergent([{ ...base, projectId: 'glot', settings: { providers: ['email'] }, declaredOrigins: ['nowhere.example'] }])).toEqual([])
  })

  it('matches wildcard and exact redirect entries', () => {
    expect(redirectAllowed(['https://glot.it/**'], 'https://glot.it/auth/callback')).toBe(true)
    expect(redirectAllowed(['https://glot.it'], 'https://glot.it/')).toBe(true)
    expect(redirectAllowed(['https://glot.it'], 'https://glot.it.evil.example')).toBe(false)
  })
})

describe('billingConsistency', () => {
  it('flags apps that share credits on different Stripe accounts, once per pair', () => {
    const out = billingConsistency(PROJECTS)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ruleId: 'billing_account_mismatch', severity: 'error', projectIds: ['glot', 'yen'] })
  })

  it('passes when both apps use the same account, and flags a price the code uses but the account lacks', () => {
    const same = PROJECTS.map((p) => (p.id === 'yen' ? { ...p, manifest: { links: { billing: { stripeAccount: 'acct_1' } } } } : p))
    expect(billingConsistency(same).filter((f) => f.ruleId === 'billing_account_mismatch')).toEqual([])
    const out = billingConsistency(same, { glot: { account: 'acct_1', priceIds: ['price_A'], priceIdsInCode: ['price_A', 'price_GONE'] } })
    expect(out).toEqual([expect.objectContaining({ ruleId: 'stripe_price_missing', projectIds: ['glot'], resourceKey: 'stripe_account:acct_1' })])
    expect(out[0].message).toContain('price_GONE')
  })

  it('does not call it a mismatch when one side names no account', () => {
    const undeclared = PROJECTS.map((p) => (p.id === 'yen' ? { ...p, manifest: { links: { billing: {} } } } : p))
    const out = billingConsistency(undeclared)
    expect(out).toEqual([expect.objectContaining({ ruleId: 'billing_account_undeclared', severity: 'info', projectIds: ['glot', 'yen'] })])
    expect(out[0].message).toContain('yen-yen names no Stripe account')
  })
})

describe('evaluateDeepLinks', () => {
  const AASA = JSON.stringify({ applinks: { apps: [], details: [{ appIDs: ['ABCDE12345.com.glotit.app'], components: [{ '/': '/open/*' }] }, { appID: 'ABCDE12345.com.other.app', paths: ['*'] }] } })
  const ASSET = JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.glotit.app', sha256_cert_fingerprints: ['14:6D:E9:83:C5:73'] } }])
  const link = [{ fromProjectId: 'yen', toProjectId: 'glot', domain: 'glot.it' }]

  it('parses both files', () => {
    expect(parseAasaAppIds(AASA)).toEqual(['ABCDE12345.com.glotit.app', 'ABCDE12345.com.other.app'])
    expect(parseAssetLinks(ASSET)).toEqual([{ packageName: 'com.glotit.app', fingerprints: ['14:6D:E9:83:C5:73'] }])
    expect(parseAasaAppIds('<html>')).toBeNull()
    expect(parseAssetLinks('{"not":"an array"}')).toBeNull()
  })

  it('passes when the domain lists the target app on both platforms', () => {
    const r = evaluateDeepLinks(link, { 'glot.it': { aasa: AASA, assetlinks: ASSET } }, { glot: { bundleId: 'com.glotit.app', appleTeamId: 'ABCDE12345', androidPackage: 'com.glotit.app', sha256CertFingerprints: ['14:6d:e9:83:c5:73'] } })
    expect(r).toEqual({ findings: [], unknown: [] })
  })

  it('flags a missing entry, a missing file and a wrong certificate', () => {
    const r = evaluateDeepLinks(link, { 'glot.it': { aasa: AASA, assetlinks: null } }, { glot: { bundleId: 'com.yenyen.app', appleTeamId: 'ABCDE12345', androidPackage: 'com.glotit.app' } }, PROJECTS)
    expect(r.findings.map((f) => f.evidence.platform)).toEqual(['ios', 'android'])
    expect(r.findings.every((f) => f.ruleId === 'deep_link_broken' && f.severity === 'error')).toBe(true)
    expect(r.findings[0].message).toContain('ABCDE12345.com.yenyen.app')
    const cert = evaluateDeepLinks(link, { 'glot.it': { aasa: null, assetlinks: ASSET } }, { glot: { androidPackage: 'com.glotit.app', sha256CertFingerprints: ['AA:BB'] } })
    expect(cert.findings).toHaveLength(1)
    expect(cert.findings[0].message).toContain('signing certificate')
  })

  it('a failed fetch or malformed file is unknown, never a finding', () => {
    const failed = evaluateDeepLinks(link, { 'glot.it': { aasa: null, assetlinks: null, fetchError: 'timeout' } }, { glot: { bundleId: 'com.glotit.app' } })
    expect(failed.findings).toEqual([])
    expect(failed.unknown[0].reason).toContain('timeout')
    const malformed = evaluateDeepLinks(link, { 'glot.it': { aasa: '{oops', assetlinks: '[[' } }, { glot: { bundleId: 'com.glotit.app', androidPackage: 'com.glotit.app' } })
    expect(malformed.findings).toEqual([])
    expect(malformed.unknown).toHaveLength(2)
    expect(evaluateDeepLinks(link, {}, { glot: { bundleId: 'x' } }).unknown).toHaveLength(1)
    expect(evaluateDeepLinks(link, { 'glot.it': { aasa: AASA, assetlinks: ASSET } }, {}).unknown[0].reason).toContain('no bundle id')
  })
})

describe('sharedChannels', () => {
  it('suggests per-app channels only above three apps on one channel, and flags a shared push key', () => {
    const three = sharedChannels(['glot', 'yen', 'twm'].map((id) => ({ projectId: id, slackChannelId: SLACK, pushKeyId: null })))
    expect(three).toEqual([])
    const four = sharedChannels([
      ...['glot', 'yen', 'twm', 'hhtp'].map((id) => ({ projectId: id, slackChannelId: SLACK, pushKeyId: null })),
      { projectId: 'tsu', slackChannelId: null, pushKeyId: 'apns-key-1' },
      { projectId: 'sbc', slackChannelId: null, pushKeyId: 'apns-key-1' },
    ], PROJECTS)
    expect(four.map((f) => [f.ruleId, f.severity, f.projectIds.length])).toEqual([['shared_channel_untagged', 'info', 4], ['push_key_shared', 'info', 2]])
  })
})

describe('ciCostConcentration', () => {
  it('flags two repos using most of the estimated minutes, and says so is estimated', () => {
    const out = ciCostConcentration([
      { projectId: 'glot', repo: 'kensaurus/glot.it', minutes30d: 900 },
      { projectId: 'yen', repo: 'kensaurus/yen-yen', minutes30d: 600 },
      { projectId: 'twm', repo: 'kensaurus/twm', minutes30d: 100 },
      { projectId: 'tsu', repo: 'kensaurus/tsumagoi', minutes30d: 100 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ruleId: 'ci_cost_concentration', severity: 'info', projectIds: ['glot', 'yen'] })
    expect(out[0].evidence.estimated).toBe(true)
  })

  it('says nothing when spend is spread out or there are too few repos', () => {
    expect(ciCostConcentration([{ projectId: 'a', repo: 'a', minutes30d: 10 }, { projectId: 'b', repo: 'b', minutes30d: 10 }, { projectId: 'c', repo: 'c', minutes30d: 10 }, { projectId: 'd', repo: 'd', minutes30d: 10 }])).toEqual([])
    expect(ciCostConcentration([{ projectId: 'a', repo: 'a', minutes30d: 100 }, { projectId: 'b', repo: 'b', minutes30d: 1 }])).toEqual([])
  })
})

describe('completenessChecklist', () => {
  it('lists each missing item for the kind, skips unchecked signals and projects with no kind', () => {
    const out = completenessChecklist([
      { id: 'glot', name: 'glot.it', kind: 'app', signals: { hasCrashReporting: true, hasVersionProbe: false, hasDeepLinkFile: false } },
      { id: 'tsu', name: 'tsumagoi', kind: 'site', signals: { hasVersionProbe: undefined, hasSecurityHeaders: false } },
      { id: 'lib', name: 'mushi-lib', kind: 'library', signals: { hasReleaseWorkflow: true } },
      { id: 'demo', name: 'mushi-demo', kind: null, signals: { hasCrashReporting: false } },
    ])
    expect(out.map((f) => `${f.projectIds[0]}:${f.evidence.missing}`)).toEqual(['glot:hasVersionProbe', 'glot:hasDeepLinkFile', 'tsu:hasSecurityHeaders'])
    expect(out.every((f) => f.ruleId === 'recipe_incomplete' && f.severity === 'info')).toBe(true)
  })
})

describe('keySharedAcrossApps', () => {
  it('flags one provider key used by several apps', () => {
    const out = keySharedAcrossApps([
      { provider: 'openai', keyFingerprint: 'sk-…a1b2', projectId: 'glot' },
      { provider: 'openai', keyFingerprint: 'sk-…a1b2', projectId: 'yen' },
      { provider: 'openai', keyFingerprint: 'sk-…ffff', projectId: 'twm' },
      { provider: 'anthropic', keyFingerprint: 'sk-…a1b2', projectId: 'twm' },
    ], PROJECTS)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ruleId: 'key_shared_across_apps', severity: 'info', projectIds: ['glot', 'yen'] })
    expect(out[0].message).toContain('glot.it, yen-yen')
  })
})

describe('crossPromoChecks', () => {
  const projects = [
    { id: 'glot', name: 'glot.it', kind: 'app' as const, manifest: { links: { crossPromo: [
      { url: 'https://apps.apple.com/app/id1?ct=from-glot', toProject: 'yen-yen' },
      { url: 'https://play.google.com/store/apps/details?id=com.gone', toProject: 'hhtp' },
      { url: 'http://example.com/more' },
      { url: 'https://site.example/apps' },
      42,
    ] } } },
    { id: 'yen', name: 'yen-yen', kind: 'app' as const, manifest: null },
  ]

  it('reads the links, flags a 404, an http link and a missing campaign tag, and never calls a throttled store broken', () => {
    const links = crossPromoLinksFrom(projects)
    expect(links).toHaveLength(4)
    expect(links[0]).toMatchObject({ fromProjectId: 'glot', toProjectId: 'yen' })
    const { findings, unknown } = crossPromoChecks(links, {
      'https://apps.apple.com/app/id1?ct=from-glot': { status: 429 },
      'https://play.google.com/store/apps/details?id=com.gone': { status: 404 },
      'https://site.example/apps': { status: null, error: 'timeout' },
    }, projects)
    const by = (id: string) => findings.filter((f) => f.ruleId === id).map((f) => String(f.evidence.url))
    expect(by('cross_promo_link_broken').sort()).toEqual(['http://example.com/more', 'https://play.google.com/store/apps/details?id=com.gone'])
    expect(by('cross_promo_untracked').sort()).toEqual(['https://play.google.com/store/apps/details?id=com.gone', 'https://site.example/apps'])
    expect(unknown.map((u) => u.resourceKey).sort()).toEqual(['cross_promo_link:https://apps.apple.com/app/id1?ct=from-glot', 'cross_promo_link:https://site.example/apps'])
  })

  it('gives App Store advice only for apple.com hosts, not for a host that merely ends in "apple.com"', () => {
    const fixFor = (url: string) => {
      const { findings } = crossPromoChecks([{ fromProjectId: 'glot', toProjectId: null, url }], { [url]: { status: 200 } }, projects)
      return findings.find((f) => f.ruleId === 'cross_promo_untracked')?.suggestedFix ?? ''
    }
    expect(fixFor('https://apps.apple.com/app/id1')).toContain('campaign token')
    expect(fixFor('https://apple.com/app')).toContain('campaign token')
    for (const hostile of ['https://evilapple.com/app', 'https://apple.com.evil.example/app', 'https://notapple.com/x']) {
      expect(fixFor(hostile), hostile).toContain('utm_source')
      expect(fixFor(hostile), hostile).not.toContain('campaign token')
    }
  })
})
