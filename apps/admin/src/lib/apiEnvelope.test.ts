import { describe, expect, it } from 'vitest'
import { coerceApiResult } from './apiEnvelope'

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
})
