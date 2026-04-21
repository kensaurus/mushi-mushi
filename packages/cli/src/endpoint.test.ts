import { describe, expect, it } from 'vitest'
import { assertEndpoint, DEFAULT_ENDPOINT, normalizeEndpoint } from './endpoint.js'

describe('assertEndpoint', () => {
  it('accepts https URLs', () => {
    expect(assertEndpoint('https://api.mushimushi.dev')).toBe('https://api.mushimushi.dev')
  })

  it('strips trailing path slashes', () => {
    expect(assertEndpoint('https://api.mushimushi.dev/')).toBe('https://api.mushimushi.dev')
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
  it('falls back to the default when undefined', () => {
    expect(normalizeEndpoint(undefined)).toBe(DEFAULT_ENDPOINT)
  })

  it('strips trailing slashes', () => {
    expect(normalizeEndpoint('https://example.com/')).toBe('https://example.com')
    expect(normalizeEndpoint('https://example.com////')).toBe('https://example.com')
  })
})
