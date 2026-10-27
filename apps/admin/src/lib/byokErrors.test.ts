import { describe, expect, it } from 'vitest'
import { describeByokError, describeByokTestResult } from './byokErrors'

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

describe('describeByokTestResult', () => {
  const name = 'Anthropic (Claude)'

  it('maps each probe status to a sentence and never the code', () => {
    const cases: Array<{ status: string; latencyMs?: number | null; detail?: string; ok: boolean; message: string }> = [
      { status: 'ok', latencyMs: 42, ok: true, message: 'Anthropic (Claude) accepted the key (42 ms).' },
      { status: 'ok', latencyMs: null, ok: true, message: 'Anthropic (Claude) accepted the key.' },
      {
        status: 'error_auth',
        detail: 'Provider rejected the credential',
        ok: false,
        message: 'Anthropic (Claude) rejected the key. Replace it with a new one.',
      },
      {
        status: 'error_quota',
        detail: 'Provider accepted the request but the account is rate-limited or out of quota',
        ok: false,
        message: 'Anthropic (Claude) says this key is out of quota. Add another key or wait for it to reset.',
      },
      {
        status: 'error_network',
        detail: 'Provider validation endpoint returned HTTP 503',
        ok: false,
        message: "Mushi couldn't reach Anthropic (Claude). Test again in a minute.",
      },
      {
        status: 'error_network',
        detail: 'Provider validation request could not be completed',
        ok: false,
        message: "Mushi couldn't reach Anthropic (Claude). Test again in a minute.",
      },
    ]
    for (const row of cases) {
      const view = describeByokTestResult(
        { status: row.status, detail: row.detail, latencyMs: row.latencyMs },
        name,
      )
      expect(view).toEqual({ ok: row.ok, message: row.message })
      expect(view.message).not.toMatch(/\berror_(?:auth|quota|network)\b/)
    }
  })

  it('keeps a specific probe sentence and drops a bare code', () => {
    expect(
      describeByokTestResult(
        {
          status: 'error_network',
          detail:
            'Link the Supabase project first: set its project ref in Settings → General, then test this token again.',
        },
        'Supabase (read-only)',
      ),
    ).toEqual({
      ok: false,
      message:
        'Link the Supabase project first: set its project ref in Settings → General, then test this token again.',
    })
    expect(
      describeByokTestResult(
        {
          status: 'error_auth',
          detail: 'Supabase rejected the token. It was revoked, expired or mistyped.',
        },
        'Supabase (read-only)',
      ).message,
    ).toBe('Supabase rejected the token. It was revoked, expired or mistyped.')
    expect(describeByokTestResult({ status: 'error_auth', detail: 'error_auth' }, name).message).toBe(
      'Anthropic (Claude) rejected the key. Replace it with a new one.',
    )
    expect(describeByokTestResult({ status: 'nope', detail: 'error_auth' }, name)).toEqual({
      ok: false,
      message: "Anthropic (Claude) didn't accept the key.",
    })
    expect(describeByokTestResult({ status: null, detail: 'Set the project ref first.' }, name)).toEqual({
      ok: false,
      message: "Anthropic (Claude) didn't accept the key. Set the project ref first.",
    })
  })
})
