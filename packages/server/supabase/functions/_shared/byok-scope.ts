/**
 * FILE: byok-scope.ts
 * PURPOSE: Which byok_keys rows a project may use. One filter for every
 *          reader, so the resolver, the key list and the per-key routes agree.
 *
 *          A row has exactly one owner (migration 20261021051628):
 *            - project_id       the app's own key;
 *            - organization_id  shared by every app in the organization (ADR 0023);
 *            - owner_user_id    universal: every app in every organization
 *                               where that user is an **owner** (ADR 0031).
 *
 *          Order for one app: its own keys, (its legacy credential, in
 *          byok.ts), its organization's shared keys, the universal keys of its
 *          organization's owners, the platform key. With several owners, all
 *          their universal keys form one group ordered by priority.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type KeyScope = 'project' | 'organization' | 'universal';

export interface KeyOwner {
  projectId: string;
  organizationId: string | null;
  /**
   * Users whose universal keys this project may use: the users with role
   * `owner` in its organization. Empty or absent: no universal keys.
   */
  universalUserIds?: string[];
}

/** An id that cannot carry PostgREST filter syntax (`,` `.` `(` `)`). */
const PLAIN_ID_RE = /^[A-Za-z0-9-]+$/;

function plainIds(ids: readonly string[] | undefined, what: string): string[] {
  const out = [...new Set(ids ?? [])];
  for (const id of out) if (!PLAIN_ID_RE.test(id)) throw new Error(`keyOwnerFilter: invalid ${what}`);
  return out;
}

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
  const users = plainIds(owner.universalUserIds, 'universal user id');
  if (users.length === 1) parts.push(`owner_user_id.eq.${users[0]}`);
  else if (users.length > 1) parts.push(`owner_user_id.in.(${users.join(',')})`);
  return parts.join(',');
}

/**
 * The scope a row has for this project, or null when the project may not use
 * it at all. The resolver runs every row through this after the filtered
 * query, so a universal key whose owner is not an owner of this project's
 * organization never serves it, whatever the query returned.
 */
export function keyScopeFor(
  row: { project_id?: string | null; organization_id?: string | null; owner_user_id?: string | null },
  owner: KeyOwner,
): KeyScope | null {
  if (row.project_id) return row.project_id === owner.projectId ? 'project' : null;
  if (row.organization_id) {
    return owner.organizationId && row.organization_id === owner.organizationId ? 'organization' : null;
  }
  if (row.owner_user_id) return owner.universalUserIds?.includes(row.owner_user_id) ? 'universal' : null;
  return null;
}

/** The scope a row was saved with, for labels; no access decision. */
export function rowScope(row: { project_id?: string | null; organization_id?: string | null }): KeyScope {
  if (row.project_id) return 'project';
  if (row.organization_id) return 'organization';
  return 'universal';
}

/** A shared key affects every app in the organization: owners and admins only. */
export function canManageSharedKeys(organizationRole: string | null | undefined): boolean {
  return organizationRole === 'owner' || organizationRole === 'admin';
}

/**
 * Whose universal keys an organization's apps use: its owners only. An
 * admin's universal key does not reach an organization they only administer,
 * so nobody can bill an organization they do not own (ADR 0031).
 */
export function universalKeyApplies(keyOwnerRoleInOrg: string | null | undefined): boolean {
  return keyOwnerRoleInOrg === 'owner';
}

/**
 * The users with role `owner` in an organization. Empty on a failed read
 * (no universal keys). `strict` throws instead, so a caller can tell a
 * failed read from an organization that has no owners.
 */
export async function organizationOwnerIds(
  db: SupabaseClient,
  organizationId: string | null,
  opts: { strict?: boolean } = {},
): Promise<string[]> {
  if (!organizationId) return [];
  try {
    const { data, error } = await db
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'owner');
    if (error) {
      if (opts.strict) throw new Error(error.message || 'organization owners read failed');
      return [];
    }
    if (!Array.isArray(data)) return [];
    return (data as Array<{ user_id: string | null }>).map((r) => r.user_id).filter((id): id is string => !!id);
  } catch (err) {
    if (opts.strict) throw err;
    return [];
  }
}

