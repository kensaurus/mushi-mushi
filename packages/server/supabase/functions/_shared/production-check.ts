/**
 * FILE: packages/server/supabase/functions/_shared/production-check.ts
 * PURPOSE: The free Production Check (docs/plan-gtm-november-2026.md §4): what
 *          a stranger's live site shows its first visitors, from public pages
 *          only.
 *
 *          - Firecrawl `/v2/scrape` (markdown + links, basic formats only, no
 *            PDF parsing: 1 credit a page) of the home page and up to 3
 *            same-origin pages linked from it: pages that answer 4xx/5xx,
 *            error screens (`errorPageReason`, shared with the Home
 *            thumbnail), a missing title, description or language.
 *          - One plain fetch of the home page (never Firecrawl): HTTPS and the
 *            http -> https redirect, four security headers, and whether the
 *            first 3 same-origin scripts point at source maps (presence only;
 *            a .map file is never requested).
 *          - Up to 20 same-origin links from the home page, HEAD then GET,
 *            5 s each: 404/410/5xx or no answer at all.
 *
 *          Never logs in, posts a form or follows a sign-in, account, admin or
 *          API link: those paths are skipped (`isSensitivePath`). Every
 *          request goes through `guardedFetch` (public addresses only, each
 *          redirect re-checked). The whole check stops at 25 s and reports
 *          what finished.
 *
 * No Deno globals; fetch and DNS are injected.
 */

import { errorPageReason } from './home-thumbnail.ts'
import { BlockedUrlError, checkPublicUrl, guardedFetch, type DnsResolver } from './public-url-guard.ts'

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  rule: string
  severity: Severity
  title: string
  why: string
  fix: string
  /** Paths (or path + status) the finding is about, at most 20. */
  where?: string[]
}

export interface PageResult {
  url: string
  statusCode: number | null
  title: string | null
  description: string | null
  language: string | null
  markdown: string
  links: string[]
  /** Set when the page could not be read at all. */
  error?: string
}

export interface CheckSummary {
  pages: Array<{ path: string; status: number | null; error?: string }>
  headers: Record<string, boolean>
  https: 'ok' | 'not_redirected' | 'no_https' | 'unknown'
  linksChecked: number
  scriptsChecked: number
  scriptsWithSourceMaps: number
  /** Firecrawl rendered the home page (false: the report rests on the plain fetch). */
  rendered: boolean
  /** Parts that did not finish inside the deadline or could not run. */
  incomplete: string[]
}

export interface CheckResult {
  findings: Finding[]
  summary: CheckSummary
}

export const CHECK_DEADLINE_MS = 25_000
export const MAX_SUBPAGES = 3
export const MAX_LINKS = 20
export const MAX_SCRIPTS = 3
const LINK_TIMEOUT_MS = 5_000
const HTML_CAP_BYTES = 1_500_000
const SCRIPT_CAP_BYTES = 8_000_000
const USER_AGENT = 'MushiProductionCheck/1.0 (+https://kensaur.us/mushi-mushi/docs/check)'

export const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
] as const

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Sign-in, account, admin, API and checkout paths are never requested. */
export function isSensitivePath(url: URL): boolean {
  if (/(^|\/)(log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|auth|oauth2?|sso|session|account|admin|dashboard|api|graphql|wp-admin|wp-login\.php|cart|checkout|billing|password|reset)(\/|$|\.)/i.test(url.pathname)) {
    return true
  }
  return /(^|&)(token|key|code|session|password|secret|auth)[^=]*=/i.test(url.search.slice(1))
}

const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|webm|mp3|wav|woff2?|ttf|otf|css|js|mjs|map|json|xml|txt|rss|atom)$/i

