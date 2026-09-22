import { describe, expect, it, vi } from 'vitest'
import {
  CLI_KEY_SCOPES,
  describeUnsafeSdkKey,
  FULL_CLI_KEY_SCOPES,
  probeKeyScope,
  SDK_KEY_SCOPES,
} from './key-scopes.js'

function respond(status: number, body: unknown = {}): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch
}

describe('scope policy', () => {
  it('the public SDK key can only ingest', () => {
    expect([...SDK_KEY_SCOPES]).toEqual(['report:write'])
  })

  it('the private CLI key adds read, and only the upgrade adds write', () => {
    expect([...CLI_KEY_SCOPES]).toEqual(['report:write', 'mcp:read'])
    expect([...FULL_CLI_KEY_SCOPES]).toEqual(['report:write', 'mcp:read', 'mcp:write'])
  })
})

describe('probeKeyScope', () => {
  it('calls the mcp:read overview route with the key and project headers', async () => {
    const doFetch = respond(200, { ok: true })
    await probeKeyScope('https://x.supabase.co/functions/v1/api/', 'mushi_k', 'proj-1', doFetch)
    const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.supabase.co/functions/v1/api/v1/admin/mcp/account-overview')
    expect(init.headers).toEqual({ 'X-Mushi-Api-Key': 'mushi_k', 'X-Mushi-Project': 'proj-1' })
  })

  it('200 means the key can read', async () => {
    expect((await probeKeyScope('https://e', 'k', 'p', respond(200))).result).toBe('mcp')
  })

  it('403 INSUFFICIENT_SCOPE means ingest-only', async () => {
    const res = await probeKeyScope('https://e', 'k', 'p', respond(403, { ok: false, error: { code: 'INSUFFICIENT_SCOPE' } }))
    expect(res.result).toBe('ingest-only')
  })

  it('any other 403 proves nothing', async () => {
    const res = await probeKeyScope('https://e', 'k', 'p', respond(403, { ok: false, error: { code: 'FORBIDDEN' } }))
    expect(res.result).toBe('unknown')
  })

  it('401 means the key is rejected', async () => {
    expect((await probeKeyScope('https://e', 'k', 'p', respond(401))).result).toBe('invalid')
  })

  it('a 5xx proves nothing', async () => {
    expect(await probeKeyScope('https://e', 'k', 'p', respond(503))).toEqual({ result: 'unknown', status: 503 })
  })

  it('a network failure is unreachable, not invalid', async () => {
    const doFetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch
    expect(await probeKeyScope('https://e', 'k', 'p', doFetch)).toEqual({ result: 'unreachable', message: 'fetch failed' })
  })
})

describe('describeUnsafeSdkKey', () => {
  it('names the endpoint when it could not be reached', () => {
    expect(describeUnsafeSdkKey({ result: 'unreachable', message: 'fetch failed' }, 'https://api.example')).toContain(
      'could not reach https://api.example',
    )
  })
})
