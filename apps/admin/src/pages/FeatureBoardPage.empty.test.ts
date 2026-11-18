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

describe('Feature requests empty board (2026-11-18 fresh-eyes)', () => {
  it('shows one plain empty state with no filters and no serif hero', () => {
    const emptyBranch = src.slice(src.indexOf('{projectId && boardEmpty && ('), src.indexOf('{projectId && !boardEmpty && ('))
    expect(emptyBranch).toContain('title="No feature requests yet"')
    expect(emptyBranch).not.toContain('icon=')
    expect(emptyBranch).not.toContain('type="search"')
    expect(src).toContain('const boardEmpty = !loading && !error && tickets.length === 0')
    // The search / status / sort controls live only in the non-empty branch.
    expect(src.indexOf('type="search"')).toBeGreaterThan(src.indexOf('{projectId && !boardEmpty && ('))
  })
})

describe('Feature requests empty board (round-2 sweep 2026-11-18)', () => {
  const emptyBranch = src.slice(src.indexOf('{projectId && boardEmpty && ('), src.indexOf('{projectId && !boardEmpty && ('))
  it('gives its tips as a plain sans list, not EmptyState hints in monospace', () => {
    expect(emptyBranch).not.toContain('hints={')
    expect(emptyBranch).toContain('data-testid="feature-board-empty-tips"')
    expect(emptyBranch).not.toContain('font-mono')
  })
  it('links to My feedback once: the header button steps aside while the board is empty', () => {
    const header = src.slice(src.indexOf('title="Feature requests"'), src.indexOf('</PageHeaderBar>'))
    expect(header).toContain('{!boardEmpty && (')
    expect(emptyBranch.split('Open My feedback').length - 1).toBe(1)
  })
})
