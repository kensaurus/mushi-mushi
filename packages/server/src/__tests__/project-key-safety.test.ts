/**
 * Console group E (2026-10-04): key rotation, CI-key revocation order and the
 * per-project capabilities that decide which controls the console shows.
 */
import { describe, expect, it } from 'vitest'
import { mayRevokePriorCiKeys, parseRotateTarget } from '../../supabase/functions/_shared/api-key-rotation'
import { projectCapabilities } from '../../supabase/functions/_shared/project-capabilities'

describe('rotation names one key (QA #31)', () => {
  it("accepts the console's keyId as well as the API's key_id", () => {
    const id = '22222222-2222-4222-8222-222222222222'
    expect(parseRotateTarget({ keyId: id })).toEqual({ keyId: id })
    expect(parseRotateTarget({ key_id: id })).toEqual({ keyId: id })
  })
})

describe('mayRevokePriorCiKeys (QA #30)', () => {
  const KEY = 'NEXT_PUBLIC_MUSHI_API_KEY'

  it('revokes only after GitHub accepted the secret that carries the new key', () => {
    expect(mayRevokePriorCiKeys([KEY, 'NEXT_PUBLIC_MUSHI_PROJECT_ID'], KEY)).toBe(true)
  })

  it('keeps the old key live when the key secret was not written', () => {
    expect(mayRevokePriorCiKeys([], KEY)).toBe(false)
    expect(mayRevokePriorCiKeys(['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_ENDPOINT'], KEY)).toBe(false)
  })
})

describe('projectCapabilities (QA #128, #129)', () => {
  const base = { userId: 'u1', ownerId: 'someone-else', organizationId: 'org1', orgRole: null, projectRole: null }

  it('org owner/admin can manage and delete', () => {
    for (const orgRole of ['owner', 'admin']) {
      expect(projectCapabilities({ ...base, orgRole })).toEqual({ my_role: orgRole, can_manage: true, can_delete: true })
    }
  })

  it('org member or viewer can do neither', () => {
    for (const orgRole of ['member', 'viewer']) {
      expect(projectCapabilities({ ...base, orgRole })).toMatchObject({ can_manage: false, can_delete: false })
    }
  })

  it('a project-only member sees no Rename/Delete (organization_role was null and read as owner)', () => {
    expect(projectCapabilities({ ...base, projectRole: 'member' })).toEqual({
      my_role: 'member',
      can_manage: false,
      can_delete: false,
    })
  })

  it('a project-only admin can manage keys but cannot delete an org-backed project', () => {
    expect(projectCapabilities({ ...base, projectRole: 'admin' })).toEqual({
      my_role: 'admin',
      can_manage: true,
      can_delete: false,
    })
  })

  it('a direct owner outside the org manages, but only the org can delete an org-backed project', () => {
    expect(projectCapabilities({ ...base, ownerId: 'u1' })).toEqual({ my_role: 'owner', can_manage: true, can_delete: false })
  })

  it('a legacy project without an org is the direct owner\'s to delete', () => {
    expect(projectCapabilities({ ...base, organizationId: null, ownerId: 'u1' })).toMatchObject({ can_delete: true })
    expect(projectCapabilities({ ...base, organizationId: null, projectRole: 'admin' })).toMatchObject({
      can_manage: true,
      can_delete: false,
    })
  })
})
