/**
 * The SQL functions behind /overview and /activity count "open reports" with
 * the same status list as the dashboard and `/reports?status=open`
 * (api/shared.ts OPEN_REPORT_STATUSES). Before 20261004163000 Overview used
 * ('new','classified','fixing') and Activity used status = 'new', so one
 * project showed three different open counts (console repair #175).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261004163000_console_counts_one_definition.sql'),
  'utf8',
)

function arrays(name: string): string[][] {
  const re = new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`, 'g')
  return [...sql.matchAll(re)].map((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')))
}

describe('20261004163000_console_counts_one_definition', () => {
  it('uses OPEN_REPORT_STATUSES in both report summaries', async () => {
    ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
    const { OPEN_REPORT_STATUSES } = await import('../../supabase/functions/api/shared.ts')
    const lists = arrays('v_open_statuses')
    expect(lists).toHaveLength(2)
    for (const list of lists) expect(list).toEqual([...OPEN_REPORT_STATUSES])
  })

  it('keeps every function service-role only', () => {
    for (const fn of [
      'integration_health_rollup(uuid[], timestamptz)',
      'project_activity_summary(uuid, integer)',
      'org_portfolio_summary(uuid)',
      'product_events_summary(uuid, integer)',
      'llm_spend_before(uuid, timestamptz)',
    ]) {
      const escaped = fn.replace(/[()[\]]/g, (c) => `\\${c}`)
      expect(sql).toMatch(new RegExp(`revoke (all|execute) on function public\\.${escaped} from public, anon, authenticated;`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped} to service_role;`))
    }
  })

  it('stops counting sessions as people in the activity split', () => {
    expect(sql).toMatch(/'identified_people',\s+ut\.identified_people/)
    expect(sql).toMatch(/'anonymous_devices',\s+ut\.anonymous_devices/)
  })

  it('returns the full event-name catalogue next to the top 20', () => {
    expect(sql).toMatch(/'distinct_events',\s+t\.distinct_events/)
    expect(sql).toMatch(/'event_names',/)
  })
})
