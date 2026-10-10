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

// `getServiceClient` is only referenced in `ReturnType<typeof
// getServiceClient>` annotations below — pull it in as a type-only
// import so `db.ts` (and its `npm:@supabase/supabase-js` dependency)
// stays out of the runtime module graph for any function whose
// import path doesn't otherwise need the live client.
import type { getServiceClient } from './db.ts'
import { fanoutMemo } from './request-memo.ts'
import { log } from './logger.ts'

/**
 * `strict`: a failed read throws `ProjectAccessReadError` instead of counting
 * as "no access". The default stays fail-closed (an empty list) for the
 * routes that already rely on it, but logs the read error so an outage is
 * visible; a page that would render an empty list as a fact ("no apps yet")
 * passes `strict: true` (Plan 020 P-1).
 */
export interface AccessReadOptions {
  strict?: boolean
}

export class ProjectAccessReadError extends Error {
  constructor(what: string, detail: string) {
    super(`project access read failed (${what}): ${detail}`)
    this.name = 'ProjectAccessReadError'
  }
}

function checkRead(
  res: { error: { message: string; code?: string } | null },
  what: string,
  opts: AccessReadOptions,
): void {
  if (!res.error) return
  if (opts.strict) throw new ProjectAccessReadError(what, res.error.message)
  log.warn('project access read failed; treating as no access', {
    table: what,
    code: res.error.code ?? null,
    err: res.error.message.slice(0, 500),
  })
}

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
  opts: AccessReadOptions = {},
): Promise<string[]> {
  // Shared across the slices of one nav-meta fan-out (see request-memo.ts);
  // callers get their own copy so none can mutate another's list.
  const ids = await fanoutMemo(userId, `accessibleProjectIds:${opts.strict ? 'strict' : 'lenient'}`, () =>
    readAccessibleProjectIds(db, userId, opts),
  )
  return [...ids]
}

async function readAccessibleProjectIds(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  opts: AccessReadOptions,
): Promise<string[]> {
  const [orgRes, memberRes, ownedRes] = await Promise.all([
    db.from('organization_members').select('organization_id').eq('user_id', userId),
    db.from('project_members').select('project_id').eq('user_id', userId),
    db.from('projects').select('id').eq('owner_id', userId),
  ])
  checkRead(orgRes, 'organization_members', opts)
  checkRead(memberRes, 'project_members', opts)
  checkRead(ownedRes, 'projects', opts)
  const orgMemberships = orgRes.data
  const projectMemberships = memberRes.data
  const owned = ownedRes.data

  const ids = new Set<string>()
  for (const p of owned ?? []) ids.add(p.id)
  for (const m of projectMemberships ?? []) ids.add(m.project_id)

  const orgIds = (orgMemberships ?? []).map((m) => m.organization_id).filter(Boolean)
  if (orgIds.length > 0) {
    const orgProjectsRes = await db.from('projects').select('id').in('organization_id', orgIds)
    checkRead(orgProjectsRes, 'projects', opts)
    for (const p of orgProjectsRes.data ?? []) ids.add(p.id)
  }

  return Array.from(ids)
}

/**
 * Subset of {@link accessibleProjectIds} limited to one organization.
 * Returns `[]` when the caller is not a member of `organizationId` (fail
 * closed — same contract as Supabase org-scoped dashboards).
 */
export async function accessibleProjectIdsInOrganization(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  organizationId: string,
  opts: AccessReadOptions = {},
): Promise<string[]> {
  const membershipRes = await db
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle()
  checkRead(membershipRes, 'organization_members', opts)
  const membership = membershipRes.data
  if (!membership) return []

  const all = await accessibleProjectIds(db, userId, opts)
  if (all.length === 0) return []

  const orgProjectsRes = await db
    .from('projects')
    .select('id')
    .eq('organization_id', organizationId)
    .in('id', all)
  checkRead(orgProjectsRes, 'projects', opts)
  return (orgProjectsRes.data ?? []).map((p) => p.id)
}

/**
 * Historical alias kept for backwards compatibility with older route
 * code that still says `ownedProjectIds`. New code should use
 * `accessibleProjectIds` directly — the "owned" naming pre-dated Teams
 * v1 / org membership and is misleading.
 *
 * @deprecated Use `accessibleProjectIds`. This returns member projects
 * (viewers included) and is NOT an owner or write check.
 */
export const ownedProjectIds = accessibleProjectIds
