/**
 * `_shared/radar/public-probes.ts` — the radar's public-probe detectors
 * (Plan 020 §4.2, Phase 1). Recorded fixtures under fixtures/radar/ stand in
 * for the App Store lookup, the Play listing, RDAP and crt.sh. Every rule is
 * covered on its ok, finding and unknown paths, and a parse failure or an
 * unreachable source is `unknown`, never a finding.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  PUBLIC_PROBE_RULES,
  appleLocale,
  missingSecurityHeaders,
  parseCrtShExpiry,
  parseItunesLookup,
  parsePlayListing,
  parseRdapExpiry,
  probeDomains,
  probeListingLocales,
  probePrivacyUrl,
  probeSecurityHeaders,
  probeStoreNames,
  probeTls,
  registrableDomain,
  runPublicProbes,
  visibleText,
  type ProbeFetcher,
  type ProbeResponse,
} from '../../supabase/functions/_shared/radar/public-probes.ts'
import type { PublicProbeTarget } from '../../supabase/functions/_shared/radar/types.ts'

const fx = (name: string) => readFileSync(resolve(__dirname, 'fixtures/radar', name), 'utf8')
const NOW = new Date('2026-10-02T12:00:00Z')

const ITUNES = 'https://itunes.apple.com/lookup?id=6761582648'
const PLAY = 'https://play.google.com/store/apps/details?id=com.glotit.app&hl=en'

function res(text: string, status = 200, headers: Record<string, string> = {}): ProbeResponse {
  return { status, headers: new Headers(headers), text, finalUrl: '' }
}

/** A fetcher over a URL → response map; anything else rejects like a network failure. */
function fetcherOf(routes: Record<string, ProbeResponse | Error>): ProbeFetcher & { calls: string[] } {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    const r = routes[url]
    if (!r) throw new Error(`no route for ${url}`)
    if (r instanceof Error) throw r
    return { ...r, finalUrl: r.finalUrl || url }
  }) as ProbeFetcher & { calls: string[] }
  f.calls = calls
  return f
}

function target(over: Partial<PublicProbeTarget> = {}): PublicProbeTarget {
  return {
    brandName: null,
    ios: { bundleId: 'com.glotit.app', appleId: '6761582648' },
    android: { package: 'com.glotit.app' },
    locales: [],
    domains: [],
    siteUrls: [],
    privacyUrl: null,
    ...over,
  }
}