/** Same-origin page links, deduped, without hashes, sensitive paths or files. */
export function samePageLinks(links: readonly string[], base: string, origins: ReadonlySet<string>): URL[] {
  const seen = new Set<string>()
  const out: URL[] = []
  for (const raw of links) {
    let u: URL
    try {
      u = new URL(raw, base)
    } catch {
      continue
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
    if (!origins.has(u.origin)) continue
    u.hash = ''
    if (ASSET_EXT.test(u.pathname) || isSensitivePath(u)) continue
    if (seen.has(u.href)) continue
    seen.add(u.href)
    out.push(u)
  }
  return out
}

/** Up to `max` sub-pages, preferring different first path segments. */
export function pickSubpages(candidates: readonly URL[], home: string, max = MAX_SUBPAGES): URL[] {
  const homeKey = normalizePath(new URL(home))
  const picked: URL[] = []
  const sections = new Set<string>()
  const rest: URL[] = []
  for (const u of candidates) {
    if (normalizePath(u) === homeKey) continue
    const section = u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (!sections.has(section)) {
      sections.add(section)
      picked.push(u)
    } else {
      rest.push(u)
    }
  }
  return [...picked, ...rest].slice(0, max)
}

function normalizePath(u: URL): string {
  return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

/** @internal Exported for tests only. `&amp;` last, so "&amp;lt;" reads "&lt;", never "<". */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/** Title, meta description and <html lang> from raw HTML. */
export function readHtmlMeta(html: string): { title: string | null; description: string | null; language: string | null } {
  const head = html.slice(0, 200_000)
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  let description: string | null = null
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\bname\s*=\s*["']?description["']?/i.test(tag)) {
      description = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find((v) => v !== undefined) ?? null
      break
    }
  }
  const language = /<html\b[^>]*\blang\s*=\s*["']?([A-Za-z0-9-]+)/i.exec(head)?.[1] ?? null
  const clean = (v: string | null | undefined) => (v && decodeEntities(v) ? decodeEntities(v) : null)
  return { title: clean(title), description: clean(description), language: clean(language) }
}

/** `<script src>` values from raw HTML, in order. */
export function readScriptSrcs(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) {
    out.push(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''))
  }
  return out.filter(Boolean)
}

/** `<a href>` values from raw HTML (fallback when Firecrawl could not read the page). */
export function readAnchorHrefs(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    out.push(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''))
  }
  return out.filter(Boolean)
}

