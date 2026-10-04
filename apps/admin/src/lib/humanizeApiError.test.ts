/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { describeApiError, humanizeApiError, parsePageDataError } from './humanizeApiError'

describe('parsePageDataError', () => {
  it('extracts code from usePageData format', () => {
    expect(parsePageDataError('X-Mushi-Org-Id header required (NO_ORG)')).toEqual({
      message: 'X-Mushi-Org-Id header required',
      code: 'NO_ORG',
    })
  })

  it('returns plain message when no code', () => {
    expect(parsePageDataError('Request failed')).toEqual({ message: 'Request failed' })
  })
})

describe('humanizeApiError', () => {
  it('maps NO_ORG to a team-switch hint', () => {
    const h = humanizeApiError('X-Mushi-Org-Id header required (NO_ORG)')
    expect(h?.code).toBe('NO_ORG')
    expect(h?.title).toMatch(/team/i)
    expect(h?.action?.target).toMatchObject({ kind: 'route' })
  })

  it('maps NETWORK_ERROR to soft retry', () => {
    const h = humanizeApiError('Failed to fetch', 'NETWORK_ERROR')
    expect(h?.severity).toBe('soft')
    expect(h?.action?.target).toEqual({ kind: 'retry' })
  })

  it('falls back helpfully for unknown codes', () => {
    const h = humanizeApiError('Something odd (WEIRD_CODE)')
    expect(h?.title).toBeTruthy()
    expect(h?.hint.length).toBeGreaterThan(10)
  })
})

describe('humanizeApiError extra codes', () => {
  it('maps REGION_LOCKED and NOT_FOUND to plain sentences', () => {
    expect(humanizeApiError('x', 'REGION_LOCKED')?.title).toMatch(/pinned to a region/)
    expect(humanizeApiError('NOT_FOUND', 'NOT_FOUND')?.title).toMatch(/no longer exists/)
  })

  it('maps a lowercase explicit code', () => {
    expect(humanizeApiError('Upgrade required', 'feature_not_in_plan')?.title).toMatch(/plan/)
  })
})

describe('describeApiError', () => {
  it('keeps a readable server sentence', () => {
    expect(describeApiError({ code: 'FORBIDDEN', message: 'Not your project' }, 'Could not save')).toEqual({
      title: 'Could not save',
      hint: 'Not your project',
    })
  })

  it('never shows a bare code', () => {
    const d = describeApiError({ code: 'FORBIDDEN', message: 'FORBIDDEN' }, 'Could not cancel')
    expect(d.hint).not.toMatch(/FORBIDDEN/)
    expect(d.hint).toMatch(/access/i)
  })

  it('never shows a JSON blob or SQL text', () => {
    expect(describeApiError({ code: 'SCAN_FAILED', message: '{"error":"boom"}' }, 'Scan failed').hint).not.toMatch(/[{}]/)
    expect(describeApiError({ code: 'DB_ERROR', message: 'relation "x" does not exist' }, 'Save failed').hint).not.toMatch(/relation/)
  })

  it('strips a trailing (CODE) suffix', () => {
    expect(describeApiError({ message: 'Project is pinned (REGION_LOCKED)' }, 'Could not pin').hint).toBe('Project is pinned')
  })

  it('falls back when there is no error at all', () => {
    expect(describeApiError(undefined, 'Could not save').hint).toMatch(/Try again/)
  })
})
