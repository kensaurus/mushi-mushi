/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/storage/StorageSnapshotStrip.test.tsx
 * PURPOSE: Round-3 sweep (2026-11-19): built-in storage with nothing saved is one line, not a
 *          chip, a sentence and two empty tiles saying it four ways.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { StorageSnapshotStrip } from './StorageSnapshotStrip'
import type { StorageStats } from './types'

function html(stats: Partial<StorageStats>): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(StorageSnapshotStrip, {
        stats: { projectId: 'p1', projectName: 'kensaur.us', activeProjectConfigured: false, activeProjectObjects: 0, activeProjectLastWrite: null, ...stats } as StorageStats,
        statsFetchedAt: null,
        onTab: () => {},
      }),
    ),
  )
}

describe('StorageSnapshotStrip', () => {
  it('says built-in and empty in one line with no tiles', () => {
    const out = html({})
    expect(out).toContain('kensaur.us · built-in storage · no screenshots yet')
    expect(out).toContain('Use your own bucket')
    expect(out).not.toContain('Screenshots</')
    expect(out).not.toContain('Never')
  })

  it('keeps the numbers once this app has saved screenshots', () => {
    const out = html({ activeProjectObjects: 12, activeProjectLastWrite: new Date().toISOString() })
    expect(out).toContain('kensaur.us stores screenshots in Mushi Mushi')
    expect(out).toContain('Screenshots')
  })
})
