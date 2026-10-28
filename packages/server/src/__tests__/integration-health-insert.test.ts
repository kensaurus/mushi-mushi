/**
 * FILE: integration-health-insert.test.ts
 * PURPOSE: A cron health batch that includes Slack `detail` still stores
 *          every row when that column is not migrated yet, and does not
 *          retry when the insert failed for another reason.
 */
import { describe, expect, it } from 'vitest'
import { insertIntegrationHealthHistory } from '../../supabase/functions/_shared/integration-health-insert.ts'

type InsertError = { code?: string; message?: string } | null

function dbOf(insert: (rows: readonly object[]) => Promise<{ error: InsertError }>) {
  return { from: () => ({ insert }) }
}

const slack = {
  project_id: 'proj-slack',
  kind: 'slack',
  status: 'down',
  detail: { slack_error: 'channel_not_found', channel_id: 'C0DEAD' },
}
const other = { project_id: 'proj-other', kind: 'reward_webhook', status: 'unknown' }

describe('insertIntegrationHealthHistory', () => {
  it('stores the whole batch without detail when that column is not migrated', async () => {
    const calls: object[][] = []
    const db = dbOf(async (rows) => {
      calls.push([...rows])
      if (rows.some((row) => 'detail' in row)) {
        return {
          error: {
            code: 'PGRST204',
            message: "Could not find the 'detail' column of 'integration_health_history' in the schema cache",
          },
        }
      }
      return { error: null }
    })

    await insertIntegrationHealthHistory(db, [slack, other])

    expect(calls).toHaveLength(2)
    expect(calls[1].some((row) => 'detail' in row)).toBe(false)
    expect(calls[1]).toEqual([
      { project_id: 'proj-slack', kind: 'slack', status: 'down' },
      other,
    ])
  })

  it('retries a Postgres missing-column error for detail and not for another column', async () => {
    const calls: object[][] = []
    const db = dbOf(async (rows) => {
      calls.push([...rows])
      if (rows.some((row) => 'detail' in row)) {
        return { error: { code: '42703', message: 'column "detail" of relation "integration_health_history" does not exist' } }
      }
      return { error: null }
    })
    await insertIntegrationHealthHistory(db, [slack])
    expect(calls).toHaveLength(2)

    const httpStatus = dbOf(async (rows) => {
      calls.push([...rows])
      return { error: { code: '42703', message: 'column "http_status" of relation "integration_health_history" does not exist' } }
    })
    calls.length = 0
    await expect(insertIntegrationHealthHistory(httpStatus, [slack, other])).rejects.toThrow(/http_status/)
    expect(calls).toHaveLength(1)
  })

  it('does not retry an insert that failed for another reason', async () => {
    const calls: object[][] = []
    const db = dbOf(async (rows) => {
      calls.push([...rows])
      return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    })
    await expect(insertIntegrationHealthHistory(db, [slack, other])).rejects.toThrow(/duplicate key/)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toHaveProperty('detail')
  })
})
