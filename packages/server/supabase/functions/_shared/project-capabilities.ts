/**
 * FILE: packages/server/supabase/functions/_shared/project-capabilities.ts
 * PURPOSE: What the caller may do on one project, computed once on the
 *          server and sent with GET /v1/admin/projects so the console shows
 *          only controls that will work. Pure; no imports.
 *
 * The console used to guess from `organization_role` alone and treated null
 * as "owner". `organization_role` is null for anyone who reaches the project
 * through a project_members row or a legacy owner_id, so project-only
 * members saw Rename and Delete and every attempt failed with 403 (QA #129),
 * and members saw key, SDK-config and identity controls that 403'd or hung
 * (QA #128).
 */

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface ProjectCapabilityInput {
  userId: string
  ownerId: string | null
  organizationId: string | null
  /** The caller's organization_members role in the project's org, if any. */
  orgRole: string | null
  /** The caller's project_members role on this project, if any. */
  projectRole: string | null
}

export interface ProjectCapabilities {
  /** Effective role, same precedence as userCanAccessProject (api/shared.ts). */
  my_role: ProjectRole | null
  /** Mint, rotate and revoke keys; change SDK, assistant and identity settings. */
  can_manage: boolean
  /** Rename and delete — the stricter rule in PATCH/DELETE /v1/admin/projects/:id. */
  can_delete: boolean
}

function asRole(value: string | null): ProjectRole | null {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer' ? value : null
}

export function projectCapabilities(input: ProjectCapabilityInput): ProjectCapabilities {
  const orgRole = asRole(input.orgRole)
  // userCanAccessProject: direct owner first, then the org role, then the
  // project_members role.
  const my_role: ProjectRole | null =
    input.ownerId === input.userId
      ? 'owner'
      : input.organizationId && orgRole
        ? orgRole
        : asRole(input.projectRole)
  const can_manage = my_role === 'owner' || my_role === 'admin'
  // Rename/delete: an org-backed project needs an org owner/admin; a legacy
  // project without an org needs the direct owner.
  const can_delete = input.organizationId
    ? orgRole === 'owner' || orgRole === 'admin'
    : input.ownerId === input.userId
  return { my_role, can_manage, can_delete }
}
