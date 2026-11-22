/**
 * FILE: production-check.test.ts
 * PURPOSE: The free Production Check's findings (_shared/production-check.ts)
 *          on fixture HTML and a fixture site:
 *            - title, description and lang are read from raw HTML; a page
 *              without them gets one finding listing the page;
 *            - a 4xx/5xx page and a 200 page that shows an error screen are
 *              told apart (the screen detection is the Home thumbnail's);
 *            - missing security headers, http not redirected to https, and no
 *              HTTPS at all;
 *            - source maps: reported when a same-origin script carries the
 *              comment (or the SourceMap header); the .map is never fetched;
 *            - broken same-origin links; sign-in, account, admin and API links
 *              are never requested, nor are other origins' pages (images the
 *              page loads from a CDN are);
 *            - Firecrawl is asked for basic formats only (markdown, links,
 *              rawHtml), no PDF parsing, at most 4 pages (4 credits);
 *            - a Firecrawl answer that landed on a private address is dropped;
 *            - breakage a visitor sees (ADR 0056): "page not found" screens at
 *              HTTP 200, a blank render, the starter template's title,
 *              description or share image, no share image, broken images (a web
 *              page served at an image address counts), mixed content, and dead
 *              links on the other pages too; sorted before security at the
 *              same severity;
 *            - a site no page of which could be read is `summary.unreachable`
 *              with a reason and no findings, never an empty pass.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  RULE_KIND,
  UNREACHABLE_TEXT,
  brokenImageFinding,
  brokenLinkFinding,
  isHandoffPage,
  namedList,
  sourceMapFinding,
  isSensitivePath,
  mixedContent,
  mixedContentFinding,
  notFoundScreen,
  pageFindings,
  placeholderParts,
  shareImageFinding,
  unreachableReason,
  pickSubpages,
  readHtmlMeta,
  decodeEntities,
  readScriptSrcs,
  runProductionCheck,
  samePageLinks,
  sortFindings,
  transportFindings,
  type PageResult,
} from '../../supabase/functions/_shared/production-check.ts'
import { UNREACHABLE_ADDRESS, checkPublicUrl } from '../../supabase/functions/_shared/public-url-guard.ts'

const GOOD_HTML = `<!doctype html><html lang="en"><head>
<title>Acme &amp; Co</title>
<meta name="description" content="Invoices that send themselves.">
<script src="/assets/app.js"></script>
<script src='https://cdn.other.com/lib.js'></script>
</head><body><a href="/pricing">Pricing</a></body></html>`

const BARE_HTML = `<html><head><meta charset="utf-8"></head><body>hi</body></html>`

function page(p: Partial<PageResult> & { url: string }): PageResult {
  return { statusCode: 200, title: 'T', description: 'D', language: 'en', markdown: 'A long enough normal page body.', links: [], ...p }
}

describe('readHtmlMeta / readScriptSrcs', () => {
  it('reads title, description and lang, decoding entities', () => {
    expect(readHtmlMeta(GOOD_HTML)).toEqual({ title: 'Acme & Co', description: 'Invoices that send themselves.', language: 'en', ogImage: null })
  })
  it('returns nulls for a bare page', () => {
    expect(readHtmlMeta(BARE_HTML)).toEqual({ title: null, description: null, language: null, ogImage: null })
  })
  it('lists script sources in order', () => {
    expect(readScriptSrcs(GOOD_HTML)).toEqual(['/assets/app.js', 'https://cdn.other.com/lib.js'])
  })
})

describe('pageFindings', () => {
  it('separates error codes from error screens, and lists missing metadata', () => {
    const findings = pageFindings([
      page({ url: 'https://acme.app/' }),
      page({ url: 'https://acme.app/pricing', statusCode: 404, title: null }),
      page({ url: 'https://acme.app/app', markdown: 'Application error: a client-side exception has occurred (see the browser console for more information).' }),
      page({ url: 'https://acme.app/about', title: null, description: null, language: null }),
    ])
    const byRule = Object.fromEntries(findings.map((f) => [f.rule, f]))
    expect(byRule.page_error_status).toMatchObject({ severity: 'high', where: ['/pricing (404)'] })
    expect(byRule.error_screen).toMatchObject({ severity: 'high', where: ['/app'] })
    // The 404 page is not also blamed for its missing title.
    expect(byRule.missing_title.where).toEqual(['/about'])
    expect(byRule.missing_description.where).toEqual(['/about'])
    expect(byRule.missing_lang.where).toEqual(['/about'])
    for (const f of findings) {
      expect(f.why.length).toBeGreaterThan(20)
      expect(f.fix.length).toBeGreaterThan(20)
      expect(f.prompt?.length ?? 0).toBeGreaterThan(20)
    }
  })

  it('a long page that merely mentions an error is not an error screen', () => {
    const long = `${'Docs about handling errors. '.repeat(40)} Internal server error means the server crashed.`
    expect(pageFindings([page({ url: 'https://acme.app/docs', markdown: long })])).toEqual([])
  })
})

describe('transportFindings', () => {
  it('names each missing header', () => {
    const rules = transportFindings('ok', {
      'content-security-policy': false,
      'strict-transport-security': true,
      'x-content-type-options': false,
      'referrer-policy': false,
    }).map((f) => f.rule)
    expect(rules).toEqual(['missing_csp', 'missing_nosniff', 'missing_referrer_policy'])
  })
  it('no HTTPS is one high finding; headers are not judged without it', () => {
    const f = transportFindings('no_https', { 'content-security-policy': false })
    expect(f.map((x) => [x.rule, x.severity])).toEqual([['no_https', 'high']])
  })
  it('http not redirected is medium', () => {
    expect(transportFindings('not_redirected', {})[0]).toMatchObject({ rule: 'http_not_redirected', severity: 'medium' })
  })
})

describe('links', () => {
  it('never requests sign-in, account, admin, API or token links', () => {
    for (const p of ['/login', '/sign-up', '/auth/callback', '/account/settings', '/admin', '/api/users', '/logout', '/checkout', '/reset?token=abc', '/p?session_id=1']) {
      expect(isSensitivePath(new URL(`https://acme.app${p}`))).toBe(true)
    }
    for (const p of ['/', '/pricing', '/blog/how-we-built-it', '/docs?page=2']) {
      expect(isSensitivePath(new URL(`https://acme.app${p}`))).toBe(false)
    }
  })

  it('keeps same-origin pages only, without files, hashes or duplicates', () => {
    const links = samePageLinks(
      ['/pricing', '/pricing#faq', 'https://acme.app/blog', 'https://other.test/x', '/logo.png', 'mailto:hi@acme.app', '/login', '/blog'],
      'https://acme.app/',
      new Set(['https://acme.app']),
    )
    expect(links.map((u) => u.href)).toEqual(['https://acme.app/pricing', 'https://acme.app/blog'])
  })

  it('picks sub-pages from different sections first, never the home page', () => {
    const urls = ['/', '/blog/a', '/blog/b', '/pricing', '/docs/x', '/docs/y'].map((p) => new URL(`https://acme.app${p}`))
    expect(pickSubpages(urls, 'https://acme.app/').map((u) => u.pathname)).toEqual(['/blog/a', '/pricing', '/docs/x'])
  })
})

describe('sortFindings', () => {
  it('orders high, medium, low', () => {
    const sorted = sortFindings([
      { rule: 'a', severity: 'low', title: '', why: '', fix: '' },
      { rule: 'b', severity: 'high', title: '', why: '', fix: '' },
      { rule: 'c', severity: 'medium', title: '', why: '', fix: '' },
    ])
    expect(sorted.map((f) => f.severity)).toEqual(['high', 'medium', 'low'])
  })
})

/** The home page as the browser rendered it: three images (one gone, one on a CDN) and an http:// script. */
const HOME_RENDERED = `<html lang="en"><head><title>Acme</title><script src="http://cdn.old-host.com/widget.js"></script></head>
<body><svg xmlns="http://www.w3.org/2000/svg"></svg><a href="http://plain-link.example.com/">a plain link is not mixed content</a>
<img src="/logo.png" alt="Acme"><img src="/gone.png" alt=""><img src="https://images.acme-cdn.com/hero.jpg" alt="Hero"></body></html>`

