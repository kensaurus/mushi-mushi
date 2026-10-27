/**
 * Settings → General, Slack row. A saved channel id used to read as ready
 * to test even when no bot or webhook could post.
 */

import { describe, expect, it } from 'vitest'
import { slackAlertStatus, slackAlertsReadout, slackAlertsReady, slackStatLabel } from './slackAlertStatus'

describe('slackAlertStatus', () => {
  it('asks for a channel when nothing is saved', () => {
    expect(slackAlertStatus({}).state).toBe('not_connected')
  })

  it('does not offer a test when only a channel id is saved', () => {
    const view = slackAlertStatus({ channelId: 'C123' })
    expect(view.state).toBe('attention')
    expect(view.detail).toMatch(/nothing can post/)
  })

  it('asks for a channel when only the bot is connected', () => {
    expect(slackAlertStatus({ botSet: true }).detail).toMatch(/Add a channel ID/)
  })

  it('can send with a webhook, or a bot plus a channel', () => {
    expect(slackAlertStatus({ webhookSet: true }).state).toBe('checking')
    expect(slackAlertStatus({ channelId: 'C123', botSet: true }).state).toBe('checking')
  })

  it('trusts slackCanPost for an org or operator bot the settings row does not list', () => {
    expect(slackAlertStatus({ channelId: 'C123', canPost: true }).state).toBe('checking')
  })

  it('keeps a just-saved webhook sendable when stats still say no', () => {
    expect(slackAlertStatus({ webhookSet: true, canPost: false }).state).toBe('checking')
  })

  it('reports the test that just ran', () => {
    expect(slackAlertStatus({ webhookSet: true, tested: { ok: true } }).state).toBe('working')
    expect(slackAlertStatus({ webhookSet: true, tested: { ok: false } }).state).toBe('attention')
  })
})

describe('slack alerts labels', () => {
  it('does not call a half-finished Slack setup ready', () => {
    const partial = { slackConfigured: true, slackCanPost: false }
    expect(slackAlertsReady(partial)).toBe(false)
    expect(slackStatLabel(partial)).toBe('Slack not ready')
    expect(slackAlertsReadout(partial)).toMatch(/cannot be sent/)
  })

  it('falls back to slackConfigured when an older server omitted slackCanPost', () => {
    expect(slackAlertsReady({ slackConfigured: true })).toBe(true)
    expect(slackAlertsReadout({ slackConfigured: true })).toBe('Set up')
  })
})