describe('parsers', () => {
  it('reads the iTunes lookup and returns null for no result or bad JSON', () => {
    expect(parseItunesLookup(fx('itunes-lookup.json'))).toMatchObject({ name: 'glot.it', developer: 'Kensaurus Studio' })
    expect(parseItunesLookup(fx('itunes-lookup-empty.json'))).toBeNull()
    expect(parseItunesLookup('<html>rate limited</html>')).toBeNull()
  })

  it('reads the Play listing from JSON-LD, and from og:title + the developer link when JSON-LD is absent', () => {
    expect(parsePlayListing(fx('play-listing.html'))).toMatchObject({ name: 'glot.it – Learn Thai', developer: 'Kensaurus Studio' })
    expect(parsePlayListing(fx('play-listing-meta-only.html'))).toMatchObject({ name: 'Help Her Take Photo', developer: 'Kensaurus Studio' })
    expect(parsePlayListing('<html><body>We are sorry, the requested URL was not found.</body></html>')).toBeNull()
  })

  it('reads RDAP expiry, crt.sh newest certificate per host, and the registrable domain', () => {
    expect(parseRdapExpiry(fx('rdap-domain.json'))?.toISOString()).toBe('2026-10-20T10:00:00.000Z')
    expect(parseRdapExpiry('{"events":[]}')).toBeNull()
    expect(parseCrtShExpiry(fx('crtsh.json'), 'glot.it')?.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    expect(parseCrtShExpiry(fx('crtsh.json'), 'api.glot.it')?.toISOString()).toBe('2026-12-19T00:00:00.000Z')
    expect(parseCrtShExpiry(fx('crtsh.json'), 'nope.example.com')).toBeNull()
    // A body cut at the byte cap keeps its complete objects.
    const cut = fx('crtsh.json').slice(0, fx('crtsh.json').indexOf('"id": 2'))
    expect(parseCrtShExpiry(cut, 'glot.it')?.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    expect(registrableDomain('app.glot.it')).toBe('glot.it')
    expect(registrableDomain('shop.example.co.jp')).toBe('example.co.jp')
    expect(appleLocale('ja')).toEqual({ country: 'jp', lang: 'ja_jp' })
    expect(appleLocale('en-GB')).toEqual({ country: 'gb', lang: 'en_gb' })
  })
})

describe('store_name_mismatch', () => {
  it('flags an App Store name that differs from the canonical Play title', async () => {
    const r = await probeStoreNames(target(), fetcherOf({ [ITUNES]: res(fx('itunes-lookup.json')), [PLAY]: res(fx('play-listing.html')) }))
    expect(r.state).toBe('finding')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].message).toContain('"glot.it"')
    expect(r.findings[0].message).toContain('glot.it – Learn Thai')
    expect(r.findings[0].fix).toMatch(/next version in review/)
  })

  it('is ok when the names match once dashes and spaces are normalized', async () => {
    const ios = fx('itunes-lookup.json').replace('"trackName": "glot.it"', '"trackName": "glot.it -  Learn Thai"')
    const r = await probeStoreNames(target({ brandName: 'glot.it — Learn Thai' }), fetcherOf({ [ITUNES]: res(ios), [PLAY]: res(fx('play-listing.html')) }))
    expect(r).toMatchObject({ state: 'ok', findings: [] })
  })

  it('flags a brandName that differs from the Play title and a developer name mismatch', async () => {
    const ios = fx('itunes-lookup.json').replace('glot.it"', 'glot.it – Learn Thai"').replace(/"sellerName": "[^"]+"/, '"sellerName": "Kenji Sato"')
    const r = await probeStoreNames(target({ brandName: 'Glot' }), fetcherOf({ [ITUNES]: res(ios), [PLAY]: res(fx('play-listing.html')) }))
    expect(r.findings.map((f) => f.severity).sort()).toEqual(['info', 'warn'])
  })

  it('is unknown — never a mismatch — when a listing cannot be read or nothing is declared', async () => {
    const parseFail = await probeStoreNames(target(), fetcherOf({ [ITUNES]: res('{"oops":'), [PLAY]: res('<html>captcha</html>') }))
    expect(parseFail).toMatchObject({ state: 'unknown', findings: [] })
    const notLive = await probeStoreNames(target(), fetcherOf({ [ITUNES]: res(fx('itunes-lookup-empty.json')), [PLAY]: res('', 404) }))
    expect(notLive.state).toBe('unknown')
    const none = await probeStoreNames(target({ ios: null, android: null }), fetcherOf({}))
    expect(none.state).toBe('unknown')
    const oneStore = await probeStoreNames(target({ android: null }), fetcherOf({ [ITUNES]: res(fx('itunes-lookup.json')) }))
    expect(oneStore.state).toBe('unknown')
  })
})

describe('listing_locale_missing', () => {
  const itunesJa = 'https://itunes.apple.com/lookup?id=6761582648&country=jp&lang=ja_jp'
  const itunesEn = 'https://itunes.apple.com/lookup?id=6761582648&country=us&lang=en_us'
  const playJa = 'https://play.google.com/store/apps/details?id=com.glotit.app&hl=ja'
  const playEn = 'https://play.google.com/store/apps/details?id=com.glotit.app&hl=en-US'

  it('flags a locale whose listing falls back to the primary text, and passes one that has its own', async () => {
    const r = await probeListingLocales(target({ locales: ['en-US', 'ja'] }), fetcherOf({
      [itunesEn]: res(fx('itunes-lookup.json')),
      [itunesJa]: res(fx('itunes-lookup-ja.json')),
      [playEn]: res(fx('play-listing.html')),
      [playJa]: res(fx('play-listing.html')),
    }))
    expect(r.state).toBe('finding')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].message).toContain('Google Play listing has no ja version')
  })

  it('is ok when every locale has its own text', async () => {
    const r = await probeListingLocales(target({ android: null, locales: ['en-US', 'ja'] }), fetcherOf({
      [itunesEn]: res(fx('itunes-lookup.json')),
      [itunesJa]: res(fx('itunes-lookup-ja.json')),
    }))
    expect(r.state).toBe('ok')
  })

  it('is unknown with fewer than two locales, or when a localized listing cannot be fetched', async () => {
    expect((await probeListingLocales(target({ locales: ['en-US'] }), fetcherOf({}))).state).toBe('unknown')
    const r = await probeListingLocales(target({ android: null, locales: ['en-US', 'ja'] }), fetcherOf({ [itunesEn]: res(fx('itunes-lookup.json')), [itunesJa]: new Error('timeout') }))
    expect(r).toMatchObject({ state: 'unknown', findings: [] })
  })
})

