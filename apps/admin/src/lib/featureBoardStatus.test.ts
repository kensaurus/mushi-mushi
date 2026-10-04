/**
 * FILE: apps/admin/src/lib/featureBoardStatus.test.ts
 * PURPOSE: The Shipped badge counts what the Shipped filter lists (QA bug
 *          202), and cancelled requests are closed (bug 312).
 */

import { describe, expect, it } from 'vitest'
import { isFeatureClosed, isFeatureShipped } from './featureBoardStatus'

describe('isFeatureShipped', () => {
  it('counts items marked shipped from the board (no release id)', () => {
    expect(isFeatureShipped({ status: 'resolved', shipped_in_release_id: null, shipped_at: '2026-10-01T00:00:00Z' })).toBe(true)
  })

  it('counts items shipped through a release', () => {
    expect(isFeatureShipped({ status: 'open', shipped_in_release_id: 'rel-1' })).toBe(true)
  })

  it('does not count open requests', () => {
    expect(isFeatureShipped({ status: 'open', shipped_in_release_id: null, shipped_at: null })).toBe(false)
  })
})

describe('isFeatureClosed', () => {
  it('treats cancelled requests as closed', () => {
    expect(isFeatureClosed({ status: 'cancelled', shipped_in_release_id: null })).toBe(true)
    expect(isFeatureClosed({ status: 'in_progress', shipped_in_release_id: null })).toBe(false)
  })
})
