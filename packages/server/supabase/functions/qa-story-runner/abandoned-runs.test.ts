/**
 * FILE: packages/server/supabase/functions/qa-story-runner/abandoned-runs.test.ts
 * PURPOSE: A pending manual QA run older than 10 minutes becomes an error
 *          ("runner did not start"). Newer rows, running rows, and cron rows
 *          stay put. A database error is reported and does not throw.
 *
 * Run with:
 *   cd packages/server/supabase/functions && deno test --no-lock --node-modules-dir qa-story-runner/abandoned-runs.test.ts
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  ABANDONED_MANUAL_RUN_MS,
  RUNNER_DID_NOT_START,
  failAbandonedManualRuns,
  sweepAbandonedManualRuns,
} from './abandoned-runs.ts'

const { test } = Deno

function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`)
}

type Row = Record<string, unknown>

const NOW = new Date('2026-10-26T12:00:00.000Z')
const CUTOFF = new Date(NOW.getTime() - ABANDONED_MANUAL_RUN_MS).toISOString()

function iso(msFromCutoff: number): string {
  return new Date(new Date(CUTOFF).getTime() + msFromCutoff).toISOString()
}

/**
 * Applies eq / lt to the in-memory rows, then patches only the matches.
 * A sweep that drops a filter updates the wrong rows and these tests fail.
 */
function fakeDb(rows: Row[], opts?: { error?: { message: string } }): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'qa_story_runs') throw new Error(`unexpected table ${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | null = null
    const b: Record<string, unknown> = {}
    b.eq = (col: string, value: unknown) => {
      filters.push((row) => row[col] === value)
      return b
    }
    b.lt = (col: string, value: unknown) => {
      filters.push((row) => {
        const left = row[col]
        if (left == null || value == null) return false
        return String(left) < String(value)
      })
      return b
    }
    b.update = (next: Row) => {
      patch = next
      return b
    }
    b.select = () => b
    b.then = (ok: (value: unknown) => unknown, err?: (reason: unknown) => unknown) => {
      if (opts?.error) {
        return Promise.resolve({ data: null, error: opts.error }).then(ok, err)
      }
      const matched = rows.filter((row) => filters.every((keep) => keep(row)))
      if (patch) {
        for (const row of matched) Object.assign(row, patch)
      }
      return Promise.resolve({
        data: matched.map((row) => ({ id: row.id })),
        error: null,
      }).then(ok, err)
    }
    return b
  }
  return { from } as unknown as SupabaseClient
}

function run(over: Partial<Row> = {}): Row {
  return {
    id: 'run-old',
    status: 'pending',
    triggered_by: 'manual',
    started_at: iso(-1),
    finished_at: null,
    error_message: null,
    ...over,
  }
}

test('the abandon cutoff is 10 minutes', () => {
  assertEquals(ABANDONED_MANUAL_RUN_MS, 10 * 60 * 1000)
})

test('a manual run still pending after 10 minutes is an error', async () => {
  const older = run({ id: 'older' })
  const alsoOlder = run({ id: 'also-older', started_at: iso(-60_000) })
  const rows = [older, alsoOlder]
  const failed = await failAbandonedManualRuns(fakeDb(rows), NOW)
  assertEquals(failed, 2)
  for (const row of rows) {
    assertEquals(row.status, 'error')
    assertEquals(row.error_message, RUNNER_DID_NOT_START)
    assertEquals(row.finished_at, NOW.toISOString())
  }
})

test('the 10-minute boundary keeps a run that is not yet older than the cutoff', async () => {
  const exactly = run({ id: 'exact', started_at: CUTOFF })
  const justUnder = run({ id: 'fresh', started_at: iso(1) })
  const rows = [exactly, justUnder]
  const failed = await failAbandonedManualRuns(fakeDb(rows), NOW)
  assertEquals(failed, 0)
  assertEquals(exactly.status, 'pending')
  assertEquals(justUnder.status, 'pending')
  assertEquals(exactly.finished_at, null)
})

test('running rows and cron rows are left alone', async () => {
  const running = run({ id: 'running', status: 'running' })
  const cron = run({ id: 'cron', triggered_by: 'cron' })
  const passed = run({ id: 'passed', status: 'passed' })
  const rows = [running, cron, passed]
  const failed = await failAbandonedManualRuns(fakeDb(rows), NOW)
  assertEquals(failed, 0)
  assertEquals(running.status, 'running')
  assertEquals(cron.status, 'pending')
  assertEquals(passed.status, 'passed')
  assertEquals(running.error_message, null)
  assertEquals(cron.error_message, null)
})

test('a database error fails the sweep and leaves every row pending', async () => {
  const row = run()
  const rows = [row]
  let warned: { message: string; fields?: Record<string, unknown> } | null = null
  const failed = await sweepAbandonedManualRuns(
    fakeDb(rows, { error: { message: 'connection reset' } }),
    NOW,
    (message, fields) => {
      warned = { message, fields }
    },
  )
  assertEquals(failed, 0)
  assertEquals(row.status, 'pending')
  assertEquals(warned, {
    message: 'abandoned manual run sweep failed',
    fields: { err: 'connection reset' },
  })
})

test('failAbandonedManualRuns throws the database error', async () => {
  const row = run()
  let message = ''
  try {
    await failAbandonedManualRuns(fakeDb([row], { error: { message: 'connection reset' } }), NOW)
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  }
  assertEquals(message, 'connection reset')
  assertEquals(row.status, 'pending')
})
