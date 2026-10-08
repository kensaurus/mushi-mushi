/**
 * FILE: apps/admin/src/lib/inboxModeUx.test.ts
 * PURPOSE: Quick mode's auto-tab lands on Overview (the action list); the
 *          Activity tab opened from inbox zero stays open (2026-10-04 console
 *          audit, group B item 80: it snapped straight back to Overview).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./mode', () => ({ useAdminMode: () => ({}) }))

import { resolveQuickInboxTab } from './inboxModeUx'

describe('resolveQuickInboxTab', () => {
  it('keeps an Activity tab the user opened', () => {
    expect(resolveQuickInboxTab('activity')).toBe('activity')
  })

  it('otherwise lands on Overview, which is the action list', () => {
    expect(resolveQuickInboxTab('overview')).toBe('overview')
    expect(resolveQuickInboxTab('stages')).toBe('overview')
    expect(resolveQuickInboxTab()).toBe('overview')
  })
})
