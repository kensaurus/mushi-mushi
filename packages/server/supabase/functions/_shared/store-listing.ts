/**
 * FILE: packages/server/supabase/functions/_shared/store-listing.ts
 * PURPOSE: Store listings as code (Plan 020 §5.2, ADR 0017 decision S-1).
 *          The listing lives in the host repo in fastlane's `metadata/`
 *          layout; the host's own CI publishes it with the operator's key.
 *          Mushi reads it, compares it with the live listing (read-only) and
 *          proposes changes only as draft PRs to these files.
 *
 * Pure: parse the files, compare repo vs live, enforce the store limits.
 */

import { z } from 'npm:zod@3'
import type { DetectorState, RadarSeverity } from './radar/types.ts'

export type ListingRuleId = 'listing_drift' | 'listing_locale_missing' | 'listing_limit_exceeded'

export interface ListingFinding {
  ruleId: ListingRuleId
  severity: RadarSeverity
  message: string
  target: string | null
  filePath?: string | null
  fix: string
  evidence?: Record<string, unknown>
}

export interface ListingResult {
  ruleId: ListingRuleId
  state: DetectorState
  reason: string
  findings: ListingFinding[]
}

/** The `store` block of mushi.recipe.json (a pointer to the listing, never a copy). */
export const storeManifestBlockSchema = z
  .object({
    listingDir: z.string().max(300).optional(),
    ios: z.object({ bundleId: z.string().max(200).optional(), appleId: z.string().max(40).optional() }).passthrough().optional(),
    android: z.object({ package: z.string().max(200).optional() }).passthrough().optional(),
    locales: z.array(z.string().max(20)).max(50).optional(),
    brandName: z.string().max(120).optional(),
    privacyUrl: z.string().max(2000).optional(),
  })
  .passthrough()

export type StoreManifestBlock = z.infer<typeof storeManifestBlockSchema>

export interface IosListing {
  name: string | null
  subtitle: string | null
  description: string | null
  keywords: string | null
  promotionalText: string | null
  releaseNotes: string | null
  privacyUrl: string | null
}

export interface AndroidListing {
  title: string | null
  shortDescription: string | null
  fullDescription: string | null
  video: string | null
}

export interface ParsedListing {
  ios: Record<string, IosListing>
  android: Record<string, AndroidListing>
}

const IOS_FILES: Record<keyof IosListing, string> = {
  name: 'name.txt',
  subtitle: 'subtitle.txt',
  description: 'description.txt',
  keywords: 'keywords.txt',
  promotionalText: 'promotional_text.txt',
  releaseNotes: 'release_notes.txt',
  privacyUrl: 'privacy_url.txt',
}

const ANDROID_FILES: Record<keyof AndroidListing, string> = {
  title: 'title.txt',
  shortDescription: 'short_description.txt',
  fullDescription: 'full_description.txt',
  video: 'video.txt',
}

/** Folders under metadata/ that are not iOS locales. */
const NON_LOCALE = new Set(['android', 'review_information', 'trade_representative_contact_information', 'default'])

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Read fastlane's `metadata/` layout. Locales come from the folder names; a missing file is null. */
export function parseFastlaneMetadata(files: Record<string, string>, listingDir = 'fastlane/metadata'): ParsedListing {
  const dir = norm(listingDir)
  const out: ParsedListing = { ios: {}, android: {} }
  for (const [rawPath, text] of Object.entries(files)) {
    const path = norm(rawPath)
    if (!path.startsWith(`${dir}/`)) continue
    const rest = path.slice(dir.length + 1).split('/')
    if (rest[0] === 'android' && rest.length === 3) {
      const [, locale, file] = rest
      const key = (Object.keys(ANDROID_FILES) as Array<keyof AndroidListing>).find((k) => ANDROID_FILES[k] === file)
      if (!key) continue
      out.android[locale] ??= { title: null, shortDescription: null, fullDescription: null, video: null }
      out.android[locale][key] = text
    } else if (rest.length === 2 && !NON_LOCALE.has(rest[0])) {
      const [locale, file] = rest
      const key = (Object.keys(IOS_FILES) as Array<keyof IosListing>).find((k) => IOS_FILES[k] === file)
      if (!key) continue
      out.ios[locale] ??= { name: null, subtitle: null, description: null, keywords: null, promotionalText: null, releaseNotes: null, privacyUrl: null }
      out.ios[locale][key] = text
    }
  }
  return out
}

/** Store limits in characters (App Store Connect and Play Console field limits). */
export const LISTING_LIMITS = {
  ios: { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 } as Partial<Record<keyof IosListing, number>>,
  android: { title: 30, shortDescription: 80, fullDescription: 4000 } as Partial<Record<keyof AndroidListing, number>>,
}

