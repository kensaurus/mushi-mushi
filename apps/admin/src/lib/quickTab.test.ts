/**
 * Quick mode on Billing and Notifications re-forced its tab on every render,
 * so ?tab=support and ?tab=outbox bounced back (suspected-bugs entry 116).
 */

import { describe, expect, it, vi } from 'vitest'
import { shouldPickQuickTab } from './quickTab'
import { useBillingUx } from './billingModeUx'
import { useNotificationsUx } from './notificationsModeUx'

vi.mock('./mode', () => ({ useAdminMode: () => ({ isQuickstart: true, isBeginner: false, isAdvanced: false }) }))

describe('shouldPickQuickTab', () => {
  const base = { isQuickstart: true, statsReady: true, tabParam: null, alreadyPicked: false }

  it('picks once, after stats load, when the link names no tab', () => {
    expect(shouldPickQuickTab(base)).toBe(true)
    expect(shouldPickQuickTab({ ...base, statsReady: false })).toBe(false)
    expect(shouldPickQuickTab({ ...base, alreadyPicked: true })).toBe(false)
    expect(shouldPickQuickTab({ ...base, isQuickstart: false })).toBe(false)
  })

  it('never overrides an explicit ?tab=', () => {
    expect(shouldPickQuickTab({ ...base, tabParam: 'support' })).toBe(false)
    expect(shouldPickQuickTab({ ...base, tabParam: 'outbox' })).toBe(false)
  })
})

describe('Quick mode tab bars', () => {
  it('stay visible so Plans, Support and the Outbox can be reached', () => {
    expect(useBillingUx().hideTabs).toBe(false)
    expect(useNotificationsUx().hideTabs).toBe(false)
  })
})
