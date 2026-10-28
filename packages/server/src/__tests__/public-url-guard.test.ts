/**
 * FILE: public-url-guard.test.ts
 * PURPOSE: The free Production Check fetches whatever a stranger pastes, so
 *          _shared/public-url-guard.ts must refuse every non-public address:
 *            - localhost (with a trailing dot, as a subdomain), single-label
 *              names and private suffixes (.local, .internal);
 *            - private, loopback, link-local, CGNAT and reserved IPv4,
 *              including the numeric forms URL normalizes (2130706433,
 *              0x7f.1);
 *            - IPv6 loopback, unique-local, link-local and IPv4-mapped;
 *            - user:password and non-default ports;
 *            - a public name whose DNS answers include a private address;
 *            - a redirect from a public page to a private address
 *              (guardedFetch re-checks every hop and never requests it).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BlockedUrlError,
  checkPublicUrl,
  guardedFetch,
  isPublicAddress,
  isPublicHostname,
  resolvesPublic,
  type DnsResolver,
} from '../../supabase/functions/_shared/public-url-guard.ts'

describe('checkPublicUrl', () => {
  it.each([
    'http://localhost/',
    'http://localhost./admin',
    'https://app.localhost',
    'http://127.0.0.1',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://127.1',
    'http://0.0.0.0',
    'http://10.0.0.5/',
    'http://10.255.255.255',
    'http://172.16.0.1',
    'http://172.31.255.254',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://printer.local/',
    'http://db.internal/',
    'http://intranet/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'http://example.com:22/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('refuses %s', (raw) => {
    expect(checkPublicUrl(raw).ok).toBe(false)
  })

  it.each([
    ['example.com', 'https://example.com'],
    ['https://www.example.com/pricing#plans', 'https://www.example.com'],
    ['http://example.com:80/', 'http://example.com'],
    ['https://example.com:443/', 'https://example.com'],
    ['https://8.8.8.8/', 'https://8.8.8.8'],
  ])('accepts %s with origin %s', (raw, origin) => {
    const r = checkPublicUrl(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.origin).toBe(origin)
      expect(r.url.hash).toBe('')
    }
  })

  it('refuses empty, overlong and non-string input', () => {
    expect(checkPublicUrl('').ok).toBe(false)
    expect(checkPublicUrl(`https://example.com/${'a'.repeat(2100)}`).ok).toBe(false)
    expect(checkPublicUrl(42).ok).toBe(false)
  })
})

describe('isPublicAddress (DNS answers)', () => {
  it.each(['10.1.2.3', '127.0.0.1', '169.254.1.1', '::1', 'fe80::abcd', 'fc00::5', '::ffff:192.168.0.1', '64:ff9b::a00:1', '2001:db8::1'])(
    '%s is not public',
    (a) => expect(isPublicAddress(a)).toBe(false),
  )
  it.each(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '1.1.1.1'])('%s is public', (a) => expect(isPublicAddress(a)).toBe(true))
  it('hostnames with blocked suffixes are not public', () => {
    expect(isPublicHostname('router.home.arpa')).toBe(false)
    expect(isPublicHostname('example.com')).toBe(true)
  })
})

describe('resolvesPublic', () => {
  const dns = (answers: Record<string, string[]>): DnsResolver => async (host, type) => {
    const v = answers[`${host}/${type}`]
    if (!v) throw new Error('NotFound')
    return v
  }

  it('refuses a public-looking name that resolves to a private address', async () => {
    expect(await resolvesPublic('rebind.example.com', dns({ 'rebind.example.com/A': ['10.0.0.7'] }))).toBe(false)
    expect(await resolvesPublic('mixed.example.com', dns({ 'mixed.example.com/A': ['93.184.216.34'], 'mixed.example.com/AAAA': ['::1'] }))).toBe(false)
  })

  it('refuses a name with no address at all', async () => {
    expect(await resolvesPublic('nothing.example.com', dns({}))).toBe(false)
  })

  it('accepts a name with only public addresses', async () => {
    expect(await resolvesPublic('ok.example.com', dns({ 'ok.example.com/A': ['93.184.216.34'] }))).toBe(true)
  })

  it('without a resolver falls back to the hostname rules', async () => {
    expect(await resolvesPublic('example.com', null)).toBe(true)
    expect(await resolvesPublic('localhost', null)).toBe(false)
  })
})

describe('guardedFetch', () => {
  it('refuses a redirect to a private address and never requests it', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u === 'https://public.example.com/') {
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      }
      return new Response('secret', { status: 200 })
    })
    await expect(guardedFetch('https://public.example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toBeInstanceOf(BlockedUrlError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('refuses a redirect to a public name that resolves privately', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url) === 'https://a.example.com/'
        ? new Response(null, { status: 301, headers: { location: 'https://b.example.com/' } })
        : new Response('internal', { status: 200 }),
    )
    const resolver: DnsResolver = async (host, type) => {
      if (type === 'AAAA') throw new Error('NotFound')
      return host === 'b.example.com' ? ['192.168.0.10'] : ['93.184.216.34']
    }
    await expect(guardedFetch('https://a.example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch, resolver })).rejects.toBeInstanceOf(BlockedUrlError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('follows public redirects and reports every hop', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url) === 'http://example.com/'
        ? new Response(null, { status: 301, headers: { location: 'https://example.com/' } })
        : new Response('<html></html>', { status: 200 }),
    )
    const r = await guardedFetch('http://example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.finalUrl).toBe('https://example.com/')
    expect(r.hops).toEqual(['http://example.com/', 'https://example.com/'])
  })

  it('stops after 5 redirects', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: `https://example.com/${++n}` } }))
    await expect(guardedFetch('https://example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('Too many redirects')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
})
