import { describe, expect, it } from 'vitest'
import { describeActionError } from './actionError'

describe('describeActionError', () => {
  it('shows a sentence the server wrote for people (QA bug 125: not "check your plan limits")', () => {
    expect(
      describeActionError({ code: 'FORBIDDEN', message: 'Owner or admin access required' }, 'Could not create a key.'),
    ).toBe('Owner or admin access required')
  })

  it('humanizes network and server faults', () => {
    expect(describeActionError({ code: 'NETWORK_ERROR', message: 'Failed to fetch' }, 'x')).toMatch(/Could not reach the Mushi API/)
    expect(describeActionError({ code: 'DB_ERROR', message: 'duplicate key value' }, 'x')).toMatch(/went wrong on our side/)
  })

  it('never shows a bare code, JSON or SQL text', () => {
    expect(describeActionError({ code: 'ALREADY_IN_PROGRESS', message: 'ALREADY_IN_PROGRESS' }, 'Fallback.')).toBe('Fallback.')
    expect(describeActionError({ code: 'ERROR', message: '{"a":1}' }, 'Fallback.')).toBe('Fallback.')
    expect(describeActionError({ code: 'ERROR', message: 'new row violates check constraint' }, 'Fallback.')).toBe('Fallback.')
    expect(describeActionError(null, 'Fallback.')).toBe('Fallback.')
  })
})
