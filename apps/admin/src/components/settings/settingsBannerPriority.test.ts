import { describe, expect, it } from 'vitest'
import { settingsBannerPriority } from './SettingsStatusBanner'
import type { KeySummary } from './keyStatus'
import { EMPTY_SETTINGS_STATS, type SettingsStats } from './types'

const stats = (over: Partial<SettingsStats> = {}): SettingsStats => ({
  ...EMPTY_SETTINGS_STATS,
  projectId: 'p1',
  sdkConfigEnabled: true,
  slackConfigured: true,
  byokAnthropicConfigured: true,
  ...over,
})

const summary = (over: Partial<KeySummary> = {}): KeySummary => ({
  working: 1,
  attention: 0,
  expiring: 0,
  checking: 0,
  off: 0,
  total: 1,
  ...over,
})

describe('settingsBannerPriority', () => {
  it('uses the key list, not the server counts, when both exist', () => {
    // The server counted a superseded legacy key as fine; the rows say "remove it".
    expect(settingsBannerPriority(stats({ byokKeysFailing: 0 }), summary({ attention: 1 }), true)).toBe(
      'keys_attention',
    )
    // The server still counted a recovered quota key as failing; the rows say it works.
    expect(settingsBannerPriority(stats({ byokKeysFailing: 1 }), summary(), true)).toBe('healthy')
  })

  it('warns about keys expiring within a week', () => {
    expect(settingsBannerPriority(stats(), summary({ expiring: 1 }), true)).toBe('keys_expiring')
  })

  it('falls back to the server counts when the key list is unavailable', () => {
    expect(settingsBannerPriority(stats({ byokKeysFailing: 2 }), null, true)).toBe('keys_attention')
    expect(settingsBannerPriority(stats({ byokKeysUntested: 1 }), null, true)).toBe('keys_unchecked')
  })

  it('orders the remaining checks: Claude key, widget, unchecked keys, alerts', () => {
    expect(settingsBannerPriority(stats(), summary(), false)).toBe('no_anthropic')
    expect(settingsBannerPriority(stats({ sdkConfigEnabled: false }), summary(), true)).toBe('sdk_off')
    expect(settingsBannerPriority(stats(), summary({ checking: 1 }), true)).toBe('keys_unchecked')
    expect(
      settingsBannerPriority(stats({ slackConfigured: false, sentryConfigured: false }), summary(), true),
    ).toBe('routing_optional')
  })
})
