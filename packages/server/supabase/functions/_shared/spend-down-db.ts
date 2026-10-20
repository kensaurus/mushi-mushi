/**
 * FILE: packages/server/supabase/functions/_shared/spend-down-db.ts
 * PURPOSE: The two spend-down reads the worker and the status route share:
 *          the apps a key pays for, and how many dispatches it started today.
 *          Rules live in spend-down.ts; this file only reads.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { spendDownProjectIds, type CursorPoolKey, type SpendDownKey } from './spend-down.ts'

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
    ? db.from('projects').select('id, organization_id').eq('id', key.project_id)
    : db
        .from('projects')
        .select('id, organization_id')
        .eq('organization_id', key.organization_id ?? '00000000-0000-0000-0000-000000000000')
  const { data: projectRows, error } = await projectQuery
  if (error) throw new Error(`spend-down: projects read failed: ${error.message}`)
  const projects = (projectRows ?? []) as Array<{ id: string; organization_id: string | null }>
  const allIds = projects.map((p) => p.id)
  if (allIds.length === 0) return { ids: [], settings: new Map() }
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((o): o is string => !!o))]

  // Every Cursor key that could win for these apps: their own and their
  // organization's shared ones (the same rows resolveCursorApiKey reads).
  const ownFilter = `project_id.in.(${allIds.join(',')})`
  const keyFilter = orgIds.length > 0 ? `${ownFilter},organization_id.in.(${orgIds.join(',')})` : ownFilter
  const [settingsRes, reposRes, keysRes] = await Promise.all([
    db
      .from('project_settings')
      .select('project_id, autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd, cursor_api_key_ref')
      .in('project_id', allIds),
    db.from('project_repos').select('project_id').in('project_id', allIds),
    db
      .from('byok_keys')
      .select('id, project_id, organization_id, priority, status, test_status')
      .eq('provider_slug', 'cursor')
      .or(keyFilter),
  ])
  if (settingsRes.error) throw new Error(`spend-down: project_settings read failed: ${settingsRes.error.message}`)
  if (reposRes.error) throw new Error(`spend-down: project_repos read failed: ${reposRes.error.message}`)
  if (keysRes.error) throw new Error(`spend-down: byok_keys read failed: ${keysRes.error.message}`)

  const settings = new Map<string, Record<string, unknown>>()
  for (const s of (settingsRes.data ?? []) as Array<Record<string, unknown>>) settings.set(String(s.project_id), s)
  const withRepo = new Set(((reposRes.data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  const legacy = (id: string) => {
    const ref = settings.get(id)?.cursor_api_key_ref
    return typeof ref === 'string' && ref.trim() !== ''
  }

  const ids = spendDownProjectIds(
    key,
    projects.map((p) => ({
      id: p.id,
      organization_id: p.organization_id,
      autofix_enabled: settings.get(p.id)?.autofix_enabled === true,
      has_repo: withRepo.has(p.id),
      has_legacy_key: legacy(p.id),
    })),
    (keysRes.data ?? []) as CursorPoolKey[],
  )
  return { ids, settings }
}