/**
 * A small public site: home links to 4 pages (one 404, one sign-in), one
 * script with a source map; the rendered home page loads 3 images (one is a
 * web page at 200) and an http:// script; /pricing links to a dead page.
 */
function fixtureSite(opts: { homeHeaders?: Record<string, string>; firecrawlLanding?: string } = {}) {
  const requested: string[] = []
  const firecrawlBodies: Array<Record<string, unknown>> = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://api.firecrawl.dev/v2/scrape') {
      const body = JSON.parse(String(init?.body)) as { url: string }
      firecrawlBodies.push(body)
      const path = new URL(body.url).pathname
      const status = path === '/missing' ? 404 : 200
      const markdown = path === '/broken-app' ? 'Application error: a client-side exception has occurred.' : 'Welcome to Acme. '.repeat(50)
      return Response.json({
        success: true,
        data: {
          markdown,
          rawHtml: path === '/' ? HOME_RENDERED : `<html><body><p>${markdown}</p></body></html>`,
          links:
            path === '/'
              ? ['https://acme.app/pricing', 'https://acme.app/missing', 'https://acme.app/broken-app', 'https://acme.app/login', 'https://elsewhere.test/']
              : path === '/pricing'
                ? ['https://acme.app/pricing/old-plan', 'https://acme.app/missing', 'https://acme.app/admin']
                : [],
          metadata: {
            statusCode: status,
            url: path === '/' && opts.firecrawlLanding ? opts.firecrawlLanding : body.url,
            title: path === '/pricing' ? '' : `Acme ${path}`,
            description: 'Acme page',
            language: 'en',
          },
        },
      })
    }
    requested.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === 'http://acme.app/') return new Response(null, { status: 301, headers: { location: 'https://acme.app/' } })
    if (url === 'https://acme.app/') {
      return new Response(GOOD_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=63072000', ...(opts.homeHeaders ?? {}) },
      })
    }
    if (url === 'https://acme.app/assets/app.js') return new Response('console.log(1)\n//# sourceMappingURL=app.js.map\n', { status: 200 })
    if (url === 'https://acme.app/missing' || url === 'https://acme.app/pricing/old-plan') return new Response(null, { status: 404 })
    if (url === 'https://acme.app/logo.png' || url === 'https://images.acme-cdn.com/hero.jpg') return new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })
    // The host's single-page-app fallback: any unknown path is the app's HTML at 200.
    if (url === 'https://acme.app/gone.png') return new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('ok', { status: 200 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requested, firecrawlBodies }
}