describe('domain_expiring', () => {
  const rdap = 'https://rdap.org/domain/glot.it'

  it('warns 18 days out, errors inside a week, and is ok far out', async () => {
    const warn = await probeDomains(target({ domains: ['app.glot.it', 'glot.it'] }), fetcherOf({ [rdap]: res(fx('rdap-domain.json')) }), NOW)
    expect(warn.state).toBe('finding')
    expect(warn.findings).toHaveLength(1)
    expect(warn.findings[0]).toMatchObject({ severity: 'warn', target: 'glot.it' })
    const soon = await probeDomains(target({ domains: ['glot.it'] }), fetcherOf({ [rdap]: res(fx('rdap-domain.json')) }), new Date('2026-10-17T00:00:00Z'))
    expect(soon.findings[0].severity).toBe('error')
    const fine = await probeDomains(target({ domains: ['glot.it'] }), fetcherOf({ [rdap]: res(fx('rdap-domain.json')) }), new Date('2026-01-01T00:00:00Z'))
    expect(fine.state).toBe('ok')
  })

  it('is unknown with no domain, no expiry event, or an unreachable registry', async () => {
    expect((await probeDomains(target(), fetcherOf({}), NOW)).state).toBe('unknown')
    expect((await probeDomains(target({ domains: ['glot.it'] }), fetcherOf({ [rdap]: res('{"events":[]}') }), NOW)).state).toBe('unknown')
    expect((await probeDomains(target({ domains: ['glot.it'] }), fetcherOf({ [rdap]: res('', 503) }), NOW)).state).toBe('unknown')
  })
})

describe('tls_expiring', () => {
  const crt = (h: string) => `https://crt.sh/?q=${h}&output=json&exclude=expired`

  it('flags a certificate expiring within 21 days, labelled as an estimate', async () => {
    const r = await probeTls(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ [crt('glot.it')]: res(fx('crtsh.json')) }), new Date('2026-10-20T00:00:00Z'))
    expect(r.state).toBe('finding')
    expect(r.findings[0].severity).toBe('warn')
    expect(r.findings[0].message).toContain('Estimated from public certificate logs')
  })

  it('is ok far from expiry and unknown when the log has nothing or fails', async () => {
    const ok = await probeTls(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ [crt('glot.it')]: res(fx('crtsh.json')) }), NOW)
    expect(ok.state).toBe('ok')
    expect(ok.reason).toContain('estimated')
    expect((await probeTls(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ [crt('glot.it')]: res('[]') }), NOW)).state).toBe('unknown')
    expect((await probeTls(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ [crt('glot.it')]: new Error('timeout') }), NOW)).state).toBe('unknown')
    expect((await probeTls(target(), fetcherOf({}), NOW)).state).toBe('unknown')
  })
})

describe('security_headers_missing', () => {
  const full = {
    'strict-transport-security': 'max-age=63072000',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  }

  it('is ok with every header and lists what is missing otherwise, at the highest severity', async () => {
    expect(missingSecurityHeaders(new Headers(full))).toEqual([])
    const okR = await probeSecurityHeaders(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ 'https://glot.it/': res('<html></html>', 200, full) }))
    expect(okR.state).toBe('ok')
    const bad = await probeSecurityHeaders(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ 'https://glot.it/': res('<html></html>', 200, { 'x-frame-options': 'DENY' }) }))
    expect(bad.state).toBe('finding')
    expect(bad.findings[0].severity).toBe('warn')
    expect(bad.findings[0].message).toContain('Strict-Transport-Security')
    expect(bad.findings[0].message).not.toContain('frame-ancestors')
  })

  it('is unknown with no site or when the site cannot be reached', async () => {
    expect((await probeSecurityHeaders(target(), fetcherOf({}))).state).toBe('unknown')
    expect((await probeSecurityHeaders(target({ siteUrls: ['https://glot.it/'] }), fetcherOf({ 'https://glot.it/': new Error('ECONNRESET') }))).state).toBe('unknown')
  })
})

