/**
 * vulnerabilities.ts — known holes in dependencies and the runtime (ADR 0038).
 * Served by `api-ext`; `api` forwards these paths (_shared/edge-proxy.ts).
 *
 *   GET  /v1/admin/projects/:id/vulnerabilities           adminOrApiKey(mcp:read)
 *        { available, lastRun, dailyLimit, filedToday, counts, groups[] }:
 *        open and dismissed findings grouped one upgrade per group, worst
 *        first. available=false before the migration.
 *   POST /v1/admin/projects/:id/vulnerabilities/scan      adminOrApiKey(mcp:write), non-viewers, 6/h
 *        Asks vuln-watch to check this project now (202). 409 RUN_IN_PROGRESS
 *        with Retry-After while a check holds the project (its lease).
 *        POST /radar/run (MCP run_radar) starts it too.
 *   PATCH /v1/admin/projects/:id/vulnerabilities/groups   jwtAuth (console), non-viewers
 *        { groupKey, status: 'dismissed' | 'open', reason? }: dismiss a group
 *        (vuln-watch never reopens it) or undo that. Audited.
 *   PUT  /v1/admin/projects/:id/vulnerabilities/settings  jwtAuth (console), non-viewers
 *        { dailyLimit: 0..100 }: reports filed per app per UTC day. Audited.
 *
 * Per-app findings never reach a public surface (ADR 0038 decision 9).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { invokeVulnWatch } from '../../_shared/vuln-watch-invoke.ts'
import { RADAR_VULN_GATE } from '../../_shared/radar/run.ts'
import { DEFAULT_DAILY_LIMIT, leaseHeldUntil, vulnTablesMissing } from '../../_shared/vuln-watch-db.ts'
import { severityRank, type VulnSeverity } from '../../_shared/vuln-watch.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const VULN_SCANS_PER_HOUR = 6

type Db = ReturnType<typeof getServiceClient>

export interface VulnRouteDeps {
  getServiceClient: () => Db
  jwtAuth: MiddlewareHandler
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  callerCanAccessProject: typeof callerCanAccessProject
  claimRateLimit: typeof claimTenantRateLimit
  logAudit: typeof logAudit
  /** Fire-and-forget call to the vuln-watch function for one project. */
  invokeWatch: (projectId: string) => void
  now: () => Date
}

export const defaultVulnRouteDeps: VulnRouteDeps = {
  getServiceClient,
  jwtAuth: jwtAuth as MiddlewareHandler,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  callerCanAccessProject,
  claimRateLimit: claimTenantRateLimit,
  logAudit,
  invokeWatch: invokeVulnWatch,
  now: () => new Date(),
}

export function registerVulnerabilityRoutes(app: Hono<{ Variables: Variables }>, deps: VulnRouteDeps = defaultVulnRouteDeps): void {
  app.get('/v1/admin/projects/:id/vulnerabilities', deps.adminOrApiKeyRead, (c) => getVulns(c, deps))
  app.post('/v1/admin/projects/:id/vulnerabilities/scan', deps.adminOrApiKeyWrite, (c) => scanNow(c, deps))
  // A person's decision in a console session: jwtAuth refuses API keys, so an agent cannot hide its own findings.
  app.patch('/v1/admin/projects/:id/vulnerabilities/groups', deps.jwtAuth, (c) => setGroupStatus(c, deps))
  app.put('/v1/admin/projects/:id/vulnerabilities/settings', deps.jwtAuth, (c) => putSettings(c, deps))
}

async function projectAccess(c: Context, deps: VulnRouteDeps, db: Db): Promise<{ projectId: string; role: string | null } | Response> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  return { projectId, role: (access.role as string | null | undefined) ?? null }
}

interface VulnRow {
  id: string
  kind: 'package' | 'runtime'
  ecosystem: string
  package_name: string
  installed_version: string
  dev: boolean
  direct: boolean
  source_path: string
  source_line: number | null
  advisory_id: string
  cve_ids: string[]
  title: string
  advisory_url: string
  severity: VulnSeverity
  fixed_version: string | null
  kev: boolean
  epss: number | string | null
  imported: boolean | null
  group_key: string
  status: 'open' | 'dismissed'
  dismissed_reason: string | null
  report_id: string | null
  first_seen_at: string
}

