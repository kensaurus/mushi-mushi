/**
 * FILE: packages/server/supabase/functions/_shared/site-audit.ts
 * PURPOSE: The site audit's checks (ADR 0040): what one rendered page of an
 *          app's live site gets wrong, which link and image targets to test,
 *          and the one report per rule that a run files.
 *
 *          A manual sweep on 2026-10-23 (689 pages, 8 apps, ~1,350 Firecrawl
 *          credits) found 11 bugs that agents fixed the same hour: dead docs
 *          links, an edit link into a private repo, Japanese titles and nav
 *          on Thai and Chinese pages, links that dropped the visitor's
 *          locale, an English page with a Japanese panel. A model-judged pass
 *          over the same pages (5 credits a page) returned 287 claims and 2
 *          real bugs, so every rule here is deterministic: a fact the page
 *          states, never a judgement (ADR 0039). Every finding quotes its
 *          evidence; the report says how to check it is fixed.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export const SITE_AUDIT_RULES = [
  'broken_internal_link',
  'broken_external_link',
  'broken_image',
  'page_metadata_missing',
  'locale_metadata_mismatch',
  'locale_text_leak',
  'locale_link_drop',
  'image_alt_missing',
] as const
export type SiteAuditRule = (typeof SITE_AUDIT_RULES)[number]

/** One rendered page, as a Firecrawl batch scrape returns it (formats: html, links, markdown). */
export interface AuditPage {
  url: string
  statusCode: number | null
  title: string | null
  description: string | null
  language: string | null
  ogImage: string | null
  html: string | null
  markdown: string | null
  links: string[]
}

export interface PageFinding {
  rule: SiteAuditRule
  page: string
  evidence: string
}

/** Not a page a visitor reads: skipped by the page rules. */
export function isDocumentUrl(url: string): boolean {
  return !/\.(xml|txt|md|json|pdf|png|jpe?g|gif|webp|svg|ico|css|js|map|zip)(\?|#|$)/i.test(url)
}

const SCRIPT = {
  kana: /[぀-ヿ]/g,
  han: /[一-鿿]/g,
  thai: /[฀-๿]/g,
  hangul: /[가-힯]/g,
  latin: /[A-Za-z]/g,
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

/** The locale a URL path says it is in (`/th/…`, `/en`, `/zh-tw/…`), else null. */
export function pathLocale(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)
    for (const s of seg.slice(0, 3)) {
      if (/^(en|ja|th|zh|ko|vi|id|fr|de|es|pt)(-[a-z]{2,4})?$/i.test(s)) return s.toLowerCase().slice(0, 2)
    }
  } catch {
    // not a URL
  }
  return null
}

/**
 * Whether `text` reads as `locale`: the share of letters in that locale's
 * script. Japanese is told apart from Chinese by kana; English by the absence
 * of CJK. A short text (under 12 letters) is not judged.
 */
export function wrongScript(text: string, locale: string): string | null {
  const letters = count(text, /[A-Za-z฀-๿぀-ヿ一-鿿가-힯]/g)
  if (letters < 12) return null
  const kana = count(text, SCRIPT.kana)
  const cjk = kana + count(text, SCRIPT.han)
  if (locale === 'th' && count(text, SCRIPT.thai) === 0 && cjk > 0) return 'Japanese or Chinese, no Thai'
  if ((locale === 'zh' || locale === 'ko' || locale === 'th' || locale === 'vi' || locale === 'en') && kana / letters > 0.05) return 'Japanese (kana)'
  if (locale === 'en' && cjk / letters > 0.2) return 'mostly CJK'
  return null
}

/** Visible strings of the body that are another locale's UI (kana on a th/zh/en/vi/ko page). */
export function leakedStrings(markdown: string, locale: string, max = 6): string[] {
  if (!['th', 'zh', 'en', 'vi', 'ko'].includes(locale)) return []
  const out: string[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!line || line.length > 160) continue
    if (count(line, SCRIPT.kana) >= 2) out.push(line.slice(0, 80))
    if (out.length >= max) break
  }
  return out
}

/** `<img>` tags with no alt attribute that are not hidden from assistive tech. */
export function imagesWithoutAlt(html: string): string[] {
  const out: string[] = []
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (/\balt\s*=/i.test(tag) || /aria-hidden\s*=\s*["']?true/i.test(tag) || /role\s*=\s*["']?(presentation|none)/i.test(tag)) continue
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)/i)?.[1] ?? ''
    out.push(src.split('/').pop()?.slice(0, 60) || '(no src)')
  }
  return out
}

/** Image and og:image URLs a page loads, absolute; data: URIs skipped. */
export function imageTargets(page: AuditPage): string[] {
  const out = new Set<string>()
  const add = (src: string | null | undefined) => {
    if (!src || src.startsWith('data:')) return
    try {
      out.add(new URL(src, page.url).href)
    } catch {
      // unparseable src
    }
  }
  for (const m of (page.html ?? '').matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi)) add(m[1])
  add(page.ogImage)
  return [...out]
}

/**
 * The page rules: metadata, locale and alt text. Links and images are
 * checked separately (they need the network), in `linkFindings`.
 */
