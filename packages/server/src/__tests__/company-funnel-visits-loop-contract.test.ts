/**
 * FILE: packages/server/src/__tests__/company-funnel-visits-loop-contract.test.ts
 * PURPOSE: Pin what 20260922000100 changed in company_funnel_weekly, and the
 *          strings it shares with the console and docs code.
 *
 * Why (2026-09-22):
 *   - visits counted landing_view only, while the docs site tracked three
 *     routes, so a visitor who entered on any other page was never a visit.
 *     The site now sends docs_page_view on every route.
 *   - All six external signups had no signup_source, so by_source was one
 *     'unknown' row. The console now stores the first-touch utm_source as
 *     signup_first_touch, and the RPC falls back to it.
 *   - K-factor was not computable: loop_impression / loop_click live in the
 *     host customers' projects, which the RPC never read.
 *
 * There is no Postgres in this suite; this reads the SQL verbatim, like the
 * other *-contract tests. company-funnel-habit-contract.test.ts still pins
 * habit_weeks to HABIT_EVENTS.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HABIT_EVENTS, MUSHI_EVENTS } from '../../../core/src/analytics-taxonomy'

const repo = resolve(__dirname, '../../../..')
const migrationsDir = resolve(__dirname, '../../supabase/migrations')

function latestDefinition(): { file: string; sql: string; body: string } {
  const file = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      readFileSync(resolve(migrationsDir, f), 'utf8').includes('create or replace function public.company_funnel_weekly('),
    )
    .at(-1)
  if (!file) throw new Error('no migration defines company_funnel_weekly')
  const sql = readFileSync(resolve(migrationsDir, file), 'utf8')
  const start = sql.indexOf('create or replace function public.company_funnel_weekly(')
  const bodyStart = sql.indexOf('$fn$', start) + 4
  return { file, sql, body: sql.slice(bodyStart, sql.indexOf('$fn$', bodyStart)) }
}

/** The CTE text from `name as (` up to the next top-level CTE. */
function cte(body: string, name: string, next: string): string {
  const start = body.indexOf(`${name} as (`)
  const end = body.indexOf(`${next} as (`, start)
  if (start < 0 || end < 0) throw new Error(`CTE ${name} not found`)
  return body.slice(start, end)
}

/** Quoted names in the first `event_name in (...)` of a text. */
function eventList(text: string): string[] {
  const match = /event_name in \(([^)]*)\)/.exec(text)
  if (!match) throw new Error('no event_name list')
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

/** The weekly subquery that ends in `as <column>`. */
function weeklyColumn(body: string, column: string): string {
  const weekly = body.slice(body.indexOf('weekly as ('))
  const end = weekly.indexOf(`as ${column}`)
  if (end < 0) throw new Error(`weekly column ${column} not found`)
  return weekly.slice(weekly.lastIndexOf('(select', end), end)
}

