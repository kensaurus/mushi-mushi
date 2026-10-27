/**
 * A report imported from Sentry often carries only the issue link and no
 * event ids or breadcrumbs. The panel used to return nothing for it, hiding
 * the "Open in Sentry" link. It now shows the issue and its resolve state.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})

describe('breadcrumb data scroll region', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const crumbs = {
    mushiBreadcrumbs: [
      { timestamp: 1_700_000_000_000, category: 'custom', level: 'info', message: 'paid', data: { intentId: 'pi_1' } },
      { timestamp: 1_700_000_001_000, category: 'custom', level: 'info', message: 'refunded', data: { intentId: 'pi_2' } },
    ],
  }

  function render(): void {
    act(() => {
      root.render(createElement(SentryContextPanel, crumbs))
    })
  }

  function mockBox(scroll: number, client: number) {
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll)
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client)
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll)
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client)
    return () => {
      scrollWidth.mockRestore()
      clientWidth.mockRestore()
      scrollHeight.mockRestore()
      clientHeight.mockRestore()
    }
  }

  it('does not tab to breadcrumb data that fits', () => {
    const restore = mockBox(80, 80)
    try {
      render()
      const pres = container.querySelectorAll('pre')
      expect(pres.length).toBe(2)
      for (const pre of pres) {
        expect(pre.hasAttribute('tabindex')).toBe(false)
        expect(pre.hasAttribute('role')).toBe(false)
        expect(pre.hasAttribute('aria-label')).toBe(false)
      }
    } finally {
      restore()
    }
  })

  it('names each overflowing breadcrumb data block on its own', () => {
    const restore = mockBox(480, 80)
    try {
      render()
      const pres = Array.from(container.querySelectorAll('pre'))
      expect(pres.map((pre) => pre.getAttribute('aria-label'))).toEqual([
        'Breadcrumb 1 data: paid',
        'Breadcrumb 2 data: refunded',
      ])
      for (const pre of pres) {
        expect(pre.getAttribute('tabindex')).toBe('0')
        expect(pre.getAttribute('role')).toBe('region')
      }
    } finally {
      restore()
    }
  })
})
