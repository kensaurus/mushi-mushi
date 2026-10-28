/**
 * FILE: packages/server/src/__tests__/landing-visits.test.ts
 * PURPOSE: The cookieless page-view count on the docs + landing site
 *          (November GTM plan §6.1). It must store no personal data: no IP,
 *          no id, no fingerprint, only (day, path, src, referrer host, count).
 *          These tests pin the input cleaning, the table's lockdown, the
 *          per-visitor rate limit (a hashed IP bucket computed in `api`), and
 *          the operator gate on the daily read.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VISITOR_BUCKET_HEADER,
  cleanVisitSrc,
  isBotUserAgent,
  normalizeVisitPath,
  parsePageViewBody,
  visitReferrerHost,
} from '../../supabase/functions/_shared/landing-visits.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

describe('normalizeVisitPath', () => {
  it('keeps a site path, without query, hash or trailing slash, lowercased', () => {
    expect(normalizeVisitPath('/quickstart/web/')).toBe('/quickstart/web')
    expect(normalizeVisitPath('/Pricing?utm_source=x#top')).toBe('/pricing')
    expect(normalizeVisitPath('/')).toBe('/')
    expect(normalizeVisitPath('')).toBe('/')
  })

  it('refuses anything that is not a short site path', () => {
    expect(normalizeVisitPath('https://evil.example/')).toBeNull()
    expect(normalizeVisitPath('quickstart')).toBeNull()
    expect(normalizeVisitPath('/a b')).toBeNull()
    expect(normalizeVisitPath('/<script>')).toBeNull()
    expect(normalizeVisitPath(`/${'a'.repeat(200)}`)).toBeNull()
    expect(normalizeVisitPath(42)).toBeNull()
    expect(normalizeVisitPath('/users/jane@example.com')).toBeNull()
  })
})

describe('cleanVisitSrc', () => {
  it('takes the same lowercase slug the console stores as the signup source', () => {
    expect(cleanVisitSrc('HN')).toBe('hn')
    expect(cleanVisitSrc('reddit.vibecoding')).toBe('reddit.vibecoding')
    expect(cleanVisitSrc(' x-thread ')).toBe('x-thread')
  })

  it('drops anything else to no source', () => {
    expect(cleanVisitSrc('')).toBe('')
    expect(cleanVisitSrc(null)).toBe('')
    expect(cleanVisitSrc('jane@example.com')).toBe('')
    expect(cleanVisitSrc('a'.repeat(80))).toBe('')
    expect(cleanVisitSrc('<b>')).toBe('')
  })
})

describe('visitReferrerHost', () => {
  it('keeps only the host name, never a path or query', () => {
    expect(visitReferrerHost('news.ycombinator.com')).toBe('news.ycombinator.com')
    expect(visitReferrerHost('https://www.reddit.com/r/vibecoding/?u=me')).toBe('www.reddit.com')
    expect(visitReferrerHost('T.CO')).toBe('t.co')
  })

  it('drops our own site and anything that is not a host', () => {
    expect(visitReferrerHost('kensaur.us')).toBe('')
    expect(visitReferrerHost('https://www.kensaur.us/mushi-mushi/')).toBe('')
    expect(visitReferrerHost('not a host')).toBe('')
    expect(visitReferrerHost(undefined)).toBe('')
  })
})

describe('parsePageViewBody', () => {
  it('reads the beacon body (text/plain JSON, so no CORS preflight)', () => {
    expect(parsePageViewBody('{"path":"/pricing/","src":"HN","ref":"news.ycombinator.com"}')).toEqual({
      path: '/pricing',
      src: 'hn',
      referrerHost: 'news.ycombinator.com',
    })
  })

  it('refuses a body without a valid path, or one that is too large', () => {
    expect(parsePageViewBody('{"src":"hn"}')).toBeNull()
    expect(parsePageViewBody('not json')).toBeNull()
    expect(parsePageViewBody(JSON.stringify({ path: '/', pad: 'x'.repeat(2000) }))).toBeNull()
  })

  it('ignores every other field, so nothing personal can be stored', () => {
    const parsed = parsePageViewBody('{"path":"/","email":"a@b.co","ip":"1.2.3.4","anon_id":"x"}')
    expect(parsed).toEqual({ path: '/', src: '', referrerHost: '' })
  })
})

describe('isBotUserAgent', () => {
  it('skips crawlers and headless browsers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 HeadlessChrome/120.0')).toBe(true)
    expect(isBotUserAgent('')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false)
  })
})

function migrationWith(marker: string): string {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(marker))
    .at(-1)
  if (!file) throw new Error(`no migration contains ${marker}`)
  return readFileSync(resolve(MIGRATIONS, file), 'utf8')
}

describe('landing_page_views_daily (migration)', () => {
  const sql = migrationWith('create table if not exists public.landing_page_views_daily')

  it('stores only day, path, src, referrer host and a count', () => {
    const start = sql.indexOf('create table if not exists public.landing_page_views_daily')
    const table = sql.slice(start, sql.indexOf('\n);', start))
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s+(?:date|text|integer)/gm)].map((m) => m[1])
    expect(columns.sort()).toEqual(['day', 'path', 'referrer_host', 'src', 'views'])
    // NOT NULL DEFAULT '': a NULL in the primary key would never match ON CONFLICT.
    expect(table).toMatch(/\n\s+src\s+text\s+not null default ''/)
    expect(table).toMatch(/referrer_host\s+text\s+not null default ''/)
  })

  it('is deny-all under RLS and closed to anon and signed-in users', () => {
    expect(sql).toMatch(/alter table public\.landing_page_views_daily enable row level security/)
    expect(sql).not.toMatch(/create policy[^;]*landing_page_views_daily/i)
    expect(sql).toMatch(/revoke all on table public\.landing_page_views_daily from public, anon, authenticated/)
  })

  it('increments through security-definer RPCs only the service role can run', () => {
    for (const fn of ['record_landing_page_view(text, text, text)', 'gtm_daily_scorecard(integer)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated`)
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`)
    }
    expect(sql).toMatch(/on conflict \(day, path, src, referrer_host\)\s+do update set views = public\.landing_page_views_daily\.views \+ 1/)
  })

  it('caps the rows one day can add, so junk paths cannot grow the table without bound', () => {
    expect(sql).toMatch(/>= 2000/)
    expect(sql).toContain("'/(other)'")
  })

  it('the daily scorecard leaves operators out and reads activated from the self project', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.gtm_daily_scorecard'))
    expect(fn).toContain('public.operator_users')
    expect(fn).toContain("event_name = 'activated'")
    expect(fn).toContain("key = 'self_project_id'")
    expect(fn).toContain("raw_user_meta_data ->> 'signup_first_touch'")
  })
})

describe('the beacon route and the daily read', () => {
  const route = read('api/routes/landing-visits.ts')
  const api = read('api/index.ts')

  it('api-ext answers the beacon only for api (internal caller) and rate-limits on the hashed visitor bucket', () => {
    const beacon = route.slice(route.indexOf("'/v1/public/page-view'"), route.indexOf("'/v1/admin/growth/daily'"))
    expect(beacon).toContain('requireServiceRoleAuth(c.req.raw)')
    expect(beacon).toContain('VISITOR_BUCKET_HEADER')
    expect(beacon).toContain('scoped_rate_limit_claim')
    expect(beacon).toContain("rpc('record_landing_page_view'")
    expect(beacon).not.toMatch(/cf-connecting-ip|x-forwarded-for/i)
  })

  it('api hashes the visitor IP into the bucket and never forwards the IP', () => {
    const fwd = read('api/page-view-forward.ts')
    expect(fwd).toContain('ipRateLimitActorId(')
    expect(fwd).toContain('VISITOR_BUCKET_HEADER')
    expect(fwd).toMatch(/cf-connecting-ip/)
    expect(fwd).toMatch(/headers\.delete\('cf-connecting-ip'\)/)
    expect(fwd).toMatch(/headers\.delete\('x-forwarded-for'\)/)
    expect(api).toContain("app.post('/v1/public/page-view'")
    expect(VISITOR_BUCKET_HEADER).toBe('x-mushi-visitor-bucket')
  })

  it('the daily read is operator-only, like the weekly funnel', () => {
    const daily = route.slice(route.indexOf("'/v1/admin/growth/daily'"))
    expect(daily).toContain('requireOperator(c)')
    expect(daily).toContain("rpc('gtm_daily_scorecard'")
    expect(daily).toContain('GROWTH_NEEDS_ACCOUNT_KEY')
  })
})
