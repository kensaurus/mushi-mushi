import { describe, expect, it } from 'vitest'
import { changedSettings, settingsFormBase } from './settingsDiff'

// Shape of GET /v1/admin/settings: stored secrets are masked and flagged.
const masked: Record<string, string | boolean | null> = {
  slack_channel_id: 'C123',
  slack_webhook_url: '••••••••',
  slack_webhook_url_set: true,
  sentry_webhook_secret: null,
  sentry_webhook_secret_set: false,
  stage2_model: 'claude-sonnet-5-5',
}

describe('settingsFormBase', () => {
  it('starts every masked secret empty and leaves other fields alone', () => {
    const base = settingsFormBase(masked)
    expect(base.slack_webhook_url).toBe('')
    expect(base.sentry_webhook_secret).toBe('')
    expect(base.slack_webhook_url_set).toBe(true)
    expect(base.slack_channel_id).toBe('C123')
    expect(base.stage2_model).toBe('claude-sonnet-5-5')
  })

  it('handles a missing payload', () => {
    expect(settingsFormBase(null)).toEqual({})
  })
})

describe('changedSettings', () => {
  it('sends only what the user edited, never the masked secrets', () => {
    const saved = settingsFormBase(masked)
    const body = changedSettings({ ...saved, stage2_model: 'claude-opus-5-5' }, saved)
    expect(body).toEqual({ stage2_model: 'claude-opus-5-5' })
    expect(JSON.stringify(body)).not.toContain('••••')
  })

  it('sends a newly pasted secret', () => {
    const saved = settingsFormBase(masked)
    expect(changedSettings({ ...saved, sentry_webhook_secret: 'whsec_new' }, saved)).toEqual({
      sentry_webhook_secret: 'whsec_new',
    })
  })

  it('sends a cleared plain field so the server can remove it', () => {
    const saved = settingsFormBase(masked)
    expect(changedSettings({ ...saved, slack_channel_id: '' }, saved)).toEqual({ slack_channel_id: '' })
  })
})
