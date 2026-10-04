/**
 * FILE: packages/server/src/__tests__/console-group-k-helpers.test.ts
 * PURPOSE: Pure decisions behind the console group K fixes (rewards,
 *          anti-gaming, tester portal), 2026-10-04.
 */
import { describe, expect, it } from 'vitest'
import {
  leaderboardSearchTerm,
  plainIssues,
  rewardsWriteDenial,
} from '../../supabase/functions/_shared/rewards-admin.ts'
import {
  antiGamingListScope,
  requestedOwnedProject,
} from '../../supabase/functions/_shared/anti-gaming-scope.ts'
import {
  normalizeLegalName,
  perAppLeaderboard,
  testerProfileUpdate,
} from '../../supabase/functions/_shared/tester-profile.ts'

describe('perAppLeaderboard (#218 privacy flags)', () => {
  const points = new Map([['a', 300], ['b', 200], ['c', 100], ['d', 50]])
  const testers = [
    { id: 'a', public_handle: 'ada', public_leaderboard: true, public_handle_visible: true },
    { id: 'b', public_handle: 'bob', public_leaderboard: false, public_handle_visible: true },
    { id: 'c', public_handle: 'cy', public_leaderboard: true, public_handle_visible: false },
  ]

  it('leaves out testers who opted out and hides handles they asked to hide', () => {
    expect(perAppLeaderboard(['a', 'b', 'c', 'd'], points, testers)).toEqual([
      { handle: 'ada', points: 300 },
      { handle: 'Anonymous tester', points: 100 },
      { handle: 'Anonymous tester', points: 50 },
    ])
  })

  it('caps the list size after filtering', () => {
    expect(perAppLeaderboard(['a', 'c', 'd'], points, testers, 2)).toHaveLength(2)
  })
})

describe('rewardsWriteDenial (#220)', () => {
  it('refuses viewers whatever the plan', () => {
    expect(rewardsWriteDenial('viewer', true)).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('refuses a caller with no role', () => {
    expect(rewardsWriteDenial(null, true)).toMatchObject({ status: 403 })
  })

  it('refuses a plan without rewards_program', () => {
    expect(rewardsWriteDenial('owner', false)).toMatchObject({ status: 402, code: 'FEATURE_NOT_IN_PLAN' })
  })

  it('allows owner and admin on a rewards plan', () => {
    for (const role of ['owner', 'admin']) expect(rewardsWriteDenial(role, true)).toBeNull()
  })

  it('refuses members: rewards changes reach every reporter', () => {
    expect(rewardsWriteDenial('member', true)).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('writes plain English, not codes', () => {
    expect(rewardsWriteDenial('viewer', true)?.message).toMatch(/viewers/i)
  })
})

describe('leaderboardSearchTerm (#317)', () => {
  it('removes characters that break a PostgREST or() filter', () => {
    const term = leaderboardSearchTerm('a,b)(c"d\\e:f')
    expect(term).not.toMatch(/[,()"\\:]/)
    expect(term).toBe('a b c d e f')
  })

  it('removes like wildcards', () => {
    expect(leaderboardSearchTerm('100%_*')).toBe('100')
  })

  it('lower-cases, trims and caps the length', () => {
    expect(leaderboardSearchTerm('  Alice  ')).toBe('alice')
    expect(leaderboardSearchTerm('x'.repeat(200))).toHaveLength(64)
    expect(leaderboardSearchTerm(undefined)).toBe('')
  })
})

describe('plainIssues (#216)', () => {
  it('builds one readable sentence from zod issues', () => {
    expect(
      plainIssues('Check the quest:', [{ path: ['steps', 0, 'action'], message: 'Required' }]),
    ).toBe('Check the quest: steps 0 action: Required.')
  })

  it('returns the prefix alone when there are no issues', () => {
    expect(plainIssues('Check the quest:', [])).toBe('Check the quest:')
  })
})

describe('anti-gaming scope (#212)', () => {
  const owned = ['p-old', 'p-new']

  it('uses the requested project when the caller owns it', () => {
    expect(requestedOwnedProject(owned, 'p-new')).toBe('p-new')
    expect(requestedOwnedProject(owned, undefined, 'p-new')).toBe('p-new')
  })

  it('ignores a project the caller does not own', () => {
    expect(requestedOwnedProject(owned, 'someone-else')).toBeNull()
  })

  it('scopes lists to the requested project, else all owned projects', () => {
    expect(antiGamingListScope(owned, 'p-new')).toEqual(['p-new'])
    expect(antiGamingListScope(owned, null)).toEqual(owned)
    expect(antiGamingListScope(owned, 'someone-else')).toEqual(owned)
  })
})

describe('testerProfileUpdate (#218)', () => {
  it('writes each privacy flag to its own column', () => {
    const res = testerProfileUpdate({ privacyPublicHandle: true, privacyPublicLeaderboard: false })
    expect(res).toMatchObject({
      ok: true,
      testerUpdates: { public_handle_visible: true, public_leaderboard: false },
    })
  })

  it('keeps the existing handle normalisation and skips an empty handle', () => {
    expect(testerProfileUpdate({ handle: 'Big Bug Hunter' })).toMatchObject({
      ok: true,
      testerUpdates: { public_handle: 'big-bug-hunter' },
    })
    const empty = testerProfileUpdate({ handle: '   ' })
    expect(empty.ok && 'public_handle' in empty.testerUpdates).toBe(false)
  })

  it('rejects a one-letter country instead of failing the CHECK silently', () => {
    expect(testerProfileUpdate({ country: 'u' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(testerProfileUpdate({ country: 'jp' })).toMatchObject({ ok: true, testerUpdates: { country_code: 'JP' } })
  })
})

describe('normalizeLegalName (#219)', () => {
  it('collapses whitespace and rejects blanks', () => {
    expect(normalizeLegalName('  Ada   Lovelace ')).toBe('Ada Lovelace')
    expect(normalizeLegalName('   ')).toBeNull()
    expect(normalizeLegalName(undefined)).toBeNull()
  })
})
