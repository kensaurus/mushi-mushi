/**
 * FILE: monitor-url.test.ts
 * PURPOSE: The marker every Mushi page load of a customer app carries
 *          (`_shared/monitor-url.ts`): appended after the existing query,
 *          fragment kept, never a param twice, and removed byte for byte
 *          from every URL Firecrawl hands back.
 */
import { describe, expect, it } from 'vitest'
import {
  MONITOR_USER_AGENT,
  hasMonitorTag,
  monitorScrapeBody,
  tagMonitorUrl,
  untagMonitorUrl,
} from '../../supabase/functions/_shared/monitor-url.ts'

const TAIL = (kind: string) => `mushi_monitor=${kind}&utm_source=mushi-monitor&utm_medium=${kind}`

describe('tagMonitorUrl', () => {
  it('appends the marker and UTM params to a URL without a query', () => {
    expect(tagMonitorUrl('https://glot.kensaur.us', 'watch')).toBe(`https://glot.kensaur.us?${TAIL('watch')}`)
    expect(tagMonitorUrl('https://app.example/pricing/', 'audit')).toBe(`https://app.example/pricing/?${TAIL('audit')}`)
  })

  it('keeps the existing query exactly as written, encoding included', () => {
    expect(tagMonitorUrl('https://app.example/s?q=a%20b&tag=x+y', 'qa')).toBe(`https://app.example/s?q=a%20b&tag=x+y&${TAIL('qa')}`)
  })

  it('keeps the fragment last and untouched, also a hash-router route with its own query', () => {
    expect(tagMonitorUrl('https://app.example/docs#install', 'watch')).toBe(`https://app.example/docs?${TAIL('watch')}#install`)
    expect(tagMonitorUrl('https://app.example/#/route?x=1', 'qa')).toBe(`https://app.example/?${TAIL('qa')}#/route?x=1`)
  })

  it('never adds a param that is already there, and is idempotent', () => {
    expect(tagMonitorUrl('https://app.example/?utm_source=newsletter', 'audit')).toBe(
      'https://app.example/?utm_source=newsletter&mushi_monitor=audit&utm_medium=audit',
    )
    const once = tagMonitorUrl('https://app.example/a?b=1', 'watch')
    expect(tagMonitorUrl(once, 'watch')).toBe(once)
    // Another kind does not stack a second marker either.
    expect(tagMonitorUrl(once, 'qa')).toBe(once)
  })

  it('leaves a string that is not an http(s) URL alone', () => {
    expect(tagMonitorUrl('mailto:a@b.c', 'watch')).toBe('mailto:a@b.c')
    expect(tagMonitorUrl('/relative/path', 'watch')).toBe('/relative/path')
  })
})

describe('untagMonitorUrl', () => {
  const urls = [
    'https://glot.kensaur.us',
    'https://glot.kensaur.us/',
    'https://app.example/pricing',
    'https://app.example/s?q=a%20b&tag=x+y',
    'https://app.example/docs#install',
    'https://app.example/#/route?x=1',
    'https://app.example/?utm_source=newsletter&utm_medium=email',
    'https://app.example/?utm_source=newsletter',
  ]

  it('gives back the URL it was given, byte for byte', () => {
    for (const url of urls) {
      for (const kind of ['watch', 'audit', 'qa'] as const) {
        expect(untagMonitorUrl(tagMonitorUrl(url, kind))).toBe(url)
      }
    }
  })

  it("untags Firecrawl's metadata.url, which comes back with the utm_* pairs already dropped", () => {
    expect(untagMonitorUrl('https://app.example/p?x=1&mushi_monitor=watch')).toBe('https://app.example/p?x=1')
    expect(untagMonitorUrl('https://app.example/p?mushi_monitor=audit#top')).toBe('https://app.example/p#top')
  })

  it("keeps a customer's own utm_medium=watch when Mushi did not add it", () => {
    expect(untagMonitorUrl('https://app.example/?utm_medium=watch')).toBe('https://app.example/?utm_medium=watch')
    expect(untagMonitorUrl('https://app.example/?a=1')).toBe('https://app.example/?a=1')
  })
})

describe('hasMonitorTag', () => {
  it('reads the marker, for a kind or any kind', () => {
    const tagged = tagMonitorUrl('https://app.example/', 'watch')
    expect(hasMonitorTag(tagged)).toBe(true)
    expect(hasMonitorTag(tagged, 'watch')).toBe(true)
    expect(hasMonitorTag(tagged, 'qa')).toBe(false)
    expect(hasMonitorTag('https://app.example/?utm_source=mushi-monitor')).toBe(false)
    expect(hasMonitorTag(undefined)).toBe(false)
  })
})

describe('monitorScrapeBody', () => {
  it('tags url and every url in urls, and adds the Mushi User-Agent', () => {
    const body = { url: 'https://app.example/a', urls: ['https://app.example/b', 'https://app.example/c?x=1'], formats: ['markdown'] }
    const out = monitorScrapeBody('audit', body)
    expect(out).toEqual({
      url: `https://app.example/a?${TAIL('audit')}`,
      urls: [`https://app.example/b?${TAIL('audit')}`, `https://app.example/c?x=1&${TAIL('audit')}`],
      formats: ['markdown'],
      headers: { 'User-Agent': MONITOR_USER_AGENT },
    })
    // The caller's object is not changed.
    expect(body.url).toBe('https://app.example/a')
    expect(body).not.toHaveProperty('headers')
  })

  it("keeps the caller's headers and its own User-Agent", () => {
    expect(monitorScrapeBody('qa', { url: 'https://a.example', headers: { 'X-Test': '1' } }).headers).toEqual({
      'User-Agent': MONITOR_USER_AGENT,
      'X-Test': '1',
    })
    expect(monitorScrapeBody('qa', { url: 'https://a.example', headers: { 'user-agent': 'Custom/1' } }).headers).toEqual({
      'user-agent': 'Custom/1',
    })
  })

  it('identifies as MushiSiteWatch/1.0 with the product URL', () => {
    expect(MONITOR_USER_AGENT).toMatch(/ MushiSiteWatch\/1\.0 \(\+https:\/\/kensaur\.us\/mushi-mushi\)$/)
  })
})
