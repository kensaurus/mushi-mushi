/**
 * FILE: packages/server/src/__tests__/inventory-propose-deadline.test.ts
 * PURPOSE: The proposer's model call must carry an abort signal, and
 *          drift_watch must cap how many proposals one run fires.
 *
 * Why (2026-09-22): with neither, the hourly cron made up to three Sonnet
 * calls per project, outlived the edge runtime's wall clock and was killed
 * before the draft insert — 5 degraded runs a day and no proposal persisted
 * since 2026-05-04. The arithmetic lives in the Deno test beside the source;
 * this pins the wiring, which only a read of the file can show.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/inventory-propose/index.ts'),
  'utf8',
)

describe('inventory-propose never runs unbounded', () => {
  it('passes an abort signal to the model call', () => {
    const call = src.slice(src.indexOf('await generateText('))
    expect(call.slice(0, call.indexOf('})'))).toContain('abortSignal')
  })

  it('checks the remaining budget before each attempt', () => {
    expect(src).toMatch(/const timeoutMs = nextAttemptTimeoutMs\(deadlineAt - Date\.now\(\)\)/)
    expect(src).toMatch(/if \(timeoutMs === null\)/)
  })

  it('never writes a trigger label into the uuid column', () => {
    // 'cron:drift-watch' in created_by made Postgres reject every cron
    // proposal after the model had already been paid for.
    expect(src).toMatch(/created_by: UUID_RE\.test\(triggeredBy \?\? ''\) \? triggeredBy : null/)
    // `source` is a typed column (passive_discovery | live_crawl | manual);
    // the trigger label rides in the rationale metadata instead.
    expect(src).toMatch(/source: 'passive_discovery'/)
    expect(src).toMatch(/__triggered_by: triggeredBy/)
  })

  it('caps how many proposals one drift-watch run fires', () => {
    expect(src).toContain('MUSHI_INVENTORY_DRIFT_MAX_PER_RUN')
    expect(src).toMatch(/fired >= maxPerRun/)
    expect(src).toContain('deferred_to_next_run')
  })
})
