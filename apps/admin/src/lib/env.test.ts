import { describe, expect, it } from 'vitest'
import { isValidBackendUrl } from './env'

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