describe('runProductionCheck on a fixture site', () => {
  it('finds what a first visitor would hit, within 4 Firecrawl credits', async () => {
    const site = fixtureSite()
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc-test', fetchImpl: site.fetchImpl, resolver: null })
    const rules = result.findings.map((f) => f.rule)
    expect(rules).toEqual(
      expect.arrayContaining(['page_error_status', 'error_screen', 'missing_title', 'missing_csp', 'missing_nosniff', 'missing_referrer_policy', 'broken_links', 'source_maps_published']),
    )
    expect(rules).not.toContain('missing_hsts')
    expect(rules).not.toContain('http_not_redirected')
    // The home page's dead link, then the one found on /pricing (its admin link is never requested).
    expect(result.findings.find((f) => f.rule === 'broken_links')?.where).toEqual(['/missing (404)', '/pricing/old-plan (404)'])
    expect(result.findings.find((f) => f.rule === 'broken_images')?.where).toEqual(['/gone.png (a web page, not an image)'])
    expect(result.findings.find((f) => f.rule === 'mixed_content')).toMatchObject({ severity: 'high', where: ['http://cdn.old-host.com/widget.js'] })
    expect(result.findings.find((f) => f.rule === 'source_maps_published')?.where).toEqual(['/assets/app.js'])
    expect(result.summary).toMatchObject({ https: 'ok', scriptsChecked: 1, scriptsWithSourceMaps: 1, rendered: true, linksChecked: 4, imagesChecked: 3 })
    expect(result.summary.unreachable).toBeUndefined()
    // Breakage leads; the security headers come last.
    const firstSecurity = rules.findIndex((r) => ['missing_csp', 'missing_nosniff', 'missing_referrer_policy'].includes(r))
    expect(rules.indexOf('broken_images')).toBeLessThan(firstSecurity)
    expect(rules.indexOf('source_maps_published')).toBeGreaterThan(rules.indexOf('broken_links'))

    // Firecrawl: home + 3 pages (4 credits), basic formats only, no PDF parsing.
    expect(site.firecrawlBodies).toHaveLength(4)
    for (const b of site.firecrawlBodies) {
      const formats = b.formats as unknown[]
      expect(formats.every((f) => typeof f === 'string' && ['markdown', 'links', 'rawHtml', 'html'].includes(f))).toBe(true)
      expect(b.parsers).toEqual([])
      // Marked as Mushi's audit traffic (monitor-url.ts) ...
      expect(b.url).toMatch(/\?mushi_monitor=audit&utm_source=mushi-monitor&utm_medium=audit$/)
      expect((b.headers as Record<string, string>)['User-Agent']).toMatch(/MushiSiteWatch\/1\.0/)
    }
    // ... and the marker Firecrawl echoes back never reaches the result.
    expect(JSON.stringify(result)).not.toContain('mushi_monitor')
    // The image on a CDN is requested (the visitor's browser loads it too); /admin never is.
    expect(site.requested).toContain('HEAD https://images.acme-cdn.com/hero.jpg')
    expect(site.requested.some((r) => r.includes('/admin'))).toBe(false)
    // Never the sign-in link, another origin, a .map file, or a POST.
    expect(site.requested.some((r) => r.includes('/login'))).toBe(false)
    expect(site.requested.some((r) => r.includes('elsewhere.test'))).toBe(false)
    expect(site.requested.some((r) => r.includes('.map'))).toBe(false)
    expect(site.requested.some((r) => r.startsWith('POST'))).toBe(false)
    expect(site.requested.some((r) => r.includes('cdn.other.com'))).toBe(false)
  })

  it('a home page Firecrawl reports on a private address is not used', async () => {
    const site = fixtureSite({ firecrawlLanding: 'http://10.0.0.8/' })
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc-test', fetchImpl: site.fetchImpl, resolver: null })
    expect(result.summary.incomplete).toContain('the rendered home page')
    expect(result.summary.rendered).toBe(false)
    expect(result.summary.pages.some((p) => p.path.includes('10.0.0.8'))).toBe(false)
  })

  it('a refused Firecrawl key fails the check instead of reporting a clean site', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://api.firecrawl.dev') ? new Response('no', { status: 402 }) : new Response(GOOD_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    await expect(runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })).rejects.toThrow('FIRECRAWL_NO_CREDITS')
  })

  it('Firecrawl rate-limiting Mushi\'s key fails the check too', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://api.firecrawl.dev') ? new Response('slow down', { status: 429 }) : new Response(GOOD_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    await expect(runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })).rejects.toThrow('FIRECRAWL_HTTP_429')
  })

  it('a Firecrawl server error leaves a report from the plain fetch, marked not rendered', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://api.firecrawl.dev') ? new Response('oops', { status: 500 }) : new Response(GOOD_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })
    expect(result.summary.rendered).toBe(false)
    expect(result.summary.incomplete).toContain('the rendered home page')
    expect(result.findings.map((f) => f.rule)).toContain('missing_csp')
  })
})

