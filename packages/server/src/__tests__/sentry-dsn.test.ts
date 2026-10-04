/**
 * FILE: sentry-dsn.test.ts
 * PURPOSE: Input-validation plan I1 + I4. A Sentry DSN names the host Mushi
 *          POSTs tester-marketplace events to, so `_shared/sentry-dsn.ts`
 *          only accepts https, a key, a numeric project id and a sentry.io
 *          (or operator-listed) host, never an IP literal or internal name.
 *          The source-contract block pins the three call sites: published-app
 *          save, the forward itself (re-validated at send time) and the
 *          settings PATCH.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseSentryDsn,
  parseSentryDsnSetting,
} from '../../supabase/functions/_shared/sentry-dsn.ts'

describe('parseSentryDsn', () => {
  it('accepts a SaaS ingest DSN', () => {
    expect(parseSentryDsn('https://k@o1.ingest.us.sentry.io/2')).toEqual({
      ok: true,
      value: { publicKey: 'k', host: 'o1.ingest.us.sentry.io', projectId: '2', pathPrefix: '' },
    })
    expect(parseSentryDsn('  https://abc123@sentry.io/42  ')).toMatchObject({ ok: true })
    // Legacy DSNs carry a secret after the key; it is accepted and ignored.
    expect(parseSentryDsn('https://pub:sec@o9.ingest.sentry.io/7')).toMatchObject({
      ok: true,
      value: { publicKey: 'pub' },
    })
  })

  it.each([
    ['http://', 'http://k@o1.ingest.us.sentry.io/2', /https:\/\//],
    ['an IPv4 literal', 'https://k@10.0.0.5/2', /not an IP address/],
    ['the metadata address', 'https://k@169.254.169.254/2', /not an IP address/],
    ['an obfuscated IPv4 literal', 'https://k@0x7f.1/2', /not an IP address/],
    ['an IPv6 literal', 'https://k@[::1]/2', /not an IP address/],
    ['localhost', 'https://k@localhost/2', /not an IP address/],
    ['a single-label intranet name', 'https://k@sentry/2', /not an IP address/],
    ['a non-sentry host', 'https://k@example.com/2', /must be sentry\.io/],
    ['a lookalike suffix', 'https://k@evilsentry.io/2', /must be sentry\.io/],
    ['a sentry.io prefix on another domain', 'https://k@sentry.io.evil.com/2', /must be sentry\.io/],
    ['a missing project id', 'https://k@o1.ingest.us.sentry.io/', /numeric project id/],
    ['a non-numeric project id', 'https://k@o1.ingest.us.sentry.io/abc', /numeric project id/],
    ['a missing key', 'https://o1.ingest.us.sentry.io/2', /missing its key/],
    ['a non-default port', 'https://k@o1.ingest.us.sentry.io:8443/2', /default HTTPS port/],
    ['a query string', 'https://k@o1.ingest.us.sentry.io/2?x=1', /"\?" or "#"/],
    ['garbage', 'not a url', /not a valid URL/],
  ])('rejects %s', (_label, dsn, reason) => {
    const parsed = parseSentryDsn(dsn)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.message).toMatch(reason)
      expect(parsed.message).toContain('A Sentry DSN looks like https://<key>@o<org>.ingest.sentry.io/<project id>.')
    }
  })

  it('a self-hosted host is accepted only when the operator lists it', () => {
    const dsn = 'https://k@sentry.acme.example/sentry/5'
    expect(parseSentryDsn(dsn).ok).toBe(false)
    expect(parseSentryDsn(dsn, ['Sentry.Acme.Example'])).toEqual({
      ok: true,
      value: { publicKey: 'k', host: 'sentry.acme.example', projectId: '5', pathPrefix: '/sentry' },
    })
    expect(parseSentryDsn('https://k@sentry.acme.example:9000/5', ['sentry.acme.example'])).toMatchObject({
      ok: true,
      value: { host: 'sentry.acme.example:9000' },
    })
  })

  it('listing an internal address does not make it acceptable', () => {
    expect(parseSentryDsn('https://k@localhost/2', ['localhost']).ok).toBe(false)
    expect(parseSentryDsn('https://k@169.254.169.254/2', ['169.254.169.254']).ok).toBe(false)
  })
})

describe('parseSentryDsnSetting', () => {
  it('null, empty and whitespace clear the setting', () => {
    expect(parseSentryDsnSetting(null)).toEqual({ ok: true, value: null })
    expect(parseSentryDsnSetting('')).toEqual({ ok: true, value: null })
    expect(parseSentryDsnSetting('   ')).toEqual({ ok: true, value: null })
  })
  it('stores the trimmed DSN and refuses non-strings', () => {
    expect(parseSentryDsnSetting(' https://k@o1.ingest.us.sentry.io/2 ')).toEqual({
      ok: true,
      value: 'https://k@o1.ingest.us.sentry.io/2',
    })
    expect(parseSentryDsnSetting(42).ok).toBe(false)
    expect(parseSentryDsnSetting('https://k@127.0.0.1/2').ok).toBe(false)
  })
})

describe('every DSN write and the forward use the parser', () => {
  const routes = resolve(__dirname, '../../supabase/functions/api/routes')
  const read = (name: string) => readFileSync(resolve(routes, name), 'utf8')

  it('published-app save rejects a bad DSN with a 400', () => {
    const src = read('published-apps.ts')
    expect(src).toMatch(
      /parseSentryDsnSetting\(parsed\.data\.sentry_dsn, sentrySelfHostedHosts\(\)\)[\s\S]{0,200}VALIDATION_ERROR[\s\S]{0,60}400/,
    )
  })

  it('the forward re-validates the stored DSN and never builds a URL from a regex match', () => {
    const src = read('tester-marketplace.ts')
    const fn = src.slice(src.indexOf('async function forwardToSentryDsn'), src.indexOf('// ─── Helper: resolve tester'))
    expect(fn).toContain('parseSentryDsn(dsn, sentrySelfHostedHosts())')
    expect(fn).toMatch(/if \(!parsed\.ok\) \{[\s\S]*?rlog\.warn\([\s\S]*?return\s*\}/)
    expect(fn).not.toMatch(/dsn\.match\(/)
    expect(fn).toContain("redirect: 'error'")
  })

  it('the settings PATCH validates sentry_dsn', () => {
    const src = read('settings-research.ts')
    expect(src).toMatch(
      /if \(key === 'sentry_dsn'\) \{\s*const verdict = parseSentryDsnSetting\(value, sentrySelfHostedHosts\(\)\);/,
    )
  })
})
