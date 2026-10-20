/**
 * FILE: packages/server/supabase/functions/_shared/spend-down-db.ts
 * PURPOSE: The two spend-down reads the worker and the status route share:
 *          the apps a key pays for, and how many dispatches it started today.
 *          Rules live in spend-down.ts; this file only reads.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { spendDownProjectIds, type SpendDownKey } from './spend-down.ts'

function utcDayStart(now: Date): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Dispatches this key started today (UTC), any status. */
export async function keyDispatchesToday(db: SupabaseClient, keyId: string, now: Date): Promise<number> {
  const { count, error } = await db
    .from('fix_dispatch_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('dispatch_metadata->>spend_down_key_id', keyId)
    .gte('created_at', utcDayStart(now))
  if (error) throw new Error(`spend-down: could not count today's dispatches: ${error.message}`)
  return count ?? 0
}

export async function keyProjects(db: SupabaseClient, key: SpendDownKey): Promise<{
  ids: string[]
  settings: Map<string, Record<string, unknown>>
}> {
  const projectQuery = key.project_id
    ? db.from('projects').select('id').eq('id', key.project_id)
    : db.from('projects').select('id').eq('organization_id', key.organization_id ?? '00000000-0000-0000-0000-000000000000')
  const { data: projectRows, error } = await projectQuery
  if (error) throw new Error(`spend-down: projects read failed: ${error.message}`)
  const allIds = ((projectRows ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (allIds.length === 0) return { ids: [], settings: new Map() }

  const [settingsRes, reposRes, ownKeysRes] = await Promise.all([
    db
      .from('project_settings')
      .select('project_id, autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd, cursor_api_key_ref')
      .in('project_id', allIds),
    db.from('project_repos').select('project_id').in('project_id', allIds),
    key.project_id
      ? Promise.resolve({ data: [] as Array<{ project_id: string }>, error: null })
      : db
          .from('byok_keys')
          .select('project_id')
          .eq('provider_slug', 'cursor')
          .eq('status', 'active')
          .in('project_id', allIds),
  ])
  if (settingsRes.error) throw new Error(`spend-down: project_settings read failed: ${settingsRes.error.message}`)
  if (reposRes.error) throw new Error(`spend-down: project_repos read failed: ${reposRes.error.message}`)
  if (ownKeysRes.error) throw new Error(`spend-down: byok_keys read failed: ${ownKeysRes.error.message}`)

  const settings = new Map<string, Record<string, unknown>>()
  for (const s of (settingsRes.data ?? []) as Array<Record<string, unknown>>) settings.set(String(s.project_id), s)
  const withRepo = new Set(((reposRes.data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  const withOwnKey = new Set(((ownKeysRes.data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  // A legacy Integrations key is the app's own too, and comes before a shared
  // key (ADR 0023, resolveCursorApiKey): a shared key never spends there.
  for (const [id, row] of settings) {
    if (typeof row.cursor_api_key_ref === 'string' && row.cursor_api_key_ref.trim() !== '') withOwnKey.add(id)
  }

  const ids = spendDownProjectIds(
    key,
    allIds.map((id) => ({ id, autofix_enabled: settings.get(id)?.autofix_enabled === true, has_repo: withRepo.has(id) })),
    withOwnKey,
  )
  return { ids, settings }
}