/**
 * A render with no title, no description and no lang at all is a page
 * Firecrawl failed to read, not a page missing all three: on 2026-10-23 two
 * mushi-mushi docs pages came back that way and both had all three live.
 */
export function isUnreadableRender(page: AuditPage): boolean {
  return !page.title?.trim() && !page.description?.trim() && !page.language?.trim()
}

export function pageFindings(page: AuditPage, siblings: ReadonlySet<string>): PageFinding[] {
  if (!isDocumentUrl(page.url) || (page.statusCode != null && page.statusCode >= 400) || isUnreadableRender(page)) return []
  const out: PageFinding[] = []
  const missing = [!page.title?.trim() && 'title', !page.description?.trim() && 'meta description', !page.language?.trim() && 'html lang'].filter(Boolean)
  if (missing.length) out.push({ rule: 'page_metadata_missing', page: page.url, evidence: `no ${missing.join(', ')}` })

  const locale = pathLocale(page.url)
  if (locale) {
    for (const [field, text] of [['title', page.title], ['description', page.description]] as const) {
      const wrong = text ? wrongScript(text, locale) : null
      if (wrong) out.push({ rule: 'locale_metadata_mismatch', page: page.url, evidence: `${field} reads as ${wrong}: "${text!.slice(0, 70)}"` })
    }
    const leaked = leakedStrings(page.markdown ?? '', locale)
    if (leaked.length) out.push({ rule: 'locale_text_leak', page: page.url, evidence: leaked.join(' | ') })
    const dropped = droppedLocaleLinks(page, locale, siblings)
    if (dropped.length) out.push({ rule: 'locale_link_drop', page: page.url, evidence: dropped.slice(0, 3).join(', ') })
  }
  const noAlt = imagesWithoutAlt(page.html ?? '')
  if (noAlt.length) out.push({ rule: 'image_alt_missing', page: page.url, evidence: `${noAlt.length} image(s): ${noAlt.slice(0, 3).join(', ')}` })
  return out
}

/**
 * Links on a `/th/…` page that point at the same site's page without the
 * locale when the localized page exists in the crawl (`siblings`).
 */
export function droppedLocaleLinks(page: AuditPage, locale: string, siblings: ReadonlySet<string>): string[] {
  let origin: string
  let localePrefix: string
  try {
    const u = new URL(page.url)
    origin = u.origin
    const segs = u.pathname.split('/')
    const i = segs.findIndex((s) => s.toLowerCase().startsWith(locale))
    localePrefix = segs.slice(0, i).join('/')
  } catch {
    return []
  }
  const out = new Set<string>()
  for (const link of page.links) {
    let u: URL
    try {
      u = new URL(link, page.url)
    } catch {
      continue
    }
    if (u.origin !== origin || pathLocale(u.href)) continue
    const rest = u.pathname.startsWith(localePrefix) ? u.pathname.slice(localePrefix.length) : null
    if (rest == null || rest === '' || rest === '/') continue
    const localized = `${origin}${localePrefix}/${locale}${rest}`.replace(/\/$/, '')
    if (siblings.has(localized)) out.add(u.pathname)
  }
  return [...out]
}

/** Hosts that refuse automated requests: a 4xx from them says nothing. */
const SKIP_HOSTS = /(^|\.)(facebook|instagram|linkedin|x|twitter|tiktok|threads)\.com$|(^|\.)calendar\.google\.com$|(^|\.)line\.me$/i

/** Targets worth testing: http(s), not bot-walled, hash dropped, deduped. */
export function linkTargets(pages: AuditPage[], cap = 2000): Array<{ url: string; pages: string[]; image: boolean }> {
  const map = new Map<string, { pages: Set<string>; image: boolean }>()
  const add = (raw: string, from: string, image: boolean) => {
    let u: URL
    try {
      u = new URL(raw, from)
    } catch {
      return
    }
    if (!/^https?:$/.test(u.protocol) || SKIP_HOSTS.test(u.hostname) || /^(localhost|127\.|0\.0\.0\.0)/.test(u.hostname)) return
    u.hash = ''
    // An in-page anchor (#top) is the page itself, which the crawl already loaded.
    if (u.href === from.split('#')[0]) return
    const e = map.get(u.href) ?? { pages: new Set<string>(), image }
    e.pages.add(from)
    e.image = e.image || image
    map.set(u.href, e)
  }
  for (const p of pages) {
    if (!isDocumentUrl(p.url)) continue
    for (const l of p.links) add(l, p.url, false)
    for (const i of imageTargets(p)) add(i, p.url, true)
  }
  return [...map].slice(0, cap).map(([url, e]) => ({ url, pages: [...e.pages], image: e.image }))
}

/**
 * When the next audit runs after its cadence changes: `cadence_days` after
 * the last run, never in the past. Without it a new cadence only applied
 * after the next run (2026-10-24: eight audits set to every day still waited
 * out the 3-day gap from before). No last run keeps the current schedule.
 */
