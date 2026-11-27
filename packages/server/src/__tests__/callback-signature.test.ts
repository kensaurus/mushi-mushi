/**
 * FILE: callback-signature.test.ts
 * PURPOSE: ADR 0072: the content-quality callback reads X-Mushi-Signature, and
 *          still accepts the legacy X-Glotit-Signature so live webhooks keep
 *          working; the route reads the header through this helper.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callbackSignature } from '../../supabase/functions/_shared/callback-signature.ts'

const headers = (h: Record<string, string>) => (name: string) => h[name]

describe('callbackSignature', () => {
  it('reads the generic header, then the legacy one', () => {
    expect(callbackSignature(headers({ 'X-Mushi-Signature': 'abc' }))).toBe('abc')
    expect(callbackSignature(headers({ 'X-Glotit-Signature': 'legacy' }))).toBe('legacy')
    expect(callbackSignature(headers({ 'X-Mushi-Signature': 'new', 'X-Glotit-Signature': 'old' }))).toBe('new')
    expect(callbackSignature(headers({ 'X-Mushi-Signature': '  ', 'X-Glotit-Signature': 'old' }))).toBe('old')
    expect(callbackSignature(headers({}))).toBe('')
  })

  it('is what the callback route verifies', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/content-quality.ts'), 'utf8')
    expect(src).toContain('callbackSignature((name) => c.req.header(name))')
    expect(src).not.toContain("c.req.header('X-Glotit-Signature')")
  })
})
