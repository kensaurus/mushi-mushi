/**
 * discovery-event-schema — pins the validation contract for the
 * /v1/sdk/discovery endpoint after the inline Zod refactor (audit
 * follow-up — discovery validation is now testable + greppable in
 * `_shared/schemas.ts` instead of bouncing 30+ lines of manual coercion
 * inline in routes/public.ts).
 *
 * Each test below corresponds to a failure mode that an SDK that
 * misbehaves OR a malicious caller could exercise.
 */

import { describe, expect, it } from 'vitest'
import { discoveryEventSchema } from '../../supabase/functions/_shared/schemas.ts'

describe('discoveryEventSchema', () => {
  it('accepts a minimal well-formed event', () => {
    const r = discoveryEventSchema.safeParse({ route: '/dashboard' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.route).toBe('/dashboard')
      expect(r.data.testids).toEqual([])
      expect(r.data.network_paths).toEqual([])
      expect(r.data.user_id_hash).toBeNull()
    }
  })

  it('strips ?query and #fragment from route on the way in', () => {
    const r = discoveryEventSchema.safeParse({
      route: '/dashboard?utm_source=email#hash',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.route).toBe('/dashboard')
  })

  it('rejects routes that do not start with /', () => {
    const r = discoveryEventSchema.safeParse({ route: 'dashboard' })
    expect(r.success).toBe(false)
  })

  it('rejects routes longer than 400 chars', () => {
    const longRoute = '/' + 'a'.repeat(400)
    const r = discoveryEventSchema.safeParse({ route: longRoute })
    expect(r.success).toBe(false)
  })

  it('caps testids array at 200 entries', () => {
    const testids = Array.from({ length: 201 }, (_, i) => `tid-${i}`)
    const r = discoveryEventSchema.safeParse({ route: '/x', testids })
    expect(r.success).toBe(false)
  })

  it('rejects testids longer than 120 chars', () => {
    const r = discoveryEventSchema.safeParse({
      route: '/x',
      testids: ['a'.repeat(121)],
    })
    expect(r.success).toBe(false)
  })

  it('rejects malformed user_id_hash (not 64-char SHA-256 hex)', () => {
    const r = discoveryEventSchema.safeParse({
      route: '/x',
      user_id_hash: 'not-a-hash',
    })
    expect(r.success).toBe(false)
  })

  it('accepts a real-shape SHA-256 hex hash', () => {
    const r = discoveryEventSchema.safeParse({
      route: '/x',
      user_id_hash: 'a'.repeat(64),
    })
    expect(r.success).toBe(true)
  })

  it('accepts user_id_hash=null', () => {
    const r = discoveryEventSchema.safeParse({ route: '/x', user_id_hash: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.user_id_hash).toBeNull()
  })

  it('caps query_param_keys at 50 entries', () => {
    const keys = Array.from({ length: 51 }, (_, i) => `k${i}`)
    const r = discoveryEventSchema.safeParse({ route: '/x', query_param_keys: keys })
    expect(r.success).toBe(false)
  })

  it('truncates dom_summary at 240 chars (rejects, does not silently truncate)', () => {
    const r = discoveryEventSchema.safeParse({
      route: '/x',
      dom_summary: 'a'.repeat(241),
    })
    expect(r.success).toBe(false)
  })

  it('returns one issue per failure for caller-friendly error envelopes', () => {
    const r = discoveryEventSchema.safeParse({
      route: 'no-slash',
      sdk_version: 'a'.repeat(41),
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.length).toBeGreaterThanOrEqual(2)
  })
})
