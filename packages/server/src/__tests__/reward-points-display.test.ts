/**
 * The widget's "points per report" line reads the action ingest awards
 * (`report.submitted`) the same way the award path does: the project's
 * enabled rule, else the built-in table. It used to read a `report_submit`
 * org rule and fall back to 50 while 10 was credited.
 */
import { describe, expect, it } from 'vitest'
import { basePointsFor } from '../../supabase/functions/_shared/reputation.ts'

function dbWithRules(rows: Array<{ action: string; base_points: number }>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
  }
  return { from: () => chain }
}

describe('basePointsFor', () => {
  it('reads the project rule for the awarded action', async () => {
    const db = dbWithRules([{ action: 'report.submitted', base_points: 25 }])
    expect(await basePointsFor(db as never, 'proj-points-1', 'report.submitted')).toBe(25)
  })

  it('ignores a rule for a different action name, as the award path does', async () => {
    const db = dbWithRules([{ action: 'report_submit', base_points: 50 }])
    expect(await basePointsFor(db as never, 'proj-points-2', 'report.submitted')).toBe(10)
  })

  it('returns null for an action with no rule and no built-in points', async () => {
    const db = dbWithRules([])
    expect(await basePointsFor(db as never, 'proj-points-3', 'no.such.action')).toBeNull()
  })
})
