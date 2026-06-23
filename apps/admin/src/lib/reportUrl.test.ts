/**
 * FILE: apps/admin/src/lib/reportUrl.test.ts
 * PURPOSE: Lock shareable admin URL helpers for local and deployed basenames.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { currentAdminViewUrl, reportDetailPath, reportPermalink } from './reportUrl'

const originalHref = typeof window !== 'undefined' ? window.location.href : null

function setLocation(href: string): void {
  const u = href.startsWith('http') ? new URL(href) : new URL(href, 'http://localhost')
  window.history.replaceState({}, '', u.pathname + u.search + u.hash)
}

afterEach(() => {
  if (originalHref) setLocation(originalHref)
})

describe('reportUrl helpers', () => {
  it('builds report permalinks with encoded id and no doubled basename', () => {
    expect(reportPermalink('abc-123')).toMatch(/\/reports\/abc-123$/)
    expect(reportPermalink('abc-123')).not.toMatch(/admin\/mushi-mushi/)
  })

  it('adds project query param to detail paths when scoped', () => {
    expect(reportDetailPath('abc-123', '11111111-1111-4111-8111-111111111111')).toBe(
      '/reports/abc-123?project=11111111-1111-4111-8111-111111111111',
    )
  })

  it('returns the live browser URL for copy-view (no basename doubling)', () => {
    setLocation('/mushi-mushi/admin/reports?status=new&project=p1#queue')
    const href = currentAdminViewUrl()
    expect(href).toMatch(/\/mushi-mushi\/admin\/reports\?status=new&project=p1#queue$/)
    expect(href).not.toMatch(/mushi-mushi\/admin\/mushi-mushi\/admin/)
  })
})
