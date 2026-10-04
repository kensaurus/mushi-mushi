/**
 * FILE: apps/admin/src/lib/apiErrorText.test.ts
 * PURPOSE: apiFetch errors are `{ code, message }` objects. Group J pages
 *          threw them into `new Error()` and toasted "[object Object]"
 *          (QA bugs 12, 206 and 210). apiErrorText always yields a sentence.
 */

import { describe, expect, it } from 'vitest'
import { apiErrorText } from './apiErrorText'

describe('apiErrorText', () => {
  it('keeps a plain-English server message', () => {
    expect(apiErrorText({ code: 'FORBIDDEN', message: "Viewers can't mark requests shipped." }, 'x')).toBe(
      "Viewers can't mark requests shipped.",
    )
  })

  it('never returns [object Object] for an error object', () => {
    const text = apiErrorText({ code: 'PROJECT_REQUIRED', message: 'PROJECT_REQUIRED' }, 'Query failed')
    expect(text).not.toContain('[object Object]')
    expect(text).toMatch(/Pick a project/)
  })

  it('maps a code-only error to its plain-English title', () => {
    expect(apiErrorText({ code: 'OWNER_REQUIRED', message: 'OWNER_REQUIRED' }, 'x')).toMatch(/Only an owner/)
  })

  it('hides raw HTTP bodies behind a readable sentence', () => {
    const text = apiErrorText({ code: 'HTTP_ERROR', message: '403: {"error":{"code":"FORBIDDEN"}}' }, 'x')
    expect(text).not.toContain('{')
    expect(text).toMatch(/server returned an error/i)
  })

  it('replaces the database "could not load" copy in a mutation', () => {
    const text = apiErrorText({ code: 'DB_ERROR', message: 'We could not load this data right now.' }, 'x')
    expect(text).toMatch(/Something went wrong on our side/)
  })

  it('falls back when nothing usable is present', () => {
    expect(apiErrorText(undefined, 'Save failed')).toBe('Save failed')
    expect(apiErrorText({ code: 'SOMETHING_NEW', message: '' }, 'Save failed')).toBe('Save failed')
  })

  it('accepts a legacy string error', () => {
    expect(apiErrorText('Body must be 10-5000 chars.', 'x')).toBe('Body must be 10-5000 chars.')
  })
})
