/**
 * FILE: packages/server/supabase/functions/_shared/ci-compare-load.ts
 * PURPOSE: The reads behind GET /v1/admin/ci/compare (Plan 022 Phase 7):
 *          projects, repos and their visibility (ci_collector_state), the
 *          GitHub snapshot's workflow files and variable names, runners,
 *          host heartbeats, cost settings, and the job aggregate.
 *
 * Degrades until 20261022120000_ci_cost_compare is applied:
 *   - no ci_runner_comparison → the newest MAX_FALLBACK_JOBS jobs are read
 *     and aggregated in TypeScript (source 'rows', with a note);
 *   - no ci_cost_settings     → the example figures, settingsWritable false.
 * Any other read error throws: the route answers 500, never a wrong total.
 */

import { readAllPages } from './paged-read.ts'
import { normalizeCostSettings, type CostSettingsRow } from './ci-cost.ts'
import { aggregateCiJobs, COMPARE_JOB_COLUMNS, readComparisonData, type CompareInput, type CompareJobRow, type ComparisonData } from './ci-compare.ts'
import type { CiCompareSettings, RepoVisibility } from './ci-compare-types.ts'
import type { RepoPermissions } from './ci-collector.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

/** Jobs the fallback reads when the SQL aggregate is not there yet. */
export const MAX_FALLBACK_JOBS = 10_000

/** PostgREST / Postgres codes for "that function or table does not exist (yet)". */
const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])

export function isMissingObject(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code && MISSING_CODES.has(error.code)) return true
  return /could not find the (function|table)|does not exist|schema cache/i.test(error.message ?? '')
}

function repoOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export type CompareLoad = Omit<CompareInput, 'now' | 'days' | 'from' | 'to'>

