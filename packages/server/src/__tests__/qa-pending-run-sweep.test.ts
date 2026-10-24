/**
 * Pending manual QA runs that the runner never started.
 *
 * POST …/qa-stories/:sid/run inserts status=pending and fire-and-forgets
 * qa-story-runner. A 503 BOOT_ERROR leaves the row pending, and the console
 * shows it as in flight forever. The cron tick expires those rows.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MANUAL_RUN_START_TIMEOUT_MS,
  RUNNER_DID_NOT_START,
  sweepStalePendingManualRuns,
  type QaPendingSweepDb,
} from '../../supabase/functions/_shared/qa-pending-run-sweep.ts'

const NOW = new Date('2026-10-24T00:10:00.000Z')
const CUTOFF = new Date(NOW.getTime() - MANUAL_RUN_START_TIMEOUT_MS).toISOString()

interface RunRow {
  id: string
  status: string
  triggered_by: string | null
  started_at: string
  finished_at: string | null
  error_message: string | null
  summary: string | null
  latency_ms: number | null
}

type Filter =
  | { op: 'eq'; column: string; value: unknown }
  | { op: 'lt'; column: string; value: string }

function matches(row: RunRow, filters: Filter[]): boolean {
  return filters.every((f) => {
    const cell = (row as unknown as Record<string, unknown>)[f.column]
    if (f.op === 'eq') return cell === f.value
    return typeof cell === 'string' && cell < f.value
  })
}

/** In-memory qa_story_runs that applies the update's eq / lt filters. */
function fakeDb(rows: RunRow[], fail = false) {
  const calls: Array<{ patch: Record<string, unknown>; filters: Filter[] }> = []
  const db: QaPendingSweepDb = {
    from: () => ({
      update: (patch) => {
        const filters: Filter[] = []
        const query = {
          eq(column: string, value: unknown) {
            filters.push({ op: 'eq', column, value })
            return query
          },
          lt(column: string, value: string) {
            filters.push({ op: 'lt', column, value })
            return query
          },
          select() {
            calls.push({ patch, filters: [...filters] })
            if (fail) return Promise.resolve({ data: null, error: { message: 'boom' } })
            const hit = rows.filter((r) => matches(r, filters))
            for (const r of hit) Object.assign(r, patch)
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
          },
        }
        return query
      },
    }),
  }
  return { db, calls }
}

function row(
  partial: Partial<RunRow> & Pick<RunRow, 'id' | 'status' | 'triggered_by' | 'started_at'>,
): RunRow {
  return {
    finished_at: null,
    error_message: null,
    summary: null,
    latency_ms: null,
    ...partial,
  }
}

describe('sweepStalePendingManualRuns', () => {
  it('marks a pending manual run older than 10 minutes as error', async () => {
    const stale = row({
      id: 'stale',
      status: 'pending',
      triggered_by: 'manual',
      started_at: '2026-10-23T23:59:59.999Z',
    })
    const fresh = row({
      id: 'fresh',
      status: 'pending',
      triggered_by: 'manual',
      started_at: '2026-10-24T00:09:00.000Z',
    })
    const cron = row({
      id: 'cron',
      status: 'pending',
      triggered_by: 'cron',
      started_at: '2026-10-23T00:00:00.000Z',
    })
    const running = row({
      id: 'running',
      status: 'running',
      triggered_by: 'manual',
      started_at: '2026-10-23T00:00:00.000Z',
    })
    const rows = [stale, fresh, cron, running]
    const { db, calls } = fakeDb(rows)

    const res = await sweepStalePendingManualRuns(db, NOW)

    expect(res).toEqual({ expired: 1, error: null })
    expect(stale).toMatchObject({
      status: 'error',
      error_message: RUNNER_DID_NOT_START,
      summary: RUNNER_DID_NOT_START,
      finished_at: NOW.toISOString(),
      latency_ms: 0,
    })
    expect(fresh.status).toBe('pending')
    expect(cron.status).toBe('pending')
    expect(running.status).toBe('running')
    expect(calls).toHaveLength(1)
    expect(calls[0].filters).toEqual([
      { op: 'eq', column: 'status', value: 'pending' },
      { op: 'eq', column: 'triggered_by', value: 'manual' },
      { op: 'lt', column: 'started_at', value: CUTOFF },
    ])
    expect(CUTOFF).toBe('2026-10-24T00:00:00.000Z')
  })

  it('leaves a pending manual run that is exactly 10 minutes old', async () => {
    const boundary = row({
      id: 'boundary',
      status: 'pending',
      triggered_by: 'manual',
      started_at: CUTOFF,
    })
    const { db } = fakeDb([boundary])
    expect(await sweepStalePendingManualRuns(db, NOW)).toEqual({ expired: 0, error: null })
    expect(boundary.status).toBe('pending')
    expect(boundary.error_message).toBeNull()
  })

  it('reports a database error and does not change the row', async () => {
    const stale = row({
      id: 'stale',
      status: 'pending',
      triggered_by: 'manual',
      started_at: '2026-10-23T23:00:00.000Z',
    })
    const { db } = fakeDb([stale], true)
    expect(await sweepStalePendingManualRuns(db, NOW)).toEqual({ expired: 0, error: 'boom' })
    expect(stale.status).toBe('pending')
  })
})

describe('qa-story-runner cron wiring', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
    'utf8',
  )

  it('sweeps on the cron tick, after a manual invoke has already returned', () => {
    const manualReturn = src.indexOf('return await executeManualRun')
    const cronStart = src.indexOf("startCronRun(db, 'qa-story-runner', 'cron')")
    const call = src.indexOf('await sweepStalePendingManualRuns(')
    expect(manualReturn).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(cronStart)
    expect(call).toBeGreaterThan(manualReturn)
  })
})
