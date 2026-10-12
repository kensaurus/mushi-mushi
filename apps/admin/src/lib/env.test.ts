import { describe, expect, it } from 'vitest'
import { isValidBackendUrl, mcpOAuthSignInUrl } from './env'

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
