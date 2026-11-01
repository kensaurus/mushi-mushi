/**
 * `_shared/egress.ts` — the local-only egress guard (Plan 023 Phase 0,
 * ADR 0034): the allowlist matcher, the fetch installer, redirect re-checks,
 * and denial recording. No network: the "original" fetch is a stub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkEgress,
  describeAllowlist,
  EGRESS_BLOCKED,
  EgressBlockedError,
  installEgressGuard,
  parseAllowEntry,
  parseHost,
  policyFromEnv,
  setEgressCaller,
  supabaseDenialRecorder,
  uninstallEgressGuard,
  type EgressPolicy,
} from '../../supabase/functions/_shared/egress.ts'

const SUPABASE_URL = 'https://abcd.supabase.co'

function policy(allow = '', localOnly = true): EgressPolicy {
  return policyFromEnv({ MUSHI_LOCAL_ONLY: localOnly ? '1' : '', MUSHI_EGRESS_ALLOW: allow, SUPABASE_URL })
}

const allowed = (url: string, p = policy()) => checkEgress(url, p).allowed

describe('host parsing', () => {
  it('canonicalises case, trailing dots and brackets', () => {
    expect(parseHost('API.Example.COM.').text).toBe('api.example.com')
    expect(parseHost('[::1]')).toMatchObject({ kind: 'ipv6' })
  })

  it('reads decimal, hex and octal IPv4 forms', () => {
    expect(parseHost('2130706433')).toMatchObject({ kind: 'ipv4', text: '127.0.0.1' })
    expect(parseHost('0x7f.1')).toMatchObject({ kind: 'ipv4', text: '127.0.0.1' })
    expect(parseHost('0177.0.0.1')).toMatchObject({ kind: 'ipv4', text: '127.0.0.1' })
    expect(parseHost('0xC0A80001')).toMatchObject({ kind: 'ipv4', text: '192.168.0.1' })
  })

  it('turns IPv4-mapped IPv6 into the IPv4 it reaches', () => {
    expect(parseHost('[::ffff:7f00:1]')).toMatchObject({ kind: 'ipv4', text: '127.0.0.1' })
    expect(parseHost('::ffff:8.8.8.8')).toMatchObject({ kind: 'ipv4', text: '8.8.8.8' })
  })
})

describe('checkEgress matrix (local-only on)', () => {
  const cases: Array<[string, boolean]> = [
    // The Supabase host, any port.
    ['https://abcd.supabase.co/rest/v1/x', true],
    ['https://ABCD.supabase.co./rest/v1/x', true],
    ['https://other.supabase.co/', false],
    // Loopback.
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1/', true],
    ['http://127.8.9.10:8080/', true],
    ['http://[::1]:11434/', true],
    ['http://2130706433/', true],
    ['http://0x7f.1/', true],
    ['http://ollama.localhost/', true],
    // Private ranges.
    ['http://10.0.0.5/', true],
    ['http://172.16.3.4/', true],
    ['http://172.32.0.1/', false],
    ['http://192.168.1.10/', true],
    ['http://100.64.0.1/', true],
    ['http://100.128.0.1/', false],
    ['http://169.254.10.10/', true],
    ['http://[fd12:3456::1]/', true],
    ['http://[fe80::1]/', true],
    // Local suffixes.
    ['http://ollama.internal/', true],
    ['http://nas.local/', true],
    ['http://box.lan:8080/', true],
    ['http://internal/', false],
    ['http://evilinternal/', false],
    // Public hosts.
    ['https://api.anthropic.com/v1/messages', false],
    ['https://api.openai.com/v1', false],
    ['https://sentry.io/', false],
    ['http://8.8.8.8/', false],
    ['http://[2001:4860:4860::8888]/', false],
    ['http://[::ffff:8.8.8.8]/', false],
    ['http://[::]/', false],
    ['http://0.0.0.0/', false],
    // Userinfo cannot smuggle a host.
    ['https://localhost@api.openai.com/', false],
    ['https://127.0.0.1:443@evil.example/', false],
    ['https://api.openai.com@127.0.0.1/', true],
    // A local-looking suffix inside a public name is still public.
    ['https://localhost.evil.com/', false],
    ['https://10.0.0.1.nip.io/', false],
    // Non-network schemes do not leave the machine.
    ['data:text/plain,hi', true],
  ]
  for (const [url, expected] of cases) {
    it(`${expected ? 'allows' : 'blocks'} ${url}`, () => {
      expect(allowed(url)).toBe(expected)
    })
  }

  it('allows everything when local-only is off', () => {
    expect(allowed('https://api.anthropic.com/', policy('', false))).toBe(true)
  })

  it('treats an unparseable URL as blocked', () => {
    expect(allowed('not a url')).toBe(false)
  })
})

describe('MUSHI_EGRESS_ALLOW entries', () => {
  it('parses host, *.domain, host:port, IP, CIDR and bracketed IPv6', () => {
    expect(parseAllowEntry('api.example.com')).toMatchObject({ kind: 'name', name: 'api.example.com', port: null })
    expect(parseAllowEntry('*.example.com')).toMatchObject({ kind: 'suffix', suffix: '.example.com' })
    expect(parseAllowEntry('git.example.com:8443')).toMatchObject({ kind: 'name', port: 8443 })
    expect(parseAllowEntry('8.8.8.8')).toMatchObject({ kind: 'cidr4', bits: 32 })
    expect(parseAllowEntry('203.0.113.0/24')).toMatchObject({ kind: 'cidr4', bits: 24 })
    expect(parseAllowEntry('[2001:db8::]/32')).toMatchObject({ kind: 'cidr6', bits: 32 })
    expect(parseAllowEntry('[2001:db8::1]:443')).toMatchObject({ kind: 'cidr6', bits: 128, port: 443 })
    expect(parseAllowEntry('2001:db8::1')).toMatchObject({ kind: 'cidr6', bits: 128, port: null })
  })

  it('ignores entries it cannot understand', () => {
    expect(parseAllowEntry('')).toBeNull()
    expect(parseAllowEntry('*')).toBeNull()
    expect(parseAllowEntry('a*.example.com')).toBeNull()
    expect(parseAllowEntry('host:99999')).toBeNull()
    expect(parseAllowEntry('10.0.0.0/40')).toBeNull()
  })

  it('matches names exactly, wildcards on subdomains only, and ports when given', () => {
    const p = policy('ollama, *.corp.example, git.example.com:8443, 203.0.113.0/24, [2001:db8::]/32')
    expect(allowed('http://ollama:11434/v1', p)).toBe(true)
    expect(allowed('http://OLLAMA./', p)).toBe(true)
    expect(allowed('https://llm.corp.example/', p)).toBe(true)
    expect(allowed('https://corp.example/', p)).toBe(false)
    expect(allowed('https://evilcorp.example/', p)).toBe(false)
    expect(allowed('https://git.example.com:8443/api/v3', p)).toBe(true)
    expect(allowed('https://git.example.com/api/v3', p)).toBe(false)
    expect(allowed('http://203.0.113.77/', p)).toBe(true)
    expect(allowed('http://203.0.114.1/', p)).toBe(false)
    expect(allowed('http://[2001:db8:1::5]/', p)).toBe(true)
    expect(allowed('http://[2001:db9::5]/', p)).toBe(false)
  })

  it('matches an allowed IPv4 written in another form', () => {
    const p = policy('8.8.8.8')
    expect(allowed('http://134744072/', p)).toBe(true)
    expect(allowed('http://[::ffff:808:808]/', p)).toBe(true)
  })

  it('lists the built-in rules, the Supabase host and the env entries', () => {
    const list = describeAllowlist(policy('ollama,*.corp.example'))
    expect(list[0]).toBe('abcd.supabase.co')
    expect(list).toContain('192.168.0.0/16')
    expect(list).toContain('*.internal')
    expect(list.slice(-2)).toEqual(['ollama', '*.corp.example'])
  })
})

describe('installEgressGuard', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    uninstallEgressGuard()
    globalThis.fetch = realFetch
  })

  function setup(allow = '') {
    const original = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
    globalThis.fetch = original as unknown as typeof fetch
    const record = vi.fn()
    const installed = installEgressGuard({
      env: { MUSHI_LOCAL_ONLY: '1', MUSHI_EGRESS_ALLOW: allow, SUPABASE_URL },
      record,
    })
    return { original, record, installed }
  }

  it('does nothing when local-only is off', () => {
    const original = globalThis.fetch
    expect(installEgressGuard({ env: { SUPABASE_URL } })).toBe(false)
    expect(globalThis.fetch).toBe(original)
  })

  it('wraps fetch once; a second install keeps the first wrapper', () => {
    const { installed } = setup()
    expect(installed).toBe(true)
    const wrapped = globalThis.fetch
    expect(installEgressGuard({ env: { MUSHI_LOCAL_ONLY: '1', SUPABASE_URL } })).toBe(true)
    expect(globalThis.fetch).toBe(wrapped)
  })

  it('blocks a public host before calling the real fetch, and records the denial', async () => {
    const { original, record } = setup()
    setEgressCaller('classify-report')
    const err = await globalThis.fetch('https://api.anthropic.com/v1/messages').catch((e) => e)
    expect(err).toBeInstanceOf(EgressBlockedError)
    expect(err.code).toBe(EGRESS_BLOCKED)
    expect(err.host).toBe('api.anthropic.com')
    expect(original).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith('api.anthropic.com', 'classify-report')
  })

  it('checks Request objects and URL objects too', async () => {
    const { original } = setup()
    await expect(globalThis.fetch(new Request('https://api.openai.com/v1/models'))).rejects.toBeInstanceOf(EgressBlockedError)
    await expect(globalThis.fetch(new URL('https://sentry.io/'))).rejects.toBeInstanceOf(EgressBlockedError)
    expect(original).not.toHaveBeenCalled()
  })

  it('lets allowed hosts through, asking the real fetch not to follow redirects itself', async () => {
    const { original } = setup('ollama')
    const res = await globalThis.fetch('http://ollama:11434/v1/models', { headers: { a: 'b' } })
    expect(await res.text()).toBe('ok')
    expect(original).toHaveBeenCalledTimes(1)
    expect(original.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('passes manual and error redirect modes through unchanged', async () => {
    const { original } = setup()
    await globalThis.fetch('http://127.0.0.1/', { redirect: 'error' })
    expect(original.mock.calls[0]![1]).toMatchObject({ redirect: 'error' })
  })

  it('re-checks a redirect target and blocks one that leaves the allowlist', async () => {
    const { original, record } = setup()
    original.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }))
    await expect(globalThis.fetch('http://127.0.0.1/start')).rejects.toBeInstanceOf(EgressBlockedError)
    expect(original).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('evil.example', expect.any(String))
  })

  it('follows an allowed redirect by hand, turning a 303 POST into a GET and dropping credentials across origins', async () => {
    const { original } = setup()
    original
      .mockImplementationOnce(async () => new Response(null, { status: 303, headers: { location: 'http://10.0.0.2/done' } }))
      .mockImplementationOnce(async () => new Response('final'))
    const res = await globalThis.fetch('http://127.0.0.1/submit', {
      method: 'POST',
      body: 'x=1',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(await res.text()).toBe('final')
    expect(original).toHaveBeenCalledTimes(2)
    expect(original.mock.calls[1]![0]).toBe('http://10.0.0.2/done')
    const second = original.mock.calls[1]![1]!
    expect(second.method).toBe('GET')
    expect(second.body).toBeUndefined()
    expect(new Headers(second.headers).get('authorization')).toBeNull()
  })

  it('keeps method and body on a 307', async () => {
    const { original } = setup()
    original
      .mockImplementationOnce(async () => new Response(null, { status: 307, headers: { location: '/again' } }))
      .mockImplementationOnce(async () => new Response('final'))
    await globalThis.fetch('http://127.0.0.1/a', { method: 'PUT', body: 'payload' })
    expect(original.mock.calls[1]![0]).toBe('http://127.0.0.1/again')
    expect(original.mock.calls[1]![1]).toMatchObject({ method: 'PUT', body: 'payload', redirect: 'manual' })
  })

  it('caps the number of redirects it follows', async () => {
    const { original } = setup()
    original.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }))
    await expect(globalThis.fetch('http://127.0.0.1/loop')).rejects.toThrow(/redirects/)
    expect(original.mock.calls.length).toBe(11)
  })
})

describe('supabaseDenialRecorder', () => {
  it('posts host and caller to the record_egress_denial RPC with the service role key', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }))
    const record = supabaseDenialRecorder(
      { SUPABASE_URL: `${SUPABASE_URL}/`, SUPABASE_SERVICE_ROLE_KEY: 'service-key' },
      () => fetchImpl as unknown as typeof fetch,
    )
    await record('api.openai.com', 'judge-batch')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/record_egress_denial`)
    expect(init!.method).toBe('POST')
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer service-key')
    expect(JSON.parse(init!.body as string)).toEqual({ p_host: 'api.openai.com', p_caller: 'judge-batch' })
  })

  it('never throws, and does nothing without credentials', async () => {
    const failing = vi.fn(async () => {
      throw new Error('down')
    })
    await expect(
      supabaseDenialRecorder({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'k' }, () => failing as unknown as typeof fetch)('x.com', 'y'),
    ).resolves.toBeUndefined()
    const unused = vi.fn()
    await supabaseDenialRecorder({ SUPABASE_URL }, () => unused as unknown as typeof fetch)('x.com', 'y')
    expect(unused).not.toHaveBeenCalled()
  })
})
