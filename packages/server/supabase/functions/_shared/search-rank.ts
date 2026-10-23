/**
 * FILE: packages/server/supabase/functions/_shared/search-rank.ts
 * PURPOSE: Search rank check: where an app ranks in web search for the
 *          words its users would type, read weekly through Firecrawl
 *          /v2/search (2 credits per 10 results). A visibility number for
 *          the owner, not a bug, so it files no report.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export const SEARCH_RANK_MAX_KEYWORDS = 10
export const SEARCH_RANK_RESULTS = 20
export const SEARCH_RANK_EVERY_DAYS = 7

/** Firecrawl's `location` for each country code it is given. */
export const COUNTRY_LOCATION: Record<string, string> = {
  US: 'United States',
  JP: 'Japan',
  TH: 'Thailand',
  GB: 'United Kingdom',
  TW: 'Taiwan',
  CN: 'China',
  KR: 'South Korea',
  VN: 'Vietnam',
  SG: 'Singapore',
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
}

export interface KeywordLine {
  query: string
  country: string
}

/**
 * The console's keyword box: one query per line, optionally ending in
 * `@JP` (a country code; default US). Blank lines and duplicates dropped;
 * an unknown code is an error rather than a silent US.
 */
export function parseKeywordLines(text: string): { ok: true; keywords: KeywordLine[] } | { ok: false; message: string } {
  const out: KeywordLine[] = []
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.*?)\s*@([A-Za-z]{2})$/)
    const query = (m ? m[1] : line).trim()
    const country = (m ? m[2] : 'US').toUpperCase()
    if (!COUNTRY_LOCATION[country]) return { ok: false, message: `Unknown country "@${country}". Use one of ${Object.keys(COUNTRY_LOCATION).join(', ')}.` }
    if (query.length < 2 || query.length > 200) return { ok: false, message: `"${query.slice(0, 40)}" must be 2 to 200 characters.` }
    const key = `${query.toLowerCase()}@${country}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ query, country })
  }
  if (out.length > SEARCH_RANK_MAX_KEYWORDS) return { ok: false, message: `At most ${SEARCH_RANK_MAX_KEYWORDS} keywords per app.` }
  return { ok: true, keywords: out }
}

/** The text form of saved keywords, for the edit box. */
export function keywordLines(rows: KeywordLine[]): string {
  return rows.map((k) => (k.country === 'US' ? k.query : `${k.query} @${k.country}`)).join('\n')
}

/**
 * The 1-based position of the first result on `target` (a host, or a host
 * with a path prefix such as `kensaur.us/glot-it`), or null when it is not
 * in the results.
 */
export function rankOf(results: Array<{ url?: string | null }>, target: string): number | null {
  const want = target.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().replace(/^www\./, '')
  const i = results.findIndex((r) => {
    if (!r.url) return false
    try {
      const u = new URL(r.url)
      const at = `${u.hostname}${u.pathname}`.toLowerCase().replace(/^www\./, '').replace(/\/$/, '')
      return at === want || at.startsWith(`${want}/`)
    } catch {
      return false
    }
  })
  return i === -1 ? null : i + 1
}

/** The hosts of the first results, for "who is ahead of you". */
export function topHosts(results: Array<{ url?: string | null }>, n = 3): string[] {
  const out: string[] = []
  for (const r of results) {
    try {
      out.push(new URL(r.url ?? '').hostname.replace(/^www\./, ''))
    } catch {
      // skip
    }
    if (out.length >= n) break
  }
  return out
}
