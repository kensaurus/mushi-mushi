/**
 * FILE: packages/server/supabase/functions/_shared/radar/public-probes.ts
 * PURPOSE: The radar's public-probe detectors (Plan 020 §4.2, Phase 1). They
 *          read only public data — App Store and Play listings, RDAP,
 *          certificate-transparency logs, a site's own response headers, the
 *          privacy page — so they need no credentials and run for every
 *          project that declares a store id, a domain or a site URL.
 *
 * Parsers and evaluators are pure. `runPublicProbes` takes an injected
 * fetcher (production passes `publicFetch` from ../safe-fetch.ts) and returns
 * exactly one DetectorResult per public-probe rule. A probe that cannot read
 * its source, or has nothing declared to check, returns `unknown` with a
 * reason. A parse failure is `unknown`, never a finding.
 */

import type { DetectorResult, PublicProbeTarget, RadarFinding, RadarRuleId, RadarSeverity } from './types.ts'

export interface ProbeResponse {
  status: number
  headers: Headers
  text: string
  finalUrl: string
}

export type ProbeFetcher = (url: string) => Promise<ProbeResponse>

export const PUBLIC_PROBE_RULES = [
  'store_name_mismatch',
  'listing_locale_missing',
  'domain_expiring',
  'tls_expiring',
  'security_headers_missing',
  'review_risk_privacy_url',
] as const satisfies readonly RadarRuleId[]

const DAY_MS = 86_400_000
const SEV_RANK: Record<RadarSeverity, number> = { info: 1, warn: 2, error: 3 }

