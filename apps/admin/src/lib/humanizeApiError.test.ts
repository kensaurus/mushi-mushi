/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { describeApiFailure, humanizeApiError, isPlainSentence, parsePageDataError } from './humanizeApiError'

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

describe('describeApiFailure', () => {
  it('keeps a plain server sentence', () => {
    expect(
      describeApiFailure({ code: 'FORBIDDEN', message: 'Only organization owners and admins can change credentials.' }, 'Could not save'),
    ).toEqual({ title: 'Could not save', description: 'Only organization owners and admins can change credentials.' })
  })

  it('maps a bare code without showing it', () => {
    const t = describeApiFailure({ code: 'BAD_KIND', message: 'BAD_KIND' }, 'Probe failed for Linear')
    expect(t.description).not.toMatch(/BAD_KIND/)
    expect(t.description).toMatch(/cannot be tested/)
  })

  it('never shows a column-name dump', () => {
    const t = describeApiFailure(
      { code: 'INVALID_WEBHOOK_URL', message: 'teams_webhook_url: host is not an allowed webhook provider' },
      'Could not save the Teams webhook',
    )
    expect(t.description).not.toMatch(/teams_webhook_url/)
  })

  it('falls back to a generic next step for unknown failures', () => {
    const t = describeApiFailure({ code: 'ERROR', message: 'Request failed' }, 'Could not trigger job')
    expect(t.description).toMatch(/Retry/)
  })

  it('isPlainSentence rejects codes and envelopes', () => {
    expect(isPlainSentence('NO_FIELDS')).toBe(false)
    expect(isPlainSentence('Request failed')).toBe(false)
    expect(isPlainSentence('Add an access token to test Vercel.')).toBe(true)
    expect(isPlainSentence('webhookUrl must be a public https URL (private host).')).toBe(false)
    expect(isPlainSentence('pluginName is required')).toBe(false)
    expect(isPlainSentence('400: {"error":{"code":"X"}}')).toBe(false)
  })
})
