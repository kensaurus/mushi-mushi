/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { humanizeApiError, parsePageDataError } from './humanizeApiError'

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

describe('humanizeApiError action errors (group B, 2026-10-04)', () => {
  it('maps dispatch codes to plain English with the fix', () => {
    const h = humanizeApiError('Enable Autofix in project settings first', 'AUTOFIX_DISABLED', { action: 'queue the fix' })
    expect(h?.title).toBe('Auto-fix is off for this project.')
    expect(h?.action?.target).toEqual({ kind: 'route', to: '/settings?tab=autofix' })
  })

  it('maps test-gen codes to the GitHub fix', () => {
    const h = humanizeApiError('GitHub token not configured', 'NO_GITHUB_TOKEN', { action: 'generate the test' })
    expect(h?.action?.target).toMatchObject({ kind: 'route', to: '/integrations/config', hash: 'platform-card-github' })
  })

  it('an unknown code on an action names the action and never echoes the raw text', () => {
    const h = humanizeApiError('duplicate key value violates unique constraint "x"', 'DISPATCH_FAILED', { action: 'queue the fix' })
    expect(h?.title).toBe('Could not queue the fix.')
    expect(h?.hint).not.toMatch(/duplicate key/)
  })

  it('page loads keep their existing fallback', () => {
    expect(humanizeApiError('Something odd (WEIRD_CODE)')?.title).toBe('Could not load this page.')
  })
})
