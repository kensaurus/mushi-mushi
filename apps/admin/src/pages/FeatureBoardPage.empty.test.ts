/**
 * Feature requests with none yet said "No feature requests yet." in the
 * status line and again as the list's empty card right below (2026-10-28).
 * The status line now waits for the first request. The page is too heavy to
 * render here, so the slot is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'FeatureBoardPage.tsx'), 'utf8')
const slot = src.slice(src.indexOf('<PagePosture'), src.indexOf('<FeatureBoardSnapshotStrip'))

describe('Feature requests with no requests', () => {
  it('shows the status line only once there is a request', () => {
    expect(slot).toContain('show: clientStats.totalTickets > 0')
  })

  it('keeps the empty card that explains how requests arrive', () => {
    expect(src).toContain('title="No feature requests yet"')
  })
})