export interface VulnGroupView {
  groupKey: string
  kind: 'package' | 'runtime'
  ecosystem: string
  package: string
  installed: string[]
  target: string | null
  direct: boolean
  dev: boolean
  severity: VulnSeverity
  kev: boolean
  epss: number | null
  imported: boolean
  sources: Array<{ path: string; line: number | null }>
  status: 'open' | 'dismissed'
  dismissedReason: string | null
  reportId: string | null
  firstSeenAt: string
  advisories: Array<{ id: string; title: string; url: string; cves: string[]; fixedVersion: string | null; severity: VulnSeverity; kev: boolean }>
}

/** Rows → one view per group_key, worst first. Exported for tests. */
export function groupRows(rows: readonly VulnRow[]): VulnGroupView[] {
  const groups = new Map<string, VulnGroupView>()
  for (const r of rows) {
    let g = groups.get(r.group_key)
    if (!g) {
      const target = r.group_key.split('|')[3]
      g = {
        groupKey: r.group_key, kind: r.kind, ecosystem: r.kind === 'runtime' ? 'runtime' : r.ecosystem, package: r.package_name, installed: [], target: target && target !== 'nofix' ? target : null,
        direct: false, dev: true, severity: 'info', kev: false, epss: null, imported: false, sources: [], status: r.status, dismissedReason: r.dismissed_reason,
        reportId: null, firstSeenAt: r.first_seen_at, advisories: [],
      }
      groups.set(r.group_key, g)
    }
    if (!g.installed.includes(r.installed_version)) g.installed.push(r.installed_version)
    if (!g.sources.some((s) => s.path === r.source_path)) g.sources.push({ path: r.source_path, line: r.source_line })
    g.direct ||= r.direct
    g.dev &&= r.dev
    g.kev ||= r.kev
    g.imported ||= r.imported === true
    const epss = r.epss == null ? null : Number(r.epss)
    if (epss != null && (g.epss == null || epss > g.epss)) g.epss = epss
    if (severityRank(r.severity) > severityRank(g.severity)) g.severity = r.severity
    // A group is open while any of its rows is.
    if (r.status === 'open') g.status = 'open'
    g.reportId ??= r.report_id
    if (r.first_seen_at < g.firstSeenAt) g.firstSeenAt = r.first_seen_at
    if (!g.advisories.some((a) => a.id === r.advisory_id)) {
      g.advisories.push({ id: r.advisory_id, title: r.title, url: r.advisory_url, cves: r.cve_ids ?? [], fixedVersion: r.fixed_version, severity: r.severity, kev: r.kev })
    }
  }
  for (const g of groups.values()) g.advisories.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id))
  return [...groups.values()].sort((a, b) =>
    Number(a.status === 'dismissed') - Number(b.status === 'dismissed') || severityRank(b.severity) - severityRank(a.severity) || a.package.localeCompare(b.package))
}

function startOfUtcDay(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

async function getVulns(c: Context, deps: VulnRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  if (await vulnTablesMissing(db)) return c.json({ ok: true, data: { available: false, lastRun: null, dailyLimit: DEFAULT_DAILY_LIMIT, filedToday: 0, counts: null, groups: [] } })
  const [rowsRes, runRes, settingsRes, filedRes] = await Promise.all([
    db.from('dependency_vulns')
      .select('id, kind, ecosystem, package_name, installed_version, dev, direct, source_path, source_line, advisory_id, cve_ids, title, advisory_url, severity, fixed_version, kev, epss, imported, group_key, status, dismissed_reason, report_id, first_seen_at')
      .eq('project_id', access.projectId)
      .in('status', ['open', 'dismissed'])
      .limit(2000),
    db.from('gate_runs').select('id, status, summary, commit_sha, completed_at, started_at').eq('project_id', access.projectId).eq('gate', RADAR_VULN_GATE).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('project_settings').select('vuln_reports_daily_limit').eq('project_id', access.projectId).maybeSingle(),
    db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', access.projectId).eq('source', 'security_advisory').gte('created_at', startOfUtcDay(deps.now())),
  ])
  if (rowsRes.error) return jsonError(c, 'DB_ERROR', 'Could not read the known holes.', 500)
  const groups = groupRows((rowsRes.data ?? []) as VulnRow[])
  const counts: Record<VulnSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const g of groups) if (g.status === 'open') counts[g.severity]++
  const run = runRes.data as { id: string; status: string; summary: Record<string, unknown> | null; commit_sha: string | null; completed_at: string | null; started_at: string } | null
  const summary = run?.summary ?? {}
  return c.json({
    ok: true,
    data: {
      available: true,
      lastRun: run ? {
        checkedAt: run.completed_at ?? run.started_at,
        status: run.status,
        commitSha: run.commit_sha,
        lockfiles: Array.isArray(summary.lockfiles) ? summary.lockfiles : [],
        runtimes: Array.isArray(summary.runtimes) ? summary.runtimes : [],
        packages: typeof summary.packages === 'number' ? summary.packages : null,
        filed: typeof summary.filed === 'number' ? summary.filed : 0,
        capped: typeof summary.capped === 'number' ? summary.capped : 0,
        warnings: Array.isArray(summary.warnings) ? summary.warnings.slice(0, 20) : [],
        results: Array.isArray(summary.results) ? summary.results : [],
        error: typeof summary.error === 'string' ? summary.error : null,
      } : null,
      dailyLimit: (settingsRes.data as { vuln_reports_daily_limit?: number } | null)?.vuln_reports_daily_limit ?? DEFAULT_DAILY_LIMIT,
      filedToday: filedRes.count ?? 0,
      counts,
      groups,
    },
  })
}

