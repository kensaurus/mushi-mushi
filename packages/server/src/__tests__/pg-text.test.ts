/**
 * FILE: pg-text.test.ts
 * PURPOSE: Postgres refuses NUL and lone surrogates ("unsupported Unicode
 *          escape sequence"); one such character failed every chunk row of a
 *          source file in the repo indexer (MUSHI-MUSHI-SERVER-2B).
 */
import { describe, expect, it } from 'vitest'
import { pgSafeSlice, pgSafeText } from '../../supabase/functions/_shared/pg-text.ts'

describe('pgSafeText', () => {
  it('drops NUL characters', () => {
    expect(pgSafeText('a\u0000b\u0000')).toBe('ab')
  })

  it('replaces a lone surrogate so the JSON body carries no \\ud83d escape', () => {
    expect(pgSafeText('x\uD83D')).toBe('x�')
    expect(JSON.stringify(pgSafeText('x\uD83D'))).not.toContain('\\ud83d')
  })
})

describe('pgSafeSlice', () => {
  it('never ends on half an emoji', () => {
    expect(pgSafeSlice('ab😀', 3)).toBe('ab�')
    expect(pgSafeSlice('ab😀', 4)).toBe('ab😀')
  })
})
