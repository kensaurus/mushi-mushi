/**
 * FILE: apps/admin/src/lib/statCardLinks.test.ts
 * PURPOSE: Snapshot cards that open /reports carry the filters that
 *          reproduce their count. /reports reads no `tab` param, so
 *          `?tab=queue` / `?tab=severity` opened the unfiltered list, and
 *          `/inbox?tab=inbox` is not a tab (2026-10-04 console audit, group B
 *          items 79 and 236).
 */

import { describe, expect, it } from 'vitest'
import { inboxLinks, reportsLinks } from './statCardLinks'
import { EMPTY_INBOX_STATS } from '../components/inbox/types'

describe('inbox and reports stat links', () => {
  it('never point /reports at a tab param', () => {
    for (const href of [inboxLinks.backlog, inboxLinks.critical, ...Object.values(reportsLinks)]) {
      expect(href).not.toMatch(/[?&]tab=/)
    }
  })

  it('Critical 14d opens open critical reports from the same window', () => {
    expect(inboxLinks.critical).toBe('/reports?status=open&severity=critical&days=14')
  })

  it('Open falls back to a tab that exists', () => {
    expect(inboxLinks.open({ ...EMPTY_INBOX_STATS, topPriorityTo: null })).toBe('/inbox?tab=actions')
  })
})
