/**
 * Regression tests for the fix-worker structured-output schema.
 *
 * Sentry MUSHI-MUSHI-SERVER-J / MUSHI-MUSHI-SERVER-8 (regressed 2026-04-23):
 * the fix-worker LLM emitted literal `"placeholder"` strings for
 * `files[].contents`. Zod's previous max-length-only constraints accepted them,
 * the worker wrote a placeholder file to a draft PR, the judge disagreed, and
 * the dispatch eventually surfaced as `AI_NoObjectGeneratedError` after the
 * downstream second-pass schema failed.
 *
 * The schema now refuses these whole-string sentinel values at the field level,
 * so the AI SDK structured-output retry receives an actionable error message
 * instead of "invalid string". This file pins the contract so a future schema
 * tweak can't silently re-allow placeholder output.
 */

import { describe, it, expect } from 'vitest'

import { isPlaceholderContents, fixSchema } from '../../supabase/functions/_shared/fix-schema.ts'

describe('isPlaceholderContents', () => {
  it.each([
    'placeholder',
    'PLACEHOLDER',
    '  placeholder  ',
    'todo',
    'TODO',
    'tbd',
    'TBD',
    'fixme',
    'FIXME',
    'xxx',
    'XXX',
    'lorem ipsum dolor sit amet',
    'Lorem ipsum',
    '...',
    'n/a',
    'N/A',
  ])('rejects %j as placeholder', (input) => {
    expect(isPlaceholderContents(input)).toBe(true)
  })

  it.each([
    'export function add(a: number, b: number) { return a + b }',
    'const props = { placeholder: "search" }',
    '<input placeholder="email" />',
    'TODO: refactor in a follow-up // (real comment in real code)',
    'Real rationale: this fixes the rage-click double submit bug',
    'fix(button): prevent rage-click',
    'A',
  ])('passes %j through as real content', (input) => {
    expect(isPlaceholderContents(input)).toBe(false)
  })
})

describe('fixSchema', () => {
  const validFix = {
    summary: 'fix(button): prevent rage-click double-submit',
    rationale:
      'The button handler did not debounce, so a fast double-click submitted twice. Adding a one-shot disabled state resolves the report.',
    files: [
      {
        path: 'src/components/Button.tsx',
        contents: 'export function Button() { return <button disabled={busy} /> }',
        reason: 'add disabled-while-busy guard',
      },
    ],
    needsHumanReview: false,
  }

  it('accepts a real fix payload', () => {
    expect(fixSchema.safeParse(validFix).success).toBe(true)
  })

  it.each([
    ['summary', 'placeholder'],
    ['rationale', 'TODO'],
  ])('rejects placeholder %s (MUSHI-MUSHI-SERVER-J/8 regression)', (field, badValue) => {
    // Need a value long enough to clear min(10)/min(20) so we hit the refine.
    const padded = (badValue + ' '.repeat(50)).slice(0, 50)
    const broken = { ...validFix, [field]: padded }
    const r = fixSchema.safeParse(broken)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === field)).toBe(true)
    }
  })

  it('rejects placeholder files[].contents (MUSHI-MUSHI-SERVER-J/8 regression)', () => {
    const broken = {
      ...validFix,
      files: [{ ...validFix.files[0], contents: 'placeholder' }],
    }
    const r = fixSchema.safeParse(broken)
    expect(r.success).toBe(false)
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path.join('.') === 'files.0.contents')?.message ?? ''
      expect(msg).toMatch(/never the literal string/i)
    }
  })

  it('rejects placeholder files[].reason', () => {
    const broken = {
      ...validFix,
      files: [{ ...validFix.files[0], reason: 'placeholder' }],
    }
    expect(fixSchema.safeParse(broken).success).toBe(false)
  })

  it('still allows file contents that contain the word "placeholder" in code', () => {
    const ok = {
      ...validFix,
      files: [
        {
          ...validFix.files[0],
          contents: 'export const Search = () => <input placeholder="search" />',
        },
      ],
    }
    expect(fixSchema.safeParse(ok).success).toBe(true)
  })
})
