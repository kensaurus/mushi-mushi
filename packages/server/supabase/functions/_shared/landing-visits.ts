/**
 * FILE: packages/server/supabase/functions/_shared/landing-visits.ts
 * PURPOSE: Input rules for the cookieless page-view count on the docs +
 *          landing site (November GTM plan §6.1, table
 *          landing_page_views_daily). The consent-gated SDK funnel saw zero
 *          landing visits because nothing is sent before the consent bar is
 *          answered; this count needs no consent because it stores nothing
 *          personal and nothing on the device: one row per (UTC day, path,
 *          `?src=` tag, referrer host) with a count. No IP, id, user agent or
 *          fingerprint is kept. The visitor's IP only picks a rate-limit
 *          bucket, hashed in `api` (api/page-view-forward.ts).
 *
 * Pure: no Deno globals, so vitest imports it.
 */

/** Header `api` sets on the forwarded beacon: sha-256(scope:ip) folded into a uuid. */
export const VISITOR_BUCKET_HEADER = 'x-mushi-visitor-bucket'

/** scoped_rate_limit_claim scope (also folded into the bucket hash). */
export const PAGE_VIEW_SCOPE = 'landing_page_view'

/** Page views one visitor bucket may record per minute. */
export const PAGE_VIEWS_PER_MINUTE = 60

/** Largest beacon body accepted, in characters. */
export const MAX_BEACON_BODY = 1024

const MAX_PATH = 96
const PATH_RE = /^\/[a-z0-9/_.-]*$/

/**
 * The site path a view counts under: query, hash and trailing slashes
 * dropped, lowercased (docs routes are lowercase). Null for anything that is
 * not a short site path, so a beacon cannot write arbitrary text.
 */
export function normalizeVisitPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const bare = raw.split(/[?#]/, 1)[0].trim().toLowerCase()
  if (bare === '') return '/'
  const path = bare.length > 1 ? bare.replace(/\/+$/, '') || '/' : bare
  if (path.length > MAX_PATH || !PATH_RE.test(path)) return null
  return path
}

/**
 * The `?src=` campaign tag, in the same lowercase shape the console stores as
 * the signup source (apps/admin/src/lib/signupAttribution.ts
 * cleanFirstTouchSource), so visits by src line up with signups by source.
 * Anything else is '' (no source).
 */
const SRC_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/

export function cleanVisitSrc(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  return SRC_RE.test(s) ? s : ''
}

/** Hosts that are this site; a click from one page to another is not a referrer. */
const OWN_HOSTS: ReadonlySet<string> = new Set(['kensaur.us', 'www.kensaur.us'])
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/** Host name of the referrer only (a URL is reduced to its host); '' otherwise. */
export function visitReferrerHost(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let host = raw.trim().toLowerCase()
  if (host.includes('/')) {
    try {
      host = new URL(host).hostname
    } catch {
      return ''
    }
  }
  if (host.length > 253 || !HOST_RE.test(host) || OWN_HOSTS.has(host)) return ''
  return host
}

/**
 * Referrer-spam hosts: sites whose "visits" are a bot replaying a referrer,
 * not people following a link. A view from one is not recorded at all (the
 * route answers 204, as for a bot), so it never lands in the "no referrer"
 * bucket either. A host matches itself and any subdomain (`aocr.org` covers
 * `www.aocr.org`), never a look-alike (`notaocr.org`).
 *
 * Keep in step with public.is_spam_referrer_host() in the migration
 * 20261111090000_landing_referrer_spam.sql, which drops the same hosts from
 * rows stored before this list existed; landing-visits.test.ts compares them.
 *
 *   aocr.org  220 of 288 landing views 2026-10-28..11-11 and 444 of 531
 *             GitHub repo views on 2026-11-05, all with no path pattern a
 *             person makes (GTM research note 2026-11-11 §1.3).
 */
export const SPAM_REFERRER_HOSTS: readonly string[] = ['aocr.org']

/** True when the referrer host is a listed spam host or a subdomain of one. */
export function isSpamReferrerHost(host: string | null | undefined): boolean {
  if (typeof host !== 'string') return false
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!h) return false
  return SPAM_REFERRER_HOSTS.some((spam) => h === spam || h.endsWith(`.${spam}`))
}

/**
 * The same test on a full referrer URL (the SDK's `$referrer` property is
 * origin + path). Unparseable input is not spam.
 */
export function isSpamReferrerUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false
  const s = raw.trim()
  if (!s.includes('/')) return isSpamReferrerHost(s)
  try {
    return isSpamReferrerHost(new URL(s).hostname)
  } catch {
    return false
  }
}

export interface PageView {
  path: string
  src: string
  referrerHost: string
}

/**
 * Parse a beacon body. `navigator.sendBeacon` sends a string as text/plain,
 * which needs no CORS preflight; the body is JSON `{ path, src?, ref? }`.
 * Every other field is ignored, so nothing personal can reach the table.
 */
export function parsePageViewBody(text: string): PageView | null {
  if (text.length > MAX_BEACON_BODY) return null
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const path = normalizeVisitPath(b.path)
  if (path === null) return null
  return { path, src: cleanVisitSrc(b.src), referrerHost: visitReferrerHost(b.ref) }
}

const BOT_UA_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|python-requests|curl|wget|httpclient|phantomjs|puppeteer|playwright/i

/** Crawlers, headless browsers and scripts are not visitors. No user agent counts as a script. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true
  return BOT_UA_RE.test(ua)
}
