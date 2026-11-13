/**
 * FILE: packages/server/supabase/functions/_shared/production-check.ts
 * PURPOSE: The free Production Check (docs/plan-gtm-november-2026.md §4): what
 *          a stranger's live site shows its first visitors, from public pages
 *          only.
 *
 *          It leads with what a visitor would see broken (ADR 0056), then
 *          content a visitor reads, then security; `sortFindings` orders them
 *          by severity, then by that kind.
 *
 *          - Firecrawl `/v2/scrape` (markdown + links + rawHtml, basic formats
 *            only, no PDF parsing: 1 credit a page) of the home page and up
 *            to 3 same-origin pages linked from it: pages that answer
 *            4xx/5xx, error screens (`errorPageReason`, shared with the Home
 *            thumbnail), "page not found" screens at HTTP 200, a page that
 *            renders almost no text (a blank app shell; "fix first" only
 *            for the home page, see `isHandoffPage`), the starter
 *            template's title, description or share image ("Lovable App",
 *            "Vite + React"), a missing title, description, share image or
 *            language, and http:// files on an https page (mixed content).
 *            Firecrawl's scrape reports no browser console, so errors on
 *            load are judged only from what the page shows.
 *          - One plain fetch of the home page (never Firecrawl): HTTPS and the
 *            http -> https redirect, four security headers, and whether the
 *            first 3 same-origin scripts point at source maps (presence only;
 *            a .map file is never requested).
 *          - Up to 20 same-origin links from the home page, then up to 10
 *            more from the other pages while time allows, HEAD then GET, 5 s
 *            each: 404/410/5xx or no answer at all (`isBrokenStatus`, shared
 *            with the site audit).
 *          - Up to 10 images the pages load (<img src> and the home page's
 *            og:image), HEAD then GET: 404/410/5xx, no answer, or a web page
 *            served where the picture should be. Images may be on another
 *            origin (a CDN): the visitor's browser loads them from there too.
 *
 *          When no page could be read at all (the plain fetch and the render
 *          both failed), the result says why in `summary.unreachable` and has
 *          no findings: that is a failed check, never an empty pass.
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
import { monitorScrapeBody, untagMonitorUrl } from './monitor-url.ts'
import { BlockedUrlError, checkPublicUrl, guardedFetch, type DnsResolver } from './public-url-guard.ts'
import { htmlImageSrcs, isBrokenStatus, isUnreadableRender } from './site-audit.ts'

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  rule: string
  severity: Severity
  title: string
  why: string
  /** The developer detail: what to change, in a code editor's words. */
  fix: string
  /**
   * One or two sentences to paste into an AI builder (Lovable, Bolt, Cursor,
   * Claude Code), naming the pages from `where`. Every rule sets it; reports
   * stored before 2026-11-12 have none, and readers fall back to `fix`.
   */
  prompt?: string
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
  /** Firecrawl rendered this page in a browser (false or unset: plain fetch only). */
  rendered?: boolean
  /** Firecrawl's own render had no title, description or lang: it did not really read the page. */
  renderUnreadable?: boolean
  /** The rendered HTML (Firecrawl rawHtml, capped), or the plain fetch's HTML when not rendered. */
  html?: string
  /** The server's own HTML for the home page (the plain fetch), when it was rendered too. */
  staticHtml?: string
  ogImage?: string | null
  /** Firecrawl's `metadata.error` for the page. */
  loadError?: string | null
}

/** Why no page of the site could be read at all. */
export type UnreachableReason = 'dns' | 'tls' | 'timeout' | 'refused' | 'blocked' | 'no_answer'

export interface CheckSummary {
  pages: Array<{ path: string; status: number | null; error?: string }>
  headers: Record<string, boolean>
  https: 'ok' | 'not_redirected' | 'no_https' | 'unknown'
  linksChecked: number
  /** Images that answered (or plainly failed); unset on reports stored before images were checked. */
  imagesChecked?: number
  scriptsChecked: number
  scriptsWithSourceMaps: number
  /** Firecrawl rendered the home page (false: the report rests on the plain fetch). */
  rendered: boolean
  /** Parts that did not finish inside the deadline or could not run. */
  incomplete: string[]
  /** Set when no page could be read: the check failed, it did not pass. */
  unreachable?: { reason: UnreachableReason }
}

export interface CheckResult {
  findings: Finding[]
  summary: CheckSummary
}

export const CHECK_DEADLINE_MS = 25_000
export const MAX_SUBPAGES = 3
export const MAX_LINKS = 20
/** Links from the other pages, checked after them while time allows. */
export const MAX_SUBPAGE_LINKS = 10
export const MAX_IMAGES = 10
export const MAX_SCRIPTS = 3
/** Fewer visible characters than this on a rendered page: a blank screen. */
export const BLANK_TEXT_CHARS = 40
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

/**
 * What each rule is about, for the order inside one severity (ADR 0056):
 * what a visitor sees broken first, then what they read, then security.
 */
export type FindingKind = 'breakage' | 'content' | 'security'
export const RULE_KIND: Record<string, FindingKind> = {
  page_error_status: 'breakage',
  error_screen: 'breakage',
  page_not_found_screen: 'breakage',
  blank_page: 'breakage',
  nearly_empty_page: 'breakage',
  broken_links: 'breakage',
  broken_images: 'breakage',
  mixed_content: 'breakage',
  no_https: 'breakage',
  placeholder_metadata: 'content',
  missing_title: 'content',
  missing_share_image: 'content',
  missing_description: 'content',
  missing_lang: 'content',
  source_maps_published: 'security',
  http_not_redirected: 'security',
  missing_csp: 'security',
  missing_hsts: 'security',
  missing_nosniff: 'security',
  missing_referrer_policy: 'security',
}
const KIND_ORDER: Record<FindingKind, number> = { breakage: 0, content: 1, security: 2 }

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