export function nextRunAfterCadenceChange(a: { lastRunAt: string | null; nextRunAt: string | null; cadenceDays: number; now: Date }): string | null {
  if (!a.lastRunAt) return a.nextRunAt
  const due = Date.parse(a.lastRunAt) + a.cadenceDays * 86_400_000
  return new Date(Math.max(a.now.getTime(), due)).toISOString()
}

/**
 * Whether a target's status means it is broken. Only answers a site gives
 * every visitor count: 404/410/5xx and unreachable (-1). 401/403/405/429 and
 * other 4xx are often bot walls, so they are not findings.
 */
export function isBrokenStatus(status: number): boolean {
  return status === -1 || status === 404 || status === 410 || status >= 500
}

export function linkFindings(
  checked: Array<{ url: string; pages: string[]; image: boolean; status: number }>,
  siteOrigins: ReadonlySet<string>,
): PageFinding[] {
  const out: PageFinding[] = []
  for (const t of checked) {
    if (!isBrokenStatus(t.status)) continue
    let internal = false
    try {
      internal = siteOrigins.has(new URL(t.url).origin)
    } catch {
      // not a URL
    }
    const rule: SiteAuditRule = t.image ? 'broken_image' : internal ? 'broken_internal_link' : 'broken_external_link'
    const label = t.status === -1 ? 'unreachable' : String(t.status)
    for (const page of t.pages.slice(0, 5)) out.push({ rule, page, evidence: `${t.url} (${label})` })
  }
  return out
}

const RULE_TEXT: Record<SiteAuditRule, { title: string; expected: string; done: string; severity: 'medium' | 'low' }> = {
  broken_internal_link: {
    title: 'links to its own pages that are 404 or erroring',
    expected: 'Every link to a page of this site opens that page.',
    done: 'each listed link returns 200 from the page that links it (fix the link or restore the page).',
    severity: 'medium',
  },
  broken_external_link: {
    title: 'links to other sites that are dead (404, 410, 5xx or unreachable)',
    expected: 'Every outbound link goes to a page that exists; dead ones are updated or removed.',
    done: 'each listed target returns 200, or the link is gone.',
    severity: 'low',
  },
  broken_image: {
    title: 'images (or the og:image) that fail to load',
    expected: 'Every image the page shows, and its link-preview image, loads.',
    done: 'each listed image URL returns 200, or the page no longer references it; a missing image falls back gracefully.',
    severity: 'medium',
  },
  page_metadata_missing: {
    title: 'pages with no title, meta description or html lang',
    expected: 'Each page has a <title>, a meta description and <html lang>.',
    done: 'every listed page renders all three.',
    severity: 'low',
  },
  locale_metadata_mismatch: {
    title: 'localized pages whose title or description is in another language',
    expected: "A /th, /zh, /en … page's title and description are in that language (or English as the fallback), never another locale's.",
    done: 'the title and description of each listed page read in its locale, and a test covers one of them.',
    severity: 'medium',
  },
  locale_text_leak: {
    title: "localized pages that show another locale's UI text",
    expected: "A visitor sees UI in the page's language; a missing translation falls back to English, not Japanese.",
    done: 'the listed strings are translated (or fall back to English) on each listed page, and a test fails on kana in one localized render.',
    severity: 'medium',
  },
  locale_link_drop: {
    title: "links that drop the visitor's language",
    expected: 'A link on a localized page goes to the same page in that language when it exists.',
    done: 'every listed link keeps the locale prefix.',
    severity: 'low',
  },
  image_alt_missing: {
    title: 'images without alt text',
    expected: 'Every meaningful image has alt text; decorative ones have alt="" or aria-hidden.',
    done: 'no listed page has an <img> without an alt attribute (axe image-alt passes).',
    severity: 'low',
  },
}

export interface AuditReportDraft {
  rule: SiteAuditRule
  title: string
  description: string
  severity: 'medium' | 'low'
  pages: number
}

/** One report per rule with findings, listing at most `maxRows` rows of evidence. */
export function reportDrafts(findings: PageFinding[], ctx: { appName: string; baseUrl: string; checkedAt: string }, maxRows = 25): AuditReportDraft[] {
  const byRule = new Map<SiteAuditRule, PageFinding[]>()
  for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f])
  const out: AuditReportDraft[] = []
  for (const rule of SITE_AUDIT_RULES) {
    const list = byRule.get(rule)
    if (!list?.length) continue
    const t = RULE_TEXT[rule]
    const pages = new Set(list.map((f) => f.page)).size
    const rows = list.slice(0, maxRows).map((f) => `- ${f.page} — ${f.evidence}`)
    const more = list.length > maxRows ? `\n- …and ${list.length - maxRows} more` : ''
    out.push({
      rule,
      title: `Site audit: ${pages} page${pages === 1 ? '' : 's'} with ${t.title}`,
      severity: t.severity,
      pages,
      description: [
        `Found by Mushi's site audit of ${ctx.baseUrl} (${ctx.appName}) on ${ctx.checkedAt.slice(0, 10)}: a rendered crawl of the live site, checked by deterministic rules.`,
        '',
        'What happens (page — evidence):',
        rows.join('\n') + more,
        '',
        `Expected: ${t.expected}`,
        '',
        `Done when: ${t.done}`,
      ].join('\n'),
    })
  }
  return out
}
