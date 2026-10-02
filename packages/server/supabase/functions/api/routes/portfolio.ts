/**
 * portfolio.ts — the portfolio rollup (Plan 019 Phase P1, Plan 020 Phase 1
 * columns): one card per project of an organization, built on the same
 * recipe composer as GET /v1/admin/projects/:id/recipe, plus the "fix once"
 * list (rules open in 2+ projects), Mushi SDK skew and integration holes.
 *
 * Access (Plan 019 §3b, §6): adminOrApiKey(mcp:read), then
 *   - a project-bound API key is refused (403): it must never read siblings;
 *   - a JWT user or an account-level key's owner must be a member of the
 *     organization (403 otherwise), and sees the organization's projects ∩
 *     the projects that user can reach (accessibleProjectIdsInOrganization).
 *
 * Shapes: _shared/portfolio-types.ts. Every response is `{ ok: true, data }`.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { accessibleProjectIdsInOrganization } from '../../_shared/project-access.ts'
import {
  groupRepeatedFindings,
  inferKind,
  integrationHoles,
  latestSdkVersions,
  mapBounded,
  sdkSkew,
  type IntegrationKey,
  type OpenFindingRow,
  type SdkObservationRow,
  type SdkVersionRow,
} from '../../_shared/portfolio.ts'
import type {
  PortfolioCard,
  PortfolioFindingsResponse,
  PortfolioRadarColumn,
  PortfolioResponse,
  PortfolioSpendColumn,
  SdkSkewEntry,
} from '../../_shared/portfolio-types.ts'
import { RECIPE_ELEMENT_KEYS, type ElementState, type RecipeElementKey } from '../../_shared/recipe-types.ts'
import { DESIGN_GATE } from '../../_shared/design-plane.ts'
import { RADAR_CI_GATE, RADAR_GATE } from '../../_shared/radar/run.ts'
import { jsonError, OPEN_REPORT_STATUSES } from '../shared.ts'
import type { Variables } from '../types.ts'
import { composeRecipe, isScanRun, latestPerGate, type ComposeDeps } from './recipe-compose.ts'
import { defaultRecipeDeps } from './recipe.ts'

const plog = log.child('portfolio')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PORTFOLIO_PAGE_SIZE = 25
const COMPOSE_CONCURRENCY = 4
const RADAR_COLUMN_GATES = [RADAR_GATE, RADAR_CI_GATE]

type Db = ReturnType<typeof getServiceClient>

export interface PortfolioRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  compose: ComposeDeps
  composeRecipe: typeof composeRecipe
}

export const defaultPortfolioDeps: PortfolioRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  compose: defaultRecipeDeps,
  composeRecipe,
}

type Access =
  | { ok: true; orgId: string; orgName: string | null; projectIds: string[] }
  | { ok: false; response: Response }

/**
 * Resolve the organization and the caller's visible projects in it. Exported
 * for the radar and digest routes, which share the same access rule.
 */
