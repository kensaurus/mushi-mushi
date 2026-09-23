/**
 * FILE: packages/server/src/__tests__/company-funnel-habit-contract.test.ts
 * PURPOSE: company_funnel_weekly counts habit from exactly HABIT_EVENTS.
 *
 * The RPC hardcodes its event names in SQL while the SDK taxonomy names the
 * habit set in TypeScript. Before 2026-09-22 they disagreed: the plan and
 * taxonomy intent included fix_dispatched, the SQL did not, and nothing
 * noticed. This reads the newest migration that defines the function.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HABIT_EVENTS } from '../../../core/src/analytics-taxonomy'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations')

function latestFunnelDefinition(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) =>
      /create or replace function public\.company_funnel_weekly\(/i.test(readFileSync(join(MIGRATIONS, f), 'utf8')),
    )
  const file = files.at(-1)
  if (!file) throw new Error('no migration defines company_funnel_weekly')
  return { file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }
}

/** The quoted names inside the first `event_name in (...)` of a CTE. */
function eventList(sql: string, cte: string): string[] {
  const start = sql.indexOf(`${cte} as (`)
  if (start < 0) throw new Error(`CTE ${cte} not found`)
  const match = /event_name in \(([^)]*)\)/.exec(sql.slice(start))
  if (!match) throw new Error(`no event_name list in ${cte}`)
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

describe('company_funnel_weekly habit definition', () => {
  const { file, sql } = latestFunnelDefinition()

  it(`habit_weeks in ${file} counts exactly HABIT_EVENTS`, () => {
    expect(eventList(sql, 'habit_weeks').sort()).toEqual([...HABIT_EVENTS].sort())
  })

  it('self_events loads every habit event', () => {
    const loaded = eventList(sql, 'self_events')
    for (const event of HABIT_EVENTS) expect(loaded).toContain(event)
  })
})