/** Owners of each organization, in one read. */
export async function organizationOwnersByOrg(db: SupabaseClient, organizationIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(organizationIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from('organization_members')
    .select('organization_id, user_id')
    .in('organization_id', ids)
    .eq('role', 'owner');
  if (error || !Array.isArray(data)) return out;
  for (const r of data as Array<{ organization_id: string; user_id: string }>) {
    const list = out.get(r.organization_id) ?? [];
    list.push(r.user_id);
    out.set(r.organization_id, list);
  }
  return out;
}

/**
 * Universal byok_keys rows serving each organization: its owners' keys
 * (ADR 0031). For batch readers that load many projects at once. A failed
 * read (or a database without the column yet) degrades to none.
 */
export async function universalKeysByOrg<T extends { owner_user_id: string }>(
  db: SupabaseClient,
  organizationIds: string[],
  columns: string,
  provider?: string,
): Promise<Map<string, T[]>> {
  const out = new Map<string, T[]>();
  try {
    const owners = await organizationOwnersByOrg(db, organizationIds);
    const ownerIds = [...new Set([...owners.values()].flat())];
    if (ownerIds.length === 0) return out;
    let query = db.from('byok_keys').select(`owner_user_id, ${columns}`).in('owner_user_id', ownerIds);
    if (provider) query = query.eq('provider_slug', provider);
    const { data, error } = await query;
    if (error || !data) return out;
    const rows = data as unknown as T[];
    for (const [orgId, ids] of owners) {
      out.set(orgId, rows.filter((r) => ids.includes(r.owner_user_id)));
    }
  } catch {
    // A batch reader's input degrades to "absent"; it never fakes a key.
  }
  return out;
}

/**
 * Does byok_keys have owner_user_id yet (migration 20261021051628)? Functions
 * can deploy before `db push`; until then every reader leaves universal keys
 * out instead of failing on an unknown column (PostgREST 42703). Cached per
 * client: a yes for good, a no for a minute so the migration is picked up.
 */
const ownerColumnState = new WeakMap<object, { ready: boolean; at: number }>();
const OWNER_COLUMN_RETRY_MS = 60_000;

export async function ownerUserColumnReady(db: SupabaseClient): Promise<boolean> {
  const cached = ownerColumnState.get(db);
  if (cached && (cached.ready || Date.now() - cached.at < OWNER_COLUMN_RETRY_MS)) return cached.ready;
  let ready = true;
  try {
    const { error } = await db.from('byok_keys').select('owner_user_id').limit(1);
    ready = !isMissingOwnerUserColumn(error);
  } catch {
    // Not a missing column: the real query reports whatever is wrong.
    ready = true;
  }
  ownerColumnState.set(db, { ready, at: Date.now() });
  return ready;
}

/** `columns` plus owner_user_id when the database has it. */
export function withOwnerUserColumn(columns: string, ready: boolean): string {
  return ready ? `${columns}, owner_user_id` : columns;
}

/** The owner triple for a project row the caller already has. */
export async function keyOwnerForProject(
  db: SupabaseClient,
  project: { id: string; organization_id?: string | null },
  opts: { strict?: boolean } = {},
): Promise<KeyOwner> {
  const organizationId = (project.organization_id as string | null | undefined) ?? null;
  const universalUserIds = (await ownerUserColumnReady(db))
    ? await organizationOwnerIds(db, organizationId, opts)
    : [];
  return { projectId: project.id, organizationId, universalUserIds };
}

/**
 * The project's owner triple, read from projects. Null organization on a
 * failed read, unless `strict`, which throws so the caller does not treat
 * a database error as "this app has no organization".
 */
export async function projectKeyOwner(
  db: SupabaseClient,
  projectId: string,
  opts: { strict?: boolean } = {},
): Promise<KeyOwner> {
  const { data, error } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle();
  if (error && opts.strict) throw new Error(error.message || 'project owner read failed');
  return keyOwnerForProject(db, {
    id: projectId,
    organization_id: (data?.organization_id as string | null | undefined) ?? null,
  }, opts);
}

const SCOPE_RANK: Record<KeyScope, number> = { project: 0, organization: 1, universal: 2 };

/** Project keys, then the organization's, then universal ones; priority within each. */
export function ownKeysFirst<
  T extends { project_id?: string | null; organization_id?: string | null; priority?: number | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const rank = SCOPE_RANK[rowScope(a)] - SCOPE_RANK[rowScope(b)];
    if (rank !== 0) return rank;
    return (a.priority ?? 100) - (b.priority ?? 100);
  });
}

/**
 * PostgREST answers 42703 when a filter or select names a column the
 * database does not have yet: functions deployed before migration
 * 20261021051628. Readers on the hot path retry without universal keys.
 */
export function isMissingOwnerUserColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || /owner_user_id/.test(error.message ?? '');
}
