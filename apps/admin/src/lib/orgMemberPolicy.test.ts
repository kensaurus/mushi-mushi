/**
 * FILE: apps/admin/src/lib/orgMemberPolicy.test.ts
 * PURPOSE: The roster offers only what the API allows (console QA bugs 51,
 *          191, 192, 193, 194, 196, 309).
 */

import { describe, expect, it } from 'vitest'
import { rosterRowPermissions, splitInvitations } from './orgMemberPolicy'
import { resolveOrgSettingsLink } from './orgSettingsRoute'

describe('rosterRowPermissions', () => {
  it('gives an admin no control over an owner row', () => {
    const p = rosterRowPermissions({ actorRole: 'admin', targetRole: 'owner', isSelf: false, ownerCount: 2 })
    expect(p.roleOptions).toEqual([])
    expect(p.removeAction).toBeNull()
    expect(p.roleLockedReason).toMatch(/Only an owner/)
  })

  it('never offers Owner to an admin', () => {
    const p = rosterRowPermissions({ actorRole: 'admin', targetRole: 'member', isSelf: false, ownerCount: 1 })
    expect(p.roleOptions).toEqual(['admin', 'member', 'viewer'])
    expect(p.removeAction).toBe('remove')
  })

  it('lets an owner manage another owner while one remains', () => {
    const p = rosterRowPermissions({ actorRole: 'owner', targetRole: 'owner', isSelf: false, ownerCount: 2 })
    expect(p.roleOptions).toContain('owner')
    expect(p.removeAction).toBe('remove')
  })

  it('locks the sole owner row and explains how to hand over', () => {
    const p = rosterRowPermissions({ actorRole: 'owner', targetRole: 'owner', isSelf: true, ownerCount: 1 })
    expect(p.roleOptions).toEqual([])
    expect(p.removeAction).toBeNull()
    expect(p.roleLockedReason).toMatch(/Make someone else an owner first/)
  })

  it('offers Leave on your own row for any role', () => {
    for (const role of ['admin', 'member', 'viewer'] as const) {
      expect(rosterRowPermissions({ actorRole: role, targetRole: role, isSelf: true, ownerCount: 1 }).removeAction).toBe('leave')
    }
  })

  it('gives members a read-only roster', () => {
    const p = rosterRowPermissions({ actorRole: 'member', targetRole: 'viewer', isSelf: false, ownerCount: 1 })
    expect(p.roleOptions).toEqual([])
    expect(p.removeAction).toBeNull()
  })
})

describe('splitInvitations', () => {
  it('counts only unexpired invites as open', () => {
    const now = Date.parse('2026-10-04T00:00:00Z')
    const { open, expired } = splitInvitations(
      [
        { id: 'a', expires_at: '2026-10-05T00:00:00Z' },
        { id: 'b', expires_at: '2026-10-01T00:00:00Z' },
      ],
      now,
    )
    expect(open.map((i) => i.id)).toEqual(['a'])
    expect(expired.map((i) => i.id)).toEqual(['b'])
  })
})

describe('resolveOrgSettingsLink', () => {
  const orgs = [
    { id: '11111111-1111-4111-8111-111111111111', slug: 'acme' },
    { id: '22222222-2222-4222-8222-222222222222', slug: 'other-team' },
  ]

  it('opens the named team, not the active one', () => {
    const r = resolveOrgSettingsLink('other-team', 'invites', orgs)
    expect(r).toEqual({
      kind: 'redirect',
      orgId: orgs[1]!.id,
      to: `/organization/members?org=${orgs[1]!.id}&tab=invites`,
    })
  })

  it('maps billing and unknown sub-paths', () => {
    const billing = resolveOrgSettingsLink('acme', 'billing', orgs)
    expect(billing.kind === 'redirect' && billing.to).toContain('tab=setup')
    const other = resolveOrgSettingsLink('acme', 'whatever/deep', orgs)
    expect(other.kind === 'redirect' && other.to).toBe(`/organization/members?org=${orgs[0]!.id}`)
  })

  it('reports a team the user is not in', () => {
    expect(resolveOrgSettingsLink('nope', undefined, orgs)).toEqual({ kind: 'unknown-team', slug: 'nope' })
  })
})