describe('decodeEntities', () => {
  it('decodes each entity once: an escaped entity stays escaped (CodeQL js/double-escaping)', () => {
    expect(decodeEntities('Tom &amp;lt;3 Jerry')).toBe('Tom &lt;3 Jerry')
    expect(decodeEntities('A &amp; B &lt;b&gt; &quot;x&quot; it&#39;s')).toBe('A & B <b> "x" it\'s')
  })
})

describe('breakage rules (ADR 0056)', () => {
  const rendered = (p: Partial<PageResult> & { url: string }) => page({ rendered: true, renderUnreadable: false, ...p })

  it('reads og:image, never og:image:width', () => {
    const html = '<head><meta property="og:image:width" content="1200"><meta property="og:image" content="/og.png"></head>'
    expect(readHtmlMeta(html).ogImage).toBe('/og.png')
  })

  it('a short rendered "page not found" at HTTP 200 is a finding; a long page about 404s is not', () => {
    expect(notFoundScreen('# 404\n\nOops! Page not found\n\n[Return to Home](/)')).toBe(true)
    expect(notFoundScreen(`${'How we handle a 404 page not found in our router. '.repeat(20)}`)).toBe(false)
    const f = pageFindings([rendered({ url: 'https://acme.app/' }), rendered({ url: 'https://acme.app/pricing', markdown: '404 Oops! Page not found Return to Home' })])
    expect(f.find((x) => x.rule === 'page_not_found_screen')).toMatchObject({ severity: 'high', where: ['/pricing'] })
  })

  it('a rendered page with almost no words is a blank page; the server HTML alone and an unreadable render are not judged', () => {
    const shell = { markdown: '[](https://acme.app/) ![logo](/logo.svg)' }
    const f = pageFindings([rendered({ url: 'https://acme.app/', ...shell })])
    expect(f.find((x) => x.rule === 'blank_page')).toMatchObject({ severity: 'high', where: ['/'] })
    // Plain fetch only: every app shell is empty there.
    expect(pageFindings([page({ url: 'https://acme.app/', markdown: '' })]).some((x) => x.rule === 'blank_page')).toBe(false)
    // Firecrawl returned no title, description or lang: it did not read the page.
    expect(pageFindings([rendered({ url: 'https://acme.app/', ...shell, renderUnreadable: true })]).some((x) => x.rule === 'blank_page')).toBe(false)
    // An error screen is reported as that, not also as blank.
    const err = pageFindings([rendered({ url: 'https://acme.app/', markdown: 'Internal Server Error' })]).map((x) => x.rule)
    expect(err).toContain('error_screen')
    expect(err).not.toContain('blank_page')
  })

  it.each(['Lovable App', 'Vite + React', 'vite + react + ts', 'React App', 'Create Next App', 'My Bolt app', 'Document'])('"%s" is a placeholder title', (title) => {
    expect(placeholderParts({ title, description: 'Real words.', ogImage: null })).toEqual([`title "${title}"`])
  })

  it("Lovable's template description and share image are placeholders; a real name is not", () => {
    expect(placeholderParts({ title: 'cycle-flow', description: 'Lovable Generated Project', ogImage: 'https://lovable.dev/opengraph-image-p98pqg.png' })).toEqual([
      'description "Lovable Generated Project"',
      'share image from lovable.dev',
    ])
    expect(placeholderParts({ title: 'Acme Invoices', description: 'Invoices that send themselves.', ogImage: 'https://acme.app/og.png' })).toEqual([])
    const f = pageFindings([page({ url: 'https://acme.app/', title: 'Lovable App', description: 'Lovable Generated Project' })]).find((x) => x.rule === 'placeholder_metadata')
    expect(f).toMatchObject({ severity: 'medium', title: 'Your site is still called "Lovable App"', where: ['/ (title "Lovable App", description "Lovable Generated Project")'] })
  })

  it('no share image on the home page is one low finding', () => {
    expect(shareImageFinding(page({ url: 'https://acme.app/' }))).toMatchObject({ rule: 'missing_share_image', severity: 'low' })
    expect(shareImageFinding(page({ url: 'https://acme.app/', ogImage: '/og.png' }))).toBeNull()
    expect(shareImageFinding(page({ url: 'https://acme.app/', statusCode: 500 }))).toBeNull()
  })

  it('mixed content: http:// scripts and styles are blocked (high), images warn (medium); links and namespaces are not files', () => {
    const html = `<link rel="stylesheet" href="http://old.cdn.com/a.css"><link rel="canonical" href="http://acme.app/">
<img src="http://old.cdn.com/a.png" data-src="http://lazy.example.com/b.png"><a href="http://x.com/">x</a><svg xmlns="http://www.w3.org/2000/svg"></svg>`
    expect(mixedContent(html)).toEqual({ active: ['http://old.cdn.com/a.css'], passive: ['http://old.cdn.com/a.png'] })
    expect(mixedContentFinding([page({ url: 'https://acme.app/', html })])).toMatchObject({ severity: 'high' })
    expect(mixedContentFinding([page({ url: 'https://acme.app/', html: '<img src="http://old.cdn.com/a.png">' })])).toMatchObject({ severity: 'medium' })
    // An http page is not "mixed".
    expect(mixedContentFinding([page({ url: 'http://acme.app/', html })])).toBeNull()
  })

  it('every rule has a kind, and breakage sorts before security at the same severity', () => {
    const f = (rule: string, severity: 'high' | 'medium' | 'low') => ({ rule, severity, title: rule, why: '', fix: '' })
    const sorted = sortFindings([f('missing_csp', 'low'), f('source_maps_published', 'medium'), f('missing_description', 'low'), f('mixed_content', 'medium'), f('placeholder_metadata', 'medium'), f('broken_links', 'high')])
    expect(sorted.map((x) => x.rule)).toEqual(['broken_links', 'mixed_content', 'placeholder_metadata', 'source_maps_published', 'missing_description', 'missing_csp'])
    expect(Object.values(RULE_KIND).every((k) => ['breakage', 'content', 'security'].includes(k))).toBe(true)
  })

  it('security headers are ranked below breakage: CSP and HSTS are low now', () => {
    const f = transportFindings('ok', { 'content-security-policy': false, 'strict-transport-security': false, 'x-content-type-options': true, 'referrer-policy': true })
    expect(f.map((x) => [x.rule, x.severity])).toEqual([
      ['missing_csp', 'low'],
      ['missing_hsts', 'low'],
    ])
  })
})

