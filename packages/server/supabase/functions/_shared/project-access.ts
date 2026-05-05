/**
 * Project-access helpers shared across Edge Functions.
 *
 * Lives in `_shared/` (not `api/`) because more than one function needs
 * the JWT-path "what projects can this user act on?" check. Keeping the
 * implementation here means functions like `inventory-crawler` and
 * `synthetic-monitor` can pull it in without dragging the whole `api/`
 * directory into their deploy bundle — which doesn't work, because the
 * deploy script (`scripts/deploy-edge-function.mjs`) only ships
 * `<function>/` plus `_shared/`. A previous version of
 * `_shared/inventory-guards.ts` reached up into `../api/shared.ts` for
 * `accessibleProjectIds`, and the resulting unresolved import made
 * `inventory-crawler` + `synthetic-monitor` fail to deploy with a
 * misleading platform-side HTTP 400.
 *
 * `api/shared.ts` re-exports from this file to keep its existing callers
 * (everything under `api/routes/*`) working without churn.
 */

import { getServiceClient } from './db.ts'

/**
 * Resolve the set of project ids visible to the authenticated user.
 *
 * Three concurrent sources of "I can see this project" the api has to
 * honour:
 *
 *   1. `projects.owner_id == userId` — legacy / pre-Teams-v1 ownership
 *      (also still the source of truth for projects created without an org).
 *   2. `organization_members.user_id == userId` — Teams v1 grants access to
 *      every project under the joined org. Pro+ feature.
 *   3. `project_members.user_id == userId` — per-project membership rows
 *      (predates Teams v1; still used by /v1/admin/fixes & dispatch gates,
 *      and seeded when a user creates a project).
 *
 * All three union together. Without this every team member would silently
 * see "0 projects" on the relevant page even though /v1/admin/projects
 * correctly enumerates the org-scoped set.
 */
export async function accessibleProjectIds(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<string[]> {
  const [
    { data: orgMemberships },
    { data: projectMemberships },
    { data: owned },
  ] = await Promise.all([
    db.from('organization_members').select('organization_id').eq('user_id', userId),
    db.from('project_members').select('project_id').eq('user_id', userId),
    db.from('projects').select('id').eq('owner_id', userId),
  ])

  const ids = new Set<string>()
  for (const p of owned ?? []) ids.add(p.id)
  for (const m of projectMemberships ?? []) ids.add(m.project_id)

  const orgIds = (orgMemberships ?? []).map((m) => m.organization_id).filter(Boolean)
  if (orgIds.length > 0) {
    const { data: projects } = await db.from('projects').select('id').in('organization_id', orgIds)
    for (const p of projects ?? []) ids.add(p.id)
  }

  return Array.from(ids)
}

/**
 * Historical alias kept for backwards compatibility with older route
 * code that still says `ownedProjectIds`. New code should use
 * `accessibleProjectIds` directly — the "owned" naming pre-dated Teams
 * v1 / org membership and is misleading.
 */
export const ownedProjectIds = accessibleProjectIds
