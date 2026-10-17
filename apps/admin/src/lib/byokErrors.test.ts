import { describe, expect, it } from 'vitest'
import { describeByokError } from './byokErrors'

const FALLBACK = 'The key was not added. Retry in a moment.'

describe('describeByokError', () => {
  it('never shows a bare error code', () => {
    for (const code of ['BAD_PROVIDER', 'VAULT_WRITE_FAILED', 'DUPLICATE_KEY', 'VALIDATION_ERROR', 'SOMETHING_NEW']) {
      const view = describeByokError({ code, message: code }, FALLBACK)
      expect(view.message).not.toBe(code)
      expect(view.message).not.toMatch(/^[A-Z_]+$/)
    }
  })

  it('signed out and network failures get the two fixed sentences', () => {
    expect(describeByokError({ code: 'MISSING_AUTH', message: 'Authorization Bearer token required' }, FALLBACK)).toEqual({
      message: 'Your session expired — sign in again.',
      where: 'form',
    })
    expect(describeByokError({ code: 'INVALID_TOKEN', message: 'x' }, FALLBACK).message).toBe(
      'Your session expired — sign in again.',
    )
    expect(describeByokError({ code: 'HTTP_ERROR', message: '401: <html>' }, FALLBACK).message).toBe(
      'Your session expired — sign in again.',
    )
    expect(describeByokError({ code: 'NETWORK_ERROR', message: 'Failed to fetch (api.example)' }, FALLBACK)).toEqual({
      message: "Couldn't reach Mushi — check your connection and retry.",
      where: 'form',
    })
  })

  it('key problems go under the key field with the server sentence', () => {
    expect(
      describeByokError({ code: 'DUPLICATE_KEY', message: 'This key is already saved (fc-FAKE…0001).' }, FALLBACK),
    ).toEqual({ message: 'This key is already saved (fc-FAKE…0001).', where: 'key' })
    expect(
      describeByokError(
        { code: 'VALIDATION_ERROR', message: 'This looks like an Anthropic key — paste it in the Anthropic row.' },
        FALLBACK,
      ),
    ).toEqual({ message: 'This looks like an Anthropic key — paste it in the Anthropic row.', where: 'key' })
  })

  it('base URL problems go under the base URL field', () => {
    const view = describeByokError({ code: 'INVALID_BASE_URL', message: 'baseUrl must use https://' }, FALLBACK)
    expect(view.where).toBe('baseUrl')
    expect(view.message).toMatch(/^That base URL can't be used/)
  })

  it('maps storage, provider and server failures to plain sentences', () => {
    expect(describeByokError({ code: 'VAULT_WRITE_FAILED', message: 'The credential could not be stored securely.' }, FALLBACK).message).toMatch(
      /nothing was saved/,
    )
    expect(describeByokError({ code: 'BAD_PROVIDER' }, FALLBACK).message).toMatch(/key pool/)
    expect(
      describeByokError({ code: 'BAD_PROVIDER', message: 'Mushi has no single-key slot for "cursor".' }, FALLBACK).message,
    ).toBe('Mushi has no single-key slot for "cursor".')
    expect(describeByokError({ code: 'DB_ERROR', message: 'relation x' }, FALLBACK).message).toMatch(/on our side/)
    expect(describeByokError(undefined, FALLBACK)).toEqual({ message: FALLBACK, where: 'form' })
  })
})
