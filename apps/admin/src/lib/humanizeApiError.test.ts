/**
 * FILE: apps/admin/src/lib/humanizeApiError.test.ts
 * PURPOSE: Unit tests for page-load error humanization.
 */

import { describe, expect, it } from 'vitest'
import { apiErrorMessage, describeApiError, humanizeApiError, parsePageDataError, plainApiError } from './humanizeApiError'

// Group K entries 215 and 216: action toasts printed raw slugs, codes and JSON.
describe('plainApiError', () => {
  it('maps a bare slug message (coerced to code ERROR) to plain English', () => {
    const text = plainApiError({ code: 'ERROR', message: 'region_not_supported' }, 'Could not join.')
    expect(text).not.toContain('region_not_supported')
    expect(text).toMatch(/country/i)
  })

  it('maps an upper-case code with no message', () => {
    const text = plainApiError({ code: 'INVALID_WEBHOOK', message: 'INVALID_WEBHOOK' }, 'x')
    expect(text).toMatch(/https:\/\//)
  })

  it('keeps a readable server sentence', () => {
    expect(plainApiError({ code: 'daily_cap_exceeded', message: 'Daily acceptance cap reached for this bounty tier.' }, 'x'))
      .toBe('Daily acceptance cap reached for this bounty tier.')
  })

  it('reads the JSON out of an HTTP_ERROR body', () => {
    const text = plainApiError(
      { code: 'HTTP_ERROR', message: '400: {"error":{"formErrors":[],"fieldErrors":{"name":["Required"]}}}' },
      'Save failed.',
    )
    expect(text).toBe('Name: Required')
  })

  it('never shows [object Object] or raw database text', () => {
    expect(plainApiError({ code: 'ERROR', message: '[object Object]' }, 'Save failed.')).toBe('Save failed.')
    expect(plainApiError({ code: 'DB_ERROR', message: 'relation "x" does not exist' }, 'Save failed.'))
      .not.toContain('relation')
  })

  it('falls back when there is nothing usable', () => {
    expect(plainApiError(null, 'Could not save.')).toBe('Could not save.')
    expect(plainApiError({ code: 'HTTP_ERROR', message: '502: <html>' }, 'Could not save.')).toBe('Could not save.')
  })
})

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

describe('humanizeApiError extra codes', () => {
  it('maps REGION_LOCKED and NOT_FOUND to plain sentences', () => {
    expect(humanizeApiError('x', 'REGION_LOCKED')?.title).toMatch(/pinned to a region/)
    expect(humanizeApiError('NOT_FOUND', 'NOT_FOUND')?.title).toMatch(/could not be found/)
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

  it('reads the sentence out of a worker JSON reply', () => {
    expect(
      describeApiError({ code: 'UPSTREAM_ERROR', message: '{"error":"No metric data for this project"}' }, 'Detection failed').hint,
    ).toBe('No metric data for this project')
  })

  it('never shows a JSON blob or SQL text', () => {
    expect(describeApiError({ code: 'SCAN_FAILED', message: '{"detail":["x"]}' }, 'Scan failed').hint).not.toMatch(/[{}]/)
    expect(describeApiError({ code: 'DB_ERROR', message: 'relation "x" does not exist' }, 'Save failed').hint).not.toMatch(/relation/)
  })

  it('strips a trailing (CODE) suffix', () => {
    expect(describeApiError({ message: 'Project is pinned (REGION_LOCKED)' }, 'Could not pin').hint).toBe('Project is pinned')
  })

  it('falls back when there is no error at all', () => {
    expect(describeApiError(undefined, 'Could not save').hint).toMatch(/Try again/)
  })
})

describe('humanizeApiError action errors (group B, 2026-10-04)', () => {
  it('maps dispatch codes to plain English with the fix', () => {
    const h = humanizeApiError('Enable Autofix in project settings first', 'AUTOFIX_DISABLED', { action: 'queue the fix' })
    expect(h?.title).toBe('Auto-fix is off for this project.')
    expect(h?.action?.target).toEqual({ kind: 'route', to: '/integrations/config', hash: 'integrations-codebase' })
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

describe('humanizeApiError: invitation accept (QA #68)', () => {
  it('never shows the raw RPC text as the headline', () => {
    for (const [message, code] of [
      ['invitation_email_mismatch', 'EMAIL_MISMATCH'],
      ['invitation_invalid_or_expired', 'EXPIRED_OR_REVOKED'],
      ['some postgres error', 'INVITE_ACCEPT_FAILED'],
    ] as const) {
      const h = humanizeApiError(message, code)
      expect(h?.title).not.toContain(message)
      expect(h?.hint).not.toContain(message)
    }
  })

  it('tells an invitee with the wrong account what to do', () => {
    expect(humanizeApiError('invitation_email_mismatch', 'EMAIL_MISMATCH')?.hint).toMatch(/sign in with the email/i)
    expect(humanizeApiError('invitation_invalid_or_expired', 'EXPIRED_OR_REVOKED')?.hint).toMatch(/new invite/i)
  })
})
