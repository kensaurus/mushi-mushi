/**
 * FILE: search-rank.test.ts
 * PURPOSE: The search rank check's pure parts: the keyword box format and
 *          finding an app's position, on the 2026-10-23 manual run (tsumagoi
 *          #2 for 嬬恋 車中泊; glot.it under a path of kensaur.us).
 */
import { describe, expect, it } from 'vitest'
import { keywordLines, parseKeywordLines, rankOf, topHosts } from '../../supabase/functions/_shared/search-rank.ts'

describe('parseKeywordLines', () => {
  it('reads one query per line with an optional @country, default US, deduped', () => {
    expect(parseKeywordLines('嬬恋 車中泊 @jp\n\nTsumagoi camping\ntsumagoi CAMPING\n')).toEqual({
      ok: true,
      keywords: [
        { query: '嬬恋 車中泊', country: 'JP' },
        { query: 'Tsumagoi camping', country: 'US' },
      ],
    })
    expect(keywordLines([{ query: '嬬恋 車中泊', country: 'JP' }, { query: 'Tsumagoi camping', country: 'US' }])).toBe('嬬恋 車中泊 @JP\nTsumagoi camping')
  })

  it('refuses unknown countries, tiny queries and more than 10 keywords', () => {
    expect(parseKeywordLines('learn thai @XX')).toMatchObject({ ok: false })
    expect(parseKeywordLines('a')).toMatchObject({ ok: false })
    expect(parseKeywordLines(Array.from({ length: 11 }, (_, i) => `keyword ${i}`).join('\n'))).toMatchObject({ ok: false, message: 'At most 10 keywords per app.' })
  })
})

describe('rankOf / topHosts', () => {
  const results = [
    { url: 'https://carstay.jp/ja/spots/123' },
    { url: 'https://tsumagoi.kensaur.us/car-stay' },
    { url: 'https://www.kensaur.us/glot-it/learn' },
    { url: 'not a url' },
  ]
  it('finds a host or a host with a path prefix, 1-based, else null', () => {
    expect(rankOf(results, 'https://tsumagoi.kensaur.us')).toBe(2)
    expect(rankOf(results, 'kensaur.us/glot-it')).toBe(3)
    expect(rankOf(results, 'kensaur.us/yen-yen')).toBeNull()
    // A look-alike host is not the app.
    expect(rankOf([{ url: 'https://kensaur.us.example.com/x' }], 'kensaur.us')).toBeNull()
  })
  it('names the leading hosts', () => {
    expect(topHosts(results)).toEqual(['carstay.jp', 'tsumagoi.kensaur.us', 'kensaur.us'])
  })
})
