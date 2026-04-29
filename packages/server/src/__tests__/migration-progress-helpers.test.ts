/**
 * Pinning tests for `migration-progress-helpers.ts`.
 *
 * These cover the pure normalisation logic the /v1/admin/migrations/progress
 * route depends on: slug allowlist, step-id sort/dedupe, count clamping, and
 * the structured-error contract that the Hono handler maps 1:1 to HTTP 400
 * response codes.
 *
 * Why pin these:
 *   * `KNOWN_GUIDE_SLUGS` is a manual mirror of `apps/docs/content/migrations/_catalog.ts`.
 *     `scripts/check-migration-catalog-sync.mjs` enforces equality, but a
 *     local change that breaks slugs (e.g. mixed-case sneaking in) should
 *     fail at the unit-test layer too.
 *   * Step-id sort/dedupe is the contract that lets the docs sync hook
 *     compare local + remote sets bit-for-bit; if the helper stops sorting
 *     the merge logic silently double-writes.
 *   * The count guards (≤1000, count<=required) protect the DB CHECK
 *     constraint from a 500 turning into a generic dbError.
 */

import { describe, it, expect } from 'vitest'

import {
  KNOWN_GUIDE_SLUGS,
  isKnownGuideSlug,
  isUuid,
  isProgressSource,
  normalizeStepIds,
  normalizeProgressUpsert,
} from '../../supabase/functions/api/migration-progress-helpers.ts'

describe('KNOWN_GUIDE_SLUGS', () => {
  it('is non-empty and sorted', () => {
    expect(KNOWN_GUIDE_SLUGS.length).toBeGreaterThan(0)
    const sorted = [...KNOWN_GUIDE_SLUGS].sort()
    expect([...KNOWN_GUIDE_SLUGS]).toEqual(sorted)
  })

  it('every slug matches the lowercase-kebab regex enforced by the DB CHECK', () => {
    const re = /^[a-z0-9][a-z0-9-]{0,79}$/
    for (const slug of KNOWN_GUIDE_SLUGS) {
      expect(re.test(slug), `slug "${slug}" violates the DB CHECK shape`).toBe(true)
    }
  })

  it('contains the marquee Phase 1 guide so docs deep links keep working', () => {
    expect(KNOWN_GUIDE_SLUGS).toContain('capacitor-to-react-native')
  })
})

describe('isKnownGuideSlug', () => {
  it('accepts a published slug', () => {
    expect(isKnownGuideSlug('capacitor-to-react-native')).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['unknown', 'made-up-guide'],
    ['uppercase', 'Capacitor-To-React-Native'],
    ['leading dash', '-capacitor'],
    ['trailing whitespace', 'capacitor-to-react-native '],
    ['null', null],
    ['object', { slug: 'capacitor-to-react-native' }],
  ])('rejects %s', (_label, value) => {
    expect(isKnownGuideSlug(value as unknown)).toBe(false)
  })
})

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true)
  })

  it('rejects a non-uuid string', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
  })
})

describe('isProgressSource', () => {
  it.each(['docs', 'admin', 'cli'])('accepts %s', (s) => {
    expect(isProgressSource(s)).toBe(true)
  })

  it('rejects unknown source', () => {
    expect(isProgressSource('marketing')).toBe(false)
  })
})

describe('normalizeStepIds', () => {
  it('sorts alphabetically so equality checks across clients are stable', () => {
    expect(normalizeStepIds(['c', 'a', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('dedupes', () => {
    expect(normalizeStepIds(['a', 'a', 'b', 'b'])).toEqual(['a', 'b'])
  })

  it('drops empty/whitespace-only and trims survivors', () => {
    expect(normalizeStepIds(['  step-1  ', '', '   ', 'step-2'])).toEqual(['step-1', 'step-2'])
  })

  it('drops oversized strings (>200 chars) so we never blow past the DB row limit', () => {
    const big = 'x'.repeat(250)
    expect(normalizeStepIds(['ok', big])).toEqual(['ok'])
  })

  it('drops non-string entries', () => {
    expect(normalizeStepIds(['ok', 1, null, undefined, { id: 'x' }] as unknown[])).toEqual(['ok'])
  })

  it('returns [] for non-array input', () => {
    expect(normalizeStepIds('not-an-array' as unknown)).toEqual([])
    expect(normalizeStepIds(null)).toEqual([])
    expect(normalizeStepIds(undefined)).toEqual([])
  })
})

describe('normalizeProgressUpsert', () => {
  const validProjectId = '11111111-2222-4333-8444-555555555555'

  it('accepts the minimum body and defaults source to "docs"', () => {
    const result = normalizeProgressUpsert({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.projectId).toBeNull()
    expect(result.value.source).toBe('docs')
    expect(result.value.completedStepIds).toEqual([])
    expect(result.value.completedRequiredCount).toBe(0)
  })

  it('passes through valid project_id', () => {
    const result = normalizeProgressUpsert({ project_id: validProjectId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.projectId).toBe(validProjectId)
  })

  it('rejects non-uuid project_id with INVALID_PROJECT_ID', () => {
    const result = normalizeProgressUpsert({ project_id: 'not-a-uuid' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_PROJECT_ID')
  })

  it('treats explicit null project_id as account-scoped', () => {
    const result = normalizeProgressUpsert({ project_id: null })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.projectId).toBeNull()
  })

  it('infers completed_required_count from completed_step_ids when omitted', () => {
    const result = normalizeProgressUpsert({
      completed_step_ids: ['intro', 'setup', 'verify'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.completedRequiredCount).toBe(3)
  })

  it('clamps inferred completed_required_count to required_step_count when smaller', () => {
    const result = normalizeProgressUpsert({
      completed_step_ids: ['a', 'b', 'c'],
      required_step_count: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.completedRequiredCount).toBe(2)
  })

  it('rejects explicit completed_required_count > required_step_count with COUNT_MISMATCH', () => {
    const result = normalizeProgressUpsert({
      required_step_count: 3,
      completed_required_count: 5,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('COUNT_MISMATCH')
  })

  it('rejects negative required_step_count', () => {
    const result = normalizeProgressUpsert({ required_step_count: -1 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_REQUIRED_COUNT')
  })

  it('rejects non-integer completed_required_count', () => {
    const result = normalizeProgressUpsert({ completed_required_count: 1.5 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_COMPLETED_COUNT')
  })

  it('caps required_step_count at 1000 to protect the DB from runaway clients', () => {
    const result = normalizeProgressUpsert({ required_step_count: 5000 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_REQUIRED_COUNT')
  })

  it('falls back to "docs" for unknown source', () => {
    const result = normalizeProgressUpsert({ source: 'marketing' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.source).toBe('docs')
  })

  it('round-trips a valid client_updated_at to ISO', () => {
    const result = normalizeProgressUpsert({ client_updated_at: '2026-04-29T12:00:00Z' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.clientUpdatedAt).toBe('2026-04-29T12:00:00.000Z')
  })

  it('rejects invalid client_updated_at with INVALID_TIMESTAMP', () => {
    const result = normalizeProgressUpsert({ client_updated_at: 'not-a-date' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INVALID_TIMESTAMP')
  })
})
