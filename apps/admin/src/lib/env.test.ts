import { describe, expect, it } from 'vitest'
import { isValidBackendUrl, mcpOAuthSignInUrl, readRuntimeEnv, resolveBackend } from './env'

const CLOUD = { supabaseUrl: 'https://dxptnwrhwsqckaftyymj.supabase.co', supabaseAnonKey: 'cloud-anon' }
const NO_BUILD = { supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', instanceType: '' }
const NO_RUNTIME = readRuntimeEnv(undefined)
const LOCAL_RUNTIME = readRuntimeEnv({
  VITE_SUPABASE_URL: 'http://localhost:8080/',
  VITE_SUPABASE_ANON_KEY: 'local-anon',
  VITE_API_URL: 'http://localhost:8080/functions/v1/api',
  MUSHI_LOCAL_ONLY: '1',
})

function resolve(over: Partial<Parameters<typeof resolveBackend>[0]> = {}) {
  return resolveBackend({
    stored: null,
    runtime: NO_RUNTIME,
    build: NO_BUILD,
    cloud: CLOUD,
    sameOrigin: 'http://mushi.lan:8080',
    ...over,
  })
}

describe('readRuntimeEnv (window.__MUSHI_ENV__ from the admin container)', () => {
  it('reads nothing from a missing or empty env.js', () => {
    for (const raw of [undefined, null, {}, 'x', { VITE_SUPABASE_URL: 42 }]) {
      expect(readRuntimeEnv(raw)).toEqual({ supabaseUrl: '', supabaseAnonKey: '', apiUrl: '', localOnly: false })
    }
  })

  it('trims values, drops trailing slashes and reads MUSHI_LOCAL_ONLY as a flag', () => {
    expect(LOCAL_RUNTIME).toEqual({
      supabaseUrl: 'http://localhost:8080',
      supabaseAnonKey: 'local-anon',
      apiUrl: 'http://localhost:8080/functions/v1/api',
      localOnly: true,
    })
    for (const on of ['1', 'true', 'TRUE', ' yes ', 'on']) expect(readRuntimeEnv({ MUSHI_LOCAL_ONLY: on }).localOnly).toBe(true)
    for (const off of ['', '0', 'false', 'no']) expect(readRuntimeEnv({ MUSHI_LOCAL_ONLY: off }).localOnly).toBe(false)
  })
})

describe('resolveBackend', () => {
  it('falls back to Mushi Cloud when nothing is configured', () => {
    expect(resolve()).toMatchObject({ supabaseUrl: CLOUD.supabaseUrl, supabaseAnonKey: 'cloud-anon', mode: 'cloud', missing: [] })
  })

  it('reads env.js before the values baked into the build', () => {
    const runtime = readRuntimeEnv({ VITE_SUPABASE_URL: 'https://supabase.example.com', VITE_SUPABASE_ANON_KEY: 'rt' })
    const build = { ...NO_BUILD, supabaseUrl: 'https://build.example.com', supabaseAnonKey: 'bk', apiUrl: 'https://build.example.com/api' }
    expect(resolve({ runtime, build })).toMatchObject({
      supabaseUrl: 'https://supabase.example.com',
      supabaseAnonKey: 'rt',
      explicitApiUrl: 'https://build.example.com/api',
      mode: 'self-hosted',
      missing: [],
    })
  })

  it('local-only: uses the container values and never the cloud fallback or a saved choice', () => {
    const stored = { mode: 'cloud' as const, supabaseUrl: '', supabaseAnonKey: '' }
    const r = resolve({ runtime: LOCAL_RUNTIME, stored })
    expect(r).toEqual({
      supabaseUrl: 'http://localhost:8080',
      supabaseAnonKey: 'local-anon',
      explicitApiUrl: 'http://localhost:8080/functions/v1/api',
      mode: 'self-hosted',
      localOnly: true,
      missing: [],
    })
  })

  it('local-only without a URL or key: same origin, never cloud, and reports what is missing', () => {
    const r = resolve({ runtime: readRuntimeEnv({ MUSHI_LOCAL_ONLY: '1' }) })
    expect(r.supabaseUrl).toBe('http://mushi.lan:8080')
    expect(r.supabaseAnonKey).toBe('')
    expect(r.mode).toBe('self-hosted')
    expect(r.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    expect(JSON.stringify(r)).not.toContain('supabase.co')
    expect(JSON.stringify(r)).not.toContain('cloud-anon')
  })

  it('a saved browser choice still wins when local-only is off', () => {
    const stored = { mode: 'self-hosted' as const, supabaseUrl: 'https://saved.example.com', supabaseAnonKey: 'sk' }
    expect(resolve({ stored, runtime: { ...LOCAL_RUNTIME, localOnly: false } })).toMatchObject({
      supabaseUrl: 'https://saved.example.com',
      supabaseAnonKey: 'sk',
      mode: 'self-hosted',
    })
  })

  it('self-hosted build flag with no credentials lists both as missing', () => {
    expect(resolve({ build: { ...NO_BUILD, instanceType: 'self-hosted' } }).missing).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ])
  })
})

describe('isValidBackendUrl', () => {
  it('accepts the canonical Mushi Cloud Supabase URL', () => {
    expect(isValidBackendUrl('https://dxptnwrhwsqckaftyymj.supabase.co')).toBe(true)
  })

  it('rejects typo’d Supabase refs (wrong ref length)', () => {
    expect(isValidBackendUrl('https://dxptnwrhwsqckaftyyrmj.supabase.co')).toBe(false)
  })

  it('rejects empty and malformed URLs', () => {
    expect(isValidBackendUrl('')).toBe(false)
    expect(isValidBackendUrl('not-a-url')).toBe(false)
    expect(isValidBackendUrl('ftp://bad.example.com')).toBe(false)
  })

  it('accepts custom self-hosted HTTPS hosts', () => {
    expect(isValidBackendUrl('https://supabase.mycompany.internal')).toBe(true)
  })
})

describe('mcpOAuthSignInUrl', () => {
  it('maps the Mushi Cloud supabase.co MCP URL to the kensaur.us OAuth URL', () => {
    // Sign-in on the supabase.co URL 404s at registration ("requested path is invalid").
    for (const url of [
      'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp',
      'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp/',
    ]) {
      expect(mcpOAuthSignInUrl(url)).toBe('https://kensaur.us/mushi-mushi/hosted-mcp/')
    }
  })

  it('leaves a self-hosted URL alone', () => {
    expect(mcpOAuthSignInUrl('https://abc.supabase.co/functions/v1/mcp')).toBe('https://abc.supabase.co/functions/v1/mcp')
  })
})