/** A script body refers to a source map (`//# sourceMappingURL=`, or the old `//@`). */
export const SOURCE_MAP_COMMENT = /\/[/*][#@]\s*sourceMappingURL\s*=/

// ── Findings ────────────────────────────────────────────────────────────────

function list(items: string[]): string[] {
  return items.slice(0, 20)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Status codes, error screens and page metadata of the scraped pages. */
export function pageFindings(pages: readonly PageResult[]): Finding[] {
  const out: Finding[] = []
  const errorStatus = pages.filter((p) => typeof p.statusCode === 'number' && p.statusCode >= 400)
  if (errorStatus.length) {
    out.push({
      rule: 'page_error_status',
      severity: 'high',
      title: `${plural(errorStatus.length, 'page answers', 'pages answer')} with an error code`,
      why: 'Visitors and search engines get an error instead of your app.',
      fix: 'Open the page yourself. A 404 means the link or route is wrong; a 5xx means the server crashed, so read your host\'s logs for that time.',
      where: list(errorStatus.map((p) => `${pathOf(p.url)} (${p.statusCode})`)),
    })
  }
  const screens = pages.filter((p) => !(typeof p.statusCode === 'number' && p.statusCode >= 400) && errorPageReason(undefined, p.markdown))
  if (screens.length) {
    out.push({
      rule: 'error_screen',
      severity: 'high',
      title: `${plural(screens.length, 'page shows', 'pages show')} an error screen`,
      why: 'The server said everything is fine, but visitors see an error message where your app should be.',
      fix: 'Open the page in a private window with the browser console open. It is usually a missing environment variable or an API call that failed during start-up.',
      where: list(screens.map((p) => pathOf(p.url))),
    })
  }
  const readable = pages.filter((p) => !p.error && !(typeof p.statusCode === 'number' && p.statusCode >= 400))
  const noTitle = readable.filter((p) => !p.title)
  if (noTitle.length) {
    out.push({
      rule: 'missing_title',
      severity: 'medium',
      title: `${plural(noTitle.length, 'page has', 'pages have')} no title`,
      why: 'The title is the name on the browser tab and the blue link in search results. Without it, people see your address instead.',
      fix: 'Add a <title> to each page (in Next.js: `export const metadata = { title: \'…\' }`).',
      where: list(noTitle.map((p) => pathOf(p.url))),
    })
  }
  const noDescription = readable.filter((p) => !p.description)
  if (noDescription.length) {
    out.push({
      rule: 'missing_description',
      severity: 'low',
      title: `${plural(noDescription.length, 'page has', 'pages have')} no description`,
      why: 'Search engines and link previews show the description under your title. Without one they pick a random sentence.',
      fix: 'Add <meta name="description" content="…"> with one plain sentence about the page.',
      where: list(noDescription.map((p) => pathOf(p.url))),
    })
  }
  const noLang = readable.filter((p) => !p.language)
  if (noLang.length) {
    out.push({
      rule: 'missing_lang',
      severity: 'low',
      title: `${plural(noLang.length, 'page does', 'pages do')} not say its language`,
      why: 'Screen readers and translation tools guess the language and can read your page out with the wrong voice.',
      fix: 'Set it once on the root element: <html lang="en">.',
      where: list(noLang.map((p) => pathOf(p.url))),
    })
  }
  return out
}

/** HTTPS and the four security headers of the home page response. */
export function transportFindings(https: CheckSummary['https'], headers: Record<string, boolean>): Finding[] {
  const out: Finding[] = []
  if (https === 'no_https') {
    out.push({
      rule: 'no_https',
      severity: 'high',
      title: 'Your site does not load over HTTPS',
      why: 'Browsers mark the site "Not secure", and anything typed into it (passwords, emails) can be read on the way.',
      fix: 'Turn on HTTPS at your host or domain provider; Vercel, Netlify and Cloudflare do it for free.',
    })
  } else if (https === 'not_redirected') {
    out.push({
      rule: 'http_not_redirected',
      severity: 'medium',
      title: 'http:// does not send visitors to https://',
      why: 'Someone who types your address without https gets the unencrypted version.',
      fix: 'Turn on "Always use HTTPS" or "Force HTTPS" at your host.',
    })
  }
  if (https !== 'no_https') {
    if (headers['content-security-policy'] === false) {
      out.push({
        rule: 'missing_csp',
        severity: 'medium',
        title: 'No Content-Security-Policy header',
        why: 'If someone gets a script into your page (a comment, a profile name), the browser runs it. A CSP tells the browser which scripts are yours.',
        fix: 'Start with `Content-Security-Policy: default-src \'self\'` in your host\'s headers file, then allow the domains your app really loads from.',
      })
    }
    if (headers['strict-transport-security'] === false) {
      out.push({
        rule: 'missing_hsts',
        severity: 'medium',
        title: 'No Strict-Transport-Security header',
        why: 'Without it, a visitor on public Wi-Fi can be pushed onto an unencrypted copy of your site before the redirect happens.',
        fix: 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` from your host.',
      })
    }
    if (headers['x-content-type-options'] === false) {
      out.push({
        rule: 'missing_nosniff',
        severity: 'low',
        title: 'No X-Content-Type-Options header',
        why: 'Browsers may guess a file\'s type, so an uploaded file can end up running as a script.',
        fix: 'Send `X-Content-Type-Options: nosniff` on every response.',
      })
    }
    if (headers['referrer-policy'] === false) {
      out.push({
        rule: 'missing_referrer_policy',
        severity: 'low',
        title: 'No Referrer-Policy header',
        why: 'Full page addresses (with ids or search terms in them) are sent to every site you link to.',
        fix: 'Send `Referrer-Policy: strict-origin-when-cross-origin`.',
      })
    }
  }
  return out
}

export function brokenLinkFinding(broken: Array<{ url: string; status: number | null }>): Finding | null {
  if (!broken.length) return null
  return {
    rule: 'broken_links',
    severity: 'medium',
    title: `${plural(broken.length, 'link', 'links')} on your home page ${broken.length === 1 ? 'goes' : 'go'} nowhere`,
    why: 'Visitors click and land on an error page, and search engines count every dead link against you.',
    fix: 'Fix or remove each link below. If a page moved, redirect the old address to the new one.',
    where: list(broken.map((b) => `${pathOf(b.url)} (${b.status ?? 'no answer'})`)),
  }
}

export function sourceMapFinding(scripts: string[]): Finding | null {
  if (!scripts.length) return null
  return {
    rule: 'source_maps_published',
    severity: 'medium',
    title: 'Your scripts point to source maps',
    why: 'A source map turns your bundled JavaScript back into your original code, comments and all. If the .map files are public, anyone can read it, including any key you left in the frontend.',
    fix: 'Turn off production source maps (Vite: `build.sourcemap: false`; Next.js: `productionBrowserSourceMaps: false`), or upload them to your error tracker and delete them from the deploy.',
    where: list(scripts.map(pathOf)),
  }
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// ── Network ─────────────────────────────────────────────────────────────────

export interface CheckDeps {
  firecrawlKey: string
  fetchImpl?: typeof fetch
  resolver?: DnsResolver | null
  now?: () => number
  deadlineMs?: number
}

function within(deadline: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([deadline, AbortSignal.timeout(ms)])
}

function firstString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v)) return firstString(v.find((x) => typeof x === 'string'))
  return null
}

/** One Firecrawl scrape: 1 credit (markdown + links, no PDF parsing). */
export async function scrapePage(url: string, deps: CheckDeps, signal: AbortSignal, timeoutMs: number): Promise<PageResult> {
  const res = await (deps.fetchImpl ?? fetch)('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.firecrawlKey}` },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'links'],
      onlyMainContent: false,
      parsers: [],
      timeout: timeoutMs,
      blockAds: true,
    }),
    signal,
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(res.status === 402 ? 'FIRECRAWL_NO_CREDITS' : `FIRECRAWL_HTTP_${res.status}`)
  }
  const json = (await res.json()) as { data?: { markdown?: string; links?: unknown; metadata?: Record<string, unknown> } }
  const meta = json.data?.metadata ?? {}
  // Where Firecrawl ended up after redirects must still be a public address.
  const landed = firstString(meta.url) ?? firstString(meta.sourceURL) ?? url
  const landedCheck = checkPublicUrl(landed)
  if (!landedCheck.ok) throw new Error('REDIRECTED_TO_PRIVATE')
  const status = typeof meta.statusCode === 'number' ? meta.statusCode : null
  return {
    url: landedCheck.url.href,
    statusCode: status,
    title: firstString(meta.title),
    description: firstString(meta.description) ?? firstString(meta.ogDescription),
    language: firstString(meta.language),
    markdown: typeof json.data?.markdown === 'string' ? json.data.markdown : '',
    links: Array.isArray(json.data?.links) ? (json.data!.links as unknown[]).filter((l): l is string => typeof l === 'string') : [],
  }
}