function errText(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

function unknown(ruleId: RadarRuleId, reason: string): DetectorResult {
  return { ruleId, state: 'unknown', reason, findings: [] }
}

/**
 * Combine per-item outcomes: any finding → `finding`; else any item that
 * could not be checked → `unknown` (a partial check is never a pass); else `ok`.
 */
function combine(ruleId: RadarRuleId, findings: RadarFinding[], unchecked: string[], checked: number, okReason: string): DetectorResult {
  if (findings.length > 0) {
    const extra = unchecked.length > 0 ? ` Could not check: ${unchecked.join('; ')}.` : ''
    return { ruleId, state: 'finding', reason: `${findings.length} problem${findings.length === 1 ? '' : 's'} found.${extra}`, findings }
  }
  if (unchecked.length > 0) {
    const did = checked > 0 ? `Checked ${checked}, but could not check: ` : 'Could not check: '
    return { ruleId, state: 'unknown', reason: `${did}${unchecked.join('; ')}.`, findings: [] }
  }
  return { ruleId, state: 'ok', reason: okReason, findings: [] }
}

// ── store listings ───────────────────────────────────────────────────────────

export interface StoreListing {
  name: string
  developer: string | null
  description: string | null
  iconUrl: string | null
}

/** iTunes lookup JSON → the first result, or null when it does not parse or has no result. */
export function parseItunesLookup(text: string): StoreListing | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const first = (json as { results?: unknown[] })?.results?.[0] as Record<string, unknown> | undefined
  if (!first || typeof first.trackName !== 'string' || !first.trackName.trim()) return null
  return {
    name: first.trackName,
    developer: typeof first.sellerName === 'string' ? first.sellerName : typeof first.artistName === 'string' ? first.artistName : null,
    description: typeof first.description === 'string' ? first.description : null,
    iconUrl: typeof first.artworkUrl512 === 'string' ? first.artworkUrl512 : null,
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

const PLAY_TITLE_SUFFIX = /\s+[-–—]\s+Apps on Google Play\s*$/i

/**
 * Play listing HTML → title, developer, description. JSON-LD
 * (SoftwareApplication) first; then og:title / itemprop="name" and the
 * developer link. null when no title can be read.
 */
export function parsePlayListing(html: string): StoreListing | null {
  let name: string | null = null
  let developer: string | null = null
  let description: string | null = null
  let iconUrl: string | null = null

  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>
      if (data['@type'] !== 'SoftwareApplication' && data['@type'] !== 'MobileApplication') continue
      if (typeof data.name === 'string') name = data.name
      const author = data.author as { name?: unknown } | undefined
      if (author && typeof author.name === 'string') developer = author.name
      if (typeof data.description === 'string') description = data.description
      if (typeof data.image === 'string') iconUrl = data.image
      break
    } catch {
      // A broken JSON-LD block falls through to the meta tags.
    }
  }
  if (!name) {
    const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
      ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html)
    if (og) name = decodeEntities(og[1]).replace(PLAY_TITLE_SUFFIX, '')
  }
  if (!name) {
    const itemprop = /<[^>]+itemprop=["']name["'][^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</i.exec(html)
    if (itemprop) name = decodeEntities(itemprop[1])
  }
  if (!developer) {
    const dev = /href=["'][^"']*\/store\/apps\/(?:dev|developer)\?id=[^"']*["'][^>]*>(?:\s*<[^>]+>)*\s*([^<]+)</i.exec(html)
    if (dev) developer = decodeEntities(dev[1])
  }
  if (!description) {
    const og = /<meta[^>]+(?:property|name)=["'](?:og:)?description["'][^>]+content=["']([^"']*)["']/i.exec(html)
    if (og) description = decodeEntities(og[1])
  }
  if (!name || !name.trim()) return null
  return { name: decodeEntities(name).trim(), developer: developer?.trim() ?? null, description: description?.trim() ?? null, iconUrl }
}

/** Collapse whitespace and treat en/em dashes as hyphens. Case is kept. */
export function normalizeStoreName(s: string): string {
  return s.replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim()
}

function itunesUrl(ios: NonNullable<PublicProbeTarget['ios']>, country?: string, lang?: string): string | null {
  const id = ios.appleId ? `id=${encodeURIComponent(ios.appleId)}` : ios.bundleId ? `bundleId=${encodeURIComponent(ios.bundleId)}` : null
  if (!id) return null
  const extra = country ? `&country=${encodeURIComponent(country)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}` : ''
  return `https://itunes.apple.com/lookup?${id}${extra}`
}

function playUrl(pkg: string, hl = 'en'): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=${encodeURIComponent(hl)}`
}

type Fetched<T> = { ok: true; value: T } | { ok: false; why: string }

async function fetchListing(fetcher: ProbeFetcher, url: string, parse: (t: string) => StoreListing | null, label: string): Promise<Fetched<StoreListing>> {
  try {
    const res = await fetcher(url)
    if (res.status === 404) return { ok: false, why: `${label} has no public listing (404)` }
    if (res.status < 200 || res.status >= 300) return { ok: false, why: `${label} answered ${res.status}` }
    const parsed = parse(res.text)
    return parsed ? { ok: true, value: parsed } : { ok: false, why: `${label} listing could not be read` }
  } catch (err) {
    return { ok: false, why: `${label} could not be reached (${errText(err)})` }
  }
}

const IOS_NAME_LIMIT = 30

export async function probeStoreNames(target: PublicProbeTarget, fetcher: ProbeFetcher): Promise<DetectorResult> {
  const rule = 'store_name_mismatch'
  const iosUrl = target.ios ? itunesUrl(target.ios) : null
  const pkg = target.android?.package ?? null
  if (!iosUrl && !pkg) return unknown(rule, 'No App Store or Google Play id is declared in mushi.recipe.json, so there is nothing to compare.')

  const [ios, play] = await Promise.all([
    iosUrl ? fetchListing(fetcher, iosUrl, parseItunesLookup, 'The App Store') : Promise.resolve(null),
    pkg ? fetchListing(fetcher, playUrl(pkg), parsePlayListing, 'Google Play') : Promise.resolve(null),
  ])
  const unchecked: string[] = []
  if (ios && !ios.ok) unchecked.push(ios.why)
  if (play && !play.ok) unchecked.push(play.why)
  const iosL = ios?.ok ? ios.value : null
  const playL = play?.ok ? play.value : null

  // Play is canonical (owner rule, 2026-10-02). Without it, the declared brand name is.
  const canonical = playL?.name ?? target.brandName ?? null
  const canonicalSource = playL ? 'the Google Play title' : 'the brandName in mushi.recipe.json'
  const findings: RadarFinding[] = []
  let compared = 0

  if (iosL && canonical) {
    compared++
    if (normalizeStoreName(iosL.name) !== normalizeStoreName(canonical)) {
      const tooLong = normalizeStoreName(canonical).length > IOS_NAME_LIMIT
      findings.push({
        ruleId: rule,
        severity: 'warn',
        message: `The App Store name "${iosL.name}" does not match ${canonicalSource} "${canonical}".`,
        target: iosUrl,
        fix: `Change the App Store name to "${canonical}" in the listing files your CI publishes${tooLong ? ` (it is over the ${IOS_NAME_LIMIT}-character App Store limit, so put the rest in the subtitle)` : ''}. An App Store name change ships with the next version in review, so fold it into your next store release.`,
        evidence: { appStore: iosL.name, canonical, canonicalSource },
      })
    }
  }
  if (playL && target.brandName) {
    compared++
    if (normalizeStoreName(playL.name) !== normalizeStoreName(target.brandName)) {
      findings.push({
        ruleId: rule,
        severity: 'warn',
        message: `The Google Play title "${playL.name}" does not match the brandName "${target.brandName}" in mushi.recipe.json.`,
        target: pkg ? playUrl(pkg) : null,
        fix: `The Play title is the name everywhere. Either set store.brandName to "${playL.name}" in mushi.recipe.json, or rename the Play listing.`,
        evidence: { play: playL.name, brandName: target.brandName },
      })
    }
  }
  if (iosL?.developer && playL?.developer) {
    compared++
    if (normalizeStoreName(iosL.developer) !== normalizeStoreName(playL.developer)) {
      findings.push({
        ruleId: rule,
        severity: 'info',
        message: `The developer name differs: "${iosL.developer}" on the App Store, "${playL.developer}" on Google Play.`,
        target: null,
        fix: 'Use one developer name on both stores. It is set in App Store Connect (Agreements, Tax and Banking legal name) and in the Play Console developer profile.',
        evidence: { appStore: iosL.developer, play: playL.developer },
      })
    }
  }
  if (compared === 0 && unchecked.length === 0) {
    unchecked.push('only one store is declared and no brandName is set, so there is nothing to compare it with')
  }
  return combine(rule, findings, unchecked, compared, 'The store names match.')
}

/** `ja` → { country: 'jp', lang: 'ja_jp' }; `en-US` → { country: 'us', lang: 'en_us' }. */
export function appleLocale(locale: string): { country: string; lang: string } {
  const [langRaw, regionRaw] = locale.replace('_', '-').split('-')
  const lang = (langRaw ?? 'en').toLowerCase()
  const DEFAULT_REGION: Record<string, string> = { en: 'us', ja: 'jp', ko: 'kr', zh: 'cn', th: 'th', es: 'es', fr: 'fr', de: 'de', pt: 'br', it: 'it', vi: 'vn', id: 'id', ru: 'ru', ar: 'sa', hi: 'in' }
  const country = (regionRaw ?? DEFAULT_REGION[lang] ?? lang).toLowerCase()
  return { country, lang: `${lang}_${country}` }
}

function sameText(a: string | null, b: string | null): boolean {
  return a != null && b != null && a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
}

/**
 * A store falls back to the primary listing when a locale has none, so a
 * localized description identical to the primary one means that locale is
 * missing. The first declared locale is the primary.
 */
export async function probeListingLocales(target: PublicProbeTarget, fetcher: ProbeFetcher): Promise<DetectorResult> {
  const rule = 'listing_locale_missing'
  if (target.locales.length < 2) return unknown(rule, 'Fewer than two store locales are declared (store.locales), so there is no translation to check.')
  const iosOk = target.ios && itunesUrl(target.ios)
  const pkg = target.android?.package ?? null
  if (!iosOk && !pkg) return unknown(rule, 'No App Store or Google Play id is declared, so there is no listing to check.')

  const [primary, ...others] = target.locales
  const findings: RadarFinding[] = []
  const unchecked: string[] = []
  let checked = 0

  const stores: Array<{ label: string; url: (locale: string) => string; parse: (t: string) => StoreListing | null }> = []
  if (iosOk) {
    stores.push({ label: 'App Store', url: (l) => { const a = appleLocale(l); return itunesUrl(target.ios!, a.country, a.lang)! }, parse: parseItunesLookup })
  }
  if (pkg) stores.push({ label: 'Google Play', url: (l) => playUrl(pkg, l), parse: parsePlayListing })

  for (const store of stores) {
    const base = await fetchListing(fetcher, store.url(primary), store.parse, `The ${store.label} ${primary} listing`)
    if (!base.ok || !base.value.description) {
      unchecked.push(base.ok ? `the ${store.label} ${primary} listing has no description to compare` : base.why)
      continue
    }
    for (const locale of others) {
      const loc = await fetchListing(fetcher, store.url(locale), store.parse, `The ${store.label} ${locale} listing`)
      if (!loc.ok || !loc.value.description) {
        unchecked.push(loc.ok ? `the ${store.label} ${locale} listing has no description` : loc.why)
        continue
      }
      checked++
      if (sameText(loc.value.description, base.value.description)) {
        findings.push({
          ruleId: rule,
          severity: 'warn',
          message: `The ${store.label} listing has no ${locale} version. Users in ${locale} see the ${primary} text.`,
          target: store.url(locale),
          fix: `Add a ${locale} listing (name, subtitle or short description, full description, keywords) in your listing files and let your CI publish it.`,
          evidence: { store: store.label, locale, primary },
        })
      }
    }
  }
  return combine(rule, findings, unchecked, checked, 'Every declared locale has its own listing text.')
}

// ── domains ──────────────────────────────────────────────────────────────────

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.br', 'co.nz', 'co.za', 'co.th', 'in.th', 'or.th', 'co.kr', 'com.cn', 'com.sg', 'com.tw', 'com.mx', 'co.in'])

/** The registrable domain RDAP knows about: `app.glot.it` → `glot.it`, `x.example.co.uk` → `example.co.uk`. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const lastTwo = parts.slice(-2).join('.')
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo
}

/** RDAP JSON → the registration expiry, or null when there is no expiration event. */
export function parseRdapExpiry(text: string): Date | null {
  try {
    const json = JSON.parse(text) as { events?: Array<{ eventAction?: string; eventDate?: string }> }
    const ev = json.events?.find((e) => e.eventAction === 'expiration')
    if (!ev?.eventDate) return null
    const d = new Date(ev.eventDate)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

function expirySeverity(daysLeft: number, errorDays: number, warnDays: number): RadarSeverity | null {
  if (daysLeft < errorDays) return 'error'
  if (daysLeft < warnDays) return 'warn'
  return null
}

export async function probeDomains(target: PublicProbeTarget, fetcher: ProbeFetcher, now: Date): Promise<DetectorResult> {
  const rule = 'domain_expiring'
  const domains = [...new Set(target.domains.map(registrableDomain).filter((d) => d.includes('.')))]
  if (domains.length === 0) return unknown(rule, 'No domain is declared (links.domains), so there is nothing to check.')
  const findings: RadarFinding[] = []
  const unchecked: string[] = []
  let checked = 0
  for (const domain of domains) {
    let expiry: Date | null = null
    try {
      const res = await fetcher(`https://rdap.org/domain/${encodeURIComponent(domain)}`)
      if (res.status < 200 || res.status >= 300) {
        unchecked.push(`${domain} (the registry answered ${res.status})`)
        continue
      }
      expiry = parseRdapExpiry(res.text)
    } catch (err) {
      unchecked.push(`${domain} (${errText(err)})`)
      continue
    }
    if (!expiry) {
      unchecked.push(`${domain} (the registry does not publish an expiry date)`)
      continue
    }
    checked++
    const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / DAY_MS)
    const sev = expirySeverity(daysLeft, 7, 30)
    if (sev) {
      findings.push({
        ruleId: rule,
        severity: sev,
        message: daysLeft < 0 ? `${domain} expired ${-daysLeft} days ago.` : `${domain} expires in ${daysLeft} days (${expiry.toISOString().slice(0, 10)}).`,
        target: domain,
        fix: `Renew ${domain} at your registrar now, and turn on auto-renew so it cannot lapse.`,
        evidence: { expiresAt: expiry.toISOString(), daysLeft },
      })
    }
  }
  return combine(rule, findings, unchecked, checked, `No declared domain expires in the next 30 days.`)
}

