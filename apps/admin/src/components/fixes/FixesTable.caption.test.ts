/**
 * FILE: apps/admin/src/components/fixes/FixesTable.caption.test.ts
 * PURPOSE: The compact fixes list must not call shipped rows drafts.
 */

import { describe, expect, it } from 'vitest'
import { fixesListCaption } from './FixesTable'

describe('fixesListCaption', () => {
  it('calls a list of unshipped rows drafts', () => {
    expect(fixesListCaption([{ status: 'completed', pr_state: 'open' }])).toBe('1 draft fix — tap a row for details')
  })

  it('does not call the whole list drafts when some rows shipped (report 8daa23e6)', () => {
    const rows = [
      ...Array.from({ length: 15 }, () => ({ status: 'completed', pr_state: 'open' as const })),
      ...Array.from({ length: 3 }, () => ({ status: 'completed', pr_state: 'merged' as const, merged_at: '2026-10-01T00:00:00Z' })),
    ]
    const caption = fixesListCaption(rows)
    expect(caption).toBe('18 fixes — 3 shipped — tap a row for details')
    expect(caption).not.toContain('draft')
  })

  it('names a list that is entirely shipped', () => {
    expect(fixesListCaption([{ status: 'merged', pr_state: 'merged', merged_at: '2026-10-01' }])).toBe(
      '1 shipped fix — tap a row for details',
    )
  })
})
