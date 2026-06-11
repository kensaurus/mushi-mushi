// ============================================================
// backend-drift-scanner — daily cron that snapshots host-app
// Supabase schemas and writes gate_findings on drift.
//
// Trigger: pg_cron daily at 03:05 UTC (migration 20260612030000).
// Auth:    requireServiceRoleAuth (internal only).
//
// For each mushi project that has:
//   • project_settings.supabase_project_ref set
//   • a `supabase` BYOK key in byok_keys
//
// The scanner:
//   1. Fetches the current schema via the read-only hosted Supabase MCP.
//   2. Computes a SHA-256 hash.
//   3. Compares to the previous backend_schema_snapshots row.
//   4. If the hash differs, stores the new snapshot and writes
//      gate_findings of gate type `schema_drift`.
//   5. Updates gate_runs for the schema_drift gate.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  listTables,
  hashSchema,
  resolveSupabasePat,
  type TableInfo,
} from '../_shared/supabase-mcp-client.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const dlog = log.child('backend-drift-scanner')

interface ProjectWithSettings {
  id: string
  name: string
  supabase_project_ref: string | null
}

/**
 * Diff two schema snapshots. Returns a summary of added, removed,
 * and modified tables — enough for a PM to understand what changed.
 */
function diffSchemas(
  prev: TableInfo[],
  curr: TableInfo[],
): { added: string[]; removed: string[]; modified: string[] } {
  const prevMap = new Map(prev.map((t) => [t.name, t]))
  const currMap = new Map(curr.map((t) => [t.name, t]))

  const added = [...currMap.keys()].filter((k) => !prevMap.has(k))
  const removed = [...prevMap.keys()].filter((k) => !currMap.has(k))
  const modified: string[] = []

  for (const [name, currTable] of currMap) {
    const prevTable = prevMap.get(name)
    if (!prevTable) continue
    if (JSON.stringify(prevTable) !== JSON.stringify(currTable)) {
      modified.push(name)
    }
  }

  return { added, removed, modified }
}

