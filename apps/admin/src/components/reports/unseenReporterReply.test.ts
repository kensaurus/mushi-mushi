/**
 * FILE: apps/admin/src/components/reports/unseenReporterReply.test.ts
 * PURPOSE: The reports list "reply" dot follows `admin_seen_at` (Plan 018
 *          decision 10), the same rule as MCP and the reporter view API.
 *          Before this, the dot compared only with the last admin reply, so
 *          opening a report without replying never cleared it.
 */

import { describe, expect, it } from 'vitest'
import { hasUnseenReporterReply } from './types'

const REPLY = '2026-10-02T10:00:00Z'

describe('hasUnseenReporterReply', () => {
  it('is false when the reporter never replied', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: null, admin_seen_at: null })).toBe(false)
    expect(hasUnseenReporterReply({})).toBe(false)
  })

  it('lights when the report was never seen in the console', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: null })).toBe(true)
  })

  it('lights when the reporter wrote after the report was last opened', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: '2026-10-02T09:00:00Z' })).toBe(true)
  })

  it('clears once the report is opened after the reply, with no admin reply', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: '2026-10-02T10:05:00Z' })).toBe(false)
  })

  it('follows admin_seen_at only — a later admin reply alone does not clear it (the reply trigger stamps admin_seen_at)', () => {
    const row = { last_reporter_reply_at: REPLY, admin_seen_at: null, last_admin_reply_at: '2026-10-02T11:00:00Z' }
    expect(hasUnseenReporterReply(row)).toBe(true)
  })

  it('a reply at exactly the seen time counts as seen', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: REPLY })).toBe(false)
  })

  it('an unparseable reply time never lights; an unparseable seen time reads as never seen', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: 'not-a-date', admin_seen_at: null })).toBe(false)
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: 'garbage' })).toBe(true)
  })
})
