/**
 * FILE: packages/server/src/__tests__/org-member-policy.test.ts
 * PURPOSE: Org roster rules (console group J #51, #191, #192, #193).
 *   #51  an admin could demote an owner and then remove them.
 *   #191 the Owner option failed with an empty error for admins.
 *   #192 demoting the last owner surfaced as a 500 "could not load" error.
 *   #193 leaving the org (self-removal) must still work, but not for the last owner.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { memberRemovalDenial, roleChangeDenial } from '../../supabase/functions/_shared/org-member-policy.ts'

describe('roleChangeDenial', () => {
  const base = { isSelf: false, ownerCount: 2 }

  it('lets an owner demote another owner when another owner remains', () => {
    expect(roleChangeDenial({ ...base, actorRole: 'owner', targetRole: 'owner', nextRole: 'member' })).toBeNull()
  })

  it('stops an admin from demoting an owner (#51)', () => {
    const d = roleChangeDenial({ ...base, actorRole: 'admin', targetRole: 'owner', nextRole: 'member' })
    expect(d?.code).toBe('OWNER_REQUIRED')
    expect(d?.status).toBe(403)
  })

  it('stops an admin from granting owner, with a readable reason (#191)', () => {
    const d = roleChangeDenial({ ...base, actorRole: 'admin', targetRole: 'member', nextRole: 'owner' })
    expect(d?.code).toBe('OWNER_REQUIRED')
    expect(d?.message.length).toBeGreaterThan(10)
  })

  it('lets an admin change a member or another admin', () => {
    expect(roleChangeDenial({ ...base, actorRole: 'admin', targetRole: 'member', nextRole: 'viewer' })).toBeNull()
    expect(roleChangeDenial({ ...base, actorRole: 'admin', targetRole: 'admin', nextRole: 'member' })).toBeNull()
  })

  it('refuses to demote the last owner with a 409, not a 500 (#192)', () => {
    const d = roleChangeDenial({ actorRole: 'owner', targetRole: 'owner', nextRole: 'admin', isSelf: true, ownerCount: 1 })
    expect(d?.code).toBe('LAST_OWNER')
    expect(d?.status).toBe(409)
  })

  it('refuses members and viewers', () => {
    expect(roleChangeDenial({ ...base, actorRole: 'member', targetRole: 'viewer', nextRole: 'member' })?.code).toBe('FORBIDDEN')
    expect(roleChangeDenial({ ...base, actorRole: null, targetRole: 'viewer', nextRole: 'member' })?.code).toBe('FORBIDDEN')
  })
})

describe('memberRemovalDenial', () => {
  it('stops an admin from removing an owner (#51)', () => {
    const d = memberRemovalDenial({ actorRole: 'admin', targetRole: 'owner', isSelf: false, ownerCount: 2 })
    expect(d?.code).toBe('OWNER_REQUIRED')
  })

  it('lets an owner remove another owner when one remains', () => {
    expect(memberRemovalDenial({ actorRole: 'owner', targetRole: 'owner', isSelf: false, ownerCount: 2 })).toBeNull()
  })

  it('lets anyone leave, including members and viewers (#193, #309)', () => {
    expect(memberRemovalDenial({ actorRole: 'viewer', targetRole: 'viewer', isSelf: true, ownerCount: 1 })).toBeNull()
    expect(memberRemovalDenial({ actorRole: 'admin', targetRole: 'admin', isSelf: true, ownerCount: 1 })).toBeNull()
  })

  it('stops the last owner from leaving', () => {
    expect(memberRemovalDenial({ actorRole: 'owner', targetRole: 'owner', isSelf: true, ownerCount: 1 })?.code).toBe('LAST_OWNER')
  })

  it('stops members removing teammates', () => {
    expect(memberRemovalDenial({ actorRole: 'member', targetRole: 'viewer', isSelf: false, ownerCount: 1 })?.code).toBe('FORBIDDEN')
  })
})

describe('organizations.ts wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/organizations.ts'), 'utf8')

  it('PATCH and DELETE member consult the policy before writing', () => {
    const patch = src.slice(src.indexOf("app.patch('/v1/org/:id/members/:userId'"))
    expect(patch.indexOf('roleChangeDenial(')).toBeGreaterThan(0)
    expect(patch.indexOf('roleChangeDenial(')).toBeLessThan(patch.indexOf(".update({ role: body.role })"))
    const del = src.slice(src.indexOf("app.delete('/v1/org/:id/members/:userId'"))
    expect(del.indexOf('memberRemovalDenial(')).toBeGreaterThan(0)
    expect(del.indexOf('memberRemovalDenial(')).toBeLessThan(del.indexOf('.delete()'))
  })

  it('reports a GoTrue invite refusal instead of swallowing it (#52)', () => {
    expect(src).not.toMatch(/inviteUserByEmail\([\s\S]{0,600}?\)\s*\.catch\(\(\) => null\)/)
    expect(src).toMatch(/emailSent/)
  })

  it('retires an expired pending invite before re-inviting the same address (#194)', () => {
    // uq_pending_invitation_email ignores expiry: an expired row still holds the slot.
    const post = src.slice(src.indexOf("app.post('/v1/org/:id/invitations'"))
    const retire = post.indexOf(".lte('expires_at', nowIso)")
    const insert = post.search(/\.from\('invitations'\)\s*\.insert\(/)
    expect(retire).toBeGreaterThan(0)
    expect(insert).toBeGreaterThan(retire)
    expect(post).toMatch(/ALREADY_INVITED/)
  })
})
