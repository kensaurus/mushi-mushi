/**
 * Drop stored setup-gap answers after a setting they depend on changes.
 *
 * `setup_gap_results` is shown for up to a day while a re-check runs in the
 * background (api/routes/setup-gaps.ts), so without this a fix the owner just
 * made (a new Cursor key, review follow-ups switched back on) still showed as
 * a problem on Home's "Fix these first" until the second visit. Dropping the
 * row makes the next read check live. Best effort: a failure is logged and
 * never fails the request that changed the setting.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const slog = log.child('setup-gap-invalidate')

type Db = SupabaseClient

/** The key row's owner columns (byok_keys has exactly one set). */
export interface KeyOwner {
  project_id?: string | null
  organization_id?: string | null
  owner_user_id?: string | null
}

/** The apps whose setup gaps a key change can move. */
async function projectsForKey(db: Db, key: KeyOwner): Promise<string[]> {
  if (key.project_id) return [key.project_id]
  if (key.organization_id) return projectsForOrgs(db, [key.organization_id])
  if (key.owner_user_id) {
    // A universal key serves the organizations its owner owns (ADR 0031).
    const { data, error } = await db.from('organizations').select('id').eq('owner_id', key.owner_user_id)
    if (error) throw new Error(error.message)
    return projectsForOrgs(db, (data ?? []).map((o: { id: string }) => o.id))
  }
  return []
}

async function projectsForOrgs(db: Db, orgIds: string[]): Promise<string[]> {
  if (orgIds.length === 0) return []
  const { data, error } = await db.from('projects').select('id').in('organization_id', orgIds)
  if (error) throw new Error(error.message)
  return (data ?? []).map((p: { id: string }) => p.id)
}

/** Delete the stored answers for these apps; returns the apps dropped. Never throws. */
export async function invalidateStoredSetupGaps(db: Db, projectIds: string[]): Promise<string[]> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (ids.length === 0) return []
  try {
    const { error } = await db.from('setup_gap_results').delete().in('project_id', ids)
    // A missing table (older self-host) means there is nothing stored to drop.
    if (error && !/^(42P01|PGRST205)$/.test(String(error.code ?? ''))) throw new Error(error.message)
    return ids
  } catch (err) {
    slog.warn('Could not drop stored setup gaps', { projects: ids.length, err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

/** After a key is added, changed or removed. Never throws. */
export async function invalidateSetupGapsForKey(db: Db, key: KeyOwner): Promise<string[]> {
  try {
    return await invalidateStoredSetupGaps(db, await projectsForKey(db, key))
  } catch (err) {
    slog.warn('Could not find the apps a key serves', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

/** After an organization-wide setting changes (review follow-ups). Never throws. */
export async function invalidateSetupGapsForOrg(db: Db, organizationId: string): Promise<string[]> {
  try {
    return await invalidateStoredSetupGaps(db, await projectsForOrgs(db, [organizationId]))
  } catch (err) {
    slog.warn('Could not find the organization\'s apps', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}
