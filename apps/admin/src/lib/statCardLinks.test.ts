/**
 * Stat cards must land somewhere real (suspected-bugs entries 110 and 257):
 * Settings has no `sdk` tab, and /sso has no tabs at all.
 */

import { describe, expect, it } from 'vitest'
import { settingsLinks, ssoLinks } from './statCardLinks'

const SETTINGS_TABS = ['general', 'byok', 'firecrawl', 'browserbase', 'voice', 'health', 'dev']

describe('settingsLinks', () => {
  it('points every ?tab= link at a tab Settings renders', () => {
    for (const to of Object.values(settingsLinks)) {
      const url = new URL(to, 'https://console.test')
      if (url.pathname !== '/settings') continue
      const tab = url.searchParams.get('tab')
      if (tab) expect(SETTINGS_TABS).toContain(tab)
    }
  })

  it('sends the bug-widget card to Health, where the widget controls are', () => {
    expect(settingsLinks.sdk).toBe('/settings?tab=health')
  })
})

describe('ssoLinks', () => {
  it('scrolls to the providers list instead of a tab that does not exist', () => {
    for (const to of [ssoLinks.registered, ssoLinks.pendingFailed, ssoLinks.emailDomains]) {
      expect(to).toBe('/sso#sso-providers')
    }
  })
})
