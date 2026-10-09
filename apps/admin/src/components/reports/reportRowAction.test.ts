import { describe, expect, it } from 'vitest'
import { closedRowAction } from './reportRowAction'

describe('closedRowAction', () => {
  it('shows a neutral "Fixed ✓" for fixed reports, never the red Triage', () => {
    for (const status of ['fixed', 'verified', 'resolved']) {
      expect(closedRowAction(status)?.label).toBe('Fixed ✓')
      expect(closedRowAction(status)?.className).not.toContain('bg-brand')
    }
  })

  it('shows "View" for dismissed reports', () => {
    expect(closedRowAction('dismissed')?.label).toBe('View')
  })

  it('keeps the triage action for open reports', () => {
    for (const status of ['new', 'queued', 'classified', 'fixing', 'reopened']) {
      expect(closedRowAction(status)).toBeNull()
    }
  })
})
