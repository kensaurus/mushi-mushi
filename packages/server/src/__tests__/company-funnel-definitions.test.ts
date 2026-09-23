/**
 * FILE: packages/server/src/__tests__/company-funnel-definitions.test.ts
 * PURPOSE: Pin the company funnel's definitions in the newest migration that
 *          declares company_funnel_weekly, and its output contract.
 *
 * Why (2026-09-21): the first version counted Bounties testers as signups,
 * counted the key every project is minted at creation (Project -> Key read
 * ~100%), and let operator traffic into visits / fix_pulled / habit. The
 * console (GrowthPage) and GET /v1/admin/growth/funnel read the jsonb keys
 * as-is, so a re-declaration may add keys but never drop one.
 *
 * There is no Postgres in this suite; this reads the SQL verbatim, the same
 * way the other *-contract tests read route sources.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(__dirname, '../../supabase/migrations')

function latestDefinition(fn: string): { file: string; body: string } {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const defining = files.filter((f) =>
    readFileSync(resolve(migrationsDir, f), 'utf8').includes(`create or replace function public.${fn}(`),
  )
  const file = defining[defining.length - 1]
  const sql = readFileSync(resolve(migrationsDir, file), 'utf8')
  const start = sql.indexOf(`create or replace function public.${fn}(`)
  const tag = /as (\$[a-z]*\$)/.exec(sql.slice(start))![1]
  const bodyStart = sql.indexOf(tag, start) + tag.length
  const bodyEnd = sql.indexOf(tag, bodyStart)
  return { file, body: sql.slice(bodyStart, bodyEnd) }
}

/** Keys the first version (20260921000002) returned per week. */
const WEEK_KEYS = [
  'week_start',
  'visits',
  'signups',
  'projects',
  'keys',
  'sdk_installed',
  'activated',
  'fix_pulled',
  'habit',
  'paid',
]

describe('company_funnel_weekly definitions', () => {
  const { file, body } = latestDefinition('company_funnel_weekly')

  it('is re-declared after the first version', () => {
    expect(file > '20260921000002_company_funnel_rpc.sql').toBe(true)
  })

  it('keeps every weekly key the console reads, and adds activated_opened', () => {
    for (const key of [...WEEK_KEYS, 'activated_opened']) {
      expect(body, key).toContain(`'${key}',`)
    }
    for (const key of ['by_source', 'window_start', 'window_end', 'source', 'self_project_configured']) {
      expect(body, key).toContain(`'${key}'`)
    }
  })

  it('does not count tester-only accounts as signups', () => {
    const people = body.slice(body.indexOf('people as ('), body.indexOf('proj as ('))
    expect(people).toContain('public.mushi_testers')
    expect(people).toContain("'signup_track'")
    // …unless they own a project: a tester who builds is a builder signup.
    expect(people).toContain('owned.owner_id = u.id')
  })

  it('keeps operators out of the self-project columns', () => {
    const selfEvents = body.slice(body.indexOf('self_events as ('), body.indexOf('first_opens as ('))
    expect(selfEvents).toContain('op_people')
    expect(selfEvents).toContain('op_anon')
    expect(body).toMatch(/join op on eu\.external_user_id = op\.user_id::text/)
  })

  it('counts a key once it leaves the console, not the one minted with the project', () => {
    const keySignals = body.slice(body.indexOf('key_signals as ('), body.indexOf('first_keys as ('))
    expect(keySignals).toContain("'wizard_env_written'")
    expect(keySignals).toContain("'sdk_first_heartbeat'")
    expect(keySignals).toContain("k.label = 'sdk-ingest'")
    const weekly = body.slice(body.indexOf('weekly as ('))
    expect(weekly).toMatch(/from first_keys fk[\s\S]*?as keys,/)
    expect(weekly).not.toContain('from public.project_api_keys')
  })

  it('activated_opened needs the owner to open a real report within 7 days of signup', () => {
    const opens = body.slice(body.indexOf('first_opens as ('), body.indexOf('habit_weeks as ('))
    expect(opens).toContain("se.event_name = 'report_opened'")
    expect(opens).toContain('eu.external_user_id = proj.owner_id::text')
    expect(opens).toContain("proj.owner_signed_up_at + interval '7 days'")
    expect(opens).toContain("'admin_test_report'")
  })
})

describe('activity RPCs leave bot sessions out', () => {
  it.each(['project_activity_summary', 'org_portfolio_summary'])('%s', (fn) => {
    const { body } = latestDefinition(fn)
    const sessionReads = body.match(/from end_user_sessions/g)?.length ?? 0
    const botFilters = body.match(/not (?:s\.)?is_bot|and s\.is_bot/g)?.length ?? 0
    expect(sessionReads).toBeGreaterThan(0)
    expect(botFilters).toBeGreaterThanOrEqual(sessionReads)
  })
})
