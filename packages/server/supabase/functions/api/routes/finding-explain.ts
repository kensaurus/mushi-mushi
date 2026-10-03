/**
 * finding-explain.ts — one gate finding, explained (MCP explain_finding).
 *
 *   GET /v1/admin/findings/:findingId   adminOrApiKey(mcp:read)
 *
 * Looks a gate_findings row up by id (from list_gate_findings, get_radar,
 * get_recipe_drift, get_code_health, get_store_status or the console) and
 * returns what the check is, why it fired, the file and line, the fix in one
 * sentence (plus the stored fix object), and whether the latest run of the
 * same check still reports it. A finding in a project the caller cannot
 * reach is a 404, the same as one that does not exist.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { DESIGN_GATE } from '../../_shared/design-plane.ts'
import {
  explainFinding,
  type ExplainFindingRow,
  type ExplainLatestRun,
  type ExplainRunRow,
} from '../../_shared/finding-explain.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { isScanRun } from './recipe-compose.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FINDING_COLUMNS =
  'id, gate_run_id, project_id, severity, rule_id, message, file_path, line, col, node_id, suggested_fix, allowlisted, allowlist_reason, created_at'

type Db = ReturnType<typeof getServiceClient>

export interface FindingExplainDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
}

export const defaultFindingExplainDeps: FindingExplainDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
}

/** The newest finished run of the finding's gate, and the same rule at the same place in it. */
async function latestRunFor(db: Db, finding: ExplainFindingRow, gate: string): Promise<ExplainLatestRun | null | 'error'> {
  const { data: runs, error } = await db
    .from('gate_runs')
    .select('id, status, completed_at, summary')
    .eq('project_id', finding.project_id)
    .eq('gate', gate)
    .not('status', 'in', '(running,queued)')
    .order('started_at', { ascending: false })
    .limit(10)
  if (error) return 'error'
  const rows = (runs ?? []) as Array<{ id: string; status: string; completed_at: string | null; summary: Record<string, unknown> | null }>
  // design_drift also writes token-refresh rows; only scans carry findings.
  const latest = (gate === DESIGN_GATE ? rows.filter(isScanRun) : rows)[0]
  if (!latest) return null
  if (latest.id === finding.gate_run_id) return { id: latest.id, completed_at: latest.completed_at, matchingFindingId: finding.id }

  let match = db
    .from('gate_findings')
    .select('id')
    .eq('gate_run_id', latest.id)
    .eq('allowlisted', false)
  match = finding.rule_id === null ? match.is('rule_id', null) : match.eq('rule_id', finding.rule_id)
  // Same file when there is one; otherwise the same message (radar and store
  // findings are about a domain or a listing, not a file).
  match = finding.file_path === null ? match.eq('message', finding.message) : match.eq('file_path', finding.file_path)
  const { data: same, error: sameErr } = await match.limit(1).maybeSingle()
  if (sameErr) return 'error'
  return { id: latest.id, completed_at: latest.completed_at, matchingFindingId: (same as { id: string } | null)?.id ?? null }
}

export function registerFindingExplainRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: FindingExplainDeps = defaultFindingExplainDeps,
): void {
  app.get('/v1/admin/findings/:findingId', deps.adminOrApiKeyRead, async (c) => {
    const findingId = c.req.param('findingId') ?? ''
    if (!UUID_RE.test(findingId)) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)
    const db = deps.getServiceClient()

    const { data: row, error } = await db.from('gate_findings').select(FINDING_COLUMNS).eq('id', findingId).maybeSingle()
    if (error) return jsonError(c, 'DB_ERROR', 'The finding could not be read. Try again in a minute.', 500)
    const finding = row as ExplainFindingRow | null
    if (!finding) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)

    const access = await callerCanAccessProject(c, db, c.get('userId') as string, finding.project_id)
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)

    const { data: runRow, error: runErr } = await db
      .from('gate_runs')
      .select('id, gate, status, started_at, completed_at, commit_sha')
      .eq('id', finding.gate_run_id)
      .maybeSingle()
    if (runErr) return jsonError(c, 'DB_ERROR', 'The finding could not be read. Try again in a minute.', 500)
    const run = runRow as ExplainRunRow | null
    if (!run) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)

    // A failed read must not turn into "fixed in the latest run".
    const latest = await latestRunFor(db, finding, run.gate)
    if (latest === 'error') return jsonError(c, 'DB_ERROR', 'Could not check the latest run of this check. Try again in a minute.', 500)

    return c.json({ ok: true, data: explainFinding(finding, run, latest) })
  })
}
