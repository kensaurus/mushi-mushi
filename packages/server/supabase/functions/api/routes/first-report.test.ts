import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { isFirstRealReport, isNonRealReport, NON_REAL_REPORT_SOURCES } from '../../_shared/first-report.ts'

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