async function readCappedText(res: Response, cap: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < cap) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => {})
  const buf = new Uint8Array(Math.min(total, cap))
  let off = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.byteLength - off)
    buf.set(c.subarray(0, take), off)
    off += take
    if (off >= buf.byteLength) break
  }
  return new TextDecoder().decode(buf)
}

/** Streams a script and stops at the first source-map comment or the cap. */
async function scriptHasSourceMap(res: Response): Promise<boolean> {
  if (res.headers.get('sourcemap') || res.headers.get('x-sourcemap')) {
    await res.body?.cancel().catch(() => {})
    return true
  }
  if (!res.body) return false
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let carry = ''
  let total = 0
  try {
    while (total < SCRIPT_CAP_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      const text = carry + decoder.decode(value, { stream: true })
      if (SOURCE_MAP_COMMENT.test(text)) return true
      carry = text.slice(-40)
    }
    return false
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function checkLink(url: string, deps: CheckDeps, deadline: AbortSignal): Promise<{ url: string; status: number | null; broken: boolean }> {
  const headers = { 'User-Agent': USER_AGENT }
  try {
    let { response } = await guardedFetch(url, { method: 'HEAD', headers, signal: within(deadline, LINK_TIMEOUT_MS), fetchImpl: deps.fetchImpl, resolver: deps.resolver })
    // Some hosts refuse HEAD; ask again with GET and drop the body.
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      ;({ response } = await guardedFetch(url, { method: 'GET', headers, signal: within(deadline, LINK_TIMEOUT_MS), fetchImpl: deps.fetchImpl, resolver: deps.resolver }))
    }
    await response.body?.cancel().catch(() => {})
    const s = response.status
    return { url, status: s, broken: s === 404 || s === 410 || s >= 500 }
  } catch (err) {
    // A timeout is not proof the link is dead (the whole check is on a clock).
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') return { url, status: null, broken: false }
    if (err instanceof BlockedUrlError) return { url, status: null, broken: false }
    return { url, status: null, broken: true }
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/**
 * Run the whole check on `startUrl` (already through `checkPublicUrl` and the
 * DNS check). Never throws for a site problem: those are findings. Throws
 * only when Firecrawl refuses Mushi's own key, so the caller can say so.
 */
export async function runProductionCheck(startUrl: string, deps: CheckDeps): Promise<CheckResult> {
  const deadlineCtl = new AbortController()
  const timer = setTimeout(() => deadlineCtl.abort(new DOMException('deadline', 'TimeoutError')), deps.deadlineMs ?? CHECK_DEADLINE_MS)
  const deadline = deadlineCtl.signal
  const incomplete: string[] = []
  const start = new URL(startUrl)
  const httpsUrl = new URL(start.href)
  httpsUrl.protocol = 'https:'
  const httpUrl = new URL(`http://${start.host}/`)
  const headers = { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }

  try {
    // 1. In parallel: the plain fetch of the home page, the http probe, and
    //    Firecrawl's render of the home page.
    const [direct, httpProbe, home] = await Promise.allSettled([
      guardedFetch(httpsUrl.href, { headers, signal: within(deadline, 8_000), fetchImpl: deps.fetchImpl, resolver: deps.resolver }).then(async (r) => {
        const isHtml = (r.response.headers.get('content-type') ?? '').includes('html')
        if (!isHtml) await r.response.body?.cancel().catch(() => {})
        return { ...r, html: isHtml ? await readCappedText(r.response, HTML_CAP_BYTES) : '' }
      }),
      guardedFetch(httpUrl.href, { headers, signal: within(deadline, 5_000), fetchImpl: deps.fetchImpl, resolver: deps.resolver }),
      scrapePage(start.href, deps, within(deadline, 15_000), 12_000),
    ])

    if (home.status === 'rejected' && /FIRECRAWL_(HTTP_40[13]|HTTP_429|NO_CREDITS)/.test(String((home.reason as Error)?.message))) {
      throw home.reason
    }

    // HTTPS: the plain https fetch answered, and http:// lands on https://.
    let https: CheckSummary['https'] = 'unknown'
    if (direct.status === 'rejected') {
      const name = (direct.reason as { name?: string })?.name
      const notTheSite = name === 'TimeoutError' || name === 'AbortError' || direct.reason instanceof BlockedUrlError
      https = notTheSite ? 'unknown' : 'no_https'
      if (notTheSite) incomplete.push('the plain fetch of the home page')
    } else if (httpProbe.status === 'fulfilled') {
      await httpProbe.value.response.body?.cancel().catch(() => {})
      https = httpProbe.value.finalUrl.startsWith('https:') ? 'ok' : 'not_redirected'
    } else {
      https = 'ok' // nothing answers on port 80: nobody lands on plain http
    }

    const securityHeaders: Record<string, boolean> = {}
    if (direct.status === 'fulfilled') {
      for (const h of SECURITY_HEADERS) securityHeaders[h] = direct.value.response.headers.has(h)
    }

    const origins = new Set<string>([start.origin, httpsUrl.origin])
    if (direct.status === 'fulfilled') origins.add(new URL(direct.value.finalUrl).origin)

    const pages: PageResult[] = []
    let homeLinks: string[] = []
    const directMeta = direct.status === 'fulfilled' && direct.value.html ? readHtmlMeta(direct.value.html) : null
    if (home.status === 'fulfilled') {
      origins.add(new URL(home.value.url).origin)
      // The plain fetch's HTML is the server's own answer; prefer it for the
      // home page's metadata and keep Firecrawl's when the HTML has none.
      pages.push({
        ...home.value,
        title: directMeta?.title ?? home.value.title,
        description: directMeta?.description ?? home.value.description,
        language: directMeta?.language ?? home.value.language,
      })
      homeLinks = home.value.links
    } else {
      incomplete.push('the rendered home page')
      if (direct.status === 'fulfilled' && directMeta) {
        pages.push({ url: direct.value.finalUrl, statusCode: direct.value.response.status, ...directMeta, markdown: '', links: [] })
      }
    }
    if (!homeLinks.length && direct.status === 'fulfilled') homeLinks = readAnchorHrefs(direct.value.html)
    const homeBase = pages[0]?.url ?? httpsUrl.href

    const candidates = samePageLinks(homeLinks, homeBase, origins)
    const subpages = pickSubpages(candidates, homeBase)
    const linkTargets = candidates.slice(0, MAX_LINKS).map((u) => u.href)

    const scripts =
      direct.status === 'fulfilled'
        ? readScriptSrcs(direct.value.html)
            .map((s) => {
              try {
                return new URL(s, direct.value.finalUrl)
              } catch {
                return null
              }
            })
            .filter((u): u is URL => u !== null && origins.has(u.origin))
            .slice(0, MAX_SCRIPTS)
        : []

    // 2. In parallel: sub-page renders, link checks, script source-map checks.
    const [subResults, linkResults, scriptResults] = await Promise.all([
      Promise.allSettled(subpages.map((u) => scrapePage(u.href, deps, within(deadline, 12_000), 10_000))),
      mapLimit(linkTargets, 5, (u) => checkLink(u, deps, deadline)),
      Promise.allSettled(
        scripts.map(async (u) => {
          const { response } = await guardedFetch(u.href, { headers: { 'User-Agent': USER_AGENT }, signal: within(deadline, 6_000), fetchImpl: deps.fetchImpl, resolver: deps.resolver })
          if (!response.ok) {
            await response.body?.cancel().catch(() => {})
            return null
          }
          return (await scriptHasSourceMap(response)) ? u.href : null
        }),
      ),
    ])

    subResults.forEach((r, i) => {
      if (r.status === 'fulfilled') pages.push(r.value)
      else incomplete.push(`the page ${pathOf(subpages[i].href)}`)
    })
    const withMaps = scriptResults.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
    if (scriptResults.some((r) => r.status === 'rejected')) incomplete.push('the script check')

    const findings = [
      ...pageFindings(pages),
      ...transportFindings(https, securityHeaders),
      brokenLinkFinding(linkResults.filter((l) => l.broken)),
      sourceMapFinding(withMaps),
    ].filter((f): f is Finding => f !== null)

    return {
      findings: sortFindings(findings),
      summary: {
        pages: pages.map((p) => ({ path: pathOf(p.url), status: p.statusCode, ...(p.error ? { error: p.error } : {}) })),
        headers: securityHeaders,
        https,
        linksChecked: linkResults.length,
        scriptsChecked: scripts.length,
        scriptsWithSourceMaps: withMaps.length,
        rendered: home.status === 'fulfilled',
        incomplete,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Counts per severity, for the report email and the product event. */
export function severityCounts(findings: readonly Pick<Finding, 'severity'>[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity]++
  return counts
}
