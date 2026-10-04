/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { apiErrorMessage, humanizeApiError, parsePageDataError } from './humanizeApiError'

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

describe('apiErrorMessage', () => {
  it('never shows a raw Postgres message', () => {
    const msg = apiErrorMessage(
      { code: 'DB_ERROR', message: 'duplicate key value violates unique constraint "bug_ontology_pkey"' },
      'Could not add the tag.',
    )
    expect(msg).not.toMatch(/duplicate key|constraint/)
  })

  it('falls back when the message is only a code', () => {
    expect(apiErrorMessage({ code: 'ERROR', message: 'INTERNAL_ERROR' }, 'Try again.')).toBe('Try again.')
  })

  it('explains AI failures in plain English', () => {
    expect(apiErrorMessage({ code: 'LLM_ERROR', message: 'upstream 529' }, 'x')).toMatch(/AI model/)
    expect(apiErrorMessage({ code: 'NO_LLM_KEY', message: 'no key' }, 'x')).toMatch(/API keys/)
    expect(apiErrorMessage({ code: 'RATE_LIMITED', message: 'rate' }, 'x')).toMatch(/Too many requests/)
  })

  it('keeps a validation message written for people', () => {
    expect(apiErrorMessage({ code: 'VALIDATION_ERROR', message: 'target_url: Invalid url' }, 'x')).toBe('target_url: Invalid url')
  })

  it('keeps the server reason when an action is refused', () => {
    expect(apiErrorMessage({ code: 'FORBIDDEN', message: 'Viewers cannot merge report groups.' }, 'x')).toBe(
      'Viewers cannot merge report groups.',
    )
    expect(apiErrorMessage({ code: 'FORBIDDEN', message: 'FORBIDDEN' }, 'x')).toMatch(/access/)
  })

  it('handles missing errors and plain strings', () => {
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback')
    expect(apiErrorMessage('Story is disabled', 'fallback')).toBe('Story is disabled')
  })
})
