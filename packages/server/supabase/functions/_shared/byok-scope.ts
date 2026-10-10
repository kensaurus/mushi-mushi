/**
 * FILE: byok-scope.ts
 * PURPOSE: Which byok_keys rows a project may use (ADR 0023): its own, then
 *          its organization's shared keys. One filter for every reader, so
 *          the resolver, the key list and the per-key routes agree.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface KeyOwner {
  projectId: string;
  organizationId: string | null;
}

/** An id that cannot carry PostgREST filter syntax (`,` `.` `(` `)`). */
const PLAIN_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * PostgREST `.or()` filter for the rows a project may use. Ids come from the
 * database, but they are spliced into a filter string, so anything that
 * could change the filter is refused.
 */
export function keyOwnerFilter(owner: KeyOwner): string {
  if (!PLAIN_ID_RE.test(owner.projectId)) throw new Error('keyOwnerFilter: invalid projectId');
  const parts = [`project_id.eq.${owner.projectId}`];
  if (owner.organizationId) {
    if (!PLAIN_ID_RE.test(owner.organizationId)) throw new Error('keyOwnerFilter: invalid organizationId');
    parts.push(`organization_id.eq.${owner.organizationId}`);
  }
  return parts.join(',');
}

/** A shared key affects every app in the organization: owners and admins only. */
export function canManageSharedKeys(organizationRole: string | null | undefined): boolean {
  return organizationRole === 'owner' || organizationRole === 'admin';
}

/** The project's owner pair, read from projects. Null organization on a failed read. */
export async function projectKeyOwner(db: SupabaseClient, projectId: string): Promise<KeyOwner> {
  const { data } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle();
  return { projectId, organizationId: (data?.organization_id as string | null | undefined) ?? null };
}

/** Project keys before shared ones; priority within each. */
export function ownKeysFirst<T extends { project_id?: string | null; priority?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aShared = a.project_id ? 0 : 1;
    const bShared = b.project_id ? 0 : 1;
    if (aShared !== bShared) return aShared - bShared;
    return (a.priority ?? 100) - (b.priority ?? 100);
  });
}