describe('review_risk_privacy_url', () => {
  const url = 'https://glot.it/privacy'
  const policy = `<html><body><h1>Privacy Policy</h1><p>${'We collect the minimum data needed to run lessons. '.repeat(10)}</p><script>var x = 1</script></body></html>`

  it('is ok for a real HTML policy page', async () => {
    const r = await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: res(policy, 200, { 'content-type': 'text/html; charset=utf-8' }) }))
    expect(r.state).toBe('ok')
  })

  it('names each failed check: a 404, a JavaScript-only shell, a JSON response, a private host', async () => {
    const notFound = await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: res('Not found', 404, { 'content-type': 'text/html' }) }))
    expect(notFound.findings[0].message).toContain('answered 404')
    const shell = await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: res('<html><body><div id="root"></div><script src="/app.js"></script></body></html>', 200, { 'content-type': 'text/html' }) }))
    expect(shell.findings[0].message).toMatch(/only 0 characters/)
    const json = await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: res('{}', 200, { 'content-type': 'application/json' }) }))
    expect(json.findings[0].message).toContain('not an HTML page')
    const blocked = await probePrivacyUrl(target({ privacyUrl: 'http://glot.it/privacy' }), fetcherOf({ 'http://glot.it/privacy': new Error('outbound-blocked: BAD_SCHEME') }))
    expect(blocked.state).toBe('finding')
  })

  it('accepts a Japanese policy and is unknown when nothing is declared or the page is unreachable', async () => {
    const ja = `<html><body><h1>プライバシーポリシー</h1><p>${'当社はレッスンの提供に必要な最小限のデータのみを収集します。'.repeat(12)}</p></body></html>`
    expect((await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: res(ja, 200, { 'content-type': 'text/html' }) }))).state).toBe('ok')
    const none = await probePrivacyUrl(target(), fetcherOf({}))
    expect(none).toMatchObject({ state: 'unknown', reason: 'No privacy URL declared in mushi.recipe.json store.privacyUrl.' })
    expect((await probePrivacyUrl(target({ privacyUrl: url }), fetcherOf({ [url]: new Error('timeout') }))).state).toBe('unknown')
  })
})

describe('visibleText', () => {
  it('drops script, style and noscript bodies whatever the end tag looks like', () => {
    expect(visibleText('a<script>var x = "hidden"</script >b')).toBe('a b')
    expect(visibleText('a<SCRIPT type="module">hidden</SCRIPT\n>b')).toBe('a b')
    expect(visibleText('a<script>hidden</script foo="bar">b')).toBe('a b')
    expect(visibleText('a<style>p{color:red}</Style>b<noscript>hidden</noscript>c')).toBe('a b c')
    // `</scripts>` is not the end tag; the script runs on to the real one.
    expect(visibleText('a<script>x</scripts>still hidden</script>b')).toBe('a b')
  })

  it('treats an unclosed script as running to the end, and comments as hidden', () => {
    expect(visibleText('shown<script>never shown')).toBe('shown')
    expect(visibleText('a<!-- <script>x</script> hidden -->b')).toBe('a b')
    expect(visibleText('a<!-- never closed')).toBe('a')
  })

  it('strips tags, keeps a bare `<`, and decodes entities only after stripping', () => {
    expect(visibleText('<p class="x">Privacy</p><br/>policy')).toBe('Privacy policy')
    expect(visibleText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2')
    expect(visibleText('&lt;script&gt;text&lt;/script&gt;')).toBe('<script>text</script>')
    expect(visibleText('<scriptx>shown</scriptx>')).toBe('shown')
  })

  it('stays linear on hostile input', () => {
    // A backtracking filter would run for minutes on these; a linear scan
    // takes milliseconds. The 3 s ceiling leaves a slow CI runner room.
    const inputs = [
      '<script>'.repeat(50_000),
      '</script'.repeat(50_000),
      '<a'.repeat(100_000),
      `<script>${'</'.repeat(100_000)}`,
      '<!--'.repeat(50_000),
    ]
    for (const html of inputs) {
      const started = performance.now()
      visibleText(html)
      expect(performance.now() - started).toBeLessThan(3_000)
    }
  }, 60_000)
})

describe('runPublicProbes', () => {
  it('returns one result per public-probe rule, in order, and never rejects', async () => {
    const results = await runPublicProbes(target({ ios: null, android: null }), fetcherOf({}), NOW)
    expect(results.map((r) => r.ruleId)).toEqual([...PUBLIC_PROBE_RULES])
    expect(results.every((r) => r.state === 'unknown')).toBe(true)
  })

  it('turns a probe that throws into unknown for that rule only', async () => {
    const throwing = (async () => { throw new Error('boom') }) as ProbeFetcher
    const t = target({ domains: ['glot.it'], siteUrls: ['https://glot.it/'], privacyUrl: 'https://glot.it/privacy', locales: ['en-US', 'ja'] })
    const results = await runPublicProbes(t, throwing, NOW)
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.state === 'unknown' && r.findings.length === 0)).toBe(true)
  })
})

describe('decodeEntities', () => {
  it('decodes valid numeric entities and keeps out-of-range ones as written instead of throwing', () => {
    expect(decodeEntities('A&#66;&#x43;')).toBe('ABC')
    expect(decodeEntities('x&#99999999;y&#x110000;z')).toBe('x&#99999999;y&#x110000;z')
  })
})
