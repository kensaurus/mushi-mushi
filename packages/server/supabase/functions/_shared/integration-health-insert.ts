/**
 * FILE: integration-health-insert.ts
 * PURPOSE: Write one cron batch of integration_health_history rows.
 *
 * The Slack channel check adds a `detail` column (migration
 * 20261029020000). Edge functions can deploy before that migration. PostgREST
 * then rejects the whole insert, so one Slack row drops health history for
 * every project in the batch. When the error is that missing column, the
 * batch is stored again without `detail`. Any other error still fails the run.
 */

import { log } from './logger.ts'

const plog = log.child('integration-health-history')

type InsertError = { code?: string; message?: string } | null

type HealthHistoryDb = {
  from: (table: string) => {
    insert: (rows: readonly object[]) => PromiseLike<{ error: InsertError }>
  }
}

/**
 * True only when PostgREST or Postgres says `integration_health_history.detail`
 * is not there yet. A missing `http_status`, a unique violation, or any other
 * failure must not take this path: stripping `detail` would not fix them, and
 * a retry that happened to succeed would hide the real error.
 */
export function missingHealthDetailColumn(error: InsertError): boolean {
  const message = error?.message ?? ''
  if (!message) return false
  return (
    /could not find the ['"]detail['"] column/i.test(message) ||
    /column ["']detail["']( of relation ["'][^"']+["'])? does not exist/i.test(message) ||
    /column ["']?[\w.]+\.detail["']? does not exist/i.test(message)
  )
}

function withoutDetail(rows: readonly object[]): object[] {
  return rows.map((row) => {
    if (!('detail' in row)) return row
    const { detail: _detail, ...rest } = row as Record<string, unknown>
    return rest
  })
}

/**
 * Insert `rows` into integration_health_history. On a missing `detail`
 * column, insert the same rows without that key. Throws on any other error,
 * including a retry that still fails.
 */
export async function insertIntegrationHealthHistory(db: HealthHistoryDb, rows: readonly object[]): Promise<void> {
  if (rows.length === 0) return
  const first = await db.from('integration_health_history').insert(rows)
  if (!first.error) return
  const hasDetail = rows.some((row) => 'detail' in row)
  if (hasDetail && missingHealthDetailColumn(first.error)) {
    plog.warn('integration_health_history.detail is not migrated yet; storing the batch without it', {
      rows: rows.length,
    })
    const retry = await db.from('integration_health_history').insert(withoutDetail(rows))
    if (!retry.error) return
    throw new Error(`integration_health_history insert failed: ${retry.error.message ?? 'unknown'}`)
  }
  throw new Error(`integration_health_history insert failed: ${first.error.message ?? 'unknown'}`)
}
