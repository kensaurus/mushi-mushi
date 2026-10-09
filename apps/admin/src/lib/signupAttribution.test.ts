/**
 * FILE: apps/admin/src/lib/signupAttribution.test.ts
 * PURPOSE: Pure-logic tests for signup attribution — meta compaction, URL
 *          tag parsing, the sessionStorage stash round-trip used by the
 *          OAuth signup path, and the console/tester track stamp that keeps
 *          Bounties testers out of builder signups.
 */

import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { auth: { updateUser: vi.fn() } } }))
vi.mock('./track', () => ({ trackSelf: vi.fn() }))

import { supabase } from './supabase'
import { trackSelf } from './track'
import {
  SIGNUP_SOURCE_OPTIONS,
  clearStashedSignupMeta,
  compactSignupMeta,
  completeSignupAttribution,
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
      signup_track: 'console',
    })
  })

  it('carries only the track when no campaign tag is present', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams(''))).toEqual({ signup_track: 'console' })
  })

  it('reads ?as=tester as the tester track, like LoginPage does', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams('?as=tester'))).toEqual({ signup_track: 'tester' })
    expect(readSignupMetaFromSearch(new URLSearchParams('?as=admin'))).toEqual({ signup_track: 'console' })
  })

  it('reads first touch from ft_src + utm_*, never from ref', () => {
    // What the docs site appends for a visitor who first came from HN.
    expect(
      readSignupMetaFromSearch(
        new URLSearchParams('?src=landing-hero&ft_src=hn&utm_source=hn&utm_medium=social&utm_campaign=launch'),
      ),
    ).toEqual({
      signup_src: 'landing-hero',
      signup_first_touch: 'hn',
      signup_first_touch_medium: 'social',
      signup_first_touch_campaign: 'launch',
      signup_track: 'console',
    })
  })

  it('falls back to utm_source when a link skips the docs site', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams('?utm_source=Reddit')).signup_first_touch).toBe('reddit')
    expect(readSignupMetaFromSearch(new URLSearchParams('?ft_src=hn&utm_source=x')).signup_first_touch).toBe('hn')
  })

  it('drops a first-touch source the growth route could not filter on', () => {
    expect(readSignupMetaFromSearch(new URLSearchParams('?ft_src=a/b')).signup_first_touch).toBeUndefined()
    expect(readSignupMetaFromSearch(new URLSearchParams('?ft_src=-x')).signup_first_touch).toBeUndefined()
  })

  it('keeps ref only when it is a widget loop ref', () => {
    // The old collision: the docs site sent ref=<first-touch utm_source>.
    expect(readSignupMetaFromSearch(new URLSearchParams('?ref=hn')).loop_ref).toBeUndefined()
    expect(readSignupMetaFromSearch(new URLSearchParams('?ref=widget')).loop_ref).toBeUndefined()
    expect(readSignupMetaFromSearch(new URLSearchParams('?ref=A1B2C3D4E5F6')).loop_ref).toBeUndefined()
    expect(
      readSignupMetaFromSearch(new URLSearchParams('?utm_source=widget&ft_src=widget&ref=a1b2c3d4e5f6')),
    ).toEqual({ loop_ref: 'a1b2c3d4e5f6', signup_first_touch: 'widget', signup_track: 'console' })
  })
})

describe('loop ref shape', () => {
  const loopRefOf = (ref: string) => readSignupMetaFromSearch(new URLSearchParams({ ref })).loop_ref

  it('is the widget mark hash: 6-64 lowercase hex', () => {
    expect(loopRefOf('a1b2c3d4e5f6')).toBe('a1b2c3d4e5f6')
    expect(loopRefOf('abc123')).toBe('abc123')
    expect(loopRefOf('f'.repeat(64))).toBe('f'.repeat(64))
    for (const bad of ['abc12', 'f'.repeat(65), 'A1B2C3', 'hn', 'widget', 'glot.it', '']) {
      expect(loopRefOf(bad), bad).toBeUndefined()
    }
  })
})