describe('a site no page of which could be read', () => {
  const DNS_ERROR = 'error sending request for url (https://nope.app/): client error (Connect): dns error: failed to lookup address information: Name or service not known'

  it('reads why from the errors', () => {
    expect(unreachableReason({ direct: new TypeError(DNS_ERROR) })).toBe('dns')
    expect(unreachableReason({ render: new Error('FIRECRAWL_HTTP_500 SCRAPE_DNS_RESOLUTION_ERROR') })).toBe('dns')
    expect(unreachableReason({ direct: new TypeError('invalid peer certificate: UnknownIssuer') })).toBe('tls')
    expect(unreachableReason({ direct: new TypeError('tcp connect error: Connection refused (os error 111)') })).toBe('refused')
    expect(unreachableReason({ direct: new DOMException('deadline', 'TimeoutError') })).toBe('timeout')
    expect(unreachableReason({ direct: new Error('something else') })).toBe('no_answer')
    for (const t of Object.values(UNREACHABLE_TEXT)) {
      // Stored in production_checks.error, which holds at most 300 characters.
      expect(t.error.length).toBeLessThanOrEqual(300)
      expect(t.tryThis.length).toBeGreaterThan(40)
    }
  })

  it('an address that does not resolve fails with reason dns and no findings (2026-11-11: it read "done", nothing found)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('https://api.firecrawl.dev')) {
        return Response.json({ success: false, code: 'SCRAPE_DNS_RESOLUTION_ERROR', error: 'DNS resolution failed' }, { status: 500 })
      }
      throw new TypeError(DNS_ERROR)
    })
    const result = await runProductionCheck('https://nope.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })
    expect(result.findings).toEqual([])
    expect(result.summary.pages).toEqual([])
    expect(result.summary.unreachable).toEqual({ reason: 'dns' })
    expect(result.summary.rendered).toBe(false)
  })

  it('with a DNS resolver, a name that does not exist (refused as non-public by the guard) still reads as dns', async () => {
    const resolver = vi.fn(async () => {
      throw Object.assign(new Error('no such host'), { name: 'NotFound' })
    })
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }))
    const result = await runProductionCheck('https://nope.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver })
    expect(result.summary.unreachable).toEqual({ reason: 'dns' })
    // Only Firecrawl was called: the guard refused the site before any request.
    expect(fetchImpl.mock.calls.every(([u]) => String(u).startsWith('https://api.firecrawl.dev'))).toBe(true)
  })

  it('a redirect to a private address reads as blocked', async () => {
    const resolver = vi.fn(async (_h: string, type: 'A' | 'AAAA') => (type === 'A' ? ['93.184.216.34'] : []))
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://api.firecrawl.dev') ? new Response('oops', { status: 500 }) : new Response(null, { status: 302, headers: { location: 'http://10.0.0.8/' } }),
    )
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver })
    expect(result.summary.unreachable).toEqual({ reason: 'blocked' })
  })

  it('a server that answers 503 with no HTML is a page that was read: an error finding, not unreachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith('https://api.firecrawl.dev') ? new Response('oops', { status: 500 }) : new Response('down for maintenance', { status: 503, headers: { 'content-type': 'text/plain' } }),
    )
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })
    expect(result.summary.unreachable).toBeUndefined()
    expect(result.findings.find((f) => f.rule === 'page_error_status')?.where).toEqual(['/ (503)'])
  })

  it('links that time out are not counted as checked', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://api.firecrawl.dev')) return new Response('oops', { status: 500 })
      if (url === 'https://acme.app/') return new Response(GOOD_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
      if (url === 'https://acme.app/pricing') throw new DOMException('slow', 'TimeoutError')
      return new Response('ok', { status: 200 })
    })
    const result = await runProductionCheck('https://acme.app/', { firecrawlKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch, resolver: null })
    expect(result.summary.linksChecked).toBe(0)
    expect(result.findings.some((f) => f.rule === 'broken_links')).toBe(false)
  })
})

