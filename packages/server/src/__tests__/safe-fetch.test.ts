/**
 * `_shared/safe-fetch.ts` — publicFetch, the one way radar and recipe probes
 * read a user-supplied URL (Plan 019 §6): https only, no private hosts (by
 * literal or by DNS answer), every redirect re-checked, at most 3 hops, a
 * 1 MB body cap, and no credentials. Injected fetch and resolver; no network.
 */
import { describe, expect, it, vi } from 'vitest'
import { PUBLIC_FETCH_USER_AGENT, publicFetch } from '../../supabase/functions/_shared/safe-fetch.ts'

const publicDns = async () => ['93.184.216.34']

function ok(body = 'hello', init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init })
}

describe('publicFetch refusals', () => {
  it('refuses the cloud metadata address over http and over https, without fetching', async () => {
    const fetchImpl = vi.fn()
    await expect(publicFetch('http://169.254.169.254/latest/meta-data/', { fetchImpl, resolve: publicDns })).rejects.toThrow(/^outbound-blocked: BAD_SCHEME/)
    await expect(publicFetch('https://169.254.169.254/latest/meta-data/', { fetchImpl, resolve: publicDns })).rejects.toThrow(/^outbound-blocked: PRIVATE_HOST/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses localhost', async () => {
    const fetchImpl = vi.fn()
    await expect(publicFetch('https://localhost/', { fetchImpl, resolve: publicDns })).rejects.toThrow(/^outbound-blocked: PRIVATE_HOST/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a redirect to http://localhost after the first hop', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://localhost/admin' } }))
    await expect(publicFetch('https://example.com/', { fetchImpl, resolve: publicDns })).rejects.toThrow(/^outbound-blocked: BAD_SCHEME/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a public name whose DNS answer is a private address', async () => {
    const fetchImpl = vi.fn()
    await expect(publicFetch('https://rebind.example.com/', { fetchImpl, resolve: async () => ['10.0.0.5'] })).rejects.toThrow(/^outbound-blocked: PRIVATE_HOST/)
    await expect(publicFetch('https://v6.example.com/', { fetchImpl, resolve: async () => ['2001:db8::1', 'fd00:ec2::254'] })).rejects.toThrow(/PRIVATE_HOST/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops after 3 redirects', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => new Response(null, { status: 301, headers: { location: `https://example.com/r${++n}` } }))
    await expect(publicFetch('https://example.com/', { fetchImpl, resolve: publicDns })).rejects.toThrow('outbound-blocked: TOO_MANY_REDIRECTS')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('treats a failed DNS lookup as a refusal, but a missing resolver as no DNS check', async () => {
    const fetchImpl = vi.fn(async () => ok())
    await expect(publicFetch('https://nx.example.com/', { fetchImpl, resolve: async () => { throw new Error('NXDOMAIN') } })).rejects.toThrow('outbound-blocked: DNS_FAILED')
    const notSupported = Object.assign(new Error('resolveDns is not supported'), { name: 'NotSupported' })
    const res = await publicFetch('https://example.com/', { fetchImpl, resolve: async () => { throw notSupported } })
    expect(res.status).toBe(200)
  })
})

describe('publicFetch reads', () => {
  it('follows a safe redirect, re-checks it, and reports the final URL', async () => {
    const resolve = vi.fn(publicDns)
    const fetchImpl = vi.fn(async (url: string) =>
      url === 'https://example.com/a' ? new Response(null, { status: 302, headers: { location: '/b' } }) : ok('final'))
    const res = await publicFetch('https://example.com/a', { fetchImpl: fetchImpl as never, resolve })
    expect(res).toMatchObject({ status: 200, finalUrl: 'https://example.com/b', text: 'final', truncated: false })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('sends only a User-Agent and Accept, never credentials, and handles redirects itself', async () => {
    const fetchImpl = vi.fn(async (_u: string, _init: RequestInit) => ok())
    await publicFetch('https://example.com/', { fetchImpl: fetchImpl as never, resolve: publicDns, accept: 'application/json' })
    const init = fetchImpl.mock.calls[0][1]
    expect(init.headers).toEqual({ 'User-Agent': PUBLIC_FETCH_USER_AGENT, Accept: 'application/json' })
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
  })

  it('cuts a 2 MB body at 1 MB and says so', async () => {
    const big = new Uint8Array(2 * 1024 * 1024).fill(97)
    const fetchImpl = vi.fn(async () => new Response(big, { status: 200 }))
    const res = await publicFetch('https://example.com/big', { fetchImpl, resolve: publicDns })
    expect(res.truncated).toBe(true)
    expect(res.text.length).toBe(1024 * 1024)
  })

  it('gives up at the deadline', async () => {
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    await expect(publicFetch('https://slow.example.com/', { fetchImpl: fetchImpl as never, resolve: publicDns, timeoutMs: 20 })).rejects.toThrow('aborted')
  })
})