/** Title, meta description, og:image and <html lang> from raw HTML. */
export function readHtmlMeta(html: string): { title: string | null; description: string | null; language: string | null; ogImage: string | null } {
  const head = html.slice(0, 200_000)
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const contentOf = (tag: string) => /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find((v) => v !== undefined) ?? null
  let description: string | null | undefined
  let ogImage: string | null | undefined
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if (description === undefined && /\bname\s*=\s*["']?description["']?/i.test(tag)) description = contentOf(tag)
    // og:image itself, never og:image:width or og:image:alt.
    else if (ogImage === undefined && /\b(?:property|name)\s*=\s*["']?og:image["']?(?=[\s/>])/i.test(tag)) ogImage = contentOf(tag)
    if (description !== undefined && ogImage !== undefined) break
  }
  const language = /<html\b[^>]*\blang\s*=\s*["']?([A-Za-z0-9-]+)/i.exec(head)?.[1] ?? null
  const clean = (v: string | null | undefined) => (v && decodeEntities(v) ? decodeEntities(v) : null)
  return { title: clean(title), description: clean(description), language: clean(language), ogImage: clean(ogImage) }
}

/** The words a visitor would read in a rendered page's markdown: no image or link syntax, no URLs. */
export function visibleText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`|~=\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NOT_FOUND_TEXT = /\b404\b|\bpage (?:was )?not found\b|\bcould not be found\b|\bcouldn['’]t be found\b|\b(?:page|route) (?:does not|doesn['’]t) exist\b/i

/**
 * A short rendered page that says "page not found" (single-page apps answer
 * every path with HTTP 200 and let the router show this). Pages over 400
 * visible characters are not judged: they are content that mentions a 404.
 */
export function notFoundScreen(markdown: string): boolean {
  const text = visibleText(markdown)
  return text.length > 0 && text.length < 400 && NOT_FOUND_TEXT.test(text)
}

/**
 * Starter-template titles and descriptions (Lovable, Bolt, Vite, Create React
 * App, Create Next App, v0, editors' "Document"), compared whole, any case.
 * Lovable's template (checked 2026-11-11) ships description "Lovable
 * Generated Project" and og:image on lovable.dev.
 */
const PLACEHOLDER_TITLE = /^(?:lovable app|lovable generated project|vite \+ (?:react|vue|svelte|preact|lit|solid|qwik)(?: \+ ts)?|vite app|react app|create next app|my bolt app|v0 app|my v0 project|welcome to astro\.?|document|untitled(?: document)?|welcome to nginx!?)$/i
const PLACEHOLDER_DESCRIPTION = /^(?:lovable generated project|generated by create next app|web site created using create-react-app|created with v0)$/i
const PLACEHOLDER_IMAGE_HOST = /(^|\.)lovable\.dev$/i

export function placeholderParts(p: Pick<PageResult, 'title' | 'description' | 'ogImage'>): string[] {
  const out: string[] = []
  if (p.title && PLACEHOLDER_TITLE.test(p.title.trim())) out.push(`title "${p.title.trim().slice(0, 60)}"`)
  if (p.description && PLACEHOLDER_DESCRIPTION.test(p.description.trim())) out.push(`description "${p.description.trim().slice(0, 60)}"`)
  if (p.ogImage) {
    try {
      const u = new URL(p.ogImage)
      if (PLACEHOLDER_IMAGE_HOST.test(u.hostname)) out.push(`share image from ${u.hostname}`)
    } catch {
      // not a URL
    }
  }
  return out
}

/** Tags whose http:// file the browser refuses to load on an https page (scripts, styles, frames). */
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'link'])

/**
 * http:// files an https page loads: `active` (script, stylesheet, frame,
 * object: the browser blocks them) and `passive` (img, audio, video, source,
 * icon: shown with a "Not secure" warning, or upgraded). Links (<a href>) and
 * XML namespaces are not files the page loads.
 */
export function mixedContent(html: string): { active: string[]; passive: string[] } {
  const active = new Set<string>()
  const passive = new Set<string>()
  for (const m of html.matchAll(/<(img|script|iframe|frame|source|video|audio|track|embed|object|link)\b[^>]*>/gi)) {
    const tag = m[1].toLowerCase()
    const text = m[0]
    let isActive = ACTIVE_TAGS.has(tag)
    if (tag === 'link') {
      const rel = /[\s"']rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(text)
      const rels = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? '').toLowerCase().split(/\s+/)
      if (rels.includes('stylesheet')) isActive = true
      else if (rels.includes('icon')) isActive = false
      else continue
    }
    const attr = tag === 'object' ? 'data' : tag === 'link' ? 'href' : 'src'
    const v = new RegExp(`[\\s"']${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(text)
    const url = decodeEntities(v?.[1] ?? v?.[2] ?? v?.[3] ?? '')
    if (!/^http:\/\//i.test(url)) continue
    ;(isActive ? active : passive).add(url.slice(0, 120))
  }
  return { active: [...active], passive: [...passive] }
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

/** "/a", "/a and /b", "/a, /b, /c and 2 more": at most `max` named, for a prompt a person pastes. */
export function namedList(items: readonly string[], max = 5): string {
  const shown = items.slice(0, max)
  const more = items.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more`
  if (shown.length <= 1) return shown[0] ?? ''
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** "The page /open" or "The pages /a and /b", to start a prompt with. */
function thePages(paths: readonly string[]): string {
  return `The ${paths.length === 1 ? 'page' : 'pages'} ${namedList(paths)}`
}

/**
 * Signs that a nearly empty page is empty on purpose: it passes the visitor on
 * (meta refresh, a script that sets the address) or hands off to a phone app
 * (smart app banner, App Links tags, a link with the app's own scheme).
 */
const HANDOFF_MARKERS = [
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
  /<meta\b[^>]*name\s*=\s*["']?(?:apple-itunes-app|google-play-app)\b/i,
  /<meta\b[^>]*property\s*=\s*["']?al:(?:ios|android|web)\b/i,
  /<meta\b[^>]*name\s*=\s*["']?twitter:app:/i,
  /\bhref\s*=\s*["'](?:intent:\/\/|(?!https?:|mailto:|tel:|sms:|javascript:|data:|blob:|about:)[a-z][a-z0-9+.-]{1,30}:\/\/)/i,
  /\blocation\.(?:replace|assign)\s*\(/,
  /\blocation(?:\.href)?\s*=\s*[^=]/,
]

/** The page's HTML shows it redirects or opens a phone app (see HANDOFF_MARKERS). */
export function isHandoffPage(html: string | undefined): boolean {
  if (!html) return false
  const head = html.slice(0, 300_000)
  return HANDOFF_MARKERS.some((re) => re.test(head))
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
      prompt: `${thePages(errorStatus.map((p) => `${pathOf(p.url)} (error ${p.statusCode})`))} on my published site ${errorStatus.length === 1 ? 'answers' : 'answer'} with an error instead of loading. Find out why and fix it. If a link points at a page that does not exist, fix the link or add the page.`,
      where: list(errorStatus.map((p) => `${pathOf(p.url)} (${p.statusCode})`)),
    })
  }
  const answered = pages.filter((p) => !(typeof p.statusCode === 'number' && p.statusCode >= 400))
  const screens = answered.filter((p) => errorPageReason(undefined, p.markdown, { title: p.title, error: p.loadError ?? undefined }))
  if (screens.length) {
    out.push({
      rule: 'error_screen',
      severity: 'high',
      title: `${plural(screens.length, 'page shows', 'pages show')} an error screen`,
      why: 'The server said everything is fine, but visitors see an error message where your app should be.',
      fix: 'Open the page in a private window with the browser console open. It is usually a missing environment variable or an API call that failed during start-up.',
      prompt: `${thePages(screens.map((p) => pathOf(p.url)))} on my published site ${screens.length === 1 ? 'shows' : 'show'} an error message instead of the app. Find the error that stops ${screens.length === 1 ? 'it' : 'them'} loading and fix it. If a setting or key is missing on the published site, tell me which one and where to add it.`,
      where: list(screens.map((p) => pathOf(p.url))),
    })
  }
  const notFound = answered.filter((p) => p.rendered && !screens.includes(p) && notFoundScreen(p.markdown))
  if (notFound.length) {
    out.push({
      rule: 'page_not_found_screen',
      severity: 'high',
      title: `${plural(notFound.length, 'page says', 'pages say')} "page not found"`,
      why: 'Your site links to these pages, but visitors who click land on a "not found" message. The server still answers "OK", so search engines may list the error page as if it were real.',
      fix: 'Fix the link, or add the missing page. In a single-page app (React, Vite, Lovable, Bolt) the router decides this: check the path is listed in your routes, spelled the same way.',
      prompt: `My published site links to ${namedList(notFound.map((p) => pathOf(p.url)))}, but ${notFound.length === 1 ? 'that page says' : 'those pages say'} "page not found". Add the missing ${notFound.length === 1 ? 'page' : 'pages'} to the app's routes, or fix the links that point there.`,
      where: list(notFound.map((p) => pathOf(p.url))),
    })
  }
  // A blank screen is judged only from the browser render: every app shell
  // is empty in the server's HTML. A render with no title, description or
  // lang is a render Firecrawl failed to read (site audit, 2026-10-23).
  const blank = answered.filter(
    (p) => p.rendered && !p.renderUnreadable && !screens.includes(p) && !notFound.includes(p) && visibleText(p.markdown).length < BLANK_TEXT_CHARS,
  )
  // Only the home page is "fix first" (2026-11-12): a nearly empty page deeper
  // in the site is often empty on purpose. An app-link handoff page (/open,
  // with a title and a smart app banner) was reported as a blank screen. With
  // a title and a sign that it passes visitors on (`isHandoffPage`) it is not
  // reported; any other sub-page is "check it is meant to".
  const blankHome = blank.filter((p) => p === pages[0])
  const nearlyEmpty = blank.filter((p) => p !== pages[0] && !(p.title && isHandoffPage(p.html)))
  if (blankHome.length) {
    out.push({
      rule: 'blank_page',
      severity: 'high',
      title: 'Your home page shows almost nothing',
      why: 'We opened the page in a real browser and found almost no words on it, so visitors most likely see a blank or half-loaded screen. In apps built with React or Vite this usually means the JavaScript stopped with an error while starting.',
      fix: 'Open the page in a private window, right-click, choose Inspect, then Console. A red error there is the cause: often a missing environment variable on your host, or a call to an API that failed. Paste that error into your AI tool to fix it.',
      prompt: `${thePages(blankHome.map((p) => pathOf(p.url)))} on my published site shows a blank screen. Find the error that stops it loading and fix it. If a setting or key is missing on the published site, tell me which one and where to add it.`,
      where: list(blankHome.map((p) => pathOf(p.url))),
    })
  }
  if (nearlyEmpty.length) {
    const one = nearlyEmpty.length === 1
    out.push({
      rule: 'nearly_empty_page',
      severity: 'medium',
      title: `${plural(nearlyEmpty.length, 'page shows', 'pages show')} almost nothing: check ${one ? 'it is' : 'they are'} meant to`,
      why: `We opened ${one ? 'this page' : 'these pages'} in a real browser and found almost no words. That is fine for a page that only passes people on, such as a redirect or a link that opens your phone app. For a page people are meant to read, it means they see a blank or half-loaded screen.`,
      fix: 'Open each page in a private window. If it should show content, right-click, choose Inspect, then Console: a red error there is the cause. If it is a redirect or app-link page, nothing needs fixing.',
      prompt: `${thePages(nearlyEmpty.map((p) => pathOf(p.url)))} on my published site ${one ? 'shows' : 'show'} almost nothing. If ${one ? 'it is meant to be a page' : 'they are meant to be pages'} people read, find what stops the content loading and fix it. If ${one ? 'it' : 'one'} only sends people on to another page or to the phone app, leave it as it is and tell me.`,
      where: list(nearlyEmpty.map((p) => pathOf(p.url))),
    })
  }
  const readable = answered.filter((p) => !p.error)
  const placeholders = readable.flatMap((p) => {
    const parts = placeholderParts(p)
    return parts.length ? [{ page: p, parts }] : []
  })
  if (placeholders.length) {
    const titled = placeholders.flatMap((x) => (x.parts[0]?.startsWith('title ') ? [x.page.title!.trim()] : []))
    out.push({
      rule: 'placeholder_metadata',
      severity: 'medium',
      title: titled.length
        ? `Your site is still called "${titled[0].slice(0, 60)}"`
        : 'Your site still uses the starter template\'s description or share image',
      why: 'That is the text the app builder or template filled in. It is the name on the browser tab, the blue link in search results and the card people see when your link is shared, so the app looks unfinished to someone who has never heard of it.',
      fix: 'Change the <title>, <meta name="description"> and og:image in your index.html (Lovable, Bolt and Vite keep them there; in Next.js set `metadata` in app/layout). Or ask your AI tool: "Replace the template title, description and share image in index.html with my app\'s real name, a one-sentence description and my own image."',
      prompt: 'My published site still shows the starter template\'s title, description or share image. Replace them in index.html with my app\'s real name, one sentence about what it does, and my own share image. Ask me for anything you need.',
      where: list(placeholders.map((x) => `${pathOf(x.page.url)} (${x.parts.join(', ')})`)),
    })
  }
  const noTitle = readable.filter((p) => !p.title)
  if (noTitle.length) {
    out.push({
      rule: 'missing_title',
      severity: 'medium',
      title: `${plural(noTitle.length, 'page has', 'pages have')} no title`,
      why: 'The title is the name on the browser tab and the blue link in search results. Without it, people see your address instead.',
      fix: 'Add a <title> to each page (in Next.js: `export const metadata = { title: \'…\' }`).',
      prompt: `${thePages(noTitle.map((p) => pathOf(p.url)))} on my published site ${noTitle.length === 1 ? 'has' : 'have'} no page title. Give ${noTitle.length === 1 ? 'it' : 'each one'} a short title that says what the page is, so it shows on the browser tab and in search results.`,
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
      prompt: `${thePages(noDescription.map((p) => pathOf(p.url)))} on my published site ${noDescription.length === 1 ? 'has' : 'have'} no meta description. Add one plain sentence to ${noDescription.length === 1 ? 'it' : 'each'} that says what the page is for.`,
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
      prompt: 'My published site does not say which language it is written in. Add the lang attribute to the <html> tag, for example lang="en", using the language my pages are really written in.',
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
      prompt: 'My published site does not load over https://. Tell me, step by step, how to turn on HTTPS where this app is hosted.',
    })
  } else if (https === 'not_redirected') {
    out.push({
      rule: 'http_not_redirected',
      severity: 'medium',
      title: 'http:// does not send visitors to https://',
      why: 'Someone who types your address without https gets the unencrypted version.',
      fix: 'Turn on "Always use HTTPS" or "Force HTTPS" at your host.',
      prompt: 'People who open my published site with http:// are not sent on to https://. Make the site redirect them. If that is a setting at my host, tell me where to switch it on.',
    })
  }
  if (https !== 'no_https') {
    if (headers['content-security-policy'] === false) {
      out.push({
        rule: 'missing_csp',
        // Hardening, not something a visitor sees broken (ADR 0056): below breakage.
        severity: 'low',
        title: 'No Content-Security-Policy header',
        why: 'If someone gets a script into your page (a comment, a profile name), the browser runs it. A CSP tells the browser which scripts are yours.',
        fix: 'Start with `Content-Security-Policy: default-src \'self\'` in your host\'s headers file, then allow the domains your app really loads from.',
        prompt: 'Add a Content-Security-Policy header to my published site that allows only the scripts, styles and images the app really loads, and check the app still works. If headers are set at my host, tell me where to add it.',
      })
    }
    if (headers['strict-transport-security'] === false) {
      out.push({
        rule: 'missing_hsts',
        severity: 'low',
        title: 'No Strict-Transport-Security header',
        why: 'Without it, a visitor on public Wi-Fi can be pushed onto an unencrypted copy of your site before the redirect happens.',
        fix: 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` from your host.',
        prompt: 'Make my published site send the header "Strict-Transport-Security: max-age=31536000; includeSubDomains". If headers are set at my host, tell me where to add it.',
      })
    }
    if (headers['x-content-type-options'] === false) {
      out.push({
        rule: 'missing_nosniff',
        severity: 'low',
        title: 'No X-Content-Type-Options header',
        why: 'Browsers may guess a file\'s type, so an uploaded file can end up running as a script.',
        fix: 'Send `X-Content-Type-Options: nosniff` on every response.',
        prompt: 'Make my published site send the header "X-Content-Type-Options: nosniff" on every response. If headers are set at my host, tell me where to add it.',
      })
    }
    if (headers['referrer-policy'] === false) {
      out.push({
        rule: 'missing_referrer_policy',
        severity: 'low',
        title: 'No Referrer-Policy header',
        why: 'Full page addresses (with ids or search terms in them) are sent to every site you link to.',
        fix: 'Send `Referrer-Policy: strict-origin-when-cross-origin`.',
        prompt: 'Make my published site send the header "Referrer-Policy: strict-origin-when-cross-origin". If headers are set at my host, tell me where to add it.',
      })
    }
  }
  return out
}

export function brokenLinkFinding(broken: Array<{ url: string; status: number | null }>): Finding | null {
  if (!broken.length) return null
  return {
    rule: 'broken_links',
    severity: 'high',
    title: `${plural(broken.length, 'link', 'links')} on your site ${broken.length === 1 ? 'goes' : 'go'} nowhere`,
    why: 'Visitors click and land on an error page, and search engines count every dead link against you.',
    fix: 'Fix or remove each link below. If a page moved, redirect the old address to the new one.',
    prompt: `${broken.length === 1 ? 'This link' : 'These links'} on my published site ${broken.length === 1 ? 'leads' : 'lead'} to an error page: ${namedList(broken.map((b) => pathOf(b.url)))}. Fix ${broken.length === 1 ? 'its address' : 'each address'} or remove the link.`,
    where: list(broken.map((b) => `${pathOf(b.url)} (${b.status ?? 'no answer'})`)),
  }
}

/** Same-origin images by path, others by host + path (they live on a CDN). */
function imageLabel(url: string, origins: ReadonlySet<string>): string {
  try {
    const u = new URL(url)
    return origins.has(u.origin) ? pathOf(url) : `${u.host}${u.pathname}`
  } catch {
    return url
  }
}

export function brokenImageFinding(broken: Array<{ url: string; status: number | null; notAnImage?: boolean }>, origins: ReadonlySet<string>): Finding | null {
  if (!broken.length) return null
  return {
    rule: 'broken_images',
    severity: 'high',
    title: `${plural(broken.length, 'image', 'images')} on your site ${broken.length === 1 ? 'does' : 'do'} not load`,
    why: 'Visitors see an empty box or a broken-picture icon where the image should be. If it is your share image, the card people see when your link is shared has no picture.',
    fix: 'Open each address below. A 404 means the file was renamed, moved or never deployed: put it back (in Vite, Lovable and Bolt the public/ folder) or update the address in the page. "A web page, not an image" means the address is wrong and your host answered with your app instead.',
    prompt: `${broken.length === 1 ? 'This image' : 'These images'} on my published site ${broken.length === 1 ? 'does' : 'do'} not load: ${namedList(broken.map((b) => imageLabel(b.url, origins)))}. Put ${broken.length === 1 ? 'the file' : 'each file'} back, or fix its address in the page.`,
    where: list(broken.map((b) => `${imageLabel(b.url, origins)} (${b.notAnImage ? 'a web page, not an image' : b.status ?? 'no answer'})`)),
  }
}

/** The home page names no og:image: shared links show no picture. */
export function shareImageFinding(home: PageResult | undefined): Finding | null {
  if (!home || home.error || (typeof home.statusCode === 'number' && home.statusCode >= 400) || home.ogImage) return null
  return {
    rule: 'missing_share_image',
    severity: 'low',
    title: 'Links to your site show no preview picture',
    why: 'When someone shares your address in iMessage, WhatsApp, Slack or X, the card shows a picture only if the page names one. Without it the link looks bare and fewer people click.',
    fix: 'Add <meta property="og:image" content="https://your-site.com/og.png"> to the page head, pointing at a 1200 x 630 image of your app.',
    prompt: 'Links to my published site show no preview picture. Add a share image (og:image) to the page head: a 1200 x 630 picture of the app. Ask me for the picture if you need one.',
    where: [pathOf(home.url)],
  }
}

/** http:// files on https pages: blocked scripts and styles first. */
export function mixedContentFinding(pages: readonly PageResult[]): Finding | null {
  const active = new Set<string>()
  const passive = new Set<string>()
  for (const p of pages) {
    if (!p.url.startsWith('https:')) continue
    for (const html of [p.html, p.staticHtml]) {
      if (!html) continue
      const m = mixedContent(html)
      m.active.forEach((u) => active.add(u))
      m.passive.forEach((u) => passive.add(u))
    }
  }
  if (!active.size && !passive.size) return null
  return {
    rule: 'mixed_content',
    severity: active.size ? 'high' : 'medium',
    title: active.size
      ? `Your https pages load ${plural(active.size, 'script or style', 'scripts or styles')} over plain http`
      : `Your https pages load ${plural(passive.size, 'file', 'files')} over plain http`,
    why: active.size
      ? 'Browsers refuse to run an http:// script or style on an https page, so the part of your app that needs it does not work or looks broken. Nothing tells the visitor why.'
      : 'Browsers show an http:// image or video on an https page with a "Not secure" warning, or try https and show nothing if that fails.',
    fix: 'Change each address below to https:// (or to a path on your own site). If the file is not available over https, host a copy yourself.',
    prompt: `My published site loads ${active.size + passive.size === 1 ? 'this file' : 'these files'} over http:// instead of https://, so browsers block ${active.size + passive.size === 1 ? 'it' : 'them'} or show a warning: ${namedList([...active, ...passive])}. Change each address to https://, or to a copy kept with the app.`,
    where: list([...active, ...passive]),
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
    prompt: 'My published site ships source maps, so anyone can read my original code. Turn off source maps in the production build.',
    where: list(scripts.map(pathOf)),
  }
}

/** Severity first, then breakage before content before security; stable otherwise. */
export function sortFindings(findings: Finding[]): Finding[] {
  const kind = (f: Finding) => KIND_ORDER[RULE_KIND[f.rule] ?? 'content']
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || kind(a) - kind(b))
}

/** One plain sentence (stored as the check's error, at most 300 characters) and what to try. */
export const UNREACHABLE_TEXT: Record<UnreachableReason, { error: string; tryThis: string; certain: boolean }> = {
  dns: {
    error: 'Your address does not lead to any server: its domain name did not resolve.',
    tryThis: 'Check the spelling first. If it is right, open your domain provider (Namecheap, GoDaddy, Cloudflare, …): make sure the domain has not expired and that it points at your host with the A or CNAME record your host gave you. A domain you just connected can take a few hours to start working.',
    certain: true,
  },
  tls: {
    error: 'Your site answered, but its HTTPS certificate is broken, so browsers show a security warning instead of your app.',
    tryThis: 'Open your host\'s domain settings and re-issue the certificate (Vercel, Netlify and Cloudflare do it for free once the domain points at them). Then open the site in a private window: the warning must be gone.',
    certain: true,
  },
  timeout: {
    error: 'Your site did not answer in time. It may be down, asleep or very slow right now.',
    tryThis: 'Open it yourself in a private window. If it loads slowly, a free-tier host may have been waking it up: run the check again in a minute. If it never loads, read your host\'s status page and the log of your last deploy.',
    certain: false,
  },
  refused: {
    error: 'A server exists at this address, but it refused the connection.',
    tryThis: 'Your host is not serving the site. Check that the last deploy succeeded and that the domain is attached to the right project at your host.',
    certain: true,
  },
  blocked: {
    error: 'This address sent us on to a private or internal address, so we stopped.',
    tryThis: 'Open the address yourself and see where you end up. A redirect to localhost or an internal name is usually a setting left over from development.',
    certain: true,
  },
  no_answer: {
    error: 'Nothing answered at this address.',
    tryThis: 'Open it yourself in a private window. If it works for you, run the check again in a few minutes; if it does not, your host\'s dashboard will show why.',
    certain: false,
  },
}

function errText(e: unknown, depth = 0): string {
  if (e == null || depth > 3) return ''
  const x = e as { name?: unknown; message?: unknown; cause?: unknown }
  const own = typeof x.message === 'string' ? `${typeof x.name === 'string' ? x.name : ''} ${x.message}` : String(e)
  return `${own} ${errText(x.cause, depth + 1)}`
}

/**
 * Why nothing could be read, from the plain fetch's error, Firecrawl's error
 * (its `code`, e.g. SCRAPE_DNS_RESOLUTION_ERROR) and a DNS lookup. With a DNS
 * resolver, `guardedFetch` reports a name that does not exist as a blocked
 * address, so `dnsMissing` is what tells those apart.
 */
export function unreachableReason(signals: { direct?: unknown; render?: unknown; dnsMissing?: boolean }): UnreachableReason {
  const text = `${errText(signals.direct)} ${errText(signals.render)}`
  if (signals.dnsMissing || /SCRAPE_DNS_RESOLUTION_ERROR|dns error|failed to lookup|getaddrinfo|ENOTFOUND|name or service not known|nodename nor servname|NXDOMAIN/i.test(text)) return 'dns'
  if (/SCRAPE_SSL_ERROR|certificate|\bTLS\b|\bSSL\b|handshake/i.test(text)) return 'tls'
  if (/connection refused|ECONNREFUSED|connection reset|ECONNRESET/i.test(text)) return 'refused'
  if (signals.direct instanceof BlockedUrlError) return 'blocked'
  if (/TimeoutError|AbortError|SCRAPE_TIMEOUT|timed? ?out/i.test(text)) return 'timeout'
  return 'no_answer'
}

/** True when DNS says the name has no address at all (NXDOMAIN or no records). */
async function dnsMissing(hostname: string, resolver: DnsResolver | null | undefined): Promise<boolean> {
  if (!resolver) return false
  const timers: ReturnType<typeof setTimeout>[] = []
  const lookup = (type: 'A' | 'AAAA') =>
    Promise.race([resolver(hostname, type), new Promise<never>((_, reject) => timers.push(setTimeout(() => reject(new Error('dns lookup timed out')), 3_000)))])
  const answers = await Promise.allSettled([lookup('A'), lookup('AAAA')])
  timers.forEach(clearTimeout)
  // Same test as public-url-guard's resolvesPublic: NotFound or "no data" means no such name.
  return answers.every((a) =>
    a.status === 'fulfilled'
      ? a.value.length === 0
      : (a.reason as { name?: string })?.name === 'NotFound' || /NXDOMAIN|no data|not found/i.test(String((a.reason as Error)?.message ?? '')),
  )
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

/** Firecrawl formats: all basic (1 credit a page). No json, query, summary or highlights (+4 each). */
export const FIRECRAWL_FORMATS = ['markdown', 'links', 'rawHtml'] as const

/** One Firecrawl scrape: 1 credit (markdown + links + rawHtml, no PDF parsing). */
export async function scrapePage(url: string, deps: CheckDeps, signal: AbortSignal, timeoutMs: number): Promise<PageResult> {
  const res = await (deps.fetchImpl ?? fetch)('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.firecrawlKey}` },
    body: JSON.stringify(
      monitorScrapeBody('audit', {
        url,
        formats: [...FIRECRAWL_FORMATS],
        onlyMainContent: false,
        parsers: [],
        timeout: timeoutMs,
        blockAds: true,
      }),
    ),
    signal,
  })
  if (!res.ok) {
    if (res.status === 402) {
      await res.body?.cancel().catch(() => {})
      throw new Error('FIRECRAWL_NO_CREDITS')
    }
    // Firecrawl names why a page failed (SCRAPE_DNS_RESOLUTION_ERROR,
    // SCRAPE_SSL_ERROR, SCRAPE_TIMEOUT): kept for an unreachable site's reason.
    const body = (await readCappedText(res, 4_000).catch(() => '')) || ''
    const code = /"code"\s*:\s*"([A-Z_]{3,60})"/.exec(body)?.[1] ?? /\b(SCRAPE_[A-Z_]{3,50})\b/.exec(body)?.[1]
    throw new Error(`FIRECRAWL_HTTP_${res.status}${code ? ` ${code}` : ''}`)
  }
  const json = (await res.json()) as { data?: { markdown?: string; links?: unknown; rawHtml?: unknown; metadata?: Record<string, unknown> } }
  const meta = json.data?.metadata ?? {}
  // Where Firecrawl ended up after redirects must still be a public address.
  // It comes back with the mushi_monitor marker; the check reports the bare URL.
  const landed = untagMonitorUrl(firstString(meta.url) ?? firstString(meta.sourceURL) ?? url)
  const landedCheck = checkPublicUrl(landed)
  if (!landedCheck.ok) throw new Error('REDIRECTED_TO_PRIVATE')
  const status = typeof meta.statusCode === 'number' ? meta.statusCode : null
  const title = firstString(meta.title)
  const description = firstString(meta.description) ?? firstString(meta.ogDescription)
  const language = firstString(meta.language)
  return {
    url: landedCheck.url.href,
    statusCode: status,
    title,
    description,
    language,
    markdown: typeof json.data?.markdown === 'string' ? json.data.markdown : '',
    links: Array.isArray(json.data?.links) ? (json.data!.links as unknown[]).filter((l): l is string => typeof l === 'string') : [],
    rendered: true,
    renderUnreadable: isUnreadableRender({ title, description, language }),
    html: typeof json.data?.rawHtml === 'string' ? json.data.rawHtml.slice(0, HTML_CAP_BYTES) : '',
    ogImage: firstString(meta.ogImage) ?? firstString(meta['og:image']),
    loadError: firstString(meta.error),
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

interface Probe {
  url: string
  /** The answer's status; null when nothing answered (or the request was not made). */
  status: number | null
  broken: boolean
  /** An image address that answered with a web page (an SPA's index.html). */
  notAnImage?: boolean
}

/** HEAD (then GET for hosts that refuse HEAD) one link or image; the body is never read. */
async function probe(url: string, deps: CheckDeps, deadline: AbortSignal, image = false): Promise<Probe> {
  const headers = { 'User-Agent': USER_AGENT }
  try {
    let { response } = await guardedFetch(url, { method: 'HEAD', headers, signal: within(deadline, LINK_TIMEOUT_MS), fetchImpl: deps.fetchImpl, resolver: deps.resolver })
    // Some hosts refuse HEAD; ask again with GET and drop the body.
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      ;({ response } = await guardedFetch(url, { method: 'GET', headers, signal: within(deadline, LINK_TIMEOUT_MS), fetchImpl: deps.fetchImpl, resolver: deps.resolver }))
    }
    await response.body?.cancel().catch(() => {})
    const s = response.status
    // A missing image on a single-page-app host comes back as the app's HTML with a 200.
    const notAnImage = image && s >= 200 && s < 300 && /text\/html/i.test(response.headers.get('content-type') ?? '')
    return { url, status: s, broken: isBrokenStatus(s) || notAnImage, ...(notAnImage ? { notAnImage } : {}) }
  } catch (err) {
    // A timeout is not proof the link is dead (the whole check is on a clock).
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') return { url, status: null, broken: false }
    if (err instanceof BlockedUrlError) return { url, status: null, broken: false }
    return { url, status: null, broken: true }
  }
}

/** A probe that got an answer (or plainly failed); timeouts and refused addresses are not "checked". */
function answered(p: Probe): boolean {
  return p.status !== null || p.broken
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

/** http(s) image addresses of the pages (rendered HTML first), then the home page's og:image; deduped. */
function imageAddresses(pages: readonly PageResult[]): string[] {
  const out = new Set<string>()
  for (const p of pages) {
    for (const src of htmlImageSrcs(p.html || p.staticHtml || '', p.url)) if (/^https?:/i.test(src)) out.add(src)
  }
  const og = pages[0]?.ogImage
  if (og) {
    try {
      const u = new URL(og, pages[0].url)
      if (/^https?:$/.test(u.protocol)) out.add(u.href)
    } catch {
      // not a URL
    }
  }
  return [...out]
}

/**
 * Run the whole check on `startUrl` (already through `checkPublicUrl` and the
 * DNS check). Never throws for a site problem: those are findings, or
 * `summary.unreachable` when no page could be read at all. Throws only when
 * Firecrawl refuses Mushi's own key, so the caller can say so.
 */
export async function runProductionCheck(startUrl: string, deps: CheckDeps): Promise<CheckResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const deadlineMs = deps.deadlineMs ?? CHECK_DEADLINE_MS
  const deadlineCtl = new AbortController()
  const timer = setTimeout(() => deadlineCtl.abort(new DOMException('deadline', 'TimeoutError')), deadlineMs)
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
    if (httpProbe.status === 'fulfilled') await httpProbe.value.response.body?.cancel().catch(() => {})

    // HTTPS: the plain https fetch answered, and http:// lands on https://.
    let https: CheckSummary['https'] = 'unknown'
    if (direct.status === 'rejected') {
      const name = (direct.reason as { name?: string })?.name
      const notTheSite = name === 'TimeoutError' || name === 'AbortError' || direct.reason instanceof BlockedUrlError
      https = notTheSite ? 'unknown' : 'no_https'
      if (notTheSite) incomplete.push('the plain fetch of the home page')
    } else if (httpProbe.status === 'fulfilled') {
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
    const directHtml = direct.status === 'fulfilled' ? direct.value.html : ''
    const directMeta = directHtml ? readHtmlMeta(directHtml) : null
    if (home.status === 'fulfilled') {
      origins.add(new URL(home.value.url).origin)
      // The plain fetch's HTML is the server's own answer (what link previews
      // and search engines read); prefer it for the home page's metadata and
      // keep Firecrawl's when the HTML has none.
      pages.push({
        ...home.value,
        title: directMeta?.title ?? home.value.title,
        description: directMeta?.description ?? home.value.description,
        language: directMeta?.language ?? home.value.language,
        ogImage: directMeta?.ogImage ?? home.value.ogImage ?? null,
        staticHtml: directHtml,
      })
      homeLinks = home.value.links
    } else {
      incomplete.push('the rendered home page')
      if (direct.status === 'fulfilled') {
        // Whatever the server answered is a page that was read, HTML or not:
        // its status is the report (a 5xx is a finding, never "nothing found").
        const meta = directMeta ?? { title: null, description: null, language: null, ogImage: null }
        pages.push({ url: direct.value.finalUrl, statusCode: direct.value.response.status, ...meta, markdown: '', links: [], html: directHtml })
      }
    }

    // Nothing could be read at all: a failed check that says why, never an
    // empty pass (2026-11-11: an address that does not resolve read "done").
    if (!pages.length) {
      const reason = unreachableReason({
        direct: direct.status === 'rejected' ? direct.reason : undefined,
        render: home.status === 'rejected' ? home.reason : undefined,
        dnsMissing: await dnsMissing(start.hostname, deps.resolver),
      })
      return {
        findings: [],
        summary: {
          pages: [],
          headers: securityHeaders,
          https,
          linksChecked: 0,
          imagesChecked: 0,
          scriptsChecked: 0,
          scriptsWithSourceMaps: 0,
          rendered: false,
          incomplete,
          unreachable: { reason },
        },
      }
    }

    if (!homeLinks.length && directHtml) homeLinks = readAnchorHrefs(directHtml)
    const homeBase = pages[0].url

    const candidates = samePageLinks(homeLinks, homeBase, origins)
    const subpages = pickSubpages(candidates, homeBase)
    const linkTargets = candidates.slice(0, MAX_LINKS).map((u) => u.href)
    const homeImages = imageAddresses(pages).slice(0, MAX_IMAGES)

    const scripts =
      direct.status === 'fulfilled'
        ? readScriptSrcs(directHtml)
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

    // 2. In parallel: sub-page renders, the home page's links and images, and
    //    script source-map checks.
    const [subResults, linkResults, imageResults, scriptResults] = await Promise.all([
      Promise.allSettled(subpages.map((u) => scrapePage(u.href, deps, within(deadline, 12_000), 10_000))),
      mapLimit(linkTargets, 5, (u) => probe(u, deps, deadline)),
      mapLimit(homeImages, 4, (u) => probe(u, deps, deadline, true)),
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

    // 3. The other pages' own links and images, while the clock allows one
    //    more round (one cap for links, one shared with the home page's images).
    const seenLinks = new Set([...linkTargets, homeBase, ...pages.map((p) => p.url)])
    const moreLinks: string[] = []
    for (const p of pages.slice(1)) {
      for (const u of samePageLinks(p.links, p.url, origins)) {
        if (moreLinks.length >= MAX_SUBPAGE_LINKS) break
        if (!seenLinks.has(u.href)) {
          seenLinks.add(u.href)
          moreLinks.push(u.href)
        }
      }
    }
    const moreImages = imageAddresses(pages).filter((u) => !homeImages.includes(u)).slice(0, Math.max(0, MAX_IMAGES - homeImages.length))
    let moreLinkResults: Probe[] = []
    let moreImageResults: Probe[] = []
    if (moreLinks.length || moreImages.length) {
      if (deadlineMs - (now() - startedAt) > LINK_TIMEOUT_MS + 1_000) {
        ;[moreLinkResults, moreImageResults] = await Promise.all([
          mapLimit(moreLinks, 5, (u) => probe(u, deps, deadline)),
          mapLimit(moreImages, 4, (u) => probe(u, deps, deadline, true)),
        ])
      }
      const unanswered = [...moreLinkResults, ...moreImageResults].filter((p) => !answered(p)).length
      if (moreLinkResults.length + moreImageResults.length === 0 || unanswered > 0) incomplete.push('the links and images on the other pages')
    }
    const links = [...linkResults, ...moreLinkResults]
    const images = [...imageResults, ...moreImageResults]

    const findings = [
      ...pageFindings(pages),
      ...transportFindings(https, securityHeaders),
      brokenLinkFinding(links.filter((l) => l.broken)),
      brokenImageFinding(images.filter((l) => l.broken), origins),
      mixedContentFinding(pages),
      shareImageFinding(pages[0]),
      sourceMapFinding(withMaps),
    ].filter((f): f is Finding => f !== null)

    return {
      findings: sortFindings(findings),
      summary: {
        pages: pages.map((p) => ({ path: pathOf(p.url), status: p.statusCode, ...(p.error ? { error: p.error } : {}) })),
        headers: securityHeaders,
        https,
        linksChecked: links.filter(answered).length,
        imagesChecked: images.filter(answered).length,
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
