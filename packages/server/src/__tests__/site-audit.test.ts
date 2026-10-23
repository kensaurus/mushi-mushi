/**
 * FILE: site-audit.test.ts
 * PURPOSE: The site audit's deterministic rules (ADR 0040), on the pages the
 *          2026-10-23 sweep verified by hand: Japanese metadata and links on
 *          tsumagoi's /th pages, a Japanese panel on an English page, images
 *          without alt, dead links, and the bot walls that must not count.
 */
import { describe, expect, it } from 'vitest'
import {
  droppedLocaleLinks,
  imagesWithoutAlt,
  isBrokenStatus,
  isDocumentUrl,
  leakedStrings,
  linkFindings,
  linkTargets,
  pageFindings,
  pathLocale,
  reportDrafts,
  wrongScript,
  type AuditPage,
} from '../../supabase/functions/_shared/site-audit.ts'

const page = (over: Partial<AuditPage>): AuditPage => ({
  url: 'https://tsumagoi.kensaur.us/',
  statusCode: 200,
  title: 'Tsumagoi Work&Camp',
  description: 'Camping and coworking in Tsumagoi.',
  language: 'ja',
  ogImage: null,
  html: '<html><body><img src="/a.jpg" alt="Camp"></body></html>',
  markdown: '',
  links: [],
  ...over,
})

describe('locale helpers', () => {
  it('reads the locale from the first path segments', () => {
    expect(pathLocale('https://tsumagoi.kensaur.us/th/events')).toBe('th')
    expect(pathLocale('https://kensaur.us/the-wanting-mind/zh/ch-4')).toBe('zh')
    expect(pathLocale('https://solo-boss.kensaur.us/en')).toBe('en')
    expect(pathLocale('https://tsumagoi.kensaur.us/events/pizza')).toBeNull()
  })

  it('flags text in the wrong script, not short strings or proper nouns', () => {
    expect(wrongScript('イベント｜群馬・嬬恋 標高1,444mの牧場で過ごす夜', 'th')).toBe('Japanese or Chinese, no Thai')
    expect(wrongScript('旅のプランをつくる — 日程と人数から、3つの泊まり方の料金を今すぐ', 'zh')).toBe('Japanese (kana)')
    expect(wrongScript('Nearby attractions & 現代湯治 — Kusatsu, Manza and Shima onsen', 'en')).toBeNull()
    expect(wrongScript('嬬恋', 'th')).toBeNull()
    expect(wrongScript('จองออนไลน์ — แคมป์·นอนในรถ·พาสเวิร์ก', 'th')).toBeNull()
  })

  it('lists kana strings that leaked into a localized body', () => {
    const md = '# ข้อกำหนด\n\n[泊まる](https://x/stay) | [旅のプラン](https://x/plan)\n\nจองที่พัก\n\n料金とキャンセル料は、ご予約時の表示が優先されます。'
    expect(leakedStrings(md, 'th')).toEqual(['泊まる | 旅のプラン', '料金とキャンセル料は、ご予約時の表示が優先されます。'])
    expect(leakedStrings(md, 'ja')).toEqual([])
  })
})

