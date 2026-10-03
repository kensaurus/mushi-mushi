/**
 * FILE: packages/server/supabase/functions/_shared/radar/types.ts
 * PURPOSE: Shared shapes for the tech-debt radar (Plan 020 §4): detectors
 *          that catch holes that never throw. Types and the rule catalog
 *          only; no I/O.
 *
 * Every detector returns one DetectorResult per run. A detector whose inputs
 * are missing (nothing declared to check) or whose source could not be read
 * returns `unknown` with a reason — never `ok`. Only a check that actually
 * looked and found nothing is `ok`.
 */

export type RadarSeverity = 'info' | 'warn' | 'error'

/** `finding` = the check looked and found a hole; `unknown` = it could not look. */
export type DetectorState = 'ok' | 'finding' | 'unknown' | 'error'

export interface RadarFinding {
  ruleId: RadarRuleId
  severity: RadarSeverity
  /** One plain-English sentence: what is wrong. */
  message: string
  /** Where: a URL, domain, store id, or repo path. */
  target: string | null
  filePath?: string | null
  line?: number | null
  /** How to fix it: a prompt for the editor, a command, or a console step. */
  fix: string
  evidence?: Record<string, unknown>
}

export interface DetectorResult {
  ruleId: RadarRuleId
  state: DetectorState
  /** Why this state, in one line. Always set. */
  reason: string
  findings: RadarFinding[]
}

export const RADAR_RULE_IDS = [
  // Plan 020 Phase 1 — public probes (no credentials).
  'store_name_mismatch',
  'listing_locale_missing',
  'domain_expiring',
  'tls_expiring',
  'security_headers_missing',
  'review_risk_privacy_url',
  // Plan 020 Phase 1 — host-CI / repo scan rules.
  'storage_sql_delete',
  'play_target_sdk_behind',
  'ios_sdk_behind',
  // Plan 020 Phase 2 — read through connectors (ADR 0017).
  'rpc_secret_reachable_by_anon',
  'storage_orphaned_bytes',
  'edge_fn_unauthenticated_paid',
  'pitr_disabled',
  'storage_not_backed_up',
  'key_shared_across_apps',
  // Plan 020 Phase 3 — revenuecat connector.
  'revenuecat_project_split',
  'revenuecat_app_missing',
  'revenuecat_offering_missing',
] as const
export type RadarRuleId = (typeof RADAR_RULE_IDS)[number]

export interface RadarRuleMeta {
  id: RadarRuleId
  title: string
  /** Where the detector reads from. */
  source: 'public_probe' | 'repo_scan' | 'host_ci' | 'connector'
  /** For connector-backed rules: the connector kind that must be connected. */
  connector?: 'supabase' | 'llm_usage' | 'revenuecat'
  /** The bug it prevents — the drift-test line (ADR 0017). */
  prevents: string
}

