import { describe, expect, it } from 'vitest'
import { goneNote, parseAuditCheck, recheckReport, verdictCommits } from './work-recheck.js'

/** The description shape the server writes for a code-audit finding (_shared/work-modes.ts). */
const desc = (summary: string) =>
  `What the user sees: the chip overflows.\nFix: truncate it.\nDone when: it fits.\n\nReproduced by the worker with no model: pattern check, ${summary}\nFound by the code-read audit of /home on the local worker lane glot-audit.`

describe('parseAuditCheck', () => {
  it('reads back the check the audit filed', () => {
    expect(parseAuditCheck(desc('/inline-flex min-w-0 truncate/ is present in app/_components/chip.tsx near line 111'))).toEqual({
      kind: 'pattern',
      regex: 'inline-flex min-w-0 truncate',
      ignoreCase: false,
      expect: 'present',
      file: 'app/_components/chip.tsx',
      line: 111,
    })
    expect(parseAuditCheck(desc('/aria-label/i is absent in src/a.tsx'))).toMatchObject({ regex: 'aria-label', ignoreCase: true, expect: 'absent', line: null })
  })

  it('keeps slashes inside the pattern, and never one from earlier text', () => {
    expect(parseAuditCheck(desc('/href="\\/features"/ is present in app/nav.tsx near line 4'))?.regex).toBe('href="\\/features"')
    const withUrl = `See https://example.com/a/b for details. Reproduced by the worker with no model: pattern check, /role="status"/ is absent in app/x.tsx near line 2`
    expect(parseAuditCheck(withUrl)?.regex).toBe('role="status"')
  })

  it('refuses a missing, cut-short, unsafe or out-of-tree check', () => {
    expect(parseAuditCheck(null)).toBeNull()
    expect(parseAuditCheck('A user wrote: /x/ is absent in README.md')).toBeNull()
    expect(parseAuditCheck(desc(`/${'a'.repeat(290)}/ is present in src/a.tsx`))).toBeNull()
    expect(parseAuditCheck(desc('/(a+)+$/ is present in src/a.tsx'))).toBeNull()
    expect(parseAuditCheck(desc('/x/ is present in ../etc/passwd'))).toBeNull()
  })
})

describe('recheckReport', () => {
  const report = { source: 'code_audit', description: desc('/ChevronRight/ is present in app/rows.tsx near line 3') }
  const file = (text: string | null) => () => text

  it('closes nothing that a person reported', () => {
    expect(recheckReport({ ...report, source: 'widget' }, '/wt', file(''))).toEqual({ gone: false, reason: null })
  })

  it('is gone only when the file is there and the check no longer holds', () => {
    expect(recheckReport(report, '/wt', file('a\nb\n<ChevronRight />\nd')).gone).toBe(false)
    const gone = recheckReport(report, '/wt', file('a\nb\n<ChevronDown />\nd'))
    expect(gone.gone).toBe(true)
    expect(gone.reason).toContain('no longer reproduces')
  })

  it('leaves a moved file or an unreadable check to the agent', () => {
    const moved = recheckReport(report, '/wt', file(null))
    expect(moved.gone).toBe(false)
    expect(moved.reason).toContain('not in the base branch')
    expect(recheckReport({ source: 'code_audit', description: 'no check here' }, '/wt', file('x')).gone).toBe(false)
  })

  it('honours the line window the audit used (3 lines either side)', () => {
    const far = Array.from({ length: 20 }, (_, i) => (i === 15 ? '<ChevronRight />' : 'x')).join('\n')
    // The pattern is 13 lines away from line 3: the audit would not see it, so neither does the recheck.
    expect(recheckReport(report, '/wt', file(far)).gone).toBe(true)
  })
})

describe('verdictCommits and goneNote', () => {
  it('finds commit ids, not plain numbers or words', () => {
    expect(verdictCommits('already fixed in db4c8383a ("release batch") and 1a2b3c4d; issue 1234567')).toEqual(['db4c8383a', '1a2b3c4d'])
    expect(verdictCommits('nothing here')).toEqual([])
  })

  it('says how it knows and how to undo it', () => {
    const note = goneNote('its own check no longer reproduces', 'origin/main', 'db4c8383a0123')
    expect(note).toContain('without an agent run')
    expect(note).toContain('origin/main at db4c8383a')
    expect(note).toContain('Reopen')
  })
})
