/**
 * inventory-guards — exhaustive unit tests for the four security
 * primitives consolidated in `_shared/inventory-guards.ts`.
 *
 * The helpers replace the inline scope-check / fetch / rate-limit code
 * that used to live in inventory.ts (audit follow-ups #1, #2, #3, #5).
 * Each test below pins the contract one of those routes depends on:
 *
 *   - assertSafeOutboundUrl: covers every category in OWASP's SSRF
 *     prevention cheatsheet — bad scheme, embedded creds, blocked port,
 *     and every private-IP family (RFC1918, loopback, link-local incl.
 *     cloud metadata, CGNAT, multicast, IPv6 ULA / link-local /
 *     IPv4-mapped).
 *   - hostMatchesAllowlist: wildcards must NOT match the bare apex.
 *   - safeFetch: redirect re-validation + Authorization stripping
 *     across origins (CVE-2025-21620 mitigation).
 *   - RateLimiter: fixed token-bucket math; validates that successive
 *     drops report a coherent retry-after.
 *   - assertProjectScope: API-key project mismatch returns 403; JWT
 *     non-member returns 403; same-project / member case returns ok.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RateLimiter,
  assertProjectScope,
  assertSafeOutboundUrl,
  hostMatchesAllowlist,
  inventoryAppAllowHosts,
  isPrivateOrSpecialHost,
  safeFetch,
  stripCredentialsOnCrossHost,
  type ScopeContext,
} from '../../supabase/functions/_shared/inventory-guards.ts'

// ---------------------------------------------------------------------------
// assertSafeOutboundUrl + isPrivateOrSpecialHost + hostMatchesAllowlist
// ---------------------------------------------------------------------------

describe('assertSafeOutboundUrl', () => {
  it('accepts a vanilla https public host', () => {
    const r = assertSafeOutboundUrl('https://example.com/path')
    expect(r.ok).toBe(true)
  })

  it('rejects http:// by default (BAD_SCHEME)', () => {
    const r = assertSafeOutboundUrl('http://example.com/')
    expect(r).toEqual({ ok: false, reason: 'BAD_SCHEME' })
  })

  it('accepts http:// when explicitly allowed', () => {
    const r = assertSafeOutboundUrl('http://example.com/', { allowHttp: true })
    expect(r.ok).toBe(true)
  })

  it('rejects non-http/https schemes (BAD_SCHEME)', () => {
    expect(assertSafeOutboundUrl('file:///etc/passwd').ok).toBe(false)
    expect(assertSafeOutboundUrl('gopher://x.example.com/').ok).toBe(false)
    expect(assertSafeOutboundUrl('javascript:alert(1)').ok).toBe(false)
  })

  it('rejects malformed URLs (INVALID_URL)', () => {
    expect(assertSafeOutboundUrl('not-a-url')).toEqual({
      ok: false,
      reason: 'INVALID_URL',
    })
  })

  it('rejects URLs with embedded credentials (EMBEDDED_CREDENTIALS)', () => {
    const r = assertSafeOutboundUrl('https://user:pass@example.com/')
    expect(r).toEqual({ ok: false, reason: 'EMBEDDED_CREDENTIALS' })
  })

  it('rejects blocked ports', () => {
    expect(assertSafeOutboundUrl('https://example.com:22/').ok).toBe(false)
    expect(assertSafeOutboundUrl('https://example.com:5432/').ok).toBe(false)
    expect(assertSafeOutboundUrl('https://example.com:6379/').ok).toBe(false)
  })

  it('accepts non-blocked custom ports', () => {
    expect(assertSafeOutboundUrl('https://example.com:8443/').ok).toBe(true)
    expect(assertSafeOutboundUrl('https://example.com:443/').ok).toBe(true)
  })

  describe('private-IP blocklist (RFC1918, loopback, link-local, CGNAT)', () => {
    const cases: Array<[string, string]> = [
      ['https://127.0.0.1/', '127.0.0.0/8 loopback'],
      ['https://10.0.0.1/', '10.0.0.0/8'],
      ['https://10.255.255.255/', '10.0.0.0/8 high'],
      ['https://172.16.0.1/', '172.16.0.0/12 low'],
      ['https://172.31.255.255/', '172.16.0.0/12 high'],
      ['https://192.168.1.1/', '192.168.0.0/16'],
      // Cloud metadata IPs — AWS, Azure, DigitalOcean, OpenStack all
      // share 169.254.169.254 (AWS IMDS / Azure / DO metadata).
      ['https://169.254.169.254/', '169.254.0.0/16 cloud metadata'],
      ['https://169.254.1.2/', '169.254.0.0/16 link-local'],
      // CGNAT — could be hit on IPv4-bound runtimes that share the carrier.
      ['https://100.64.0.1/', '100.64.0.0/10 CGNAT low'],
      ['https://100.127.255.255/', '100.64.0.0/10 CGNAT high'],
      ['https://0.0.0.0/', '0.0.0.0/8 unspecified'],
      ['https://224.0.0.1/', '224.0.0.0/4 multicast'],
    ]
    it.each(cases)('rejects %s (%s)', (url) => {
      expect(assertSafeOutboundUrl(url)).toEqual({ ok: false, reason: 'PRIVATE_HOST' })
    })

    it('does NOT reject the just-outside-CGNAT 100.63.x.x', () => {
      expect(assertSafeOutboundUrl('https://100.63.255.255/').ok).toBe(true)
    })

    it('does NOT reject 172.32.x.x (just outside RFC1918)', () => {
      expect(assertSafeOutboundUrl('https://172.32.0.1/').ok).toBe(true)
    })
  })

  describe('private-IPv6 blocklist', () => {
    const cases = [
      ['https://[::1]/', 'IPv6 loopback'],
      ['https://[::]/', 'IPv6 unspecified'],
      ['https://[fc00::1]/', 'fc00::/7 ULA'],
      ['https://[fd12:3456::1]/', 'fd00::/8 ULA'],
      ['https://[fe80::1]/', 'fe80::/10 link-local'],
      ['https://[ff02::1]/', 'ff00::/8 multicast'],
      // IPv4-mapped IPv6 must be re-classified on the embedded v4.
      ['https://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
      ['https://[::ffff:169.254.169.254]/', 'IPv4-mapped cloud metadata'],
    ]
    it.each(cases)('rejects %s (%s)', (url) => {
      expect(assertSafeOutboundUrl(url).ok).toBe(false)
    })
  })

  describe('DNS landmines', () => {
    it('rejects localhost as a hostname', () => {
      expect(assertSafeOutboundUrl('https://localhost/').ok).toBe(false)
    })
    it('rejects metadata.google.internal', () => {
      expect(assertSafeOutboundUrl('https://metadata.google.internal/').ok).toBe(false)
    })
    it('rejects bare `metadata`', () => {
      expect(assertSafeOutboundUrl('https://metadata/').ok).toBe(false)
    })
  })

  describe('host allowlist mode', () => {
    it('accepts an exact-match host', () => {
      const r = assertSafeOutboundUrl('https://app.example.com/x', {
        allowHosts: ['app.example.com'],
      })
      expect(r.ok).toBe(true)
    })

    it('rejects an off-allowlist host even if public', () => {
      const r = assertSafeOutboundUrl('https://other.example.com/', {
        allowHosts: ['app.example.com'],
      })
      expect(r).toEqual({ ok: false, reason: 'HOST_NOT_ALLOWED' })
    })

    it('rejects a private IP even when allowlist is set, when it does not match', () => {
      // The allowlist only opens up the listed hosts; nothing else.
      const r = assertSafeOutboundUrl('https://127.0.0.1/', {
        allowHosts: ['app.example.com'],
      })
      expect(r).toEqual({ ok: false, reason: 'HOST_NOT_ALLOWED' })
    })

    it('wildcard *.example.com matches subdomain but NOT bare apex', () => {
      const allow = ['*.example.com']
      expect(assertSafeOutboundUrl('https://app.example.com/', { allowHosts: allow }).ok).toBe(true)
      expect(assertSafeOutboundUrl('https://example.com/', { allowHosts: allow }).ok).toBe(false)
    })
  })
})

describe('hostMatchesAllowlist', () => {
  it('is case-insensitive', () => {
    expect(hostMatchesAllowlist('APP.example.com', ['app.example.COM'])).toBe(true)
  })
  it('does not let *.example.com match attacker.example.com.evil.com', () => {
    expect(hostMatchesAllowlist('attacker.example.com.evil.com', ['*.example.com'])).toBe(false)
  })
  it('handles empty allowlist as deny-all', () => {
    expect(hostMatchesAllowlist('example.com', [])).toBe(false)
  })
})

describe('isPrivateOrSpecialHost (direct)', () => {
  it('returns false for a normal public DNS name (no IP literal)', () => {
    expect(isPrivateOrSpecialHost('example.com')).toBe(false)
    expect(isPrivateOrSpecialHost('api.acme.io')).toBe(false)
  })
  it('returns true for empty/whitespace input (fail-closed)', () => {
    expect(isPrivateOrSpecialHost('')).toBe(true)
    expect(isPrivateOrSpecialHost('   ')).toBe(true)
  })
})

describe('inventoryAppAllowHosts', () => {
  it('extracts hostnames from base/preview/staging URLs and dedupes', () => {
    const hosts = inventoryAppAllowHosts({
      base_url: 'https://app.example.com/',
      preview_url: 'https://preview.example.com/foo',
      staging_url: 'https://app.example.com/already-seen',
    })
    expect(hosts.sort()).toEqual(['app.example.com', 'preview.example.com'])
  })
  it('skips malformed entries silently', () => {
    const hosts = inventoryAppAllowHosts({
      base_url: 'not a url',
      preview_url: 'https://ok.example.com/',
    })
    expect(hosts).toEqual(['ok.example.com'])
  })
})

// ---------------------------------------------------------------------------
// safeFetch — redirect handling + Authorization stripping
// ---------------------------------------------------------------------------

describe('safeFetch', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('passes through to fetch on a single hop', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await safeFetch(
      'https://example.com/',
      { headers: { Authorization: 'Bearer secret' } },
      { url: { allowHosts: ['example.com'] } },
    )
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = new Headers(init.headers ?? {})
    expect(headers.get('Authorization')).toBe('Bearer secret')
    expect(init.redirect).toBe('manual')
  })

  it('throws outbound-blocked when initial URL is private', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      safeFetch('https://127.0.0.1/', {}, { url: {} }),
    ).rejects.toThrow(/outbound-blocked: PRIVATE_HOST/)
  })

  it('strips Authorization on cross-host redirect (CVE-2025-21620 mitigation)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'https://evil.example.com/' },
          }),
      )
      .mockImplementationOnce(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await safeFetch(
      'https://app.example.com/',
      { headers: { Authorization: 'Bearer secret', Cookie: 'sess=abc' } },
      { url: { allowHosts: ['app.example.com', 'evil.example.com'] } },
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit
    const headers = new Headers(secondInit.headers ?? {})
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('Cookie')).toBeNull()
  })

  it('keeps Authorization on same-origin redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'https://app.example.com/landing' },
          }),
      )
      .mockImplementationOnce(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await safeFetch(
      'https://app.example.com/',
      { headers: { Authorization: 'Bearer secret' } },
      { url: { allowHosts: ['app.example.com'] } },
    )
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit
    const headers = new Headers(secondInit.headers ?? {})
    expect(headers.get('Authorization')).toBe('Bearer secret')
  })

  it('refuses to follow a redirect into a private IP', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
          }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      safeFetch(
        'https://app.example.com/',
        {},
        { url: { allowHosts: ['app.example.com'] } },
      ),
    ).rejects.toThrow(/outbound-blocked/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps redirect chain depth', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++
        return new Response(null, {
          status: 301,
          headers: { Location: `https://app.example.com/hop${n}` },
        })
      }),
    )
    await expect(
      safeFetch(
        'https://app.example.com/',
        {},
        { url: { allowHosts: ['app.example.com'] }, maxRedirects: 2 },
      ),
    ).rejects.toThrow(/TOO_MANY_REDIRECTS/)
    // 1 initial hop + 2 follow-ups = 3 fetches before we give up.
    expect(n).toBe(3)
  })
})

describe('stripCredentialsOnCrossHost', () => {
  it('keeps headers untouched on same-origin', () => {
    const out = stripCredentialsOnCrossHost(
      { headers: { Authorization: 'Bearer x', Cookie: 'a=b' } },
      true,
    )
    const h = new Headers(out.headers ?? {})
    expect(h.get('Authorization')).toBe('Bearer x')
    expect(h.get('Cookie')).toBe('a=b')
  })
  it('drops Authorization + Cookie + Proxy-Authorization on cross-origin', () => {
    const out = stripCredentialsOnCrossHost(
      {
        headers: {
          Authorization: 'Bearer x',
          Cookie: 'a=b',
          'Proxy-Authorization': 'Basic Y',
          'X-Custom': 'kept',
        },
      },
      false,
    )
    const h = new Headers(out.headers ?? {})
    expect(h.get('Authorization')).toBeNull()
    expect(h.get('Cookie')).toBeNull()
    expect(h.get('Proxy-Authorization')).toBeNull()
    expect(h.get('X-Custom')).toBe('kept')
  })
})

// ---------------------------------------------------------------------------
// RateLimiter — token-bucket math
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  it('allows up to `burst` immediate requests', () => {
    const rl = new RateLimiter({ tokensPerMinute: 60, burst: 5 })
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      const v = rl.consume('p1', t0)
      expect(v.allowed).toBe(true)
    }
    const denied = rl.consume('p1', t0)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('refills 1 token per second when configured at 60/min', () => {
    const rl = new RateLimiter({ tokensPerMinute: 60, burst: 1 })
    const t0 = 1_000_000
    expect(rl.consume('p1', t0).allowed).toBe(true)
    expect(rl.consume('p1', t0).allowed).toBe(false)
    // 1 second later → 1 token refilled.
    expect(rl.consume('p1', t0 + 1000).allowed).toBe(true)
  })

  it('keys are isolated across projects', () => {
    const rl = new RateLimiter({ tokensPerMinute: 60, burst: 1 })
    const t0 = 1_000_000
    expect(rl.consume('a', t0).allowed).toBe(true)
    expect(rl.consume('a', t0).allowed).toBe(false)
    // Different project still has its own bucket.
    expect(rl.consume('b', t0).allowed).toBe(true)
  })

  it('reports a Retry-After ≥ 1 even on a near-full bucket so 429 callers can shape headers safely', () => {
    const rl = new RateLimiter({ tokensPerMinute: 60, burst: 1 })
    const t0 = 1_000_000
    rl.consume('p', t0)
    const denied = rl.consume('p', t0 + 100) // 100ms later — barely refilled.
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// assertProjectScope — auth-method branching
// ---------------------------------------------------------------------------

describe('assertProjectScope', () => {
  function fakeContext(values: Record<string, string | undefined>): {
    ctx: ScopeContext
    json: ReturnType<typeof vi.fn>
  } {
    const json = vi.fn((body: unknown, status?: number) => {
      // Returning the body shape lets us assert on it directly.
      return new Response(JSON.stringify(body), { status: status ?? 200 })
    })
    const ctx = {
      get: ((key: string) => values[key]) as ScopeContext['get'],
      json,
    } as ScopeContext
    return { ctx, json }
  }

  it('rejects with 401 when no userId is on context', async () => {
    const { ctx } = fakeContext({})
    const r = await assertProjectScope(ctx, 'p1', {} as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })

  it('rejects API-key calls when the key project does not match :projectId', async () => {
    const { ctx, json } = fakeContext({
      userId: 'u',
      projectId: 'pA',
      authMethod: 'apiKey',
    })
    const r = await assertProjectScope(ctx, 'pB', {} as never)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = json.mock.calls[0]![0] as { error: { code: string } }
      expect(body.error.code).toBe('PROJECT_MISMATCH')
    }
  })

  it('accepts API-key calls when the key project matches :projectId', async () => {
    const { ctx } = fakeContext({
      userId: 'u',
      projectId: 'pA',
      authMethod: 'apiKey',
    })
    const r = await assertProjectScope(ctx, 'pA', {} as never)
    expect(r).toEqual({ ok: true, userId: 'u', authMethod: 'apiKey' })
  })

  it('falls back to accessibleProjectIds for JWT callers', async () => {
    const { ctx, json } = fakeContext({ userId: 'u', authMethod: 'jwt' })
    // accessibleProjectIds reads three tables — mock them as empty so the
    // user has no access. We pass a thin db stub that returns no rows.
    const fakeDb = {
      from: () => ({
        select: () => ({
          eq: () => ({ data: [], error: null }),
        }),
      }),
    }
    const r = await assertProjectScope(ctx, 'pX', fakeDb as never)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(403)
      const body = json.mock.calls[0]![0] as { error: { code: string } }
      expect(body.error.code).toBe('FORBIDDEN')
    }
  })
})