// ── TLS (certificate transparency) ───────────────────────────────────────────
//
// Deno's TLS API does not give us the server's certificate: Deno.connectTls()
// returns a TlsConn whose handshake() resolves to TlsHandshakeInfo, which only
// carries `alpnProtocol` (checked in the Deno 2.x type definitions; no peer
// certificate field). fetch() exposes nothing either. So the expiry is read
// from public Certificate Transparency logs (crt.sh): the newest certificate
// logged for the host. That is an estimate — the server may still serve an
// older certificate — and every result says so.

/** crt.sh can return a huge array; when the body was cut at the byte cap, keep the complete objects. */
export function parseJsonArrayLenient(text: string): unknown[] | null {
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : null
  } catch {
    const cut = text.lastIndexOf('},')
    if (!text.trimStart().startsWith('[') || cut < 0) return null
    try {
      const v = JSON.parse(`${text.slice(0, cut + 1)}]`)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }
}

function hostMatchesName(host: string, name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n === host) return true
  if (n.startsWith('*.')) {
    const parent = host.split('.').slice(1).join('.')
    return parent.length > 0 && n.slice(2) === parent
  }
  return false
}

/** crt.sh JSON → the newest not_after among certificates naming `host`, or null. */
export function parseCrtShExpiry(text: string, host: string): Date | null {
  const rows = parseJsonArrayLenient(text)
  if (!rows) return null
  const h = host.toLowerCase()
  let best: Date | null = null
  for (const r of rows as Array<{ name_value?: unknown; not_after?: unknown }>) {
    if (typeof r?.name_value !== 'string' || typeof r.not_after !== 'string') continue
    if (!r.name_value.split('\n').some((n) => hostMatchesName(h, n))) continue
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(r.not_after) ? r.not_after : `${r.not_after}Z`
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) continue
    if (!best || d > best) best = d
  }
  return best
}