export async function loadCiCompareInput(db: Db, projectIds: string[], from: Date, to: Date): Promise<CompareLoad> {
  const check = <T>(res: { data: unknown; error: { message?: string } | null }, what: string): T[] => {
    if (res.error) throw new Error(`${what} read failed: ${res.error.message ?? 'unknown error'}`)
    return (res.data ?? []) as T[]
  }
  const [projectsRes, reposRes, stateRes, snapsRes, runnersRes] = await Promise.all([
    db.from('projects').select('id, name, organization_id').in('id', projectIds),
    db.from('project_repos').select('project_id, repo_url').in('project_id', projectIds),
    db.from('ci_collector_state').select('project_id, permissions').in('project_id', projectIds),
    db.from('connector_snapshots').select('project_id, snapshot').in('project_id', projectIds).eq('kind', 'github').eq('is_current', true).eq('ok', true),
    db.from('ci_runners').select('repo, runner_name, status, labels').in('project_id', projectIds),
  ])
  const projects = check<CompareInput['projects'][number]>(projectsRes, 'projects')
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((x): x is string => !!x))]

  const repoMeta: CompareInput['repoMeta'] = {}
  for (const s of check<{ permissions: Record<string, RepoPermissions> | null }>(stateRes, 'ci_collector_state')) {
    for (const [repo, p] of Object.entries(s.permissions ?? {})) {
      const visibility = p?.visibility as RepoVisibility | undefined
      repoMeta[repo] = { visibility: visibility ?? repoMeta[repo]?.visibility, owner: p?.owner ?? repoMeta[repo]?.owner }
    }
  }

  const workflows: CompareInput['workflows'] = []
  const variableNames: CompareInput['variableNames'] = {}
  // A missing GitHub snapshot only silences the YAML-based parts.
  type Snap = { project_id: string; snapshot: { facts?: { workflowFiles?: Record<string, string>; variableNames?: unknown; repoPrivate?: unknown }; resources?: Array<{ kind?: string; externalId?: string }> } | null }
  for (const s of (snapsRes.error ? [] : (snapsRes.data ?? [])) as Snap[]) {
    const repo = s.snapshot?.resources?.find((r) => r.kind === 'repo')?.externalId ?? null
    if (!repo) continue
    for (const [path, text] of Object.entries(s.snapshot?.facts?.workflowFiles ?? {})) {
      if (typeof text === 'string') workflows.push({ projectId: s.project_id, repo, path, text })
    }
    const names = s.snapshot?.facts?.variableNames
    variableNames[repo] = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : null
    // The snapshot also knows visibility; the collector's daily read wins.
    const priv = s.snapshot?.facts?.repoPrivate
    if (typeof priv === 'boolean' && !repoMeta[repo]?.visibility) repoMeta[repo] = { ...repoMeta[repo], visibility: priv ? 'private' : 'public' }
  }

  const [hostsRes, settingsRes] = orgIds.length
    ? await Promise.all([
        db.from('ci_runner_hosts').select('host_id, hostname, metrics, runners').in('organization_id', orgIds),
        db.from('ci_cost_settings').select('*').in('organization_id', orgIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  let settingsWritable = true
  const settingsByOrg = new Map<string, CiCompareSettings>()
  if (settingsRes.error) {
    if (!isMissingObject(settingsRes.error)) throw new Error(`ci_cost_settings read failed: ${settingsRes.error.message ?? 'unknown error'}`)
    settingsWritable = false
  }
  const saved = new Map(((settingsRes.error ? [] : settingsRes.data) ?? [] as CostSettingsRow[]).map((r: CostSettingsRow) => [r.organization_id, r]))
  for (const org of orgIds) settingsByOrg.set(org, normalizeCostSettings(org, (saved.get(org) as CostSettingsRow | undefined) ?? null))

  const { data, source, sourceNote } = await loadComparisonData(db, projectIds, from, to)

  return {
    data,
    source,
    sourceNote,
    projects,
    repoBindings: check<{ project_id: string; repo_url: string }>(reposRes, 'project_repos')
      .map((r) => ({ project_id: r.project_id, repo: repoOf(r.repo_url) }))
      .filter((r): r is { project_id: string; repo: string } => !!r.repo),
    repoMeta,
    settingsByOrg,
    defaultSettings: normalizeCostSettings(orgIds[0] ?? '', null),
    settingsWritable,
    hosts: check<CompareInput['hosts'][number]>(hostsRes, 'ci_runner_hosts'),
    runners: check<CompareInput['runners'][number]>(runnersRes, 'ci_runners'),
    workflows,
    variableNames,
  }
}

/** The SQL aggregate, or the TypeScript one over the newest jobs when the function is not applied yet. */
export async function loadComparisonData(db: Db, projectIds: string[], from: Date, to: Date): Promise<{ data: ComparisonData; source: 'sql' | 'rows'; sourceNote: string | null }> {
  const empty: ComparisonData = { groups: [], pairs: [], workflows: [], intervals: [], oldest: null, jobs: 0 }
  if (projectIds.length === 0) return { data: empty, source: 'sql', sourceNote: null }
  const res = await db.rpc('ci_runner_comparison', { project_ids: projectIds, p_from: from.toISOString(), p_to: to.toISOString() })
  if (!res.error) {
    const data = readComparisonData(res.data)
    if (!data) throw new Error('ci_runner_comparison returned an unexpected shape')
    return { data, source: 'sql', sourceNote: null }
  }
  if (!isMissingObject(res.error)) throw new Error(`ci_runner_comparison failed: ${res.error.message ?? 'unknown error'}`)

  const read = await readAllPages<CompareJobRow>(
    (lo, hi, count) =>
      db
        .from('ci_jobs')
        .select(COMPARE_JOB_COLUMNS, { count })
        .in('project_id', projectIds)
        .gte('gh_created_at', from.toISOString())
        .lte('gh_created_at', to.toISOString())
        .order('gh_created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(lo, hi),
    { what: 'ci_jobs', maxRows: MAX_FALLBACK_JOBS },
  )
  return {
    data: aggregateCiJobs(read.rows, { from, to }),
    source: 'rows',
    sourceNote: read.truncated
      ? `Based on the newest ${read.rows.length.toLocaleString('en-US')} of ${read.total?.toLocaleString('en-US') ?? 'more'} jobs: the database update that totals the whole window is not applied yet.`
      : 'Totalled in the API: the database update that does this in the database is not applied yet.',
  }
}
