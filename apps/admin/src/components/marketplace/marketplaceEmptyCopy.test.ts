/**
 * 2026-11-18: an empty Plugins page said "No plugins installed yet" above five
 * cards that said "Already on Integrations". The empty copy now names what is
 * left to install here.
 */
import { describe, expect, it } from 'vitest'
import { marketplaceEmptyCopy } from './types'

describe('marketplaceEmptyCopy', () => {
  it('names the one plugin Integrations does not cover', () => {
    const copy = marketplaceEmptyCopy([
      { slug: 'pagerduty', name: 'PagerDuty Escalation' },
      { slug: 'linear', name: 'Linear Sync' },
      { slug: 'zapier', name: 'Zapier Bridge' },
      { slug: 'sentry', name: 'Sentry Mirror' },
    ])
    expect(copy.title).toBe('Zapier Bridge is the only plugin not covered by Integrations')
    expect(copy.description).toMatch(/^The other 3 are set up from Integrations\./)
  })

  it('lists several uncovered plugins', () => {
    const copy = marketplaceEmptyCopy([
      { slug: 'zapier', name: 'Zapier' },
      { slug: 'webhook', name: 'Webhook' },
      { slug: 'sentry', name: 'Sentry' },
    ])
    expect(copy.title).toBe('Zapier and Webhook are the only plugins not covered by Integrations')
  })

  it('keeps the plain title when nothing is covered elsewhere', () => {
    expect(marketplaceEmptyCopy([{ slug: 'zapier', name: 'Zapier' }]).title).toBe('No plugins installed yet')
    expect(marketplaceEmptyCopy([]).title).toBe('No plugins installed yet')
  })
})