function siteHosts(target: PublicProbeTarget): string[] {
  const hosts = new Set<string>()
  for (const u of target.siteUrls) {
    try {
      hosts.add(new URL(u).hostname.toLowerCase())
    } catch {
      // A malformed URL is skipped; the headers probe reports it.
    }
  }
  if (hosts.size === 0) for (const d of target.domains) hosts.add(d.toLowerCase())
  return [...hosts]
}

export async function probeTls(target: PublicProbeTarget, fetcher: ProbeFetcher, now: Date): Promise<DetectorResult> {
  const rule = 'tls_expiring'
  const hosts = siteHosts(target)
  if (hosts.length === 0) return unknown(rule, 'No site URL or domain is declared, so there is no certificate to check.')
  const findings: RadarFinding[] = []
  const unchecked: string[] = []
  let checked = 0
  for (const host of hosts) {
    let expiry: Date | null = null
    try {
      const res = await fetcher(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`)
      if (res.status < 200 || res.status >= 300) {
        unchecked.push(`${host} (the certificate log answered ${res.status})`)
        continue
      }
      expiry = parseCrtShExpiry(res.text, host)
    } catch (err) {
      unchecked.push(`${host} (${errText(err)})`)
      continue
    }
    if (!expiry) {
      unchecked.push(`${host} (no current certificate found in public certificate logs)`)
      continue
    }
    checked++
    const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / DAY_MS)
    const sev = expirySeverity(daysLeft, 7, 21)
    if (sev) {
      findings.push({
        ruleId: rule,
        severity: sev,
        message: `The newest HTTPS certificate for ${host} expires in ${daysLeft} days (${expiry.toISOString().slice(0, 10)}). Estimated from public certificate logs.`,
        target: host,
        fix: `Check that certificate renewal runs for ${host} (your host or CDN usually does it). If you manage the certificate yourself, renew it and set up automatic renewal.`,
        evidence: { notAfter: expiry.toISOString(), daysLeft, source: 'crt.sh' },
      })
    }
  }
  return combine(rule, findings, unchecked, checked, 'No certificate expires in the next 21 days (estimated from public certificate logs).')
}

// ── security headers ─────────────────────────────────────────────────────────

export function missingSecurityHeaders(headers: Headers): Array<{ header: string; severity: RadarSeverity; why: string }> {
  const out: Array<{ header: string; severity: RadarSeverity; why: string }> = []
  if (!headers.get('strict-transport-security')) out.push({ header: 'Strict-Transport-Security', severity: 'warn', why: 'browsers may still try plain http first' })
  const csp = headers.get('content-security-policy') ?? ''
  if (!/frame-ancestors/i.test(csp) && !headers.get('x-frame-options')) {
    out.push({ header: 'Content-Security-Policy frame-ancestors (or X-Frame-Options)', severity: 'warn', why: 'another site can load yours in a frame and trick clicks' })
  }
  if ((headers.get('x-content-type-options') ?? '').toLowerCase().trim() !== 'nosniff') out.push({ header: 'X-Content-Type-Options: nosniff', severity: 'info', why: 'browsers may guess file types' })
  if (!headers.get('referrer-policy')) out.push({ header: 'Referrer-Policy', severity: 'info', why: 'full page URLs can leak to other sites' })
  return out
}

export async function probeSecurityHeaders(target: PublicProbeTarget, fetcher: ProbeFetcher): Promise<DetectorResult> {
  const rule = 'security_headers_missing'
  if (target.siteUrls.length === 0) return unknown(rule, 'No site URL is declared (deploy target url), so there are no headers to check.')
  const findings: RadarFinding[] = []
  const unchecked: string[] = []
  let checked = 0
  for (const url of [...new Set(target.siteUrls)]) {
    let res: ProbeResponse
    try {
      res = await fetcher(url)
    } catch (err) {
      unchecked.push(`${url} (${errText(err)})`)
      continue
    }
    if (res.status >= 500 || res.status === 0) {
      unchecked.push(`${url} (answered ${res.status})`)
      continue
    }
    checked++
    const missing = missingSecurityHeaders(res.headers)
    if (missing.length === 0) continue
    const severity = missing.reduce<RadarSeverity>((w, m) => (SEV_RANK[m.severity] > SEV_RANK[w] ? m.severity : w), 'info')
    findings.push({
      ruleId: rule,
      severity,
      message: `${url} is missing ${missing.map((m) => m.header).join(', ')}.`,
      target: url,
      fix: `Add these response headers in your host or CDN config: ${missing.map((m) => `${m.header} (without it, ${m.why})`).join('; ')}.`,
      evidence: { missing: missing.map((m) => m.header) },
    })
  }
  return combine(rule, findings, unchecked, checked, 'Every declared site sends the security headers.')
}

// ── privacy URL ──────────────────────────────────────────────────────────────

/** Elements whose content is never shown as page text. */
const RAW_TEXT_ELEMENTS = ['script', 'style', 'noscript'] as const

function isTagNameEnd(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === '/' || /\s/.test(ch)
}

/** `html` at `at` starts with `name` (ASCII, case-insensitive) followed by a tag-name end. */
function nameAt(html: string, at: number, name: string): boolean {
  return html.slice(at, at + name.length).toLowerCase() === name && isTagNameEnd(html[at + name.length])
}

/** Index just past the `>` that closes the tag whose name ends before `from`; the end of input if none. */
function tagEnd(html: string, from: number): number {
  const gt = html.indexOf('>', from)
  return gt === -1 ? html.length : gt + 1
}

/**
 * Visible text of an HTML page: no scripts, styles or tags, whitespace
 * collapsed. A single left-to-right scan, the way a browser tokenizes:
 * `<script>`, `<style>` and `<noscript>` run to their end tag in any case and
 * with any attributes or whitespace before the `>` (`</script >`,
 * `</SCRIPT\n>`); an unclosed one runs to the end of the input; comments run
 * to `-->`; any other tag runs to its `>`. Linear in the input length.
 */
export function visibleText(html: string): string {
  const out: string[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      out.push(html.slice(i))
      break
    }
    out.push(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4)
      i = close === -1 ? html.length : close + 3
      out.push(' ')
      continue
    }
    const raw = RAW_TEXT_ELEMENTS.find((name) => nameAt(html, lt + 1, name))
    if (raw) {
      // Skip to the matching end tag: `</` + the same name + a tag-name end.
      let j = tagEnd(html, lt + 1 + raw.length)
      let end = html.length
      while (j < html.length) {
        const close = html.indexOf('</', j)
        if (close === -1) break
        if (nameAt(html, close + 2, raw)) {
          end = tagEnd(html, close + 2 + raw.length)
          break
        }
        j = close + 2
      }
      i = end
      out.push(' ')
      continue
    }
    const next = html[lt + 1]
    if (next !== undefined && (/[A-Za-z!?]/.test(next) || (next === '/' && /[A-Za-z]/.test(html[lt + 2] ?? '')))) {
      i = tagEnd(html, lt + 1)
      out.push(' ')
      continue
    }
    // A `<` that opens no tag (`a < b`) is text.
    out.push('<')
    i = lt + 1
  }
  return decodeEntities(out.join('')).replace(/\s+/g, ' ').trim()
}

const MIN_POLICY_CHARS = 300

export async function probePrivacyUrl(target: PublicProbeTarget, fetcher: ProbeFetcher): Promise<DetectorResult> {
  const rule = 'review_risk_privacy_url'
  if (!target.privacyUrl) return unknown(rule, 'No privacy URL declared in mushi.recipe.json store.privacyUrl.')
  const url = target.privacyUrl
  let res: ProbeResponse
  try {
    res = await fetcher(url)
  } catch (err) {
    const msg = errText(err)
    // A refused URL (http, private host) is a real problem with the declared link.
    if (msg.startsWith('outbound-blocked:')) {
      return { ruleId: rule, state: 'finding', reason: 'The privacy link is not a public https page.', findings: [privacyFinding(url, `The privacy link is not a public https page (${msg.replace('outbound-blocked: ', '')}).`)] }
    }
    return unknown(rule, `The privacy page could not be reached (${msg}).`)
  }
  const failures: string[] = []
  if (res.status < 200 || res.status >= 300) failures.push(`it answered ${res.status} instead of a page`)
  const type = res.headers.get('content-type') ?? ''
  if (!/text\/html/i.test(type)) failures.push(`it is served as "${type || 'no content type'}", not an HTML page`)
  const text = visibleText(res.text)
  if (text.length < MIN_POLICY_CHARS) failures.push(`it shows only ${text.length} characters of text (a page that renders with JavaScript only looks empty to a reviewer's quick check)`)
  if (!/privacy|プライバシー/i.test(text)) failures.push('the text never mentions privacy')
  if (failures.length === 0) return { ruleId: rule, state: 'ok', reason: 'The privacy page loads and reads as a privacy policy.', findings: [] }
  return {
    ruleId: rule,
    state: 'finding',
    reason: 'The privacy page may fail store review.',
    findings: [privacyFinding(res.finalUrl || url, `The privacy page may fail store review: ${failures.join('; ')}.`)],
  }
}

function privacyFinding(url: string, message: string): RadarFinding {
  return {
    ruleId: 'review_risk_privacy_url',
    severity: 'warn',
    message,
    target: url,
    fix: 'Serve the privacy policy as a plain HTML page that loads without JavaScript, at a stable https URL, and use that URL in both store listings.',
  }
}

// ── orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run every public probe. Never rejects: a probe that throws becomes
 * `unknown` for its own rule only. Returns one result per PUBLIC_PROBE_RULES
 * entry, in that order.
 */
export async function runPublicProbes(target: PublicProbeTarget, fetcher: ProbeFetcher, now: Date): Promise<DetectorResult[]> {
  const runners: Record<(typeof PUBLIC_PROBE_RULES)[number], () => Promise<DetectorResult>> = {
    store_name_mismatch: () => probeStoreNames(target, fetcher),
    listing_locale_missing: () => probeListingLocales(target, fetcher),
    domain_expiring: () => probeDomains(target, fetcher, now),
    tls_expiring: () => probeTls(target, fetcher, now),
    security_headers_missing: () => probeSecurityHeaders(target, fetcher),
    review_risk_privacy_url: () => probePrivacyUrl(target, fetcher),
  }
  return Promise.all(
    PUBLIC_PROBE_RULES.map(async (rule) => {
      try {
        return await runners[rule]()
      } catch (err) {
        return unknown(rule, `The check could not run (${errText(err)}).`)
      }
    }),
  )
}
