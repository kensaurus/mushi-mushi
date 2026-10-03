/**
 * FILE: packages/server/supabase/functions/_shared/store-ops.ts
 * PURPOSE: Store ops, read side (Plan 020 §5, Phase 2): listing as code
 *          against what is live, store limits, claims vs code, screenshot
 *          checks and the pre-submission checklist — run on demand, recorded
 *          as one `store_review` gate run. Read-only: nothing is published
 *          (listings change through draft PRs the host's CI publishes).
 *
 * Every check that could not look reads `unknown` with the reason. Listing
 * text and policy pages are untrusted and are wrapped before the LLM sees
 * them (store-review.ts buildClaimExtractionPrompt).
 */

import type { getServiceClient } from './db.ts'
import { normalizeRepoPath } from './recipe-glob.ts'
import type { RecipeRepo, RecipeRepoResolution } from './recipe-github.ts'
import { appleLocale, parseItunesLookup, parsePlayListing, type ProbeFetcher } from './radar/public-probes.ts'
import { checkListingLimits, compareListing, parseFastlaneMetadata, storeManifestBlockSchema, type AndroidListing, type IosListing, type ParsedListing } from './store-listing.ts'
import {
  judgeClaims,
  readImageSize,
  reviewRiskChecklist,
  screenshotPlatformMismatch,
  screenshotStale,
  type ExtractedClaim,
  type StoreReviewResult,
} from './store-review.ts'

type Db = ReturnType<typeof getServiceClient>

export const STORE_REVIEW_GATE = 'store_review'
const MAX_LISTING_FILES = 300
const MAX_SCREENSHOTS = 12

