/**
 * Unit tests for inventory-auth-runner internals.
 *
 * Audit context (Round 8 — B2): the runner ships a `new Function()`
 * eval over user-supplied YAML and a cookie-picking heuristic that
 * silently fell back to `_ga` on non-Supabase apps. These tests lock
 * in the hardened behaviour so we don't regress.
 */

import { describe, it, expect } from 'vitest'
import { __test } from './index.js'

const { pickSessionCookie, validateInlineAuthScript, isAnalyticsCookie } = __test

// ----------------------------------------------------------------------------
// pickSessionCookie
// ----------------------------------------------------------------------------

describe('pickSessionCookie', () => {
  const BASE = 'https://app.example.com'

  it('picks a Supabase sb- cookie over analytics noise', () => {
    const result = pickSessionCookie(
      [
        { name: '_ga', value: 'GA1.1.x', domain: '.example.com', secure: true },
        { name: 'sb-access-token', value: 'eyJhbGc...', domain: 'app.example.com', httpOnly: true, secure: true },
        { name: '_fbp', value: 'fb.1.x', domain: 'app.example.com', secure: true },
      ],
      BASE,
    )
    expect(result?.name).toBe('sb-access-token')
  })

  it('picks the connect.sid cookie for an Express session app', () => {
    const result = pickSessionCookie(
      [
        { name: 'connect.sid', value: 's:abc', domain: 'app.example.com', httpOnly: true, secure: true },
        { name: '_gid', value: 'GA1.x', domain: '.example.com', secure: true },
      ],
      BASE,
    )
    expect(result?.name).toBe('connect.sid')
  })

  it('picks a httpOnly+secure cookie even without a session-y name', () => {
    const result = pickSessionCookie(
      [{ name: 'X-Custom-Tenant-Auth', value: 'abc', domain: 'app.example.com', httpOnly: true, secure: true }],
      BASE,
    )
    expect(result?.name).toBe('X-Custom-Tenant-Auth')
  })

  it('returns null when only analytics cookies are present', () => {
    const result = pickSessionCookie(
      [
        { name: '_ga', value: 'GA1.1.x', domain: '.example.com', secure: true },
        { name: '_gid', value: 'GA1.2.x', domain: '.example.com', secure: true },
        { name: '_fbp', value: 'fb.x', domain: 'app.example.com', secure: true },
      ],
      BASE,
    )
    expect(result).toBeNull()
  })

  it('returns null when only a non-httpOnly + non-session-y cookie exists (too ambiguous)', () => {
    const result = pickSessionCookie(
      [{ name: 'theme', value: 'dark', domain: 'app.example.com' }],
      BASE,
    )
    expect(result).toBeNull()
  })

  it('returns null when no cookies match the login origin', () => {
    const result = pickSessionCookie(
      [{ name: 'session', value: 'abc', domain: 'evil.com', httpOnly: true, secure: true }],
      BASE,
    )
    expect(result).toBeNull()
  })

  it('handles www. stripping on the login origin', () => {
    const result = pickSessionCookie(
      [{ name: 'auth_token', value: 'x', domain: 'example.com', httpOnly: true, secure: true }],
      'https://www.example.com',
    )
    expect(result?.name).toBe('auth_token')
  })

  it('prefers Supabase cookie over Hotjar even when both have the same secure flag', () => {
    const result = pickSessionCookie(
      [
        { name: '_hjSession_12345', value: 'h.x', domain: 'app.example.com', secure: true },
        { name: 'sb-refresh-token', value: 'r.x', domain: 'app.example.com', httpOnly: true, secure: true },
      ],
      BASE,
    )
    expect(result?.name).toBe('sb-refresh-token')
  })
})

// ----------------------------------------------------------------------------
// isAnalyticsCookie
// ----------------------------------------------------------------------------

describe('isAnalyticsCookie', () => {
  it.each([
    ['_ga', true],
    ['_GA', true],
    ['_ga_ABCDEF', true],
    ['_gid', true],
    ['_gat_UA-12345', true],
    ['_gcl_au', true],
    ['_fbp', true],
    ['__utma', true],
    ['ajs_anonymous_id', true],
    ['_hp2_id.123', true],
    ['_hjSessionUser_999', true],
    ['_hjid', true],
    ['__hstc', true],
    ['hubspotutk', true],
    ['mp_abcdef_mixpanel', true],
    ['amplitude_id_xyz', true],
    ['_pk_id.1.x', true],
    ['optimizelyEndUserId', true],

    ['sb-access-token', false],
    ['session', false],
    ['auth', false],
    ['connect.sid', false],
    ['next-auth.session-token', false],
    ['XSRF-TOKEN', false],
    ['theme', false],
  ])('isAnalyticsCookie(%s) === %s', (name, expected) => {
    expect(isAnalyticsCookie(name)).toBe(expected)
  })
})

// ----------------------------------------------------------------------------
// validateInlineAuthScript — sandbox guards
// ----------------------------------------------------------------------------

describe('validateInlineAuthScript', () => {
  it('accepts a benign Playwright-only login script', () => {
    expect(() =>
      validateInlineAuthScript(
        `await page.fill('input[name="email"]', env.TEST_USER_EMAIL);
         await page.fill('input[name="password"]', env.TEST_USER_PASSWORD);
         await page.click('button[type="submit"]');`,
      ),
    ).not.toThrow()
  })

  it.each([
    ['child_process spawn', "const cp = require('child_process'); cp.execSync('whoami')"],
    ['dynamic import', "const fs = await import('fs'); fs.readFileSync('/etc/passwd')"],
    ['process exfil', 'console.log(process.env.AWS_SECRET_ACCESS_KEY)'],
    ['second-order Function', "new Function('return 1')()"],
    ['eval call', "eval('1+1')"],
    ['globalThis escape', 'globalThis.fetch("http://attacker/")'],
    ['Worker spawn', 'new Worker("./malicious.js")'],
    ['Deno-specific escape', 'await Deno.readTextFile("/etc/passwd")'],
    ['child_process bare reference', 'const cp = "child_process"; require(cp)'],
  ])('rejects %s', (_label, script) => {
    expect(() => validateInlineAuthScript(script)).toThrow(/forbidden token|child_process/)
  })

  it('rejects a script that exceeds the size cap', () => {
    const huge = 'x'.repeat(10 * 1024)
    expect(() => validateInlineAuthScript(huge)).toThrow(/limit is/)
  })

  it('rejects non-string input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => validateInlineAuthScript(123 as any)).toThrow(/must be a string/)
  })

  it('matches whole-token boundaries (not arbitrary substrings)', () => {
    // `myFunction(` should not trip the `Function(` denylist; only
    // bare `Function(` (capitalised, word-boundary, paren-after) does.
    expect(() => validateInlineAuthScript('await page.evaluate(myFunctionName())')).not.toThrow()
  })

  it('rejects access to process via direct property read', () => {
    expect(() => validateInlineAuthScript('await page.fill("a", process.env.TOKEN)')).toThrow(
      /forbidden token/,
    )
  })
})
