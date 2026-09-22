/**
 * FILE: packages/server/supabase/functions/inventory-propose/run-budget.test.ts
 * PURPOSE: Every model call in this function must carry a deadline, and the
 *          run must stop in time to persist what it has.
 *
 * Why (2026-09-22): the hourly drift_watch cron made up to three Sonnet calls
 * with no abort signal. The run outlived the edge runtime, was killed before
 * the draft insert, and the last proposal to reach the database was
 * 2026-05-04 — one wasted LLM call an hour in between.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { MAX_ATTEMPT_MS, nextAttemptTimeoutMs } from './run-budget.ts'

Deno.test('a full budget allows a full-length attempt', () => {
  assertEquals(nextAttemptTimeoutMs(110_000), MAX_ATTEMPT_MS)
})

Deno.test('a short budget shortens the attempt and keeps time to persist', () => {
  // 30 s left, 10 s reserved for the draft insert.
  assertEquals(nextAttemptTimeoutMs(30_000), 20_000)
})

Deno.test('too little time starts no further attempt', () => {
  assertEquals(nextAttemptTimeoutMs(20_000), null)
  assertEquals(nextAttemptTimeoutMs(0), null)
  assertEquals(nextAttemptTimeoutMs(-5_000), null)
})

Deno.test('the model call is given an abort signal', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  // generateText without abortSignal is the bug this file exists for.
  const call = src.slice(src.indexOf('const result = await generateText('))
  assertEquals(call.slice(0, call.indexOf('})')).includes('abortSignal'), true)
})