async function scanProject(
  db: SupabaseClient,
  project: ProjectWithSettings,
): Promise<{ scanned: boolean; drifted: boolean; findings: number }> {
  const pat = await resolveSupabasePat(db, project.id)
  if (!pat || !project.supabase_project_ref) {
    dlog.info('skip project — no PAT or ref', { projectId: project.id })
    return { scanned: false, drifted: false, findings: 0 }
  }

  const opts = { projectRef: project.supabase_project_ref, pat }
  let currTables: TableInfo[]

  try {
    currTables = await listTables(opts)
  } catch (err) {
    dlog.warn('listTables failed', { projectId: project.id, err: String(err) })
    return { scanned: false, drifted: false, findings: 0 }
  }

  const currHash = await hashSchema(currTables)

  // Fetch the most recent snapshot for this project.
  const { data: prevSnap } = await db
    .from('backend_schema_snapshots')
    .select('id, schema_hash, schema_json')
    .eq('project_id', project.id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Store the new snapshot regardless of drift.
  let diffSummary: Record<string, unknown> | null = null
  let drifted = false

  if (prevSnap && prevSnap.schema_hash !== currHash) {
    drifted = true
    const prevTables = (prevSnap.schema_json as TableInfo[] | null) ?? []
    const diff = diffSchemas(prevTables, currTables)
    diffSummary = diff as Record<string, unknown>
    dlog.info('schema drift detected', { projectId: project.id, diff })
  }

  await db.from('backend_schema_snapshots').insert({
    project_id: project.id,
    schema_json: currTables,
    schema_hash: currHash,
    diff_summary: diffSummary,
  })

  if (!drifted || !diffSummary) {
    return { scanned: true, drifted: false, findings: 0 }
  }

  // Create a gate_run for schema_drift.
  const { data: runData, error: runErr } = await db
    .from('gate_runs')
    .insert({
      project_id: project.id,
      gate: 'schema_drift',
      status: 'running',
      triggered_by: 'backend-drift-scanner',
    })
    .select('id')
    .single()

  if (runErr || !runData) {
    dlog.warn('gate_runs insert failed', { projectId: project.id, err: runErr?.message })
    return { scanned: true, drifted: true, findings: 0 }
  }
  const runId = runData.id as string

  const diff = diffSummary as { added: string[]; removed: string[]; modified: string[] }
  let inserted = 0

  // Removed tables are critical — data loss risk.
  for (const tableName of diff.removed ?? []) {
    const { error } = await db.from('gate_findings').insert({
      gate_run_id: runId,
      project_id: project.id,
      severity: 'error',
      rule_id: 'schema-drift-table-removed',
      message: `Table "${tableName}" was removed from the linked Supabase project. If any frontend code still references it, you will get runtime errors.`,
    })
    if (!error) inserted++
  }

  // Added tables are informational — but flag if no RLS.
  for (const tableName of diff.added ?? []) {
    const table = currTables.find((t) => t.name === tableName)
    if (table && !table.rls_enabled) {
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: project.id,
        severity: 'warn',
        rule_id: 'schema-drift-table-added-no-rls',
        message: `New table "${tableName}" was added without Row Level Security. Enable RLS to prevent unintentional data exposure.`,
      })
      if (!error) inserted++
    } else {
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: project.id,
        severity: 'info',
        rule_id: 'schema-drift-table-added',
        message: `New table "${tableName}" was added to the linked Supabase project.`,
      })
      if (!error) inserted++
    }
  }

  // Modified tables: warn on column changes (could break API contracts).
  for (const tableName of diff.modified ?? []) {
    const { error } = await db.from('gate_findings').insert({
      gate_run_id: runId,
      project_id: project.id,
      severity: 'warn',
      rule_id: 'schema-drift-table-modified',
      message: `Table "${tableName}" schema changed (columns or RLS policy). Verify the frontend and API contracts are compatible with the new schema.`,
    })
    if (!error) inserted++
  }

  await db.from('gate_runs').update({
    status: inserted > 0 ? 'fail' : 'warn',
    summary: {
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      total_changes: diff.added.length + diff.removed.length + diff.modified.length,
    },
    findings_count: inserted,
    completed_at: new Date().toISOString(),
  }).eq('id', runId)

  return { scanned: true, drifted: true, findings: inserted }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  const db = getServiceClient()

  // Fetch all projects that have a supabase_project_ref set.
  const { data: projects, error } = await db
    .from('project_settings')
    .select('project_id, supabase_project_ref, projects!inner(id, name)')
    .not('supabase_project_ref', 'is', null)
    .returns<Array<{
      project_id: string
      supabase_project_ref: string
      projects: { id: string; name: string }
    }>>()

  if (error) {
    dlog.error('failed to list linked projects', { err: error.message })
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const toScan: ProjectWithSettings[] = (projects ?? []).map((row) => ({
    id: row.projects.id,
    name: row.projects.name,
    supabase_project_ref: row.supabase_project_ref,
  }))

  dlog.info('starting drift scan', { projectCount: toScan.length })

  const results = await Promise.allSettled(toScan.map((p) => scanProject(db, p)))

  const summary = results.reduce(
    (acc, r, i) => {
      if (r.status === 'fulfilled') {
        acc.scanned += r.value.scanned ? 1 : 0
        acc.drifted += r.value.drifted ? 1 : 0
        acc.totalFindings += r.value.findings
      } else {
        dlog.error('scanProject rejected', { project: toScan[i]?.id, err: String(r.reason) })
        acc.errors++
      }
      return acc
    },
    { scanned: 0, drifted: 0, totalFindings: 0, errors: 0 },
  )

  dlog.info('drift scan complete', summary)

  return new Response(
    JSON.stringify({ ok: true, data: { total: toScan.length, ...summary } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('backend-drift-scanner', handler))
}