describe('pageFindings', () => {
  it('reports the /th/events page the sweep found: Japanese title and description, links without /th', () => {
    const th = page({
      url: 'https://tsumagoi.kensaur.us/th/events',
      language: 'th',
      title: 'イベント｜群馬・嬬恋 標高1,444mの牧場で過ごす夜',
      description: 'Tsumagoi Work&Campの公開イベント。群馬県嬬恋村・標高1,444mの牧場で、チケット1枚から参加できる夜',
      links: ['https://tsumagoi.kensaur.us/events/pizza-night-trial-2026-10-24', 'https://tsumagoi.kensaur.us/th/rules'],
    })
    const siblings = new Set(['https://tsumagoi.kensaur.us/th/events/pizza-night-trial-2026-10-24'])
    const rules = pageFindings(th, siblings).map((f) => f.rule)
    expect(rules).toEqual(['locale_metadata_mismatch', 'locale_metadata_mismatch', 'locale_link_drop'])
    expect(droppedLocaleLinks(th, 'th', siblings)).toEqual(['/events/pizza-night-trial-2026-10-24'])
  })

  it('reports missing metadata and images without alt, and skips sitemaps, error pages and unreadable renders', () => {
    const bare = page({ title: '', description: null, html: '<img src="/hero.png"><img src="/d.png" aria-hidden="true"><img src="/c.png" alt="">' })
    expect(pageFindings(bare, new Set())).toEqual([
      { rule: 'page_metadata_missing', page: bare.url, evidence: 'no title, meta description' },
      { rule: 'image_alt_missing', page: bare.url, evidence: '1 image(s): hero.png' },
    ])
    // No title, description or lang at all: Firecrawl did not read the page (2026-10-23, two docs pages).
    expect(pageFindings(page({ title: '', description: null, language: null }), new Set())).toEqual([])
    expect(pageFindings(page({ url: 'https://x.dev/sitemap.xml', title: '' }), new Set())).toEqual([])
    expect(pageFindings(page({ statusCode: 503, title: '' }), new Set())).toEqual([])
    expect(isDocumentUrl('https://talk.kensaur.us/notes/fight-starts.md')).toBe(false)
  })

  it('finds alt-less images only', () => {
    expect(imagesWithoutAlt('<img src="a/b/x.webp"><IMG ALT="y" src="z"><img role="presentation" src="p">')).toEqual(['x.webp'])
  })
})

describe('links and images', () => {
  const docs = page({
    url: 'https://kensaur.us/mushi-mushi/docs/admin/research',
    language: 'en',
    links: ['https://firecrawl.dev/privacy', 'https://www.facebook.com/profile.php?id=1', 'http://localhost:6464/', '#top', 'mailto:a@b.c'],
    ogImage: 'https://kensaur.us/mushi-mushi/testers/og-card.png',
    html: '<img src="data:image/png;base64,xx" alt="">',
  })

  it('tests http(s) targets once, without bot-walled hosts, localhost, data: or mailto:', () => {
    const t = linkTargets([docs])
    expect(t.map((x) => x.url)).toEqual(['https://firecrawl.dev/privacy', 'https://kensaur.us/mushi-mushi/testers/og-card.png'])
    expect(t[1].image).toBe(true)
  })

  it('counts only 404/410/5xx/unreachable as broken, and files internal, external and image findings', () => {
    expect([404, 410, 500, 503, -1].every(isBrokenStatus)).toBe(true)
    expect([200, 301, 401, 403, 405, 429].some(isBrokenStatus)).toBe(false)
    const findings = linkFindings(
      [
        { url: 'https://firecrawl.dev/privacy', pages: [docs.url], image: false, status: 404 },
        { url: 'https://kensaur.us/mushi-mushi/testers/og-card.png', pages: ['https://kensaur.us/mushi-mushi/testers/leaderboard'], image: true, status: 404 },
        { url: 'https://solo-boss.kensaur.us/docs/ai-document-generation', pages: ['https://solo-boss.kensaur.us/docs/document-templates'], image: false, status: 404 },
        { url: 'https://github.com/x/private', pages: [docs.url], image: false, status: 403 },
      ],
      new Set(['https://solo-boss.kensaur.us']),
    )
    expect(findings.map((f) => f.rule)).toEqual(['broken_external_link', 'broken_image', 'broken_internal_link'])
  })
})

describe('reportDrafts', () => {
  it('files one report per rule, with evidence rows, expected and done-when', () => {
    const drafts = reportDrafts(
      [
        { rule: 'locale_text_leak', page: 'https://t/th/a', evidence: '泊まる | 旅のプラン' },
        { rule: 'locale_text_leak', page: 'https://t/th/b', evidence: 'おんせん' },
        { rule: 'image_alt_missing', page: 'https://t/', evidence: '1 image(s): hero.png' },
      ],
      { appName: 'tsumagoi', baseUrl: 'https://t', checkedAt: '2026-10-23T03:00:00Z' },
    )
    expect(drafts.map((d) => [d.rule, d.pages, d.severity])).toEqual([
      ['locale_text_leak', 2, 'medium'],
      ['image_alt_missing', 1, 'low'],
    ])
    expect(drafts[0].title).toBe("Site audit: 2 pages with localized pages that show another locale's UI text")
    expect(drafts[0].description).toContain('- https://t/th/a — 泊まる | 旅のプラン')
    expect(drafts[0].description).toContain('Done when:')
  })
})
