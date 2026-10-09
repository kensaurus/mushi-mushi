/**
 * FILE: packages/server/supabase/functions/_shared/integration-health-rollup.ts
 * PURPOSE: One answer to "how is each integration doing right now?" for the
 *          dashboard KPI, the sidebar health dot (dashboard/stats), the inbox
 *          Act/Ops flags and the dashboard's Integrations panel.
 *
 * REGRESSION (2026-10-04): three routes read `integration_health_history`
 * three ways. /v1/admin/dashboard took the OLDEST 2000 rows of a 14-day
 * window (a busy project writes ~7,000), so "latest status" was two weeks
 * stale; dashboard/stats took the newest 500 rows across every project and
 * could miss a rarely probed kind; inbox/stats counted only `red`/`fail` as
 * red, so a `down` probe (what the prober actually writes) never counted.
 *
 * Now the latest row per (project, kind) and the ok/total counts come from
 * the `integration_health_rollup` SQL function (DISTINCT ON over the
 * (project_id, kind, checked_at desc) index), and every route classifies
 * the status with `healthSeverity`.
 *
 * Pure apart from the structural db type, so the Deno CI test runs without
 * permissions and the vitest suite imports it directly.
 */

export type HealthSeverity = 'ok' | 'red' | 'amber'

/** The worst-first order used when one kind has several projects in scope. */
const SEVERITY_RANK: Record<HealthSeverity, number> = { ok: 0, amber: 1, red: 2 }

/**
 * `ok` is healthy. `down` (what integration-health-probe writes), and the
 * legacy `red` / `fail` / `error` spellings, are red. Anything else that is
 * not ok (`degraded`, `amber`, `warn`, an unknown word) is amber: it is not
 * healthy, and it must never read as healthy.
 */
export function healthSeverity(status: string | null | undefined): HealthSeverity {
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'ok') return 'ok'
  if (s === 'down' || s === 'red' || s === 'fail' || s === 'failed' || s === 'error') return 'red'
  return 'amber'
}

export interface HealthRollupRow {
  project_id: string
  kind: string
  last_status: string | null
  last_at: string | null
  /** null when the counts were not read (sampled fallback). */
  ok_count: number | null
  total_count: number | null
}

export interface IntegrationHealthByKind {
  kind: string
  /** Worst latest status across the projects in scope. */
  lastStatus: string | null
  lastAt: string | null
  severity: HealthSeverity
  /** ok / total probes in the window; null when not counted. */
  uptime: number | null
}

/**
 * Fold per-(project, kind) rows into one row per kind. With several projects
 * in scope a kind is as healthy as its worst project, so one project's red
 * GitHub probe is never hidden by another project's later green one.
 */
export function summarizeHealthByKind(rows: HealthRollupRow[]): IntegrationHealthByKind[] {
  const byKind = new Map<
    string,
    { worst: HealthRollupRow; lastAt: string | null; ok: number; total: number; counted: boolean }
  >()
  for (const row of rows) {
    const cur = byKind.get(row.kind)
    const counted = row.ok_count != null && row.total_count != null
    if (!cur) {
      byKind.set(row.kind, {
        worst: row,
        lastAt: row.last_at,
        ok: Number(row.ok_count ?? 0),
        total: Number(row.total_count ?? 0),
        counted,
      })
      continue
    }
    if (SEVERITY_RANK[healthSeverity(row.last_status)] > SEVERITY_RANK[healthSeverity(cur.worst.last_status)]) {
      cur.worst = row
    }
    if (row.last_at && (!cur.lastAt || row.last_at > cur.lastAt)) cur.lastAt = row.last_at
    cur.ok += Number(row.ok_count ?? 0)
    cur.total += Number(row.total_count ?? 0)
    cur.counted = cur.counted && counted
  }
  return [...byKind.entries()]
    .map(([kind, v]) => ({
      kind,
      lastStatus: v.worst.last_status,
      lastAt: v.lastAt,
      severity: healthSeverity(v.worst.last_status),
      uptime: v.counted && v.total > 0 ? v.ok / v.total : null,
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind))
}

export interface HealthIssueCounts {
  /** Kinds whose latest status is not ok. */
  issues: number
  red: number
  amber: number
}

export function countHealthIssues(kinds: IntegrationHealthByKind[]): HealthIssueCounts {
  let red = 0
  let amber = 0
  for (const k of kinds) {
    if (k.severity === 'red') red += 1
    else if (k.severity === 'amber') amber += 1
  }
  return { issues: red + amber, red, amber }
}

// ── loader ─────────────────────────────────────────────────────────────────

type RpcResult = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
type SampleResult = PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>
interface HealthDb {
  rpc: (fn: string, args: Record<string, unknown>) => RpcResult
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => {
        gte: (col: string, value: string) => {
          order: (col: string, opts: { ascending: boolean }) => { limit: (n: number) => SampleResult }
        }
      }
    }
  }
}

/** PostgREST / Postgres codes for "this function does not exist (yet)". */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST202' || err.code === '42883'
}

export class IntegrationHealthReadError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'IntegrationHealthReadError'
  }
}

/** Rows read in the fallback when the rollup function is not deployed yet. */
const FALLBACK_SAMPLE = 1000

/**
 * Latest status per (project, kind) since `sinceIso`, newest first.
 *
 * Throws `IntegrationHealthReadError` on any read error: an unreadable health
 * table must surface as an error, never as "0 integrations failing". The one
 * exception is a rollup function that is not deployed yet, where it reads a
 * latest-first sample instead (latest status stays correct; uptime is not
 * counted) and logs that the migration is owed.
 */
export async function loadIntegrationHealth(
  db: HealthDb,
  projectIds: string[],
  sinceIso: string,
): Promise<{ rows: HealthRollupRow[]; source: 'rollup' | 'sample' }> {
  if (projectIds.length === 0) return { rows: [], source: 'rollup' }
  const { data, error } = await db.rpc('integration_health_rollup', {
    p_project_ids: projectIds,
    p_since: sinceIso,
  })
  if (!error) {
    return {
      rows: ((data ?? []) as HealthRollupRow[]).map((r) => ({
        ...r,
        ok_count: r.ok_count == null ? null : Number(r.ok_count),
        total_count: r.total_count == null ? null : Number(r.total_count),
      })),
      source: 'rollup',
    }
  }
  if (!isMissingFunction(error)) {
    throw new IntegrationHealthReadError(error.message ?? 'integration health unreadable', error.code)
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'integration_health_rollup missing — apply migration 20261004163000_console_counts_one_definition; reading a latest-first sample',
    }),
  )
  const sample = await db
    .from('integration_health_history')
    .select('project_id, kind, status, checked_at')
    .in('project_id', projectIds)
    .gte('checked_at', sinceIso)
    .order('checked_at', { ascending: false })
    .limit(FALLBACK_SAMPLE)
  if (sample.error) {
    throw new IntegrationHealthReadError(sample.error.message ?? 'integration health unreadable', sample.error.code)
  }
  const seen = new Set<string>()
  const rows: HealthRollupRow[] = []
  for (const r of (sample.data ?? []) as Array<{ project_id: string; kind: string; status: string | null; checked_at: string }>) {
    const key = `${r.project_id}:${r.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      project_id: r.project_id,
      kind: r.kind,
      last_status: r.status,
      last_at: r.checked_at,
      ok_count: null,
      total_count: null,
    })
  }
  return { rows, source: 'sample' }
}
