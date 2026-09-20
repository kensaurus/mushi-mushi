/**
 * FILE: apps/admin/src/lib/signupAttribution.test.ts
 * PURPOSE: Pure-logic tests for signup attribution — meta compaction, URL
 *          tag parsing, and the sessionStorage stash round-trip used by the
 *          OAuth signup path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { auth: { updateUser: vi.fn() } } }))
vi.mock('./track', () => ({ trackSelf: vi.fn() }))

import {
  SIGNUP_SOURCE_OPTIONS,
  clearStashedSignupMeta,
  compactSignupMeta,
  readSignupMetaFromSearch,
  readStashedSignupMeta,
  stashSignupMeta,
} from './signupAttribution'

describe('compactSignupMeta', () => {
  it('drops empty keys and detail when source is not "other"', () => {
    expect(compactSignupMeta({ signup_source: 'github', signup_source_detail: 'ignored' })).toEqual({
      signup_source: 'github',
    })
  })

  it('keeps trimmed detail for "other"', () => {
    expect(compactSignupMeta({ signup_source: 'other', signup_source_detail: '  a newsletter  ' })).toEqual({
      signup_source: 'other',
      signup_source_detail: 'a newsletter',
    })
  })

  it('rejects campaign tags that are not opaque slugs', () => {
    expect(compactSignupMeta({ signup_src: 'https://evil.example/<script>' })).toEqual({})
    expect(compactSignupMeta({ signup_src: 'hn-launch_2026.09', loop_ref: 'proj/abc' })).toEqual({
      signup_src: 'hn-launch_2026.09',
      loop_ref: 'proj/abc',
    })
  })

  it('caps tag length', () => {
    const long = 'a'.repeat(200)
    expect(compactSignupMeta({ signup_src: long }).signup_src).toHaveLength(64)
  })
})

describe('readSignupMetaFromSearch', () => {
  it('reads ?src= and ?ref=', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams('?src=docs_pricing&ref=abc123'))).toEqual({
      signup_src: 'docs_pricing',
      loop_ref: 'abc123',
    })
  })

  it('returns an empty object when neither is present', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams('?as=tester'))).toEqual({})
  })
})

describe('stash round-trip', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('stores, reads, and clears the compacted meta', () => {
    stashSignupMeta({ signup_source: 'reddit', signup_src: 'launch' })
    expect(readStashedSignupMeta()).toEqual({ signup_source: 'reddit', signup_src: 'launch' })
    clearStashedSignupMeta()
    expect(readStashedSignupMeta()).toBeNull()
  })

  it('clears the stash when the meta is empty', () => {
    stashSignupMeta({ signup_source: 'hn' })
    stashSignupMeta({})
    expect(readStashedSignupMeta()).toBeNull()
  })

  it('ignores malformed stash contents', () => {
    sessionStorage.setItem('mushi_signup_meta', '{not json')
    expect(readStashedSignupMeta()).toBeNull()
  })
})

describe('SIGNUP_SOURCE_OPTIONS', () => {
  it('uses unique snake_case analytics keys', () => {
    const values = SIGNUP_SOURCE_OPTIONS.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^[a-z][a-z0-9_]*$/)
  })
})
