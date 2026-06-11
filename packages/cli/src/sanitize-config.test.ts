import { describe, expect, it } from 'vitest'
import {
  sanitizeApiKey,
  sanitizeCliCredentials,
  sanitizeEndpoint,
  sanitizeProjectId,
} from './sanitize-config.js'

describe('sanitizeApiKey', () => {
  it('accepts a valid mushi_ key', () => {
    expect(sanitizeApiKey('mushi_abcdef1234567890')).toBe('mushi_abcdef1234567890')
  })

  it('strips CRLF before validation', () => {
    expect(sanitizeApiKey('mushi_abcdef1234567890\r\n')).toBe('mushi_abcdef1234567890')
  })

  it('rejects malformed keys', () => {
    expect(() => sanitizeApiKey('not-a-key')).toThrow(/Invalid API key/)
  })
})

describe('sanitizeProjectId', () => {
  it('accepts UUIDs', () => {
    expect(sanitizeProjectId('bdafa28d-b153-482f-bd4f-42981f3fd3a4')).toBe(
      'bdafa28d-b153-482f-bd4f-42981f3fd3a4',
    )
  })

  it('accepts proj_ slugs', () => {
    expect(sanitizeProjectId('proj_myproject12')).toBe('proj_myproject12')
  })

  it('rejects arbitrary strings', () => {
    expect(() => sanitizeProjectId('../../../etc/passwd')).toThrow(/Invalid project ID/)
  })
})

describe('sanitizeEndpoint', () => {
  it('normalizes and validates https endpoints', () => {
    expect(sanitizeEndpoint('https://xyz.supabase.co/functions/v1/api/')).toBe(
      'https://xyz.supabase.co/functions/v1/api',
    )
  })

  it('allows localhost for dev', () => {
    expect(sanitizeEndpoint('http://localhost:54321/functions/v1/api')).toBe(
      'http://localhost:54321/functions/v1/api',
    )
  })
})

describe('sanitizeCliCredentials', () => {
  it('returns all three fields when valid', () => {
    const creds = sanitizeCliCredentials({
      endpoint: 'https://xyz.supabase.co/functions/v1/api',
      apiKey: 'mushi_abcdef1234567890',
      projectId: 'bdafa28d-b153-482f-bd4f-42981f3fd3a4',
    })
    expect(creds.endpoint).toContain('https://xyz.supabase.co')
    expect(creds.apiKey).toMatch(/^mushi_/)
    expect(creds.projectId).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
