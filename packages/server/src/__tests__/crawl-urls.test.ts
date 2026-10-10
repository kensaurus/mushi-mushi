/**
 * FILE: crawl-urls.test.ts
 * PURPOSE: A live crawl scrapes distinct pages. The Firecrawl maps below are
 *          the real ones for two apps (2026-10-10): most links were the same
 *          page in four languages, plus sitemap.xml.
 */
import { describe, expect, it } from 'vitest'
import { pickCrawlUrls } from '../../supabase/functions/_shared/crawl-urls.ts'

const TWM = 'https://kensaur.us/the-wanting-mind'
const twmMap = [
  `${TWM}/ja`, `${TWM}/sitemap.xml`, TWM, `${TWM}/en`, `${TWM}/zh`, `${TWM}/th`,
  `${TWM}/en/preface`, `${TWM}/zh/preface`, `${TWM}/ja/preface`, `${TWM}/th/preface`,
  `${TWM}/en/introduction`, `${TWM}/zh/introduction`, `${TWM}/ja/introduction`, `${TWM}/th/introduction`,
  `${TWM}/en/ch-1`, `${TWM}/zh/ch-1`, `${TWM}/ja/ch-1`, `${TWM}/th/ch-1`,
]

const HHTP = 'https://kensaur.us/help-her-take-photo'
const hhtpMap = [
  `${HHTP}/pair`, `${HHTP}/terms`, `${HHTP}/sitemap.xml`, `${HHTP}/ja`, HHTP, `${HHTP}/privacy`,
  `${HHTP}/th`, `${HHTP}/zh`, `${HHTP}/guides/partner-photos`,
  `${HHTP}/guides/two-phone-camera-remote-apps-2026`, `${HHTP}/guides/couple-travel-photo-ideas`,
  `${HHTP}/privacy.html`,
]

describe('pickCrawlUrls', () => {
  it('keeps one copy of each page, preferring English, and skips files', () => {
    expect(pickCrawlUrls(twmMap, TWM, 15)).toEqual([
      TWM,
      `${TWM}/en/preface`,
      `${TWM}/en/introduction`,
      `${TWM}/en/ch-1`,
    ])
  })

  it('treats /privacy and /privacy.html as one page', () => {
    const picked = pickCrawlUrls(hhtpMap, HHTP, 15)
    expect(picked).toEqual([
      HHTP,
      `${HHTP}/pair`,
      `${HHTP}/terms`,
      `${HHTP}/privacy`,
      `${HHTP}/guides/partner-photos`,
      `${HHTP}/guides/two-phone-camera-remote-apps-2026`,
      `${HHTP}/guides/couple-travel-photo-ideas`,
    ])
  })

  it('stays inside the app: other hosts and sibling paths are dropped', () => {
    const links = [
      'https://kensaur.us/glot-it/learn',
      'https://kensaur.us/yen-yen',
      'https://evil.example.com/glot-it/x',
      'https://kensaur.us/glot-it-other',
    ]
    expect(pickCrawlUrls(links, 'https://kensaur.us/glot-it', 10)).toEqual([
      'https://kensaur.us/glot-it',
      'https://kensaur.us/glot-it/learn',
    ])
  })

  it('keeps a two-letter route that is not a language', () => {
    expect(pickCrawlUrls(['https://a.example/ai', 'https://a.example/en/ai'], 'https://a.example', 10)).toEqual([
      'https://a.example/',
      'https://a.example/ai',
    ])
  })

  it('caps at maxPages and always includes the start page', () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://a.example/p${i}`)
    const picked = pickCrawlUrls(many, 'https://a.example', 5)
    expect(picked).toHaveLength(5)
    expect(picked[0]).toBe('https://a.example/')
    expect(pickCrawlUrls([], 'https://a.example', 0)).toEqual(['https://a.example/'])
  })
})
