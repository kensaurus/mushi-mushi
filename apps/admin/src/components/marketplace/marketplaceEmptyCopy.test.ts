/**
 * 2026-11-18: an empty Plugins page said "No plugins installed yet" above five
 * cards that said "Already on Integrations". The empty copy now names what is
 * left to install here.
 */
import { describe, expect, it } from 'vitest'
import { displayPluginText, displayPublisher, marketplaceEmptyCopy, showOfficialChip, splitCatalog } from './types'

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

describe('catalogue grouping (round-2 sweep 2026-11-18)', () => {
  const cat = [
    { slug: 'sentry', name: 'Sentry Mirror', is_official: true },
    { slug: 'linear', name: 'Linear Sync', is_official: true },
    { slug: 'zapier', name: 'Zapier Bridge', is_official: true },
  ]
  it('draws a card only for what installs here; the rest fold into one row of links', () => {
    const { own, covered } = splitCatalog(cat, new Set())
    expect(own.map((p) => p.slug)).toEqual(['zapier'])
    expect(covered.map((p) => p.href)).toEqual(['/integrations/config#platform-card-sentry', '/integrations/config#integrations-linear'])
  })
  it('keeps an installed covered plugin as a card so it can be uninstalled', () => {
    expect(splitCatalog(cat, new Set(['linear'])).own.map((p) => p.slug)).toEqual(['linear', 'zapier'])
  })
  it('hides "Official" when every plugin is official', () => {
    expect(showOfficialChip(cat)).toBe(false)
    expect(showOfficialChip([...cat, { slug: 'x', name: 'X', is_official: false }])).toBe(true)
  })
  it('says "Mushi Mushi", never "Mushi"', () => {
    expect(displayPublisher('Mushi')).toBe('Mushi Mushi')
    expect(displayPublisher('mushi-mushi')).toBe('Mushi Mushi')
    expect(displayPublisher('Acme')).toBe('Acme')
    expect(displayPluginText('Fan out any Mushi event.')).toBe('Fan out any Mushi Mushi event.')
    expect(displayPluginText('Mushi Mushi events')).toBe('Mushi Mushi events')
  })
})
