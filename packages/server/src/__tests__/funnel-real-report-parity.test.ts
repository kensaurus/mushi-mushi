/**
 * FILE: packages/server/src/__tests__/funnel-real-report-parity.test.ts
 * PURPOSE: Keep public.is_activation_candidate_report() (SQL, the company
 *          funnel and the daily scorecard) and isActivationCandidate()
 *          (_shared/activation.ts, ingest and classify-report) on one rule.
 *
 * Why (2026-11-14): company_funnel_weekly's own "real report" filter left
 * out only the console test report and the demo seed, so the mushi init
 * test report (cli://wizard) and a localhost dev-server test each counted
 * as an outside activation. 20261114090000 ports the ingest rule to SQL;
 * this test pins the source lists and the dev-URL pattern to the TypeScript
 * constants, and runs a JavaScript reading of the SQL expression against
 * isActivationCandidate on the same cases.
 *
 * There is no Postgres in this suite; it reads the SQL verbatim.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { END_USER_REPORT_SOURCES, isActivationCandidate } from '../../supabase/functions/_shared/activation.ts'
import { NOT_FIRST_REPORT_SOURCES } from '../../supabase/functions/_shared/first-report.ts'
import { LOCAL_DEV_URL_PATTERN } from '../../supabase/functions/_shared/report-origin.ts'

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations')
const MARKER = 'create or replace function public.is_activation_candidate_report('

function latest(marker: string): { file: string; sql: string } {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8').includes(marker))
    .at(-1)
  if (!file) throw new Error(`no migration contains ${marker}`)
  return { file, sql: readFileSync(resolve(MIGRATIONS, file), 'utf8') }
}

const { sql } = latest(MARKER)
const fnStart = sql.indexOf(MARKER)
const body = sql.slice(sql.indexOf('$act$', fnStart) + 5, sql.indexOf('$act$', sql.indexOf('$act$', fnStart) + 5))

/** Quoted strings in the `<lead> in (...)` list that follows `lead`. */
function inList(lead: string): string[] {
  const at = body.indexOf(lead)
  if (at < 0) throw new Error(`no ${lead} in the helper`)
  const open = body.indexOf('(', at + lead.length)
  const list = body.slice(open + 1, body.indexOf(')', open))
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** The pattern of each `coalesce(p_url, '') !~* '<pattern>'` test, in order. */
const urlPatterns = [...body.matchAll(/coalesce\(p_url, ''\) !~\* '([^']+)'/g)].map((m) => m[1])

const sqlSources = inList("coalesce(p_source, 'widget')")
const sqlNotFirst = inList("coalesce(p_custom_metadata ->> 'source', '') not")

/** The SQL expression, read in JavaScript (`~*` is a case-insensitive match). */
function sqlCandidate(source: string | null, metadata: Record<string, unknown> | null, url: string | null): boolean {
  const metaSource = metadata && metadata.source != null ? String(metadata.source) : ''
  const u = url ?? ''
  return (
    sqlSources.includes(source ?? 'widget') &&
    !sqlNotFirst.includes(metaSource) &&
    urlPatterns.every((p) => !new RegExp(p, 'i').test(u))
  )
}

describe('is_activation_candidate_report matches isActivationCandidate', () => {
  it('lists the same end-user sources and defaults a missing source to widget', () => {
    expect([...sqlSources].sort()).toEqual([...END_USER_REPORT_SOURCES].sort())
    expect(body).toContain("coalesce(p_source, 'widget')")
  })

  it('leaves out the same custom_metadata.source values', () => {
    expect([...sqlNotFirst].sort()).toEqual([...NOT_FIRST_REPORT_SOURCES].sort())
    expect(sqlNotFirst).toContain('cli_wizard')
  })

  it('uses LOCAL_DEV_URL_PATTERN verbatim, and refuses cli:// tool URLs', () => {
    expect(urlPatterns).toContain(LOCAL_DEV_URL_PATTERN)
    expect(urlPatterns).toContain('^cli://')
    expect(urlPatterns).toHaveLength(2)
  })

  const cases: Array<[string, string | null, Record<string, unknown> | null, string | null]> = [
    ['wizard test, old CLI (no metadata source)', 'widget', null, 'cli://wizard'],
    ['wizard test, new CLI', 'widget', { source: 'cli_wizard' }, 'cli://wizard'],
    ['dev server on localhost', 'widget', {}, 'http://localhost:5299/checkout'],
    ['phone on the dev Wi-Fi', 'sdk', {}, 'http://192.168.1.20:8081/'],
    ['*.test host', null, {}, 'https://shop.test/'],
    ['console test report', 'widget', { source: 'admin_test_report' }, 'https://app.example.com/'],
    ['demo seed', 'widget', { source: 'mushi-marketing-seed' }, 'https://app.example.com/'],
    ['hand-filed report', 'widget', { source: 'admin_file' }, 'https://app.example.com/'],
    ['site watch report', 'site_watch', {}, 'https://app.example.com/'],
    ['live web widget', 'widget', {}, 'https://app.example.com/pay'],
    ['live, uppercase scheme', 'widget', {}, 'HTTPS://APP.EXAMPLE.COM/'],
    ['Capacitor production (no port)', 'sdk', {}, 'capacitor://localhost'],
    ['native report, no URL', null, null, null],
    ['unrelated metadata source', 'widget', { source: 'checkout-page' }, 'https://app.example.com/'],
  ]

  it.each(cases)('%s', (_label, source, metadata, url) => {
    const ts = isActivationCandidate({ id: 'r1', source, custom_metadata: metadata, url })
    expect(sqlCandidate(source, metadata, url)).toBe(ts)
  })

  it('stays immutable and service-role only', () => {
    const decl = sql.slice(fnStart, sql.indexOf('$act$', fnStart))
    expect(decl).toMatch(/\bimmutable\b/)
    expect(sql).toContain(
      'revoke all on function public.is_activation_candidate_report(text, jsonb, text) from public, anon, authenticated;',
    )
    expect(sql).toContain('grant execute on function public.is_activation_candidate_report(text, jsonb, text) to service_role;')
  })
})

describe('the funnel reads the shared rule', () => {
  const funnel = latest('create or replace function public.company_funnel_weekly(').sql
  const fn = funnel.slice(funnel.indexOf('create or replace function public.company_funnel_weekly('))
  const card = latest('create or replace function public.gtm_daily_scorecard(').sql
  const scorecard = card.slice(card.indexOf('create or replace function public.gtm_daily_scorecard('))
  const call = "public.is_activation_candidate_report(r.source, r.custom_metadata, r.environment ->> 'url')"

  function cte(text: string, name: string, next: string): string {
    const start = text.indexOf(`${name} as (`)
    const end = text.indexOf(`${next} as (`, start)
    if (start < 0 || end < 0) throw new Error(`CTE ${name} not found`)
    return text.slice(start, end)
  }

  it('activated (first_reports) and activated_opened (first_opens) count only candidate reports', () => {
    const reports = cte(fn, 'first_reports', 'self_events')
    expect(reports).toContain(call)
    expect(reports).not.toContain("not in ('mushi-marketing-seed', 'admin_test_report')")
    expect(cte(fn, 'first_opens', 'habit_weeks')).toContain(call)
  })

  it('drops a first_real_report path event whose report fails the rule, and only that step', () => {
    const path = cte(fn, 'path_events', 'page_views')
    expect(path).toContain("e.event_name <> 'first_real_report'")
    expect(path).toContain("r.id::text = e.properties ->> 'report_id'")
    expect(path).toContain(`not ${call}`)
    // A left-out-if-failing test, never a join that would drop events without report_id.
    expect(path).not.toMatch(/join public\.reports/)
  })

  it('the daily scorecard drops an activated event whose report fails the rule', () => {
    const activated = cte(scorecard, 'activated', 'outside_projects')
    expect(activated).toContain("e.event_name = 'activated'")
    expect(activated).toContain(`not ${call}`)
    expect(activated).toContain('not exists (')
  })
})
