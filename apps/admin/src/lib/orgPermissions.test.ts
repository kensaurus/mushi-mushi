/**
 * FILE: apps/admin/src/lib/orgPermissions.test.ts
 * PURPOSE: Unit tests for org permission helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  canCreateProject,
  canDeleteProject,
  canManageOrg,
  mayManageActiveOrg,
  resolveActiveOrgRole,
  viewerRoleHint,
} from './orgPermissions'

describe('orgPermissions', () => {
  it('owner/admin can manage org and projects', () => {
    expect(canManageOrg('owner')).toBe(true)
    expect(canManageOrg('admin')).toBe(true)
    expect(canCreateProject('admin')).toBe(true)
    expect(canDeleteProject('owner')).toBe(true)
  })

  it('member/viewer cannot manage org resources', () => {
    expect(canManageOrg('member')).toBe(false)
    expect(canManageOrg('viewer')).toBe(false)
    expect(canCreateProject('viewer')).toBe(false)
  })

  it('viewerRoleHint explains restrictions', () => {
    expect(viewerRoleHint('viewer')).toContain('viewer')
    expect(viewerRoleHint('owner')).toBeNull()
  })
})

describe('resolveActiveOrgRole', () => {
  const orgs = [
    { id: 'a', role: 'owner' },
    { id: 'b', role: 'viewer' },
  ]
  it('returns the active team role', () => {
    expect(resolveActiveOrgRole(orgs, 'b')).toBe('viewer')
  })
  it('falls back to the only team when none is picked', () => {
    expect(resolveActiveOrgRole([{ id: 'x', role: 'member' }], null)).toBe('member')
  })
  it('is unknown while loading or ambiguous', () => {
    expect(resolveActiveOrgRole(undefined, 'a')).toBeNull()
    expect(resolveActiveOrgRole(orgs, null)).toBeNull()
  })
  it('only a known member/viewer role blocks management', () => {
    expect(mayManageActiveOrg(null)).toBe(true)
    expect(mayManageActiveOrg('admin')).toBe(true)
    expect(mayManageActiveOrg('member')).toBe(false)
  })
})
