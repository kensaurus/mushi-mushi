import { describe, expect, it } from 'vitest'
import { actionErrorText } from './actionErrorText'

describe('actionErrorText', () => {
  it("keeps the API's own sentence", () => {
    expect(actionErrorText({ code: 'FORBIDDEN', message: 'Only team owners and admins can change the digest.' })).toBe(
      'Only team owners and admins can change the digest.',
    )
  })

  it('drops a trailing code in parentheses', () => {
    expect(actionErrorText({ message: 'The digest preview could not be built. (DIGEST_FAILED)' })).toBe(
      'The digest preview could not be built.',
    )
  })

  it('turns a bare code into plain English', () => {
    expect(actionErrorText({ code: 'NETWORK_ERROR', message: 'NETWORK_ERROR' })).toBe(
      'Could not reach the Mushi API. Check your network connection. If you are online, the API may be briefly down — retry in a moment.',
    )
  })

  it('never shows an unknown code', () => {
    const text = actionErrorText({ code: 'SOMETHING_ODD' })
    expect(text).not.toContain('SOMETHING_ODD')
    expect(text).toBe('Something went wrong. Try again in a minute.')
  })

  it('uses the fallback when there is no error detail', () => {
    expect(actionErrorText(undefined, 'Could not remove the source.')).toBe('Could not remove the source.')
  })
})
