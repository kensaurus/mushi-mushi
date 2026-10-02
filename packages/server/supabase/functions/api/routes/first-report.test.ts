import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  firstRealReportId,
  FULL_DIAGNOSIS_FIRST_REAL_REPORTS,
  isEarlyRealReport,
  isFirstRealReport,
  isNonRealReport,
  NON_REAL_REPORT_SOURCES,
} from '../../_shared/first-report.ts'

const real = (id: string) => ({ id, custom_metadata: { source: 'widget' } })
const test = (id: string) => ({ id, custom_metadata: { source: 'admin_test_report' } })
const seed = (id: string) => ({ id, custom_metadata: { source: 'mushi-marketing-seed' } })

Deno.test('the only real report on a project is its first', () => {
  assertEquals(isFirstRealReport([real('a')], 'a'), true)
})

Deno.test('a project that already had real reports does not re-activate', () => {
  // The bug this guards: a project with pre-existing reports getting a
  // "first report" stamped at its first report after the emitter shipped.
  assertEquals(isFirstRealReport([real('old'), real('new')], 'new'), false)
})

Deno.test('console test reports and the demo seed never count as the first', () => {
  assertEquals(isFirstRealReport([test('t1'), seed('s1'), real('r1')], 'r1'), true)
  assertEquals(isFirstRealReport([test('t1'), real('r1')], 't1'), false)
})

Deno.test('concurrent first reports agree on a single winner', () => {
  // Both ingests read the same (created_at, id)-ordered list; exactly one wins.
  const oldest = [real('a'), real('b')]
  const winners = ['a', 'b'].filter((id) => isFirstRealReport(oldest, id))
  assertEquals(winners, ['a'])
})

Deno.test('reports with no source metadata are real', () => {
  assertEquals(isNonRealReport(null), false)
  assertEquals(isNonRealReport({}), false)
  assertEquals(isFirstRealReport([{ id: 'x', custom_metadata: null }], 'x'), true)
})

Deno.test('no rows means no first report (e.g. read-after-write lag)', () => {
  assertEquals(isFirstRealReport([], 'a'), false)
})

Deno.test('the skip list matches the company funnel RPC exclusions', () => {
  assertEquals([...NON_REAL_REPORT_SOURCES].sort(), ['admin_test_report', 'mushi-marketing-seed'])
})

// ── fast-filter: the first real report always gets the Stage-2 diagnosis ──

Deno.test('only the very first real report is forced to Stage 2 by default', () => {
  assertEquals(FULL_DIAGNOSIS_FIRST_REAL_REPORTS, 1)
  const oldest = [real('a'), real('b')]
  assertEquals(isEarlyRealReport(oldest, 'a'), true)
  assertEquals(isEarlyRealReport(oldest, 'b'), false)
})

Deno.test('the console test report never counts toward or uses the first-report slot', () => {
  const oldest = [test('t1'), seed('s1'), real('r1'), real('r2')]
  assertEquals(isEarlyRealReport(oldest, 'r1'), true)
  assertEquals(isEarlyRealReport(oldest, 'r2'), false)
  // A test report whose precomputed write failed reaches fast-filter itself.
  assertEquals(isEarlyRealReport(oldest, 't1'), false)
})

Deno.test('a report outside the rows read stays on the normal path', () => {
  assertEquals(isEarlyRealReport([real('a')], 'zzz'), false)
  assertEquals(isEarlyRealReport([], 'a'), false)
})

Deno.test('the slot widens with the limit', () => {
  const oldest = [real('a'), test('t'), real('b'), real('c')]
  assertEquals(['a', 'b', 'c'].filter((id) => isEarlyRealReport(oldest, id, 2)), ['a', 'b'])
})

// ── retention-sweep: the first real report is the one kept ──

Deno.test('firstRealReportId skips test and seed rows', () => {
  assertEquals(firstRealReportId([test('t1'), seed('s1'), real('r1'), real('r2')]), 'r1')
  assertEquals(firstRealReportId([test('t1')]), null)
  assertEquals(firstRealReportId([]), null)
})