async function scanNow(c: Context, deps: VulnRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'start a dependency check')
  if (viewer) return viewer
  if (await vulnTablesMissing(db)) return jsonError(c, 'NOT_SET_UP', 'Known-hole checks are not set up on this server yet.', 503)
  // A 202 while a check is running would start nothing and say nothing.
  const heldUntil = await leaseHeldUntil(db, access.projectId, deps.now())
  if (heldUntil) {
    const waitSec = Math.max(1, Math.ceil((Date.parse(heldUntil) - deps.now().getTime()) / 1000))
    c.header('Retry-After', String(waitSec))
    return jsonError(c, 'RUN_IN_PROGRESS', 'A check of this project is running. Its result appears here when it finishes.', 409)
  }
  const rate = await deps.claimRateLimit(db as never, `project:${access.projectId}:vuln_scan`, VULN_SCANS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `A project can be checked ${VULN_SCANS_PER_HOUR} times an hour.`, 429)
  }
  deps.invokeWatch(access.projectId)
  return c.json({ ok: true, data: { queued: true } }, 202)
}

const groupPatchSchema = z.object({
  groupKey: z.string().min(3).max(800),
  status: z.enum(['dismissed', 'open']),
  reason: z.string().trim().max(500).optional(),
})

async function setGroupStatus(c: Context, deps: VulnRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'dismiss a known hole')
  if (viewer) return viewer
  const parsed = groupPatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '), 400)
  const { groupKey, status, reason } = parsed.data
  const from = status === 'dismissed' ? 'open' : 'dismissed'
  const patch = status === 'dismissed'
    ? { status, dismissed_reason: reason ?? null, dismissed_by: c.get('userId') ?? null }
    : { status, dismissed_reason: null, dismissed_by: null }
  const { data, error } = await db.from('dependency_vulns').update(patch).eq('project_id', access.projectId).eq('group_key', groupKey).eq('status', from).select('id')
  if (error) return jsonError(c, 'DB_ERROR', 'Could not change the known hole.', 500)
  const changed = (data ?? []).length
  if (changed === 0) return jsonError(c, 'NOT_FOUND', `No ${from} finding with that group.`, 404)
  await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'dependency_vulns', groupKey.slice(0, 200), { status, reason: reason ?? null, rows: changed }).catch(() => null)
  return c.json({ ok: true, data: { groupKey, status, rows: changed } })
}

const settingsSchema = z.object({ dailyLimit: z.number().int().min(0).max(100) })

async function putSettings(c: Context, deps: VulnRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db)
  if (access instanceof Response) return access
  const viewer = denyViewerWrite(c, access.role, 'change the known-hole report limit')
  if (viewer) return viewer
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', 'dailyLimit must be a whole number from 0 to 100.', 400)
  const { error } = await db.from('project_settings').upsert({ project_id: access.projectId, vuln_reports_daily_limit: parsed.data.dailyLimit }, { onConflict: 'project_id' })
  if (error) return jsonError(c, 'DB_ERROR', 'Could not save the limit.', 500)
  await deps.logAudit(db as never, access.projectId, c.get('userId') as string, 'settings.updated', 'project_settings', access.projectId, { vulnReportsDailyLimit: parsed.data.dailyLimit }).catch(() => null)
  return c.json({ ok: true, data: { dailyLimit: parsed.data.dailyLimit } })
}
