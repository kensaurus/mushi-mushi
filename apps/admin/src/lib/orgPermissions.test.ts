/**
 * FILE: apps/admin/src/lib/orgPermissions.test.ts
 * PURPOSE: Unit tests for org permission helpers.
 */

import { describe, expect, it } from 'vitest'
import {
  canCreateProject,
  canDeleteProject,
  canManageOrg,
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
