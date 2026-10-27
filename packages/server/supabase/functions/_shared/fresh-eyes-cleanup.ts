/**
 * FILE: packages/server/supabase/functions/_shared/fresh-eyes-cleanup.ts
 * PURPOSE: Delete synthetic fresh-eyes accounts once they expire (ADR 0051),
 *          from the daily retention sweep. Per account, in order:
 *            1. product events about its projects or its person row (a
 *               second line behind emitProductEvent's own skip);
 *            2. the projects it owns (their reports, keys and runs cascade);
 *            3. the organizations it alone owns (no other member, no one
 *               else's project);
 *            4. its person rows (end_users keyed on its user id);
 *            5. the auth user (synthetic_accounts and operator_users cascade).
 *          A step that fails leaves the account for the next sweep; the auth
 *          user is deleted last, so nothing is orphaned.
 *
 * The client is injected so vitest drives it with a fake.
 */

import { expiredSyntheticAccounts, orgsOwnedAlone } from './fresh-eyes.ts'

interface Res<T> {
  data: T | null
  error: { message: string } | null
}

/** The slice of the Supabase client this sweep uses. */
export interface CleanupDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any
  auth: { admin: { deleteUser(id: string): Promise<{ error: { message: string } | null }> } }
}

export interface SyntheticSweepStats {
  accounts_deleted: number
  projects_deleted: number
  orgs_deleted: number
  failed: number
}

export async function sweepSyntheticAccounts(db: CleanupDb, now: Date, warn: (msg: string, ctx: Record<string, unknown>) => void = () => {}): Promise<SyntheticSweepStats> {
  const stats: SyntheticSweepStats = { accounts_deleted: 0, projects_deleted: 0, orgs_deleted: 0, failed: 0 }
  const { data: rows, error } = (await db.from('synthetic_accounts').select('user_id, expires_at').lte('expires_at', now.toISOString()).limit(50)) as Res<Array<{ user_id: string; expires_at: string }>>
  if (error) {
    // Migration not applied yet, or a transient error: try again tomorrow.
    warn('synthetic_accounts_select_failed', { err: error.message })
    return stats
  }
  for (const acct of expiredSyntheticAccounts(rows ?? [], now)) {
    const uid = acct.user_id
    const fail = (step: string, err: { message: string }) => {
      stats.failed++
      warn('synthetic_account_cleanup_failed', { user_id: uid, step, err: err.message })
    }
    const projects = (await db.from('projects').select('id, organization_id').eq('owner_id', uid)) as Res<Array<{ id: string; organization_id: string | null }>>
    if (projects.error) {
      fail('projects', projects.error)
      continue
    }
    const projectIds = (projects.data ?? []).map((p) => p.id)
    const people = (await db.from('end_users').select('id').eq('external_user_id', uid)) as Res<Array<{ id: string }>>
    if (people.error) {
      fail('end_users', people.error)
      continue
    }
    const personIds = (people.data ?? []).map((p) => p.id)

    // 1. product events about it
    if (personIds.length) {
      const r = (await db.from('product_events').delete().in('end_user_id', personIds)) as Res<unknown>
      if (r.error) {
        fail('product_events', r.error)
        continue
      }
    }
    let stop = false
    for (const pid of projectIds) {
      const r = (await db.from('product_events').delete().eq('properties->>project_id', pid)) as Res<unknown>
      if (r.error) {
        fail('product_events', r.error)
        stop = true
        break
      }
    }
    if (stop) continue

    // 2. its projects
    if (projectIds.length) {
      const r = (await db.from('projects').delete().in('id', projectIds)) as Res<unknown>
      if (r.error) {
        fail('projects_delete', r.error)
        continue
      }
      stats.projects_deleted += projectIds.length
    }

    // 3. organizations it alone owns
    const orgs = (await db.from('organizations').select('id').eq('owner_id', uid)) as Res<Array<{ id: string }>>
    if (orgs.error) {
      fail('organizations', orgs.error)
      continue
    }
    const orgIds = (orgs.data ?? []).map((o) => o.id)
    if (orgIds.length) {
      const members = (await db.from('organization_members').select('organization_id, user_id').in('organization_id', orgIds)) as Res<Array<{ organization_id: string; user_id: string }>>
      const others = (await db.from('projects').select('organization_id, owner_id').in('organization_id', orgIds)) as Res<Array<{ organization_id: string | null; owner_id: string | null }>>
      if (members.error || others.error) {
        fail('organization_members', (members.error ?? others.error)!)
        continue
      }
      const alone = orgsOwnedAlone(orgs.data ?? [], members.data ?? [], others.data ?? [], uid)
      if (alone.length < orgIds.length) {
        // Someone else joined or built there: keep the account so the org's owner survives, and say so.
        fail('organizations_shared', { message: `${orgIds.length - alone.length} organization(s) have other members or projects` })
        continue
      }
      const r = (await db.from('organizations').delete().in('id', alone)) as Res<unknown>
      if (r.error) {
        fail('organizations_delete', r.error)
        continue
      }
      stats.orgs_deleted += alone.length
    }

    // 4. person rows
    if (personIds.length) {
      const r = (await db.from('end_users').delete().in('id', personIds)) as Res<unknown>
      if (r.error) {
        fail('end_users_delete', r.error)
        continue
      }
    }

    // 5. the user
    const del = await db.auth.admin.deleteUser(uid)
    if (del.error) {
      fail('auth_user', del.error)
      continue
    }
    stats.accounts_deleted++
  }
  return stats
}
