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
 *              are never requested, nor are other origins;
 *            - Firecrawl is asked for markdown + links only, no PDF parsing,
 *              at most 4 pages (4 credits);
 *            - a Firecrawl answer that landed on a private address is dropped.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  isSensitivePath,
  pageFindings,
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
    expect(readHtmlMeta(GOOD_HTML)).toEqual({ title: 'Acme & Co', description: 'Invoices that send themselves.', language: 'en' })
  })
  it('returns nulls for a bare page', () => {
    expect(readHtmlMeta(BARE_HTML)).toEqual({ title: null, description: null, language: null })
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

/** A small public site: home links to 4 pages (one 404, one sign-in), one script with a source map. */
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
          links: path === '/' ? ['https://acme.app/pricing', 'https://acme.app/missing', 'https://acme.app/broken-app', 'https://acme.app/login', 'https://elsewhere.test/'] : [],
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
    if (url === 'https://acme.app/missing') return new Response(null, { status: 404 })
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
    expect(result.findings.find((f) => f.rule === 'broken_links')?.where).toEqual(['/missing (404)'])
    expect(result.findings.find((f) => f.rule === 'source_maps_published')?.where).toEqual(['/assets/app.js'])
    expect(result.summary).toMatchObject({ https: 'ok', scriptsChecked: 1, scriptsWithSourceMaps: 1, rendered: true })

    // Firecrawl: home + 3 pages, markdown + links only, no PDF parsing.
    expect(site.firecrawlBodies).toHaveLength(4)
    for (const b of site.firecrawlBodies) {
      expect(b.formats).toEqual(['markdown', 'links'])
      expect(b.parsers).toEqual([])
    }
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
