import { describe, expect, it } from 'vitest'
import { coerceApiResult, describeErrorDetail, errorFromBody } from './apiEnvelope'

describe('coerceApiResult', () => {
  it('wraps legacy feature-board list payloads', () => {
    const res = coerceApiResult<{ tickets: unknown[] }>({
      ok: true,
      tickets: [{ id: '1' }],
    })
    expect(res.ok).toBe(true)
    expect(res.data?.tickets).toHaveLength(1)
  })

  it('passes through canonical data envelopes', () => {
    const res = coerceApiResult<{ tickets: unknown[] }>({
      ok: true,
      data: { tickets: [] },
    })
    expect(res.ok).toBe(true)
    expect(res.data?.tickets).toEqual([])
  })

  it('re-nests paginated flat list payloads', () => {
    const res = coerceApiResult<{ data: unknown[]; total: number }>({
      ok: true,
      data: [{ id: 'a' }],
      total: 1,
      page: 1,
      limit: 50,
    })
    expect(res.ok).toBe(true)
    expect(res.data?.data).toHaveLength(1)
    expect(res.data?.total).toBe(1)
  })

  it('surfaces structured API errors', () => {
    const res = coerceApiResult({
      ok: false,
      error: { code: 'DB_ERROR', message: 'relation missing' },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('DB_ERROR')
    expect(res.error?.message).toBe('relation missing')
  })

  it('coerces ok:false with a string error', () => {
    const res = coerceApiResult({ ok: false, error: 'boom' })
    expect(res.ok).toBe(false)
    expect(res.error).toEqual({ code: 'ERROR', message: 'boom' })
  })

  it('preserves data on ok:false soft errors (e.g. sync-ci-secrets forbidden)', () => {
    const res = coerceApiResult<{ minted: { prefix: string }; fallback: string[] }>({
      ok: false,
      error: { code: 'GH_SECRETS_FORBIDDEN', message: 'write denied' },
      data: { minted: { prefix: 'mushi_ab' }, fallback: ['gh secret set ...'] },
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('GH_SECRETS_FORBIDDEN')
    expect(res.data?.minted.prefix).toBe('mushi_ab')
    expect(res.data?.fallback).toEqual(['gh secret set ...'])
  })

  it('keeps data absent on ok:false errors that carry none', () => {
    const res = coerceApiResult({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } })
    expect(res.ok).toBe(false)
    expect(res.data).toBeUndefined()
  })

  it('falls back to a generic message for ok:false without error detail', () => {
    const res = coerceApiResult({ ok: false })
    expect(res.ok).toBe(false)
    expect(res.error?.message).toBe('Request failed')
  })

  it('rejects non-object responses', () => {
    for (const raw of [null, undefined, 'oops', 42]) {
      const res = coerceApiResult(raw)
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('INVALID_RESPONSE')
    }
  })

  it('treats a bare { error } body without ok as a failure', () => {
    const res = coerceApiResult({ error: 'not found' })
    expect(res.ok).toBe(false)
    expect(res.error?.message).toBe('not found')
  })

  it('returns ok with undefined data for an empty { ok: true } body', () => {
    const res = coerceApiResult({ ok: true })
    expect(res.ok).toBe(true)
    expect(res.data).toBeUndefined()
  })

  it('passes through envelope-less payloads as data', () => {
    const res = coerceApiResult<{ id: string }>({ id: 'a' })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ id: 'a' })
  })

  // Group K entry 8: POST /v1/admin/rewards/webhooks returns the one-time signing
  // secret only in `meta`, which coercion used to drop.
  it('keeps top-level meta beside data on success', () => {
    const res = coerceApiResult<{ id: string }>({
      ok: true,
      data: { id: 'w1' },
      meta: { secret: 'mushi_whk_x', secret_shown_once: true },
    })
    expect(res.data).toEqual({ id: 'w1' })
    expect(res.meta).toEqual({ secret: 'mushi_whk_x', secret_shown_once: true })
  })

  it('leaves the paginated re-nesting shape unchanged when meta is present', () => {
    const res = coerceApiResult<{ data: unknown[]; meta: { total: number } }>({
      ok: true,
      data: [{ id: 'a' }],
      meta: { total: 1 },
    })
    expect(res.data).toEqual({ data: [{ id: 'a' }], meta: { total: 1 } })
    expect(res.meta).toEqual({ total: 1 })
  })

  // Group K entry 215: zod flatten() objects in `message` printed "[object Object]".
  it('turns a zod flatten() message into readable text', () => {
    const res = coerceApiResult({
      ok: false,
      error: {
        code: 'INVALID_BODY',
        message: { formErrors: [], fieldErrors: { country_codes: ['String must contain exactly 2 character(s)'] } },
      },
    })
    expect(res.error?.message).toBe('Country codes: String must contain exactly 2 character(s)')
    expect(res.error?.message).not.toContain('[object Object]')
  })
})

describe('describeErrorDetail', () => {
  it('reads an issue list with paths', () => {
    expect(
      describeErrorDetail([{ path: ['bounties', 0, 'points_per_event'], message: 'Expected integer, received float' }]),
    ).toBe('Bounties 0 points per event: Expected integer, received float')
  })

  it('returns null for objects with nothing readable', () => {
    expect(describeErrorDetail({ foo: 1 })).toBeNull()
    expect(describeErrorDetail(null)).toBeNull()
  })
})

describe('errorFromBody', () => {
  it('reads a bare { error: flatten() } body (no ok field)', () => {
    expect(errorFromBody({ error: { formErrors: ['Name is required'], fieldErrors: {} } })).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Name is required',
    })
  })

  it('returns null when the body has no error', () => {
    expect(errorFromBody({ message: 'proxy says no' })).toBeNull()
  })
})
