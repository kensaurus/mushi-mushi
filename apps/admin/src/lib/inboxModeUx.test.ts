/**
 * FILE: apps/admin/src/lib/inboxModeUx.test.ts
 * PURPOSE: Quick mode's auto-tab manages Overview and Actions only; the
 *          Activity tab opened from inbox zero stays open (2026-10-04 console
 *          audit, group B item 80: it snapped straight back to Overview).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./mode', () => ({ useAdminMode: () => ({}) }))

import { resolveQuickInboxTab } from './inboxModeUx'
import { EMPTY_INBOX_STATS } from '../components/inbox/types'

describe('resolveQuickInboxTab', () => {
  const clear = { ...EMPTY_INBOX_STATS, openActions: 0 }
  const busy = { ...EMPTY_INBOX_STATS, openActions: 2 }

  it('keeps an Activity tab the user opened', () => {
    expect(resolveQuickInboxTab(clear, 'activity')).toBe('activity')
  })

  it('still jumps between Overview and Actions with the work', () => {
    expect(resolveQuickInboxTab(busy, 'overview')).toBe('actions')
    expect(resolveQuickInboxTab(clear, 'actions')).toBe('overview')
    expect(resolveQuickInboxTab(clear)).toBe('overview')
  })
})