describe('compactSignupMeta — track', () => {
  it('keeps the two known tracks and drops anything else', () => {
    expect(compactSignupMeta({ signup_track: 'tester' })).toEqual({ signup_track: 'tester' })
    expect(compactSignupMeta({ signup_track: 'operator' as unknown as 'console' })).toEqual({})
  })
})

function freshUser(userMetadata: Record<string, unknown>): User {
  return {
    id: `user-${Math.random().toString(36).slice(2)}`,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: userMetadata,
    created_at: new Date().toISOString(),
  } as User
}

describe('completeSignupAttribution', () => {
  const updateUser = vi.mocked(supabase.auth.updateUser)
  const track = vi.mocked(trackSelf)

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    updateUser.mockReset()
    track.mockReset()
  })

  it('stamps the stashed console track on a fresh OAuth user and reports it', async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: null } as unknown as Awaited<
      ReturnType<typeof supabase.auth.updateUser>
    >)
    stashSignupMeta({ signup_src: 'hn', signup_track: 'console' })

    await completeSignupAttribution(freshUser({ avatar_url: 'https://example.test/a.png' }))

    expect(updateUser).toHaveBeenCalledWith({ data: { signup_src: 'hn', signup_track: 'console' } })
    expect(track).toHaveBeenCalledWith('signup_completed', {
      signup_source: 'unspecified',
      signup_src: 'hn',
      signup_track: 'console',
    })
    expect(readStashedSignupMeta()).toBeNull()
  })

  it('labels a tester magic-link signup by its signup_intent', async () => {
    await completeSignupAttribution(freshUser({ signup_intent: 'tester' }))

    expect(updateUser).not.toHaveBeenCalled()
    expect(track).toHaveBeenCalledWith('signup_completed', {
      signup_source: 'unspecified',
      signup_track: 'tester',
    })
  })

  it('reports the email-signup track stamped at signUp() time', async () => {
    await completeSignupAttribution(freshUser({ signup_source: 'github', signup_track: 'console' }))

    expect(track).toHaveBeenCalledWith('signup_completed', {
      signup_source: 'github',
      signup_track: 'console',
    })
  })

  it('attaches the first touch to signup_completed and fires no loop_signup for it', async () => {
    await completeSignupAttribution(
      freshUser({
        signup_track: 'console',
        signup_first_touch: 'hn',
        signup_first_touch_medium: 'social',
        signup_first_touch_campaign: 'launch',
      }),
    )

    expect(track).toHaveBeenCalledWith('signup_completed', {
      signup_source: 'unspecified',
      signup_track: 'console',
      signup_first_touch: 'hn',
      signup_first_touch_medium: 'social',
      signup_first_touch_campaign: 'launch',
    })
    expect(track).not.toHaveBeenCalledWith('loop_signup', expect.anything())
  })

  it('replays a stashed OAuth first touch and loop ref onto the user', async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: null } as unknown as Awaited<
      ReturnType<typeof supabase.auth.updateUser>
    >)
    stashSignupMeta(readSignupMetaFromSearch(new URLSearchParams('?ft_src=widget&ref=a1b2c3d4e5f6')))

    await completeSignupAttribution(freshUser({}))

    expect(updateUser).toHaveBeenCalledWith({
      data: { loop_ref: 'a1b2c3d4e5f6', signup_first_touch: 'widget', signup_track: 'console' },
    })
    expect(track).toHaveBeenCalledWith('loop_signup', { ref: 'a1b2c3d4e5f6' })
  })

  it('fires loop_signup only for a real loop ref', async () => {
    // An account attributed before 2026-09-22 can carry ref=<utm_source>.
    await completeSignupAttribution(freshUser({ signup_source: 'hn', loop_ref: 'hn' }))
    expect(track).toHaveBeenCalledWith('signup_completed', { signup_source: 'hn' })
    expect(track).not.toHaveBeenCalledWith('loop_signup', expect.anything())

    track.mockReset()
    await completeSignupAttribution(freshUser({ signup_source: 'friend', loop_ref: 'a1b2c3d4e5f6' }))
    expect(track).toHaveBeenCalledWith('loop_signup', { ref: 'a1b2c3d4e5f6' })
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