/** SDKs that collect user or device data — compared with what the listing and labels claim. */
const DATA_COLLECTORS: Array<[RegExp, string]> = [
  [/^(@react-native-firebase\/analytics|firebase)$/, 'Firebase'],
  [/^posthog(-js|-react-native|-node)?$/, 'PostHog'],
  [/^@sentry\//, 'Sentry'],
  [/^(mixpanel|mixpanel-browser|mixpanel-react-native)$/, 'Mixpanel'],
  [/^(@amplitude\/|amplitude-js)/, 'Amplitude'],
  [/^@segment\//, 'Segment'],
  [/^react-native-appsflyer$/, 'AppsFlyer'],
  [/^@datadog\//, 'Datadog'],
  [/^(onesignal|react-native-onesignal|onesignal-cordova-plugin)$/, 'OneSignal'],
  [/^@mushi-mushi\//, 'Mushi (bug reports)'],
]

export function dataCollectorsFromPackageJson(text: string | null): string[] | null {
  if (!text) return null
  try {
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string> }
    const names = Object.keys(pkg.dependencies ?? {})
    return [...new Set(names.flatMap((n) => DATA_COLLECTORS.filter(([re]) => re.test(n)).map(([, label]) => label)))].sort()
  } catch {
    return null
  }
}

export interface StoreOpsDeps {
  resolveRepo: (db: Db, projectId: string) => Promise<RecipeRepoResolution>
  getDefaultHead: (repo: RecipeRepo) => Promise<{ branch: string; sha: string }>
  listTree: (repo: RecipeRepo, sha: string) => Promise<{ entries: Array<{ path: string; size: number }>; truncated: boolean }>
  readBlobs: (repo: RecipeRepo, sha: string, paths: readonly string[]) => Promise<Map<string, string | null>>
  readBytes: (repo: RecipeRepo, ref: string, path: string, maxBytes: number) => Promise<{ kind: 'file'; bytes: Uint8Array } | { kind: 'absent' } | { kind: 'too_large'; size: number }>
  /** Last commit date that touched a path (GitHub commits API); null when unknown. */
  lastChanged: (repo: RecipeRepo, path: string) => Promise<string | null>
  repoInfo: (repo: RecipeRepo) => Promise<{ public: boolean | null; license: string | null }>
  fetcher: ProbeFetcher
  /** Claim extraction (LLM, BYOK). null when no model is available. */
  extractClaims: ((db: Db, projectId: string, listingText: string) => Promise<ExtractedClaim[] | null>) | null
  /** Indexed files whose code looks like it uploads user content. */
  uploadPaths: (db: Db, projectId: string) => Promise<string[]>
  now: () => Date
}

export interface StoreReport {
  projectId: string
  checkedAt: string
  store: Record<string, unknown> | null
  results: StoreReviewResult[]
  checklist: ReturnType<typeof reviewRiskChecklist>
  liveRead: { ios: boolean; android: boolean }
}

async function liveListing(target: { ios: { bundleId: string | null; appleId: string | null } | null; android: { package: string | null } | null }, locales: string[], fetcher: ProbeFetcher) {
  const ios: Record<string, Partial<IosListing>> = {}
  const android: Record<string, Partial<AndroidListing>> = {}
  let iosOk = false
  let androidOk = false
  for (const locale of locales.slice(0, 10)) {
    if (target.ios?.bundleId || target.ios?.appleId) {
      const { country, lang } = appleLocale(locale)
      const q = target.ios.appleId ? `id=${encodeURIComponent(target.ios.appleId)}` : `bundleId=${encodeURIComponent(target.ios.bundleId!)}`
      try {
        const r = await fetcher(`https://itunes.apple.com/lookup?${q}&country=${country}&lang=${lang}`)
        const l = r.status === 200 ? parseItunesLookup(r.text) : null
        if (l) { ios[locale] = { name: l.name, description: l.description }; iosOk = true }
      } catch {
        // stays unread for this locale
      }
    }
    if (target.android?.package) {
      try {
        const r = await fetcher(`https://play.google.com/store/apps/details?id=${encodeURIComponent(target.android.package)}&hl=${encodeURIComponent(locale)}`)
        const l = r.status === 200 ? parsePlayListing(r.text) : null
        if (l) { android[locale] = { title: l.name, fullDescription: l.description }; androidOk = true }
      } catch {
        // stays unread
      }
    }
  }
  return { ios: iosOk ? ios : null, android: androidOk ? android : null, iosOk, androidOk }
}

function unknownResult(ruleId: StoreReviewResult['ruleId'] | string, reason: string): StoreReviewResult {
  return { ruleId: ruleId as StoreReviewResult['ruleId'], state: 'unknown', reason, findings: [] }
}

/** A check whose input read threw: a failed check, never "could not decide" and never ok. */
function errorResult(ruleId: StoreReviewResult['ruleId'] | string, reason: string): StoreReviewResult {
  return { ruleId: ruleId as StoreReviewResult['ruleId'], state: 'error', reason, findings: [] }
}

/** Run status: serious findings first, then any check that failed to run (never a pass). */
export function storeRunStatus(results: readonly StoreReviewResult[]): 'fail' | 'error' | 'warn' | 'pass' | 'skipped' {
  const findings = results.flatMap((r) => r.findings)
  if (findings.some((f) => f.severity === 'error')) return 'fail'
  if (results.some((r) => r.state === 'error')) return 'error'
  if (findings.some((f) => f.severity === 'warn')) return 'warn'
  return results.some((r) => r.state === 'ok' || r.state === 'finding') ? 'pass' : 'skipped'
}

function errText(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 200)
}

/** Run every store check for one project and record a `store_review` gate run. */
export async function runStoreReview(db: Db, projectId: string, deps: StoreOpsDeps, triggeredBy = 'manual'): Promise<StoreReport> {
  const now = deps.now()
  const { data: snap } = await db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle()
  const manifest = ((snap as { manifest?: Record<string, any> | null } | null)?.manifest) ?? null
  const parsed = storeManifestBlockSchema.safeParse(manifest?.store ?? null)
  const store = parsed.success ? (parsed.data as Record<string, any>) : null
  const results: StoreReviewResult[] = []
  const ids = manifest?.app?.ids ?? {}
  const target = {
    ios: store?.ios?.bundleId || store?.ios?.appleId || ids.bundleId || ids.appStoreId ? { bundleId: store?.ios?.bundleId ?? ids.bundleId ?? null, appleId: store?.ios?.appleId ?? ids.appStoreId ?? null } : null,
    android: store?.android?.package || ids.androidPackage ? { package: store?.android?.package ?? ids.androidPackage ?? null } : null,
  }
  const locales: string[] = Array.isArray(store?.locales) && store!.locales.length ? store!.locales : ['en-US']

  // Repo side: listing files, screenshots, package.json.
  // `repoError` set = the repo read threw (a failed check); `!repoRes.ok` = no repo connected (undecided).
  let repoError = null as string | null
  const repoRes = await deps.resolveRepo(db, projectId).catch((err): RecipeRepoResolution => {
    repoError = errText(err)
    return { ok: false, repoConnected: true, tokenAvailable: true, reason: repoError }
  })
  let listing: ParsedListing | null = null
  let collectors: string[] | null = null
  let shots: Array<{ path: string; width: number; height: number }> | null = null
  let shotDates: Array<{ path: string; lastChangedAt: string }> | null = null
  let repoInfo: { public: boolean | null; license: string | null } = { public: null, license: null }
  const listingDir = typeof store?.listingDir === 'string' ? normalizeRepoPath(store.listingDir.replace(/\/+$/, '')) : null
  if (repoRes.ok) {
    try {
      const head = await deps.getDefaultHead(repoRes.repo)
      const tree = await deps.listTree(repoRes.repo, head.sha)
      const listingPaths = listingDir ? tree.entries.filter((e) => e.path.startsWith(`${listingDir}/`) && e.path.endsWith('.txt')).map((e) => e.path).slice(0, MAX_LISTING_FILES) : []
      const texts = await deps.readBlobs(repoRes.repo, head.sha, [...listingPaths, 'package.json'])
      if (listingDir) {
        const files: Record<string, string> = {}
        for (const p of listingPaths) { const t = texts.get(p); if (typeof t === 'string') files[p] = t }
        listing = parseFastlaneMetadata(files, listingDir)
      }
      collectors = dataCollectorsFromPackageJson(texts.get('package.json') ?? null)
      const shotPaths = tree.entries.filter((e) => /(^|\/)(fastlane\/screenshots|screenshots)\/.+\.(png|jpe?g)$/i.test(e.path) && !/android/i.test(e.path)).map((e) => e.path).slice(0, MAX_SCREENSHOTS)
      if (shotPaths.length) {
        shots = []
        for (const p of shotPaths) {
          const b = await deps.readBytes(repoRes.repo, head.sha, p, 8 * 1024 * 1024)
          const size = b.kind === 'file' ? readImageSize(b.bytes) : null
          if (size) shots.push({ path: p, width: size.width, height: size.height })
        }
        const dirs = [...new Set(shotPaths.map((p) => p.split('/').slice(0, -1).join('/')))].slice(0, 5)
        shotDates = []
        for (const d of dirs) {
          const at = await deps.lastChanged(repoRes.repo, d).catch(() => null)
          if (at) shotDates.push({ path: d, lastChangedAt: at })
        }
      }
      repoInfo = await deps.repoInfo(repoRes.repo).catch(() => ({ public: null, license: null }))
    } catch (err) {
      repoError = errText(err)
    }
  }

  // Live side: public listings per declared locale.
  const live = await liveListing(target, locales, deps.fetcher)

  if (!listingDir) {
    results.push(unknownResult('listing_drift', 'No store.listingDir in mushi.recipe.json, so there is no listing in the repo to compare.'))
    results.push(unknownResult('listing_limit_exceeded', 'No listing in the repo to check against the store limits.'))
  } else if (!listing) {
    if (repoError) {
      results.push(errorResult('listing_drift', `Reading the repo failed: ${repoError}`))
      results.push(errorResult('listing_limit_exceeded', `Reading the repo failed: ${repoError}`))
    } else {
      results.push(unknownResult('listing_drift', repoRes.ok ? 'The listing files could not be read from the repo.' : `The repo could not be read: ${repoRes.reason}`))
      results.push(unknownResult('listing_limit_exceeded', 'The listing files could not be read.'))
    }
  } else {
    results.push(...compareListing(listing, { ios: live.ios, android: live.android }) as unknown as StoreReviewResult[])
    results.push(checkListingLimits(listing, listingDir) as unknown as StoreReviewResult)
  }

  const listingText = [
    ...Object.values(live.ios ?? {}).slice(0, 1).map((l) => `${l.name ?? ''}\n${l.description ?? ''}`),
    ...Object.values(live.android ?? {}).slice(0, 1).map((l) => `${l.title ?? ''}\n${l.fullDescription ?? ''}`),
    ...(listing ? Object.values(listing.ios).slice(0, 1).map((l) => `${l.name ?? ''}\n${l.description ?? ''}`) : []),
  ].join('\n\n').trim().slice(0, 12_000)
  let claims: ExtractedClaim[] | null = null
  let claimsError = null as string | null
  if (listingText && deps.extractClaims) claims = await deps.extractClaims(db, projectId, listingText).catch((err) => { claimsError = `Reading the claims failed: ${errText(err)}`; return null })
  // Without the upload evidence an on-device claim cannot be judged: a failed read is an error, not "no uploads".
  let uploads: string[] = []
  try {
    uploads = await deps.uploadPaths(db, projectId)
  } catch (err) {
    claimsError ??= `Reading the code for uploads failed: ${errText(err)}`
  }
  const [claimResult, labelResult] = judgeClaims(listingText ? claims : null, {
    networkUploadPaths: uploads,
    repoLicense: repoInfo.license,
    repoPublic: repoInfo.public,
    contentCounts: {},
    sdkDataCollectors: collectors ?? [],
    privacyLabelDataTypes: null,
  }).results
  if (listingText && !deps.extractClaims) results.push(unknownResult('listing_claim_contradicts_code', 'No AI key is available to read the claims in the listing. Add an Anthropic or OpenAI key under API keys.'))
  else if (claimsError || repoError) results.push(errorResult('listing_claim_contradicts_code', claimsError ?? `Reading the repo failed: ${repoError}`))
  else results.push(claimResult)
  results.push(repoError ? errorResult(labelResult.ruleId, `Reading package.json failed: ${repoError}`) : labelResult)

  if (repoError) results.push(errorResult('screenshot_platform_mismatch', `Reading the repo failed: ${repoError}`))
  else results.push(shots === null ? unknownResult('screenshot_platform_mismatch', 'No iOS screenshots found in the repo (fastlane/screenshots).') : screenshotPlatformMismatch(shots))
  const { data: releases } = await db.from('releases').select('published_at').eq('project_id', projectId).order('published_at', { ascending: false }).limit(20)
  const releaseDates = ((releases ?? []) as Array<{ published_at: string | null }>).map((r) => r.published_at).filter((x): x is string => Boolean(x)).slice(0, 10)
  results.push(screenshotStale({ screenshots: shotDates, releaseDates }))

  // The checklist reuses the latest hole checks; anything not checked stays unknown.
  const { data: radarRun } = await db.from('gate_runs').select('summary').eq('project_id', projectId).in('gate', ['portfolio_radar', 'portfolio_radar_ci']).order('started_at', { ascending: false }).limit(2)
  const radarResults = ((radarRun ?? []) as Array<{ summary: { results?: Array<{ ruleId: string; state: string }> } | null }>).flatMap((r) => r.summary?.results ?? [])
  const stateOf = (rule: string): boolean | null => {
    const r = radarResults.find((x) => x.ruleId === rule)
    return !r || r.state === 'unknown' || r.state === 'error' ? null : r.state === 'ok'
  }
  const checklist = reviewRiskChecklist({
    sendsUserDataToAi: null,
    aiDisclosureFound: null,
    privacyUrlOk: stateOf('review_risk_privacy_url'),
    externalPurchaseLinks: [],
    byokPurchaseFlow: null,
    hardcodedPersonas: null,
    accountDeletionPath: null,
    playTargetOk: stateOf('play_target_sdk_behind'),
    iosSdkOk: stateOf('ios_sdk_behind'),
  })

  // Record one store_review run.
  const findings = results.flatMap((r) => r.findings)
  const status = storeRunStatus(results)
  const { data: run, error: runError } = await db.from('gate_runs').insert({
    project_id: projectId, gate: STORE_REVIEW_GATE, status, triggered_by: triggeredBy, findings_count: findings.length,
    summary: { results: results.map((r) => ({ ruleId: r.ruleId, state: r.state, reason: r.reason, findings: r.findings.length })), checklist, liveRead: { ios: live.iosOk, android: live.androidOk } },
    started_at: now.toISOString(), completed_at: now.toISOString(),
  }).select('id').single()
  if (runError || !run) throw new Error(`could not record the store review: ${runError?.message ?? 'no row'}`)
  if (findings.length) {
    const { error: fErr } = await db.from('gate_findings').insert(findings.slice(0, 200).map((f) => ({
      gate_run_id: (run as { id: string }).id, project_id: projectId, severity: f.severity, rule_id: f.ruleId, message: f.message.slice(0, 1000),
      suggested_fix: { fix: f.fix, target: f.target ?? null }, allowlisted: false,
    })))
    if (fErr) {
      // A run whose findings did not land must not read as a pass.
      const { error: uErr } = await db.from('gate_runs').update({ status: 'error' }).eq('id', (run as { id: string }).id)
      throw new Error(`could not store the store review findings: ${fErr.message}${uErr ? `; the run could not be marked failed either (${uErr.message})` : ''}`)
    }
  }
  return { projectId, checkedAt: now.toISOString(), store, results, checklist, liveRead: { ios: live.iosOk, android: live.androidOk } }
}
