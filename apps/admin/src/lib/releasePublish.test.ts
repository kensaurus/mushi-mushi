/**
 * FILE: apps/admin/src/lib/releasePublish.test.ts
 * PURPOSE: The publish toast must report the real delivery counts (QA bug 56)
 *          and treat "live, but follow-ups failed" as published (bug 207).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ apiFetchRaw: vi.fn() }))

import { readPublishResponse } from './releasePublish'

describe('readPublishResponse', () => {
  it('reads the top-level delivery block apiFetch used to drop', () => {
    const outcome = readPublishResponse({
      ok: true,
      data: { id: 'r1' },
      notified: 3,
      delivery: { reporters_notified: 3, reporters_held: 1, reporters_failed: 2, reports_already_released: 0 },
    })
    expect(outcome).toEqual({ kind: 'published', told: 3, held: 1, failed: 2, alreadyShipped: 0 })
  })

  it('reports a live release with failed follow-ups as published', () => {
    const outcome = readPublishResponse({
      ok: false,
      published: true,
      error: { code: 'PUBLISHED_WITH_ERRORS', message: 'The release is live, but some follow-up steps failed.' },
    })
    expect(outcome.kind).toBe('published-with-errors')
  })

  it('reports a real failure in plain English', () => {
    const outcome = readPublishResponse({ ok: false, published: false, error: { code: 'NOT_A_DRAFT', message: 'This release is already published.' } })
    expect(outcome).toEqual({ kind: 'failed', message: 'This release is already published.' })
  })

  it('never shows [object Object] for a legacy error', () => {
    const outcome = readPublishResponse({ ok: false, error: { code: 'DB_ERROR' } })
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.message).not.toContain('[object')
  })
})
