/**
 * FILE: packages/server/supabase/functions/api/routes/health-checks.ts
 * PURPOSE: The Health check (plan-simplicity-2026-10, Phase 1; ADR 0054,
 *          Proposed): one list of every setup and health check for an app,
 *          served by `api-ext` (deploy size limit; `api` forwards the path).
 *
 *   GET /v1/admin/health-checks   ?projectId= one app, or every app the caller can open (≤ 10)
 *                                 &refresh=1  re-check the setup gaps now (≤ once a minute)
 *                                 &audience=platform  also the server doctor's platform lines
 *
 * Read-only. Every row comes from an existing checker, adapted by
 * `_shared/health-checks.ts`: setup gaps (`loadSetupGaps`, shared with
 * GET /v1/admin/setup-gaps, which stays as it is), SDK health
 * (`readSdkHealth`), the SDK diagnostics launcher verdict and the server
 * doctor (`runDoctorChecks`, narrowed to the app). Each source reads with its
 * own deadline; a source that fails or is slow gives `unknown` rows, never
 * missing ones and never `problem`.
 *
 * Auth: a console session or an API key with mcp:read (`mushi doctor`, MCP
 * `diagnose_setup`), members only. A project key reaches its own app only.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import {
  attachAffects,
  bannerCheck,
  countChecks,
  dedupeChecks,
  dropDuplicateNoRepo,
  fromDoctorCheck,
  fromSdkHealth,
  fromSetupGap,
  problemsByProject,
  rootCauses,
  sdkHealthUnreadable,
  sortChecks,
  type HealthCheck,
} from '../../_shared/health-checks.ts'
import { tagRootCauses, type PipelineStage } from '../../_shared/pipeline-view.ts'
import { defaultSetupGapsDeps, loadSetupGaps, type SetupGapsDeps } from './setup-gaps.ts'
import { readSdkHealth } from './sdk-health.ts'
import { runDoctorChecks } from './doctor.ts'
import { readPipeline, type DispatcherProject } from './pipeline.ts'
import { enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts'

const hlog = log.child('health-checks')

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Apps per request in "every app" mode: SDK health reads each repo. */
const MAX_PROJECTS = 10
const PROJECT_CONCURRENCY = 3
/** Each source's budget; a slower one gives `unknown` rows. */
const SDK_MS = 25_000
const SOURCE_MS = 12_000
const PIPELINE_MS = 12_000

export interface HealthChecksDeps {
  now: () => Date
  setupGaps: SetupGapsDeps
  readSdkHealth: typeof readSdkHealth
  runDoctorChecks: typeof runDoctorChecks
  readPipeline: typeof readPipeline
}

export const defaultHealthChecksDeps: HealthChecksDeps = {
  now: () => new Date(),
  setupGaps: defaultSetupGapsDeps,
  readSdkHealth: (...a) => readSdkHealth(...a),
  runDoctorChecks: (...a) => runDoctorChecks(...a),
  readPipeline: (...a) => readPipeline(...a),
}

function within<T>(p: PromiseLike<T>, what: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)
  })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160)

/**
 * Home's rows: the stored setup gaps only, never a live check (Home must not
 * wait on GitHub; an app with no stored answer is checked in the background
 * and shows none this time).
 */
export async function homeHealthChecks(db: Db, project: DispatcherProject, deps: SetupGapsDeps = defaultSetupGapsDeps): Promise<HealthCheck[]> {
  const [gaps] = await loadSetupGaps(db, [project], deps, { waitForLive: false })
  return gaps ? gaps.gaps.map((g) => fromSetupGap(g, gaps.checkedAt)) : []
}

async function sdkRows(db: Db, projectId: string, deps: HealthChecksDeps): Promise<HealthCheck[]> {
  const at = deps.now().toISOString()
  try {
    const read = await within(deps.readSdkHealth(db, projectId), 'SDK health', SDK_MS)
    if (!read.ok) return sdkHealthUnreadable(projectId, read.error?.message ?? 'the database did not answer', at)
    return fromSdkHealth(projectId, read.data, read.data.checkedAt)
  } catch (err) {
    return sdkHealthUnreadable(projectId, why(err), at)
  }
}

async function bannerRow(db: Db, projectId: string, now: Date): Promise<HealthCheck> {
  try {
    const { data, error } = await within(
      db.from('project_settings').select('sdk_config_enabled, sdk_widget_launcher').eq('project_id', projectId).maybeSingle(),
      'report button settings',
      SOURCE_MS,
    )
    if (error) throw new Error(error.message)
    const row = data as { sdk_config_enabled?: boolean | null; sdk_widget_launcher?: string | null } | null
    // The same reading as GET /sdk-diagnostics: no row means the defaults (button on).
    return bannerCheck(projectId, { bannerEnabled: row?.sdk_config_enabled !== false, launcherMode: row?.sdk_widget_launcher ?? null }, now.toISOString())
  } catch {
    return bannerCheck(projectId, null, now.toISOString())
  }
}

