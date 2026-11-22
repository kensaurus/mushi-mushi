import { describe, expect, it } from 'vitest'
import { closedRowAction } from './reportRowAction'

describe('closedRowAction', () => {
  it('shows a neutral "View" for fixed reports (the Status column says Fixed), never the red Triage', () => {
    for (const status of ['fixed', 'verified', 'resolved']) {
      expect(closedRowAction(status)?.label).toBe('View')
      expect(closedRowAction(status)?.label).not.toMatch(/fixed/i)
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
