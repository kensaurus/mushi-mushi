/**
 * FILE: packages/server/src/__tests__/text-clip.test.ts
 * PURPOSE: fast-filter stored `reports.summary` as a hard `.slice(0, 200)`,
 *          so report 469f6962's heading ended "…creating awkwar" (2026-10-02).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clipAtWord } from '../../supabase/functions/_shared/text-clip.ts'

describe('clipAtWord', () => {
  it('returns short text unchanged (whitespace collapsed)', () => {
    expect(clipAtWord('  Button   overlaps footer ', 200)).toBe('Button overlaps footer')
  })

  it('cuts on a word boundary with an ellipsis and stays within the limit', () => {
    const text = 'The footer links run together without a comma and space, creating awkward wrapping on mobile'
    const out = clipAtWord(text, 60)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
    expect(text.startsWith(out.slice(0, -1))).toBe(true)
    // The character after the cut is not a letter: no word was split.
    expect(text[out.length - 1]).toMatch(/[^A-Za-z]/)
  })

  it('drops trailing punctuation before the ellipsis', () => {
    expect(clipAtWord('alpha beta, gamma delta epsilon zeta', 13)).toBe('alpha beta…')
  })

  it('hard-cuts a single unbroken token, still with an ellipsis', () => {
    const out = clipAtWord('x'.repeat(50), 10)
    expect(out).toBe(`${'x'.repeat(9)}…`)
  })

  it('fast-filter stores summaries through clipAtWord', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/fast-filter/index.ts'), 'utf8')
    expect(src).toMatch(/const summary = clipAtWord\(/)
    expect(src).not.toMatch(/\$\{classification\.actual\}`\.slice\(0, 200\)/)
  })
})