describe('prompts for an AI builder, and the blank-page rule (2026-11-12)', () => {
  const rendered = (p: Partial<PageResult> & { url: string }) => page({ rendered: true, renderUnreadable: false, ...p })
  const EMPTY = '[](https://acme.app/) ![logo](/logo.svg)'
  // More than BLANK_TEXT_CHARS visible characters: a page with real words on it.
  const BODY = 'Pair two phones with a short code so your partner can direct the shot, live.'
  // The page that was wrongly reported: kensaur.us/help-her-take-photo/open, an
  // app-link handoff with a title and a smart app banner, and no words.
  const HANDOFF_HTML =
    '<!DOCTYPE html><html lang="en"><head><title>help her take photo – Pose Cam</title><meta name="apple-itunes-app" content="app-id=6762513666"/></head><body><div id="root"></div></body></html>'

  it('every rule hands over a prompt to paste, beside the developer steps', () => {
    const origins = new Set(['https://acme.app'])
    const all = [
      ...pageFindings([
        rendered({ url: 'https://acme.app/', markdown: EMPTY, title: 'Lovable App' }),
        page({ url: 'https://acme.app/pricing', statusCode: 404 }),
        page({ url: 'https://acme.app/app', markdown: 'Application error: a client-side exception has occurred (see the browser console for more information).' }),
        rendered({ url: 'https://acme.app/gone', markdown: '404 Oops! Page not found Return to Home' }),
        rendered({ url: 'https://acme.app/empty', markdown: EMPTY }),
        page({ url: 'https://acme.app/about', title: null, description: null, language: null }),
      ]),
      ...transportFindings('no_https', {}),
      ...transportFindings('not_redirected', { 'content-security-policy': false, 'strict-transport-security': false, 'x-content-type-options': false, 'referrer-policy': false }),
      brokenLinkFinding([{ url: 'https://acme.app/old', status: 404 }]),
      brokenImageFinding([{ url: 'https://acme.app/hero.png', status: 404 }], origins),
      mixedContentFinding([page({ url: 'https://acme.app/', html: '<script src="http://cdn.old.com/a.js"></script>' })]),
      shareImageFinding(page({ url: 'https://acme.app/' })),
      sourceMapFinding(['https://acme.app/assets/app.js']),
    ].filter((f) => f !== null)
    // Every rule the check knows is in this fixture, so none can ship without a prompt.
    expect(new Set(all.map((f) => f.rule))).toEqual(new Set(Object.keys(RULE_KIND)))
    for (const f of all) {
      expect(f.prompt, f.rule).toBeTruthy()
      expect(f.prompt!.length, f.rule).toBeGreaterThan(40)
      expect(f.prompt!.length, f.rule).toBeLessThan(420)
      // Words for a person and their AI builder: no "right-click, Inspect".
      expect(f.prompt, f.rule).not.toMatch(/Inspect|right-click|private window/i)
      expect(f.fix.length, f.rule).toBeGreaterThan(20)
    }
    const by = Object.fromEntries(all.map((f) => [f.rule, f.prompt!]))
    expect(by.blank_page).toBe(
      'The page / on my published site shows a blank screen. Find the error that stops it loading and fix it. If a setting or key is missing on the published site, tell me which one and where to add it.',
    )
    expect(by.page_error_status).toContain('/pricing (error 404)')
    expect(by.error_screen).toContain('The page /app ')
    expect(by.page_not_found_screen).toContain('/gone')
    expect(by.nearly_empty_page).toContain('The page /empty ')
    expect(by.missing_title).toContain('/about')
    expect(by.broken_links).toContain('/old')
    expect(by.broken_images).toContain('/hero.png')
    expect(by.mixed_content).toContain('http://cdn.old.com/a.js')
  })

  it('names at most five places in a prompt, then counts the rest', () => {
    expect(namedList(['/a'])).toBe('/a')
    expect(namedList(['/a', '/b'])).toBe('/a and /b')
    expect(namedList(['/a', '/b', '/c'])).toBe('/a, /b and /c')
    expect(namedList(['/1', '/2', '/3', '/4', '/5', '/6', '/7'])).toBe('/1, /2, /3, /4, /5 and 2 more')
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `https://acme.app/p${i}`, status: 404 }))
    expect(brokenLinkFinding(many)!.prompt).toContain('/p0, /p1, /p2, /p3, /p4 and 4 more')
  })

  it('an app-link or redirect page that is empty on purpose is not reported', () => {
    const home = rendered({ url: 'https://kensaur.us/help-her-take-photo/', markdown: BODY })
    const open = rendered({ url: 'https://kensaur.us/help-her-take-photo/open', markdown: '', title: 'help her take photo – Pose Cam', html: HANDOFF_HTML })
    const rules = pageFindings([home, open]).map((f) => f.rule)
    expect(rules).not.toContain('blank_page')
    expect(rules).not.toContain('nearly_empty_page')
    for (const html of [
      '<meta http-equiv="refresh" content="0; url=/home">',
      '<meta property="al:ios:url" content="acme://open">',
      '<a href="acme://open?code=1">Open the app</a>',
      '<a href="intent://open#Intent;scheme=acme;end">Open</a>',
      '<script>window.location.replace("/home")</script>',
      '<script>location.href = "acme://open"</script>',
    ]) {
      expect(isHandoffPage(html), html).toBe(true)
    }
    for (const html of [
      '<div id="root"></div><script type="module" src="/assets/index.js"></script>',
      '<a href="https://acme.app/pricing">Pricing</a><a href="mailto:hi@acme.app">Mail</a>',
      '<script>if (location.href === "x") {}</script>',
      undefined,
    ]) {
      expect(isHandoffPage(html), String(html)).toBe(false)
    }
  })

  it('an empty sub-page with no such sign is "check it is meant to", never "fix first"; an empty home page still is', () => {
    const home = rendered({ url: 'https://acme.app/', markdown: BODY })
    const shell = '<div id="root"></div><script type="module" src="/assets/index.js"></script>'
    const sub = pageFindings([home, rendered({ url: 'https://acme.app/dashboard-preview', markdown: EMPTY, html: shell })])
    expect(sub.some((f) => f.rule === 'blank_page')).toBe(false)
    expect(sub.find((f) => f.rule === 'nearly_empty_page')).toMatchObject({ severity: 'medium', where: ['/dashboard-preview'] })
    expect(sub.find((f) => f.rule === 'nearly_empty_page')!.title).toBe('1 page shows almost nothing: check it is meant to')
    // A handoff sign without a title is still worth a look.
    const untitled = pageFindings([home, rendered({ url: 'https://acme.app/open', markdown: '', title: null, html: HANDOFF_HTML })])
    expect(untitled.find((f) => f.rule === 'nearly_empty_page')).toMatchObject({ severity: 'medium' })
    // The home page: a handoff sign does not excuse a blank front door.
    const blankHome = pageFindings([rendered({ url: 'https://acme.app/', markdown: EMPTY, html: HANDOFF_HTML }), rendered({ url: 'https://acme.app/x', markdown: EMPTY, html: shell })])
    expect(blankHome.find((f) => f.rule === 'blank_page')).toMatchObject({ severity: 'high', where: ['/'], title: 'Your home page shows almost nothing' })
    expect(blankHome.find((f) => f.rule === 'nearly_empty_page')).toMatchObject({ severity: 'medium', where: ['/x'] })
    expect(RULE_KIND.nearly_empty_page).toBe('breakage')
  })
})

