/**
 * Reporter updates view rules (round-2 review 2026-11-18): an OFF channel is
 * never "Ready to send"; one status row with one action; the SDK-polls
 * prerequisite is only met when a reporter opened an update; a Sent row
 * always has a title.
 */

import { describe, expect, it } from 'vitest'
import {
  notificationsStatusAction,
  notificationsStatusSentence,
  reporterChannelBadge,
  reporterSetupChecks,
  sentRowTitle,
} from './notificationsView'

describe('reporterChannelBadge', () => {
  it('reads Off when the switch is off, even with the server ready', () => {
    expect(reporterChannelBadge(false, 'configured')).toEqual({ kind: 'off', label: 'Off' })
    expect(reporterChannelBadge(true, 'configured')).toEqual({ kind: 'ready', label: 'Ready to send' })
  })
  it('names a missing server sender first, whatever the switch says', () => {
    expect(reporterChannelBadge(true, 'not_configured').kind).toBe('server_missing')
    expect(reporterChannelBadge(false, 'not_configured').kind).toBe('server_missing')
  })
})

describe('notificationsStatusAction', () => {
  it('turns updates on first, then setup, then the unopened inbox', () => {
    expect(notificationsStatusAction({ topPriority: 'disabled', unread: 3 })).toEqual({ label: 'Turn on reporter updates', tab: 'setup', primary: true })
    expect(notificationsStatusAction({ topPriority: 'no_messages', unread: 0 })?.tab).toBe('setup')
    expect(notificationsStatusAction({ topPriority: 'unread_backlog', unread: 2 })).toEqual({ label: 'Review inbox', tab: 'inbox', primary: false })
    expect(notificationsStatusAction({ topPriority: 'healthy', unread: 0 })).toBeNull()
  })
})

describe('notificationsStatusSentence', () => {
  it('never repeats the counts the row shows as numbers', () => {
    const s = notificationsStatusSentence({ notificationsEnabled: true, total: 2, unread: 2 }, '5 days ago')
    expect(s).toBe('Last sent 5 days ago. Reporters see unopened ones the next time they open the widget.')
    expect(s).not.toMatch(/\b2\b/)
    expect(notificationsStatusSentence({ notificationsEnabled: true, total: 4, unread: 0 }, null)).toBe('Sent to reporters. All opened.')
    expect(notificationsStatusSentence({ notificationsEnabled: false, total: 4, unread: 0 }, null)).toMatch(/off/)
    expect(notificationsStatusSentence({ notificationsEnabled: true, total: 0, unread: 0 }, null)).toBe('No updates sent to reporters yet.')
  })
})

describe('reporterSetupChecks', () => {
  it('marks SDK polling seen only when a reporter opened an update; otherwise not seen (hollow), never failed', () => {
    expect(reporterSetupChecks({ total: 2, unread: 2 })[0]).toMatchObject({ status: 'idle', word: 'Not seen yet' })
    expect(reporterSetupChecks({ total: 0, unread: 0 })[0].status).toBe('idle')
    expect(reporterSetupChecks({ total: 2, unread: 1 })[0]).toMatchObject({ status: 'passed', word: 'Seen' })
  })
})

describe('sentRowTitle', () => {
  it('uses the message, else the type in words, never a bare dash', () => {
    expect(sentRowTitle({ message: 'Your bug was fixed', notification_type: 'fixed' })).toBe('Your bug was fixed')
    expect(sentRowTitle({ message: null, notification_type: 'classified' })).toBe('Bug diagnosed')
    expect(sentRowTitle({ message: '  ', notification_type: 'some_new_type' })).toBe('some new type')
  })
})
