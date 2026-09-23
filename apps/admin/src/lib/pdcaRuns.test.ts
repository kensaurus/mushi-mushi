import { describe, expect, it } from 'vitest'
import { coerceApiResult } from './apiEnvelope'
import { pdcaRunsFromEnvelope, type PdcaRunsEnvelope } from './pdcaRuns'

type R = { id: string; status: string }

describe('pdcaRunsFromEnvelope', () => {
  it('unwraps the re-nested flat-paginated shape coerceApiResult produces', () => {
    const r = pdcaRunsFromEnvelope<R>({
      data: [{ id: '1', status: 'queued' }],
      total: 7,
      page: 1,
      limit: 50,
    })
    expect(r.runs.map((x) => x.id)).toEqual(['1'])
    expect(r.total).toBe(7)
  })

  it('accepts a bare array — no pagination siblings means coerceApiResult leaves it alone', () => {
    const r = pdcaRunsFromEnvelope<R>([{ id: '2', status: 'running' }])
    expect(r.runs).toHaveLength(1)
    expect(r.total).toBeNull()
  })

  it('yields an empty list for null, undefined or garbage instead of throwing', () => {
    expect(pdcaRunsFromEnvelope<R>(null).runs).toEqual([])
    expect(pdcaRunsFromEnvelope<R>(undefined).runs).toEqual([])
    expect(pdcaRunsFromEnvelope<R>({} as PdcaRunsEnvelope<R>).runs).toEqual([])
  })

  it('survives the exact wire envelope the page received on 2026-09-23', () => {
    // Captured from the live console: /v1/admin/pdca?project_id=…&limit=50
    const wire = {
      ok: true,
      data: [{ id: '64156bce-64e7-4115-9abf-3bffde67fd0c', status: 'succeeded' }],
      total: 2,
      page: 1,
      limit: 50,
    }
    const coerced = coerceApiResult<PdcaRunsEnvelope<R>>(wire)
    expect(coerced.ok).toBe(true)
    // This is the shape that reached IteratePage — an object, not the array.
    expect(Array.isArray(coerced.data)).toBe(false)
    const r = pdcaRunsFromEnvelope(coerced.data)
    expect(r.runs).toHaveLength(1)
    expect(r.total).toBe(2)
    // The old code path: array method on the raw hook value.
    expect(() => (coerced.data as unknown as R[]).filter(() => true)).toThrow(TypeError)
  })
})
