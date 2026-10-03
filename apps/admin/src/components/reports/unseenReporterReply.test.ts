/**
 * FILE: apps/admin/src/components/reports/unseenReporterReply.test.ts
 * PURPOSE: The reports list "reply" dot follows `admin_seen_at` (Plan 018
 *          decision 10). Before this, the dot compared only with the last
 *          admin reply, so opening a report without replying never cleared it.
 */

import { describe, expect, it } from 'vitest'
import { hasUnseenReporterReply } from './types'

const REPLY = '2026-10-02T10:00:00Z'

describe('hasUnseenReporterReply', () => {
  it('is false when the reporter never replied', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: null, admin_seen_at: null, last_admin_reply_at: null })).toBe(false)
    expect(hasUnseenReporterReply({})).toBe(false)
  })

  it('lights when the report was never opened or answered', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: null, last_admin_reply_at: null })).toBe(true)
  })

  it('lights when the reporter wrote after the report was last opened', () => {
    expect(
      hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: '2026-10-02T09:00:00Z', last_admin_reply_at: null }),
    ).toBe(true)
  })

  it('clears once the report is opened after the reply, with no admin reply', () => {
    expect(
      hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: '2026-10-02T10:05:00Z', last_admin_reply_at: null }),
    ).toBe(false)
  })

  it('treats an admin reply after the reporter as seen (rows from before admin_seen_at existed)', () => {
    expect(
      hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: null, last_admin_reply_at: '2026-10-02T11:00:00Z' }),
    ).toBe(false)
  })

  it('lights again when the reporter answers an older admin reply that was opened before', () => {
    expect(
      hasUnseenReporterReply({
        last_reporter_reply_at: '2026-10-03T08:00:00Z',
        admin_seen_at: '2026-10-02T12:00:00Z',
        last_admin_reply_at: '2026-10-02T11:00:00Z',
      }),
    ).toBe(true)
  })

  it('a reply at exactly the seen time counts as seen', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: REPLY })).toBe(false)
  })

  it('ignores an unparseable timestamp instead of lighting forever', () => {
    expect(hasUnseenReporterReply({ last_reporter_reply_at: 'not-a-date', admin_seen_at: null })).toBe(false)
    expect(hasUnseenReporterReply({ last_reporter_reply_at: REPLY, admin_seen_at: 'garbage' })).toBe(true)
  })
})
