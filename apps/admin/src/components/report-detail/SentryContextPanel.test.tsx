/**
 * A report imported from Sentry often carries only the issue link and no
 * event ids or breadcrumbs. The panel used to return nothing for it, hiding
 * the "Open in Sentry" link. It now shows the issue and its resolve state.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SentryContextPanel } from './SentryContextPanel'

const html = (props: Parameters<typeof SentryContextPanel>[0]) => renderToStaticMarkup(createElement(SentryContextPanel, props))

describe('SentryContextPanel for an imported Sentry issue', () => {
  it('renders with only the issue link', () => {
    const out = html({ sentryIssueUrl: 'https://acme.sentry.io/issues/4501/' })
    expect(out).toContain('Open in Sentry')
    expect(out).toContain('https://acme.sentry.io/issues/4501/')
  })

  it('says the issue resolves on merge until Sentry accepted the resolve', () => {
    const open = html({ sentryLinks: [{ external_id: '4501', external_url: 'https://acme.sentry.io/issues/4501/', resolved_at: null }] })
    expect(open).toContain('Resolves in Sentry when the fix merges')
    expect(open).toContain('Open in Sentry')

    const done = html({
      sentryLinks: [{ external_id: '4501', external_url: null, resolved_at: new Date(Date.now() - 3_600_000).toISOString() }],
    })
    expect(done).toContain('Resolved in Sentry')
    expect(done).not.toContain('when the fix merges')
  })

  it('still renders nothing for a report with no Sentry data at all', () => {
    expect(html({})).toBe('')
  })

  it('names the breadcrumb data block as a region', () => {
    const out = html({
      mushiBreadcrumbs: [{
        timestamp: 1_700_000_000_000,
        category: 'custom',
        level: 'info',
        message: 'paid',
        data: { intentId: 'pi_1' },
      }],
    })
    const pre = out.match(/<pre\b[^>]*>/)?.[0] ?? ''
    expect(pre).toContain('tabindex="0"')
    expect(pre).toContain('role="region"')
    expect(pre).toContain('aria-label="Breadcrumb data"')
  })
})
