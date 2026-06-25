import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { generateFixBranchName } from './github-pr.ts'

Deno.test('generateFixBranchName falls back when legacy template is invalid', () => {
  const reportId = '426f1bf0-0000-4000-8000-000000000001'
  const name = generateFixBranchName(
    reportId,
    'mushi/fix/{date}-bug-{shortId}',
    'ui-bug',
    'null-pointer',
  )

  assertEquals(name, `bugfix/MUSHI-${reportId}-null-pointer`)
})

Deno.test('generateFixBranchName uses default when template is empty', () => {
  const reportId = '426f1bf0-0000-4000-8000-000000000001'
  const name = generateFixBranchName(reportId, null, 'ui-bug', 'crash')
  assertEquals(name, `bugfix/MUSHI-${reportId}-crash`)
})