export async function portfolioAccess(c: Context, db: Db, rawOrgId: string): Promise<Access> {
  if (c.get('authMethod') === 'apiKey' && !c.get('isOrgScopedKey')) {
    return {
      ok: false,
      response: jsonError(c, 'PORTFOLIO_NEEDS_ACCOUNT_KEY', 'This key is bound to one project. The portfolio needs an account-level key (Connect → MCP → account key) or a signed-in session.', 403),
    }
  }
  const userId = c.get('userId') as string | undefined
  if (!userId) return { ok: false, response: jsonError(c, 'UNAUTHORIZED', 'Sign in or use an account-level key.', 401) }

  let orgId = rawOrgId
  if (rawOrgId === 'current') {
    const { data: memberships, error } = await db.from('organization_members').select('organization_id, organizations(name)').eq('user_id', userId)
    if (error) return { ok: false, response: jsonError(c, 'DB_ERROR', 'Could not read your organizations.', 500) }
    const rows = (memberships ?? []) as Array<{ organization_id: string; organizations?: { name?: string | null } | null }>
    if (rows.length !== 1) {
      return {
        ok: false,
        response: jsonError(c, 'ORG_REQUIRED', rows.length === 0 ? 'You are not a member of any organization.' : 'You belong to several organizations; pass one of these ids.', 400, {
          organizations: rows.map((r) => ({ id: r.organization_id, name: r.organizations?.name ?? null })),
        }),
      }
    }
    orgId = rows[0].organization_id
  }
  if (!UUID_RE.test(orgId)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Organization not found', 404) }

  const { data: membership } = await db
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return { ok: false, response: jsonError(c, 'FORBIDDEN', 'You are not a member of this organization.', 403) }

  const [{ data: org }, projectIds] = await Promise.all([
    db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    accessibleProjectIdsInOrganization(db, userId, orgId),
  ])
  return { ok: true, orgId, orgName: (org as { name?: string | null } | null)?.name ?? null, projectIds }
}

interface ProjectRow {
  id: string
  name: string | null
  slug: string | null
}

interface RunRow {
  id: string
  project_id: string
  gate: string
  status: string
  summary: Record<string, unknown> | null
  started_at: string
  completed_at: string | null
}

/** Latest completed run per (project, gate). Design refresh runs never count as the latest scan. */
function latestRunsByProject(runs: readonly RunRow[]): RunRow[] {
  const byProject = new Map<string, RunRow[]>()
  for (const r of runs) {
    if (r.gate === DESIGN_GATE && !isScanRun(r)) continue
    const list = byProject.get(r.project_id) ?? []
    list.push(r)
    byProject.set(r.project_id, list)
  }
  return [...byProject.values()].flatMap((rows) => latestPerGate(rows))
}

async function loadLatestRuns(db: Db, projectIds: string[]): Promise<RunRow[]> {
  if (projectIds.length === 0) return []
  const { data, error } = await db
    .from('gate_runs')
    .select('id, project_id, gate, status, summary, started_at, completed_at')
    .in('project_id', projectIds)
    .order('started_at', { ascending: false })
    .limit(3000)
  if (error) throw new Error(`gate_runs: ${error.message}`)
  return latestRunsByProject((data ?? []) as RunRow[])
}

async function loadOpenFindings(db: Db, runs: readonly RunRow[]): Promise<OpenFindingRow[]> {
  const runIds = runs.map((r) => r.id)
  if (runIds.length === 0) return []
  const gateOf = new Map(runs.map((r) => [r.id, r.gate]))
  const { data, error } = await db
    .from('gate_findings')
    .select('gate_run_id, project_id, rule_id, severity, message')
    .in('gate_run_id', runIds)
    .eq('allowlisted', false)
    .limit(10000)
  if (error) throw new Error(`gate_findings: ${error.message}`)
  return ((data ?? []) as Array<{ gate_run_id: string; project_id: string; rule_id: string; severity: string; message: string | null }>).map((f) => ({
    project_id: f.project_id,
    gate: gateOf.get(f.gate_run_id) ?? 'unknown',
    rule_id: f.rule_id,
    severity: f.severity,
    message: f.message,
  }))
}

async function loadSdk(db: Db, projectIds: string[]): Promise<{ observations: SdkObservationRow[]; latest: Map<string, string> }> {
  const [obs, versions] = await Promise.all([
    projectIds.length ? db.from('project_sdk_observations').select('project_id, sdk_package, sdk_version').in('project_id', projectIds) : Promise.resolve({ data: [], error: null }),
    db.from('sdk_versions').select('package, version, deprecated').limit(5000),
  ])
  return {
    observations: ((obs as { data: unknown }).data ?? []) as SdkObservationRow[],
    latest: latestSdkVersions(((versions as { data: unknown }).data ?? []) as SdkVersionRow[]),
  }
}

async function loadPresence(db: Db, projectIds: string[]): Promise<Map<string, Set<IntegrationKey>>> {
  const out = new Map<string, Set<IntegrationKey>>(projectIds.map((id) => [id, new Set<IntegrationKey>()]))
  if (projectIds.length === 0) return out
  const [{ data: settings }, { data: repos }] = await Promise.all([
    db.from('project_settings')
      .select('project_id, sentry_dsn, sentry_org_slug, slack_channel_id, slack_bot_token_ref, linear_api_key_ref, linear_access_token_ref, supabase_project_ref')
      .in('project_id', projectIds),
    db.from('project_repos').select('project_id').in('project_id', projectIds),
  ])
  for (const s of (settings ?? []) as Array<Record<string, string | null>>) {
    const set = out.get(s.project_id as string)
    if (!set) continue
    if (s.sentry_dsn || s.sentry_org_slug) set.add('sentry')
    if (s.slack_channel_id || s.slack_bot_token_ref) set.add('slack')
    if (s.linear_api_key_ref || s.linear_access_token_ref) set.add('linear')
    if (s.supabase_project_ref) set.add('supabase')
  }
  for (const r of (repos ?? []) as Array<{ project_id: string }>) out.get(r.project_id)?.add('github')
  return out
}

const STATUS_RANK: Record<string, number> = { error: 4, fail: 3, warn: 2, pass: 1, skipped: 0 }

/**
 * Radar column from the latest scheduled run and the latest host-CI run
 * (`radar` + `radar_ci`). Never-run is `never_run`; a run that found nothing
 * declared to check is `nothing_to_check` — neither reads as green.
 */
export function radarColumn(runs: readonly RunRow[], findings: readonly OpenFindingRow[]): PortfolioRadarColumn {
  if (runs.length === 0) return { checkedAt: null, status: 'never_run', open: { error: 0, warn: 0, info: 0 }, unchecked: 0 }
  const open = { error: 0, warn: 0, info: 0 }
  for (const f of findings) {
    if (f.severity === 'error' || f.severity === 'warn' || f.severity === 'info') open[f.severity]++
  }
  const worst = runs.reduce((w, r) => ((STATUS_RANK[r.status] ?? 4) > (STATUS_RANK[w.status] ?? 4) ? r : w))
  const status: PortfolioRadarColumn['status'] = worst.status === 'skipped' ? 'nothing_to_check'
    : worst.status === 'pass' || worst.status === 'warn' || worst.status === 'fail' ? worst.status : 'error'
  const unchecked = runs.reduce((n, r) => n + Number((r.summary as { unchecked?: number } | null)?.unchecked ?? 0), 0)
  const checkedAt = runs.map((r) => r.completed_at ?? r.started_at).sort().pop() ?? null
  return { checkedAt, status, open, unchecked: Number.isFinite(unchecked) ? unchecked : 0 }
}

async function loadSpend(db: Db, projectIds: string[], since: string): Promise<Map<string, PortfolioSpendColumn>> {
  const out = new Map<string, PortfolioSpendColumn>(projectIds.map((id) => [id, { llmUsd30d: 0, llmCalls30d: 0, autofixCapUsd: null, monthlyLlmBudgetUsd: null }]))
  if (projectIds.length === 0) return out
  const [{ data: calls }, { data: caps }] = await Promise.all([
    db.from('llm_invocations').select('project_id, cost_usd').in('project_id', projectIds).gte('created_at', since).limit(20000),
    db.from('project_settings').select('project_id, autofix_max_spend_usd, monthly_llm_budget_usd').in('project_id', projectIds),
  ])
  for (const c of (calls ?? []) as Array<{ project_id: string; cost_usd: number | string | null }>) {
    const s = out.get(c.project_id)
    if (!s) continue
    s.llmCalls30d++
    const n = Number(c.cost_usd ?? 0)
    if (Number.isFinite(n)) s.llmUsd30d += n
  }
  for (const c of (caps ?? []) as Array<{ project_id: string; autofix_max_spend_usd: number | string | null; monthly_llm_budget_usd: number | string | null }>) {
    const s = out.get(c.project_id)
    if (!s) continue
    s.autofixCapUsd = c.autofix_max_spend_usd == null ? null : Number(c.autofix_max_spend_usd)
    s.monthlyLlmBudgetUsd = c.monthly_llm_budget_usd == null ? null : Number(c.monthly_llm_budget_usd)
  }
  for (const s of out.values()) s.llmUsd30d = Math.round(s.llmUsd30d * 100) / 100
  return out
}

async function loadOpenReports(db: Db, projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(projectIds.map((id) => [id, 0]))
  if (projectIds.length === 0) return out
  const { data, error } = await db.from('reports').select('project_id').in('project_id', projectIds).in('status', [...OPEN_REPORT_STATUSES]).limit(20000)
  if (error) throw new Error(`reports: ${error.message}`)
  for (const r of (data ?? []) as Array<{ project_id: string }>) out.set(r.project_id, (out.get(r.project_id) ?? 0) + 1)
  return out
}

/** Build the cards for one page of projects. One project failing never fails the page. */
export async function buildPortfolio(db: Db, deps: PortfolioRouteDeps, orgId: string, orgName: string | null, projectIds: string[], page: number): Promise<PortfolioResponse> {
  const now = deps.compose.now()
  const sorted = [...projectIds].sort()
  const { data: projectRows } = sorted.length
    ? await db.from('projects').select('id, name, slug').in('id', sorted)
    : { data: [] }
  const projects = ((projectRows ?? []) as ProjectRow[]).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
  const pageProjects = projects.slice((page - 1) * PORTFOLIO_PAGE_SIZE, page * PORTFOLIO_PAGE_SIZE)
  const pageIds = pageProjects.map((p) => p.id)

  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const [runs, sdk, openReports, spend, presence, snapshots, releases] = await Promise.all([
    loadLatestRuns(db, sorted),
    loadSdk(db, pageIds),
    loadOpenReports(db, pageIds),
    loadSpend(db, pageIds, since),
    loadPresence(db, sorted),
    pageIds.length ? db.from('app_recipe_snapshots').select('project_id, manifest').in('project_id', pageIds).eq('is_current', true) : Promise.resolve({ data: [] }),
    pageIds.length ? db.from('releases').select('project_id, version, published_at, created_at').in('project_id', pageIds).order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
  ])
  const findings = await loadOpenFindings(db, runs)
  const skew = sdkSkew(pageIds, sdk.observations, sdk.latest)
  const declaredKind = new Map(((snapshots as { data: unknown }).data as Array<{ project_id: string; manifest: { app?: { kind?: unknown } } | null }> ?? []).map((s) => [s.project_id, s.manifest?.app?.kind]))
  const latestRelease = new Map<string, { version: string; publishedAt: string | null }>()
  for (const r of ((releases as { data: unknown }).data ?? []) as Array<{ project_id: string; version: string; published_at: string | null }>) {
    if (!latestRelease.has(r.project_id)) latestRelease.set(r.project_id, { version: r.version, publishedAt: r.published_at })
  }

  const cards = await mapBounded(pageProjects, COMPOSE_CONCURRENCY, async (p): Promise<PortfolioCard> => {
    const sdkEntries: SdkSkewEntry[] = skew.filter((s) => s.projectId === p.id)
    const kind = inferKind(declaredKind.get(p.id), sdk.observations.filter((o) => o.project_id === p.id).map((o) => o.sdk_package))
    const radarRuns = runs.filter((r) => r.project_id === p.id && RADAR_COLUMN_GATES.includes(r.gate))
    const base = {
      projectId: p.id,
      name: p.name ?? p.slug ?? p.id,
      slug: p.slug,
      kind: kind.kind,
      kindSource: kind.source,
      openReports: openReports.get(p.id) ?? 0,
      sdk: sdkEntries,
      latestRelease: latestRelease.get(p.id) ?? null,
      radar: radarColumn(radarRuns, findings.filter((f) => f.project_id === p.id && RADAR_COLUMN_GATES.includes(f.gate))),
      spend: spend.get(p.id)!,
    }
    try {
      const { response } = await deps.composeRecipe(db, deps.compose, p.id)
      const elements: Partial<Record<RecipeElementKey, ElementState>> = {}
      for (const k of RECIPE_ELEMENT_KEYS) elements[k] = response.elements[k].state
      return { ...base, worst: response.worst, elements, error: null }
    } catch (err) {
      plog.warn('portfolio card failed', { projectId: p.id, err: (err as Error)?.message ?? String(err) })
      return { ...base, worst: 'error', elements: {}, error: 'The recipe for this project could not be composed. Open its Recipe page for detail.' }
    }
  })

  return {
    organizationId: orgId,
    organizationName: orgName,
    generatedAt: now.toISOString(),
    page,
    pageSize: PORTFOLIO_PAGE_SIZE,
    totalProjects: projects.length,
    cards,
    repeatedGroups: groupRepeatedFindings(findings).length,
    holes: integrationHoles(presence).length,
  }
}

export async function buildPortfolioFindings(db: Db, deps: PortfolioRouteDeps, orgId: string, projectIds: string[]): Promise<PortfolioFindingsResponse> {
  const ids = [...projectIds].sort()
  const [runs, sdk, presence] = await Promise.all([loadLatestRuns(db, ids), loadSdk(db, ids), loadPresence(db, ids)])
  const findings = await loadOpenFindings(db, runs)
  return {
    organizationId: orgId,
    generatedAt: deps.compose.now().toISOString(),
    groups: groupRepeatedFindings(findings),
    sdkSkew: sdkSkew(ids, sdk.observations, sdk.latest),
    holes: integrationHoles(presence),
  }
}

export function registerPortfolioRoutes(app: Hono<{ Variables: Variables }>, deps: PortfolioRouteDeps = defaultPortfolioDeps): void {
  app.get('/v1/admin/orgs/:orgId/portfolio', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const page = Math.max(1, Math.min(1000, Number.parseInt(c.req.query('page') ?? '1', 10) || 1))
    try {
      const data = await buildPortfolio(db, deps, access.orgId, access.orgName, access.projectIds, page)
      return c.json({ ok: true, data })
    } catch (err) {
      plog.error('portfolio failed', { orgId: access.orgId, err: (err as Error)?.message ?? String(err) })
      return jsonError(c, 'PORTFOLIO_FAILED', 'The portfolio could not be read. Try again in a minute.', 500)
    }
  })

  app.get('/v1/admin/orgs/:orgId/portfolio/findings', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const data = await buildPortfolioFindings(db, deps, access.orgId, access.projectIds)
      return c.json({ ok: true, data })
    } catch (err) {
      plog.error('portfolio findings failed', { orgId: access.orgId, err: (err as Error)?.message ?? String(err) })
      return jsonError(c, 'PORTFOLIO_FAILED', 'The portfolio findings could not be read. Try again in a minute.', 500)
    }
  })
}
