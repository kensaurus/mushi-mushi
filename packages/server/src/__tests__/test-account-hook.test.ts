/**
 * FILE: test-account-hook.test.ts
 * PURPOSE: A project's own test-account hook (ADR 0073): only a public https
 *          address; the signature covers the time and the body; a redirect is
 *          refused, never followed; a private address is never called; the
 *          answer is read up to 8 KB and must hold a usable account; the
 *          run's refs keep ids, never passwords.
 */

import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  accountRefs,
  callHook,
  hookUrl,
  newHookSecret,
  parseHookAccount,
  requestHookAccount,
  signHookBody,
} from '../../supabase/functions/_shared/test-account-hook.ts'

const URL_OK = 'https://app.example.com/api/mushi-test-account'
const NOW = new Date('2026-11-27T10:00:00Z')
const publicDns = async () => ['93.184.216.34']

describe('hookUrl and the secret', () => {
  it('takes only a public https address', () => {
    expect(hookUrl(URL_OK)).toEqual({ ok: true, url: URL_OK })
    expect(hookUrl('http://app.example.com/hook').ok).toBe(false)
    expect(hookUrl('https://localhost/hook').ok).toBe(false)
    expect(hookUrl('https://10.0.0.5/hook').ok).toBe(false)
    expect(hookUrl('https://app.example.com:8443/hook').ok).toBe(false)
    expect(hookUrl(`https://app.example.com/${'a'.repeat(600)}`).ok).toBe(false)
  })

  it('makes a long random secret', () => {
    const s = newHookSecret(new Uint8Array(32).fill(171))
    expect(s).toBe(`mtah_${'ab'.repeat(32)}`)
    expect(() => newHookSecret(new Uint8Array(8))).toThrow()
  })

  it('signs the time and the body together', async () => {
    const sig = await signHookBody('mtah_secret', '{"a":1}', NOW)
    const t = Math.floor(NOW.getTime() / 1000)
    expect(sig).toBe(`t=${t},v1=${createHmac('sha256', 'mtah_secret').update(`${t}.{"a":1}`).digest('hex')}`)
  })
})

describe('parseHookAccount', () => {
  it('takes an email and a long password, an optional name and id', () => {
    expect(parseHookAccount({ email: ' a@b.co ', password: 'p'.repeat(16), name: 'Ann', id: 'user_42' })).toEqual({ ok: true, account: { email: 'a@b.co', password: 'p'.repeat(16), name: 'Ann', id: 'user_42' } })
  })

  it.each([
    [null, 'JSON object'],
    [{ email: 'nope', password: 'p'.repeat(16) }, 'email'],
    [{ email: 'a@b.co', password: 'short' }, 'password'],
    [{ email: 'a@b.co', password: 'p'.repeat(16), id: 'has space' }, 'id'],
  ])('refuses %j', (raw, words) => {
    const r = parseHookAccount(raw)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain(words)
  })

  it('keeps the id, else the email, never the password', () => {
    expect(accountRefs([{ email: 'a@b.co', password: 'x'.repeat(16), id: 'u1' }, { email: 'c@d.co', password: 'y'.repeat(16) }])).toEqual(['u1', 'c@d.co'])
  })
})

describe('callHook', () => {
  const answer = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers })

  it('POSTs the signed event, refuses redirects, and returns the parsed answer', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual')
      expect((init.headers as Record<string, string>)['X-Mushi-Event']).toBe('mushi.test_account.create')
      expect((init.headers as Record<string, string>)['X-Mushi-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
      expect(JSON.parse(String(init.body))).toMatchObject({ event: 'mushi.test_account.create', project_id: 'p', run_id: 'r', visitor: 1 })
      return answer(200, JSON.stringify({ email: 'v1@app.example.com', password: 'Pw-'.padEnd(16, 'x') }))
    })
    const r = await requestHookAccount(URL_OK, 'mtah_s', { projectId: 'p', runId: 'r', visitor: 1, expiresAt: '2026-11-28T10:00:00Z', persona: null }, { fetchImpl: fetchImpl as never, resolver: publicDns })
    expect(r).toMatchObject({ ok: true, account: { email: 'v1@app.example.com' } })
  })

  it('never follows a redirect, never calls a name that resolves privately, and reads at most 8 KB', async () => {
    const redirect = await callHook(URL_OK, 's', 'mushi.test_account.create', {}, { fetchImpl: (async () => answer(302, '', { location: 'https://evil.example/' })) as never, resolver: publicDns })
    expect(redirect).toMatchObject({ ok: false, message: expect.stringContaining('redirect') })
    const never = vi.fn()
    const priv = await callHook(URL_OK, 's', 'mushi.test_account.create', {}, { fetchImpl: never as never, resolver: async () => ['10.1.2.3'] })
    expect(priv.ok).toBe(false)
    expect(never).not.toHaveBeenCalled()
    const big = await callHook(URL_OK, 's', 'mushi.test_account.create', {}, { fetchImpl: (async () => answer(200, 'x'.repeat(9000))) as never, resolver: publicDns })
    expect(big).toMatchObject({ ok: false, message: expect.stringContaining('8 KB') })
    const down = await callHook(URL_OK, 's', 'mushi.test_account.create', {}, { fetchImpl: (async () => answer(500, 'oops')) as never, resolver: publicDns })
    expect(down).toMatchObject({ ok: false, message: 'The hook answered 500.' })
  })
})