describe('what a person reads when the address cannot be checked', () => {
  const message = (raw: string) => {
    const r = checkPublicUrl(raw)
    return r.ok ? null : r.message
  }

  it('a misspelled or incomplete address gets the "check the spelling" line', () => {
    expect(UNREACHABLE_ADDRESS).toBe(
      "We couldn't reach that address. Check the spelling, or paste the link you share with your users (for example https://my-app.lovable.app).",
    )
    for (const raw of ['myapp', 'my app.com', 'https://my_app', 'http://']) expect(message(raw), raw).toBe(UNREACHABLE_ADDRESS)
  })

  it('a local or private address gets its own true line, and never the rule that refused it', () => {
    for (const raw of ['localhost', 'http://192.168.1.20', 'http://10.0.0.5/app', 'my-mac.local', 'http://[::1]/']) {
      expect(message(raw), raw).toMatch(/^That is a private or local address, so only you can open it\./)
    }
    expect(message('localhost:3000')).toMatch(/port number/)
    expect(message('my-app.com:8080')).toMatch(/port number/)
    for (const raw of ['myapp', 'localhost', 'http://169.254.169.254/', 'localhost:3000', 'http://user:pw@my-app.com']) {
      expect(message(raw), raw).not.toMatch(/DNS|metadata|RFC|169\.254|suffix|loopback|link-local|credential/i)
      expect(message(raw), raw).toContain('https://my-app.lovable.app')
    }
    expect(message('https://my-app.lovable.app')).toBeNull()
  })
})