export const RADAR_RULES: Readonly<Record<RadarRuleId, RadarRuleMeta>> = {
  store_name_mismatch: { id: 'store_name_mismatch', title: 'Store names match', source: 'public_probe', prevents: 'Users search one name and find another, or a review flags the mismatch.' },
  listing_locale_missing: { id: 'listing_locale_missing', title: 'Store listing in every language', source: 'public_probe', prevents: 'Users in a language you support see a listing they cannot read.' },
  domain_expiring: { id: 'domain_expiring', title: 'Domain not about to expire', source: 'public_probe', prevents: 'The whole app goes dark when the domain lapses.' },
  tls_expiring: { id: 'tls_expiring', title: 'HTTPS certificate not about to expire', source: 'public_probe', prevents: 'Browsers and the app refuse to connect when the certificate lapses.' },
  security_headers_missing: { id: 'security_headers_missing', title: 'Security headers set', source: 'public_probe', prevents: 'Clickjacking, content sniffing and downgrade attacks on the site.' },
  review_risk_privacy_url: { id: 'review_risk_privacy_url', title: 'Privacy policy link works', source: 'public_probe', prevents: 'An App Store or Play rejection because the privacy link is broken.' },
  storage_sql_delete: { id: 'storage_sql_delete', title: 'No storage deletes through SQL', source: 'host_ci', prevents: 'Files stay in the bucket and keep billing after their rows are deleted.' },
  play_target_sdk_behind: { id: 'play_target_sdk_behind', title: 'Android target SDK meets Google Play', source: 'repo_scan', prevents: 'Google Play refuses the next update, or hides the app from new users.' },
  ios_sdk_behind: { id: 'ios_sdk_behind', title: 'iOS build meets App Store upload rules', source: 'repo_scan', prevents: 'App Store Connect refuses the next build upload.' },
  rpc_secret_reachable_by_anon: { id: 'rpc_secret_reachable_by_anon', title: 'No secret-reading function open to anyone', source: 'connector', connector: 'supabase', prevents: 'Anyone with your public key calls a function that reads secrets.' },
  storage_orphaned_bytes: { id: 'storage_orphaned_bytes', title: 'No orphaned storage', source: 'connector', connector: 'supabase', prevents: 'You keep paying for files whose rows are gone.' },
  edge_fn_unauthenticated_paid: { id: 'edge_fn_unauthenticated_paid', title: 'Paid edge functions need auth', source: 'connector', connector: 'supabase', prevents: 'Strangers spend your AI and API credits through an open function.' },
  pitr_disabled: { id: 'pitr_disabled', title: 'Point-in-time recovery on', source: 'connector', connector: 'supabase', prevents: 'A bad migration or delete cannot be undone.' },
  storage_not_backed_up: { id: 'storage_not_backed_up', title: 'Storage files backed up', source: 'connector', connector: 'supabase', prevents: 'Database backups do not include Storage files; lost files stay lost.' },
  key_shared_across_apps: { id: 'key_shared_across_apps', title: 'AI spend tied to each app', source: 'connector', connector: 'llm_usage', prevents: 'Spend you cannot tie to an app cannot be capped, and one leaked key hits every app.' },
  revenuecat_project_split: { id: 'revenuecat_project_split', title: 'Shared purchases in one RevenueCat project', source: 'connector', connector: 'revenuecat', prevents: 'A purchase in one app does not unlock the other app it was sold for.' },
  revenuecat_app_missing: { id: 'revenuecat_app_missing', title: 'Store app registered in RevenueCat', source: 'connector', connector: 'revenuecat', prevents: 'Purchases from an unregistered store app are never seen.' },
  revenuecat_offering_missing: { id: 'revenuecat_offering_missing', title: 'A current RevenueCat offering', source: 'connector', connector: 'revenuecat', prevents: 'The paywall has nothing to show.' },
}

/**
 * Store and site facts a project declares (manifest `store`, `links`,
 * `deploy`) — the inputs of the public probes.
 */
export interface PublicProbeTarget {
  /** Play title is canonical (owner rule, 2026-10-02); this is the declared brand name. */
  brandName: string | null
  ios: { bundleId: string | null; appleId: string | null } | null
  android: { package: string | null } | null
  /** Locales the listing must exist in, e.g. `en-US`, `ja`. */
  locales: string[]
  /** Apex or host names to check for expiry. */
  domains: string[]
  /** https URLs of live sites to check headers and TLS on. */
  siteUrls: string[]
  privacyUrl: string | null
}

/** Facts read from repo files (or pushed from the host's CI) for the store-policy rules. */
export interface RepoFacts {
  /** From `android/app/build.gradle`, `android/variables.gradle` or `app.json` (Expo). */
  androidTargetSdk: number | null
  androidTargetSdkSource: string | null
  /** Highest Xcode major the iOS build workflow pins (`xcode-version`, `macos-NN` runner image). */
  xcodeMajor: number | null
  xcodeSource: string | null
  /** `IPHONEOS_DEPLOYMENT_TARGET` / Podfile `platform :ios`. */
  iosDeploymentTarget: string | null
  iosDeploymentTargetSource: string | null
  /** Whether the repo builds for each platform at all (an Android-less repo is not "behind"). */
  hasAndroid: boolean
  hasIos: boolean
}
