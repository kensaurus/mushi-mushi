/**
 * FILE: inbox-banner.test.ts
 * PURPOSE: The /inbox banner must not describe failing connections as code bugs.
 *
 * Regression: four open items, two of them integration actions, still showed
 * "Read each diagnosis, then dispatch a fix or close it as not a code bug."
 */

import { describe, expect, it } from 'vitest'
import { inboxBannerLabel, type InboxBannerFlag } from '../../supabase/functions/_shared/inbox-banner.ts'

const REPORT_HINT = 'Read each diagnosis, then dispatch a fix or close it as not a code bug.'

function flag(stage: string, hint: string): InboxBannerFlag {
  return { stage, hint }
}

describe('inboxBannerLabel', () => {
  it('keeps the report hint when every open item is a report', () => {
    expect(inboxBannerLabel([flag('plan', REPORT_HINT)])).toBe(REPORT_HINT)
  })

  it('keeps a connection hint when every open item is a connection', () => {
    const hint = 'Fix-worker cannot ship PRs until GitHub and routing are healthy.'
    expect(
      inboxBannerLabel([
        flag('act', hint),
        flag('ops', 'Run probes in Health — degraded tools may silently drop context.'),
      ]),
    ).toBe(hint)
  })

  it('says which of the open items are failing connections', () => {
    const label = inboxBannerLabel([
      flag('plan', REPORT_HINT),
      flag('do', 'Open each one to read why the last attempt stopped, then retry or hand off to your editor.'),
      flag('act', 'Fix-worker cannot ship PRs until GitHub and routing are healthy.'),
      flag('ops', 'Run probes in Health — degraded tools may silently drop context.'),
    ])
    expect(label).toBe(
      'Read each diagnosis, then dispatch a fix or close it as not a code bug. 2 of these 4 are failing connections — reconnect them instead.',
    )
  })

  it('returns null when nothing is open', () => {
    expect(inboxBannerLabel([])).toBeNull()
  })
})