/** Compare as the stores do: trimmed, line endings and runs of spaces normalized. */
export function normalizeListingText(s: string | null | undefined): string {
  return (s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

function charLength(s: string): number {
  return [...s].length
}

export function checkListingLimits(listing: ParsedListing, listingDir = 'fastlane/metadata'): ListingResult {
  const ruleId = 'listing_limit_exceeded' as const
  const findings: ListingFinding[] = []
  const dir = norm(listingDir)
  for (const [locale, l] of Object.entries(listing.ios)) {
    for (const [field, max] of Object.entries(LISTING_LIMITS.ios) as Array<[keyof IosListing, number]>) {
      const len = charLength(normalizeListingText(l[field]))
      if (len > max) {
        findings.push({ ruleId, severity: 'error', message: `The App Store ${field} for ${locale} is ${len} characters; the limit is ${max}.`, target: `ios:${locale}:${field}`, filePath: `${dir}/${locale}/${IOS_FILES[field]}`, fix: `Shorten it to ${max} characters or fewer. App Store Connect rejects the upload otherwise.` })
      }
    }
  }
  for (const [locale, l] of Object.entries(listing.android)) {
    for (const [field, max] of Object.entries(LISTING_LIMITS.android) as Array<[keyof AndroidListing, number]>) {
      const len = charLength(normalizeListingText(l[field]))
      if (len > max) {
        findings.push({ ruleId, severity: 'error', message: `The Google Play ${field} for ${locale} is ${len} characters; the limit is ${max}.`, target: `android:${locale}:${field}`, filePath: `${dir}/android/${locale}/${ANDROID_FILES[field]}`, fix: `Shorten it to ${max} characters or fewer. Play Console rejects the edit otherwise.` })
      }
    }
  }
  const total = Object.keys(listing.ios).length + Object.keys(listing.android).length
  if (total === 0) return { ruleId, state: 'unknown', reason: 'No listing files found in the repo.', findings: [] }
  return findings.length
    ? { ruleId, state: 'finding', reason: `${findings.length} field${findings.length === 1 ? ' is' : 's are'} over the store limit.`, findings }
    : { ruleId, state: 'ok', reason: 'Every field fits the store limits.', findings: [] }
}

/**
 * Repo (source of truth) against the live listing (read-only). `live` null
 * for a platform means it could not be read: that platform is unknown, never
 * "in sync".
 */
export function compareListing(repo: ParsedListing, live: { ios: Record<string, Partial<IosListing>> | null; android: Record<string, Partial<AndroidListing>> | null }): [ListingResult, ListingResult] {
  const drift: ListingFinding[] = []
  const missing: ListingFinding[] = []
  let compared = 0
  const platforms: Array<['ios' | 'android', Record<string, Partial<IosListing> | Partial<AndroidListing>>, Record<string, Partial<IosListing> | Partial<AndroidListing>> | null]> = [
    ['ios', repo.ios, live.ios],
    ['android', repo.android, live.android],
  ]
  let unreadable = 0
  for (const [platform, mine, theirs] of platforms) {
    if (Object.keys(mine).length === 0) continue
    if (theirs === null) {
      unreadable++
      continue
    }
    const storeName = platform === 'ios' ? 'App Store' : 'Google Play'
    for (const locale of Object.keys(mine)) {
      if (!theirs[locale]) {
        missing.push({ ruleId: 'listing_locale_missing', severity: 'warn', message: `${locale} is in the repo but not live on ${storeName}.`, target: `${platform}:${locale}`, fix: 'Let your CI publish the listing, or add the language in the store console.' })
        continue
      }
      for (const [field, value] of Object.entries(mine[locale])) {
        if (value == null) continue
        compared++
        const liveValue = (theirs[locale] as Record<string, string | null | undefined>)[field]
        if (liveValue === undefined) continue
        if (normalizeListingText(value) !== normalizeListingText(liveValue)) {
          drift.push({ ruleId: 'listing_drift', severity: 'warn', message: `The ${storeName} ${field} for ${locale} differs from the repo.`, target: `${platform}:${locale}:${field}`, fix: 'The repo is the source of truth. Publish it from CI, or if the live text is right, copy it into the repo with `mushi store pull`.', evidence: { repo: normalizeListingText(value).slice(0, 200), live: normalizeListingText(liveValue).slice(0, 200) } })
        }
      }
    }
    for (const locale of Object.keys(theirs)) {
      if (!mine[locale]) missing.push({ ruleId: 'listing_locale_missing', severity: 'info', message: `${locale} is live on ${storeName} but not in the repo.`, target: `${platform}:${locale}`, fix: 'Run `mushi store pull` to copy it into the repo so it is not lost on the next publish.' })
    }
  }
  const unknownReason = unreadable ? 'The live listing could not be read.' : 'No listing files found in the repo.'
  const driftResult: ListingResult = drift.length
    ? { ruleId: 'listing_drift', state: 'finding', reason: `${drift.length} field${drift.length === 1 ? ' differs' : 's differ'} from the live listing.`, findings: drift }
    : compared > 0 && unreadable === 0
      ? { ruleId: 'listing_drift', state: 'ok', reason: `Compared ${compared} field${compared === 1 ? '' : 's'}; the live listing matches the repo.`, findings: [] }
      : { ruleId: 'listing_drift', state: 'unknown', reason: unknownReason, findings: [] }
  const missingResult: ListingResult = missing.length
    ? { ruleId: 'listing_locale_missing', state: 'finding', reason: `${missing.length} language${missing.length === 1 ? '' : 's'} differ between the repo and the store.`, findings: missing }
    : compared > 0 && unreadable === 0
      ? { ruleId: 'listing_locale_missing', state: 'ok', reason: 'The same languages are in the repo and live.', findings: [] }
      : { ruleId: 'listing_locale_missing', state: 'unknown', reason: unknownReason, findings: [] }
  return [driftResult, missingResult]
}