describe('company_funnel_weekly — visits, source fallback, loop columns', () => {
  const { file, sql, body } = latestDefinition()

  it('is re-declared by 20260922000100 or later', () => {
    expect(file >= '20260922000100_funnel_visits_by_source.sql').toBe(true)
  })

  // 20261114090000: visits reads the cookieless counter. The consent-gated
  // measure below read 0 or 1 a week; it stays as visits_consented.
  it('counts visits from the cookieless counter, without referrer spam, per UTC day', () => {
    const visits = weeklyColumn(body, 'visits')
    expect(visits).toContain('from page_views pv')
    expect(visits).toContain("(wk.week_start at time zone 'utc')::date")
    const pageViews = cte(body, 'page_views', 'loop_events')
    expect(pageViews).toContain('from public.landing_page_views_daily v')
    expect(pageViews).toContain('filter (where not public.is_spam_referrer_host(v.referrer_host))')
    expect(pageViews).toContain('(v_source is null or v.src = v_source)')
    expect(weeklyColumn(body, 'visits_spam_excluded')).toContain('sum(pv.spam)')
    expect(body).toMatch(/'visits',\s+w\.visits,/)
    expect(body).toMatch(/'visits_spam_excluded',\s+w\.visits_spam_excluded,/)
  })

  it('keeps the consent-gated measure as visits_consented (landing_view and docs_page_view)', () => {
    const consented = weeklyColumn(body, 'visits_consented')
    expect(eventList(consented).sort()).toEqual(['docs_page_view', 'landing_view'])
    expect(consented).toContain('count(distinct se.anon_id)')
    expect(body).toMatch(/'visits_consented',\s+w\.visits_consented,/)
    for (const name of ['landing_view', 'docs_page_view']) expect(name in MUSHI_EVENTS).toBe(true)
  })

  it('still loads every habit event, plus docs_page_view, into self_events', () => {
    const loaded = eventList(cte(body, 'self_events', 'first_opens'))
    for (const event of [...HABIT_EVENTS, 'landing_view', 'docs_page_view']) expect(loaded).toContain(event)
  })

  it('falls back to the first-touch source and filters on the same value', () => {
    const people = cte(body, 'people', 'proj')
    expect(people).toMatch(
      /coalesce\(\s*nullif\(nullif\(u\.raw_user_meta_data ->> 'signup_source', ''\), 'unknown'\),\s*nullif\(u\.raw_user_meta_data ->> 'signup_first_touch', ''\),\s*'unknown'\) as source/,
    )
    expect(people).toContain('(v_source is null or src.source = v_source)')
    expect(people).not.toMatch(/raw_user_meta_data ->> 'signup_source' = v_source/)
  })

  it('reads signup_first_touch under the key the console writes', () => {
    const console = readFileSync(resolve(repo, 'apps/admin/src/lib/signupAttribution.ts'), 'utf8')
    expect(console).toMatch(/^\s+signup_first_touch\?: string$/m)
  })

  it('counts loop impressions and clicks across projects, not just the self project', () => {
    const loop = cte(body, 'loop_events', 'weekly')
    expect(eventList(loop).sort()).toEqual(['loop_click', 'loop_impression'])
    expect(loop).not.toMatch(/project_id = v_self/)
    expect(loop).toContain('e.project_id <> v_self')
    expect(weeklyColumn(body, 'loop_impressions')).toContain("le.event_name = 'loop_impression'")
    expect(weeklyColumn(body, 'loop_clicks')).toContain("le.event_name = 'loop_click'")
    expect(sql).toMatch(
      /create index if not exists product_events_loop_ts\s+on public\.product_events \(ts\)\s+where event_name in \('loop_impression', 'loop_click'\);/,
    )
  })

  it('counts loop signups by the same loop-ref shape the console accepts', () => {
    const console = readFileSync(resolve(repo, 'apps/admin/src/lib/signupAttribution.ts'), 'utf8')
    const consoleRe = /const LOOP_REF_RE = \/(.+)\/\n/.exec(console)?.[1]
    expect(consoleRe).toBe('^[0-9a-f]{6,64}$')
    expect(cte(body, 'people', 'proj')).toContain(
      `coalesce(u.raw_user_meta_data ->> 'loop_ref', '') ~ '${consoleRe}' as loop_referred`,
    )
    const signups = weeklyColumn(body, 'loop_signups')
    expect(signups).toContain('from people ppl')
    expect(signups).toContain('ppl.loop_referred')
  })

  it('returns the three loop keys per week', () => {
    for (const key of ['loop_impressions', 'loop_clicks', 'loop_signups']) {
      expect(body).toMatch(new RegExp(`'${key}',\\s+w\\.${key}`))
    }
  })

  it('stays service_role only', () => {
    const tail = sql.slice(sql.indexOf('$fn$;'))
    expect(tail).toContain(
      'revoke all on function public.company_funnel_weekly(integer, text) from public, anon, authenticated;',
    )
    expect(tail).toContain('grant execute on function public.company_funnel_weekly(integer, text) to service_role;')
  })
})
