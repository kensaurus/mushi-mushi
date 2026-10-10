import { describe, expect, it } from 'vitest'
import { assertEndpoint, firstEndpoint, normalizeEndpoint } from './endpoint.js'

describe('firstEndpoint', () => {
  it('skips a blank env value so a saved self-hosted endpoint still wins over Cloud', () => {
    expect(firstEndpoint(undefined, '', 'https://self.example/api')).toBe('https://self.example/api')
    expect(firstEndpoint(undefined, '   ', 'https://self.example/api')).toBe('https://self.example/api')
  })

  it('keeps flag → env → saved precedence and trims', () => {
    expect(firstEndpoint(' https://flag.example ', 'https://env.example', 'https://saved.example')).toBe('https://flag.example')
    expect(firstEndpoint(undefined, 'https://env.example', 'https://saved.example')).toBe('https://env.example')
  })

  it('returns undefined when every candidate is blank', () => {
    expect(firstEndpoint(undefined, '', '  ')).toBeUndefined()
  })
})

describe('assertEndpoint', () => {
  it('accepts https URLs', () => {
    expect(assertEndpoint('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api')).toBe('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api')
  })

  it('strips trailing path slashes', () => {
    expect(assertEndpoint('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/')).toBe('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api')
  })

  it('preserves non-root pathnames', () => {
    expect(assertEndpoint('https://example.com/mushi')).toBe('https://example.com/mushi')
  })

  it('accepts http://localhost for local dev', () => {
    expect(assertEndpoint('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('accepts http://127.0.0.1', () => {
    expect(assertEndpoint('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
  })

  it('accepts http://*.local', () => {
    expect(assertEndpoint('http://mushi.local')).toBe('http://mushi.local')
  })

  it('rejects http:// for non-local hosts', () => {
    expect(() => assertEndpoint('http://evil.com')).toThrow(/must use https/)
  })

  it('rejects garbage input', () => {
    expect(() => assertEndpoint('not a url')).toThrow(/Invalid endpoint URL/)
  })
})

describe('normalizeEndpoint', () => {
  it('throws when undefined — no silent dead-host fallback', () => {
    expect(() => normalizeEndpoint(undefined)).toThrow(/No API endpoint configured/)
  })

  it('throws when empty string', () => {
    expect(() => normalizeEndpoint('')).toThrow(/No API endpoint configured/)
  })

  it('strips trailing slashes', () => {
    expect(normalizeEndpoint('https://example.com/')).toBe('https://example.com')
    expect(normalizeEndpoint('https://example.com////')).toBe('https://example.com')
  })
})
