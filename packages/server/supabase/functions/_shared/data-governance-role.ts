/**
 * FILE: packages/server/supabase/functions/_shared/data-governance-role.ts
 * PURPOSE: Who may change what the nightly sweeps delete and where a
 *          project's data lives (retention windows, legal hold, residency
 *          pins). Org owners and admins, or the project's direct owner.
 *          Members and viewers keep read access.
 *
 *          The PUT routes enforce it; the GET routes return `can_manage` per
 *          row so the console disables controls a caller cannot use instead
 *          of letting them click into a 403. Both read the same rule.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function canManageDataGovernance(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * The subset of `projectIds` whose retention / residency the user may change.
 * Mirrors userCanAccessProject's precedence: direct ownership, then the org
 * role, then a per-project membership role.
 */
export async function manageableProjectIds(
  db: SupabaseClient,
  userId: string,
  projectIds: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (projectIds.length === 0) return out

  const [{ data: projects }, { data: orgRows }, { data: projectRows }] = await Promise.all([
    db.from('projects').select('id, owner_id, organization_id').in('id', [...projectIds]),
    db.from('organization_members').select('organization_id, role').eq('user_id', userId),
    db.from('project_members').select('project_id, role').eq('user_id', userId),
  ])

  const orgRole = new Map<string, string>()
  for (const r of (orgRows ?? []) as Array<{ organization_id: string; role: string }>) {
    orgRole.set(r.organization_id, r.role)
  }
  const projectRole = new Map<string, string>()
  for (const r of (projectRows ?? []) as Array<{ project_id: string; role: string }>) {
    projectRole.set(r.project_id, r.role)
  }

  for (const p of (projects ?? []) as Array<{ id: string; owner_id: string | null; organization_id: string | null }>) {
    if (p.owner_id === userId) {
      out.add(p.id)
      continue
    }
    const viaOrg = p.organization_id ? orgRole.get(p.organization_id) : undefined
    const role = viaOrg ?? projectRole.get(p.id)
    if (canManageDataGovernance(role)) out.add(p.id)
  }
  return out
}