async function doctorRows(db: Db, userId: string, projectId: string, platform: boolean, deps: HealthChecksDeps): Promise<HealthCheck[]> {
  const at = deps.now().toISOString()
  try {
    const { checks } = await within(deps.runDoctorChecks(db, userId, { projectIds: [projectId], platform }), 'server doctor', SOURCE_MS)
    return checks.map((ch) => fromDoctorCheck(ch.name.startsWith('codebase_index') || ch.name === 'stranded_reports' || ch.name === 'dead_letter' ? projectId : null, ch, at))
  } catch (err) {
    return ['stranded_reports', 'dead_letter'].map((name) =>
      fromDoctorCheck(projectId, { name, status: 'warn', summary: `Could not read the server doctor (${why(err)}).` }, at),
    )
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Which apps this caller may read: a project key only its own app. */
async function scopedIds(c: Ctx, db: Db, userId: string): Promise<{ ids: string[]; truncated: boolean } | { response: Response }> {
  const requested = c.req.query('projectId') ?? undefined
  const keyProject = c.get('authMethod') === 'apiKey' ? ((c.get('projectId') as string | null | undefined) ?? null) : null
  if (requested && !UUID_RE.test(requested)) return { response: c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is not a uuid.' } }, 400) }
  const one = requested ?? keyProject
  if (one) {
    if (keyProject && one !== keyProject) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) }
    const access = await userCanAccessProject(db, userId, one)
    if (!access.allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) }
    return { ids: [one], truncated: false }
  }
  const all = await enumerateAccessibleProjectIds(c, db, userId)
  return { ids: all.slice(0, MAX_PROJECTS), truncated: all.length > MAX_PROJECTS }
}

export function registerHealthCheckRoutes(app: Hono<{ Variables: Variables }>, deps: HealthChecksDeps = defaultHealthChecksDeps): void {
  app.get('/v1/admin/health-checks', adminOrApiKey({ scope: 'mcp:read' }), async (c: Ctx) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const scope = await scopedIds(c, db, userId)
    if ('response' in scope) return scope.response
    const now = deps.now()
    const empty = { generatedAt: now.toISOString(), projects: [], counts: countChecks([]), truncated: false }
    if (scope.ids.length === 0) return c.json({ ok: true, data: empty })

    const { data: projectRows, error } = await db.from('projects').select('id, name, organization_id, owner_id').in('id', scope.ids)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    const projects = (projectRows ?? []) as DispatcherProject[]
    const platform = c.req.query('audience') === 'platform'

    const [gaps, pipeline] = await Promise.all([
      loadSetupGaps(db, projects, deps.setupGaps, { refresh: c.req.query('refresh') === '1' }).catch((err) => {
        hlog.warn('setup gaps unreadable for the health check', { err: why(err) })
        return null
      }),
      within(deps.readPipeline(db, projects.map((p) => p.id), now), 'pipeline', PIPELINE_MS).catch(() => null),
    ])
    const gapsByProject = new Map((gaps ?? []).map((g) => [g.projectId, g]))

    const perProject = await mapLimit(projects, PROJECT_CONCURRENCY, async (p) => {
      const [sdk, banner, doctor] = await Promise.all([sdkRows(db, p.id, deps), bannerRow(db, p.id, now), doctorRows(db, userId, p.id, platform, deps)])
      const g = gapsByProject.get(p.id)
      const setup = g
        ? g.gaps.map((x) => fromSetupGap(x, g.checkedAt))
        : // Setup gaps could not be read: one unknown line per check, never "fine".
          ['github_access', 'review_followup_key', 'autofix_agent_key', 'deploy_events', 'slack_bot_token'].map((id) =>
            fromSetupGap({ id, projectId: p.id, audience: 'app_owner', status: 'unknown', title: id.replace(/_/g, ' '), summary: 'Mushi Mushi could not read this check just now.', fixHref: '/onboarding' }, null),
          )
      return { project: p, checks: dropDuplicateNoRepo(dedupeChecks([...setup, ...sdk, banner, ...doctor])) }
    })

    const all = perProject.flatMap((x) => x.checks)
    const stages: PipelineStage[] | null = pipeline ? tagRootCauses(pipeline.stages, problemsByProject(all)) : null
    const groups = stages ? stages.flatMap((s) => s.groups) : []
    const out = perProject.map(({ project, checks }) => {
      const visible = sortChecks(attachAffects(checks, groups).filter((ch) => platform || ch.audience === 'app_owner'))
      return {
        projectId: project.id,
        name: project.name,
        checkedAt: gapsByProject.get(project.id)?.checkedAt ?? now.toISOString(),
        checks: visible,
        fixFirst: rootCauses(visible),
        counts: countChecks(visible),
      }
    })
    const counts = countChecks(out.flatMap((p) => p.checks))
    hlog.info('health checks read', { projects: out.length, ...counts })
    return c.json({
      ok: true,
      data: {
        generatedAt: now.toISOString(),
        projects: out.sort((a, b) => a.name.localeCompare(b.name)),
        counts,
        truncated: scope.truncated,
        pipelineRead: pipeline !== null,
      },
    })
  })
}
