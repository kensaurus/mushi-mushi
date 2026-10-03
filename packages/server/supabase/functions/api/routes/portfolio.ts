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
 * A column whose read failed or was cut short is listed in `readErrors` and in
 * the card's `unreadable`; it never reads as zero, "no cap" or "none yet".
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
  CrossProjectFinding,
  PortfolioCard,
  PortfolioFindingsResponse,
  PortfolioRadarColumn,
  PortfolioReadError,
  PortfolioReadPart,
  PortfolioResponse,
  PortfolioSpendColumn,
  SdkSkewEntry,
} from '../../_shared/portfolio-types.ts'
import { readAllPages } from '../../_shared/paged-read.ts'
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

  const { data: membership, error: membershipErr } = await db
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipErr) return { ok: false, response: jsonError(c, 'DB_ERROR', 'Could not check your membership of this organization.', 500) }
  if (!membership) return { ok: false, response: jsonError(c, 'FORBIDDEN', 'You are not a member of this organization.', 403) }

  let projectIds: string[]
  let org: { name?: string | null } | null
  try {
    const [orgRes, ids] = await Promise.all([
      db.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      // strict: a failed read is a 500, never "no apps in this team yet".
      accessibleProjectIdsInOrganization(db, userId, orgId, { strict: true }),
    ])
    org = (orgRes.data ?? null) as { name?: string | null } | null
    projectIds = ids
  } catch (err) {
    plog.error('portfolio access read failed', { orgId, err: err instanceof Error ? err.message : String(err) })
    return { ok: false, response: jsonError(c, 'DB_ERROR', 'Could not read the projects of this organization.', 500) }
  }
  return { ok: true, orgId, orgName: org?.name ?? null, projectIds }
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

// ── reads ────────────────────────────────────────────────────────────────────
// Fail-open rule (Plan 020 P-1): a read that fails or is cut short is recorded
// in `errs` and its column reads "could not read", never $0 / "no cap" /
// "no release" / "healthy". The project list, gate runs, findings and open
// reports throw instead: without them the page has nothing true to show.

/** Row ceilings per read; past them the read is reported as truncated. */
const MAX_RUN_ROWS = 20_000
const MAX_FINDING_ROWS = 20_000
const MAX_REPORT_ROWS = 50_000
const MAX_SPEND_ROWS = 50_000
const MAX_RELEASE_ROWS = 5_000
const MAX_SDK_VERSION_ROWS = 5_000

/** Parts whose failure makes a card's own column unknown. */
const CARD_PARTS: readonly PortfolioReadPart[] = ['gate_runs', 'findings', 'reports', 'sdk', 'spend', 'caps', 'releases', 'kind']

type ReadErrors = PortfolioReadError[]

function noteFailed(errs: ReadErrors, part: PortfolioReadPart, message: string, detail: string): void {
  plog.warn('portfolio read failed', { part, err: detail })
  errs.push({ part, kind: 'failed', message })
}

function noteTruncated(errs: ReadErrors, part: PortfolioReadPart, message: string): void {
  plog.warn('portfolio read truncated', { part })
  errs.push({ part, kind: 'truncated', message })
}

async function loadLatestRuns(db: Db, projectIds: string[], errs: ReadErrors): Promise<RunRow[]> {
  if (projectIds.length === 0) return []
  const read = await readAllPages<RunRow>(
    (from, to) => db
      .from('gate_runs')
      .select('id, project_id, gate, status, summary, started_at, completed_at', { count: 'exact' })
      .in('project_id', projectIds)
      .order('started_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    { what: 'gate_runs', maxRows: MAX_RUN_ROWS },
  )
  if (read.truncated) {
    noteTruncated(errs, 'gate_runs', `Only the newest ${MAX_RUN_ROWS.toLocaleString('en-US')} check runs were read; a check that last ran before them is missing from the cards.`)
  }
  return latestRunsByProject(read.rows)
}

async function loadOpenFindings(db: Db, runs: readonly RunRow[], errs: ReadErrors): Promise<OpenFindingRow[]> {
  const runIds = runs.map((r) => r.id)
  if (runIds.length === 0) return []
  const gateOf = new Map(runs.map((r) => [r.id, r.gate]))
  type Row = { gate_run_id: string; project_id: string; rule_id: string; severity: string; message: string | null }
  const read = await readAllPages<Row>(
    (from, to) => db
      .from('gate_findings')
      .select('id, gate_run_id, project_id, rule_id, severity, message', { count: 'exact' })
      .in('gate_run_id', runIds)
      .eq('allowlisted', false)
      .order('id', { ascending: true })
      .range(from, to),
    { what: 'gate_findings', maxRows: MAX_FINDING_ROWS },
  )
  if (read.truncated) {
    noteTruncated(errs, 'findings', `More than ${MAX_FINDING_ROWS.toLocaleString('en-US')} open findings: the counts below are a lower bound.`)
  }
  return read.rows.map((f) => ({
    project_id: f.project_id,
    gate: gateOf.get(f.gate_run_id) ?? 'unknown',
    rule_id: f.rule_id,
    severity: f.severity,
    message: f.message,
  }))
}

/** null when the SDK observations or the version catalog could not be read. */
async function loadSdk(db: Db, projectIds: string[], errs: ReadErrors): Promise<{ observations: SdkObservationRow[]; latest: Map<string, string> } | null> {
  const [obs, versions] = await Promise.all([
    projectIds.length
      ? db.from('project_sdk_observations').select('project_id, sdk_package, sdk_version').in('project_id', projectIds)
      : Promise.resolve({ data: [] as SdkObservationRow[], error: null }),
    db.from('sdk_versions').select('package, version, deprecated').limit(MAX_SDK_VERSION_ROWS),
  ])
  if (obs.error || versions.error) {
    noteFailed(errs, 'sdk', 'The Mushi SDK versions could not be read.', (obs.error ?? versions.error)?.message ?? '')
    return null
  }
  const versionRows = (versions.data ?? []) as SdkVersionRow[]
  if (versionRows.length >= MAX_SDK_VERSION_ROWS) {
    noteTruncated(errs, 'sdk', 'The Mushi SDK release catalog is larger than Mushi reads; "latest" may be out of date.')
  }
  return {
    observations: (obs.data ?? []) as SdkObservationRow[],
    latest: latestSdkVersions(versionRows),
  }
}

/** null when the integration settings could not be read: holes are then unknown, not "none". */
async function loadPresence(db: Db, projectIds: string[], errs: ReadErrors): Promise<Map<string, Set<IntegrationKey>> | null> {
  const out = new Map<string, Set<IntegrationKey>>(projectIds.map((id) => [id, new Set<IntegrationKey>()]))
  if (projectIds.length === 0) return out
  const [settingsRes, reposRes] = await Promise.all([
    db.from('project_settings')
      .select('project_id, sentry_dsn, sentry_org_slug, slack_channel_id, slack_bot_token_ref, linear_api_key_ref, linear_access_token_ref, supabase_project_ref')
      .in('project_id', projectIds),
    db.from('project_repos').select('project_id').in('project_id', projectIds),
  ])
  if (settingsRes.error || reposRes.error) {
    noteFailed(errs, 'integrations', 'Which integrations each app has could not be read, so missing setups are unknown.', (settingsRes.error ?? reposRes.error)?.message ?? '')
    return null
  }
  const settings = settingsRes.data
  const repos = reposRes.data
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
 * (`portfolio_radar` + `portfolio_radar_ci`). Never-run is `never_run`; a run that found nothing
 * declared to check is `nothing_to_check` — neither reads as green.
 */
export function radarColumn(runs: readonly RunRow[], findings: readonly OpenFindingRow[]): PortfolioRadarColumn {
  if (runs.length === 0) return { checkedAt: null, status: 'never_run', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 }
  const open = { error: 0, warn: 0, info: 0 }
  for (const f of findings) {
    if (f.severity === 'error' || f.severity === 'warn' || f.severity === 'info') open[f.severity]++
  }
  const worst = runs.reduce((w, r) => ((STATUS_RANK[r.status] ?? 4) > (STATUS_RANK[w.status] ?? 4) ? r : w))
  const errored = runs.reduce((n, r) => n + Number((r.summary as { errored?: number } | null)?.errored ?? 0), 0)
  // A check that failed to run is never shown as green, whatever the run status says.
  const status: PortfolioRadarColumn['status'] = worst.status === 'fail' ? 'fail'
    : worst.status === 'error' || errored > 0 ? 'error'
    : worst.status === 'skipped' ? 'nothing_to_check'
    : worst.status === 'pass' || worst.status === 'warn' ? worst.status : 'error'
  const unchecked = runs.reduce((n, r) => n + Number((r.summary as { unchecked?: number } | null)?.unchecked ?? 0), 0)
  const checkedAt = runs.map((r) => r.completed_at ?? r.started_at).sort().pop() ?? null
  return { checkedAt, status, open, unchecked: Number.isFinite(unchecked) ? unchecked : 0, errored: Number.isFinite(errored) ? errored : 0 }
}

const EMPTY_SPEND: PortfolioSpendColumn = { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true }

async function loadSpend(db: Db, projectIds: string[], since: string, errs: ReadErrors): Promise<Map<string, PortfolioSpendColumn>> {
  const out = new Map<string, PortfolioSpendColumn>(projectIds.map((id) => [id, { ...EMPTY_SPEND }]))
  if (projectIds.length === 0) return out
  type CallRow = { project_id: string; cost_usd: number | string | null }
  const [callsRead, capsRes] = await Promise.all([
    readAllPages<CallRow>(
      (from, to) => db
        .from('llm_invocations')
        .select('id, project_id, cost_usd', { count: 'exact' })
        .in('project_id', projectIds)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, to),
      { what: 'llm_invocations', maxRows: MAX_SPEND_ROWS },
    ).catch((err: unknown) => {
      noteFailed(errs, 'spend', "Mushi's AI spend could not be read.", err instanceof Error ? err.message : String(err))
      return null
    }),
    db.from('project_settings').select('project_id, autofix_max_spend_usd, monthly_llm_budget_usd').in('project_id', projectIds),
  ])
  if (!callsRead) {
    for (const s of out.values()) {
      s.llmUsd30d = null
      s.llmCalls30d = null
    }
  } else {
    if (callsRead.truncated) {
      noteTruncated(errs, 'spend', `More than ${MAX_SPEND_ROWS.toLocaleString('en-US')} AI calls in 30 days: the spend shown is a lower bound.`)
    }
    for (const c of callsRead.rows) {
      const s = out.get(c.project_id)
      if (!s) continue
      s.llmCalls30d = (s.llmCalls30d ?? 0) + 1
      const n = Number(c.cost_usd ?? 0)
      if (Number.isFinite(n)) s.llmUsd30d = (s.llmUsd30d ?? 0) + n
    }
    for (const s of out.values()) {
      s.partial = callsRead.truncated
      s.llmUsd30d = Math.round((s.llmUsd30d ?? 0) * 100) / 100
    }
  }
  if (capsRes.error) {
    noteFailed(errs, 'caps', 'The spend caps could not be read; they are unknown, not unset.', capsRes.error.message)
    for (const s of out.values()) s.capsKnown = false
    return out
  }
  for (const c of (capsRes.data ?? []) as Array<{ project_id: string; autofix_max_spend_usd: number | string | null; monthly_llm_budget_usd: number | string | null }>) {
    const s = out.get(c.project_id)
    if (!s) continue
    s.autofixCapUsd = c.autofix_max_spend_usd == null ? null : Number(c.autofix_max_spend_usd)
    s.monthlyLlmBudgetUsd = c.monthly_llm_budget_usd == null ? null : Number(c.monthly_llm_budget_usd)
  }
  return out
}

async function loadOpenReports(db: Db, projectIds: string[], errs: ReadErrors): Promise<Map<string, number>> {
  const out = new Map<string, number>(projectIds.map((id) => [id, 0]))
  if (projectIds.length === 0) return out
  type ReportRow = { project_id: string }
  const read = await readAllPages<ReportRow>(
    (from, to) => db
      .from('reports')
      .select('id, project_id', { count: 'exact' })
      .in('project_id', projectIds)
      .in('status', [...OPEN_REPORT_STATUSES])
      .order('id', { ascending: true })
      .range(from, to),
    { what: 'reports', maxRows: MAX_REPORT_ROWS },
  )
  if (read.truncated) {
    noteTruncated(errs, 'reports', `More than ${MAX_REPORT_ROWS.toLocaleString('en-US')} open reports: the counts shown are a lower bound.`)
  }
  for (const r of read.rows) out.set(r.project_id, (out.get(r.project_id) ?? 0) + 1)
  return out
}

/** Declared kind per project from the current recipe snapshot; null when it could not be read. */
async function loadDeclaredKinds(db: Db, projectIds: string[], errs: ReadErrors): Promise<Map<string, unknown> | null> {
  if (projectIds.length === 0) return new Map()
  const { data, error } = await db.from('app_recipe_snapshots').select('project_id, manifest').in('project_id', projectIds).eq('is_current', true)
  if (error) {
    noteFailed(errs, 'kind', 'The app kinds declared in each recipe could not be read.', error.message)
    return null
  }
  return new Map(((data ?? []) as Array<{ project_id: string; manifest: { app?: { kind?: unknown } } | null }>).map((s) => [s.project_id, s.manifest?.app?.kind]))
}

interface LatestReleases {
  byProject: Map<string, { version: string; publishedAt: string | null }>
  /** When the read stopped early, a project with no row found is unknown, not "none yet". */
  truncated: boolean
}

async function loadLatestReleases(db: Db, projectIds: string[], errs: ReadErrors): Promise<LatestReleases | null> {
  const byProject = new Map<string, { version: string; publishedAt: string | null }>()
  if (projectIds.length === 0) return { byProject, truncated: false }
  type ReleaseRow = { project_id: string; version: string; published_at: string | null }
  try {
    const read = await readAllPages<ReleaseRow>(
      (from, to) => db
        .from('releases')
        .select('id, project_id, version, published_at, created_at', { count: 'exact' })
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
      { what: 'releases', maxRows: MAX_RELEASE_ROWS },
    )
    for (const r of read.rows) {
      if (!byProject.has(r.project_id)) byProject.set(r.project_id, { version: r.version, publishedAt: r.published_at })
    }
    if (read.truncated) {
      noteTruncated(errs, 'releases', `Only the newest ${MAX_RELEASE_ROWS.toLocaleString('en-US')} releases were read; an app with no release among them reads "could not read".`)
    }
    return { byProject, truncated: read.truncated }
  } catch (err) {
    noteFailed(errs, 'releases', 'The releases could not be read.', err instanceof Error ? err.message : String(err))
    return null
  }
}

/** The card columns a page-level read problem makes unknown for this card. */
function unreadableFor(projectId: string, errs: readonly PortfolioReadError[], releases: LatestReleases | null): PortfolioReadPart[] {
  const parts = new Set<PortfolioReadPart>()
  for (const e of errs) {
    if (!CARD_PARTS.includes(e.part)) continue
    // A truncated release read only hides apps whose latest release was not reached.
    if (e.part === 'releases' && e.kind === 'truncated' && releases?.byProject.has(projectId)) continue
    parts.add(e.part)
  }
  return CARD_PARTS.filter((p) => parts.has(p))
}

/** Build the cards for one page of projects. One project failing never fails the page. */
export async function buildPortfolio(db: Db, deps: PortfolioRouteDeps, orgId: string, orgName: string | null, projectIds: string[], page: number): Promise<PortfolioResponse> {
  const now = deps.compose.now()
  const sorted = [...projectIds].sort()
  let projectRows: ProjectRow[] = []
  if (sorted.length) {
    const { data, error } = await db.from('projects').select('id, name, slug').in('id', sorted)
    // Without the project list there is nothing true to show: never "no apps yet".
    if (error) throw new Error(`projects: ${error.message}`)
    projectRows = (data ?? []) as ProjectRow[]
  }
  const projects = projectRows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
  const pageProjects = projects.slice((page - 1) * PORTFOLIO_PAGE_SIZE, page * PORTFOLIO_PAGE_SIZE)
  const pageIds = pageProjects.map((p) => p.id)

  const errs: ReadErrors = []
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const [runs, sdk, openReports, spend, presence, declaredKind, releases] = await Promise.all([
    loadLatestRuns(db, sorted, errs),
    loadSdk(db, pageIds, errs),
    loadOpenReports(db, pageIds, errs),
    loadSpend(db, pageIds, since, errs),
    loadPresence(db, sorted, errs),
    loadDeclaredKinds(db, pageIds, errs),
    loadLatestReleases(db, pageIds, errs),
  ])
  const findings = await loadOpenFindings(db, runs, errs)
  const skew = sdk ? sdkSkew(pageIds, sdk.observations, sdk.latest) : []

  const cards = await mapBounded(pageProjects, COMPOSE_CONCURRENCY, async (p): Promise<PortfolioCard> => {
    const sdkEntries: SdkSkewEntry[] = skew.filter((s) => s.projectId === p.id)
    // Without the declared kind or the SDK list the kind is unknown, not guessed from half the inputs.
    const kind = declaredKind && sdk
      ? inferKind(declaredKind.get(p.id), sdk.observations.filter((o) => o.project_id === p.id).map((o) => o.sdk_package))
      : { kind: null, source: 'unknown' as const }
    const radarRuns = runs.filter((r) => r.project_id === p.id && RADAR_COLUMN_GATES.includes(r.gate))
    const base = {
      projectId: p.id,
      name: p.name ?? p.slug ?? p.id,
      slug: p.slug,
      kind: kind.kind,
      kindSource: kind.source,
      openReports: openReports.get(p.id) ?? 0,
      sdk: sdkEntries,
      latestRelease: releases?.byProject.get(p.id) ?? null,
      radar: radarColumn(radarRuns, findings.filter((f) => f.project_id === p.id && RADAR_COLUMN_GATES.includes(f.gate))),
      spend: spend.get(p.id) ?? { ...EMPTY_SPEND },
      unreadable: unreadableFor(p.id, errs, releases),
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
    holes: presence ? integrationHoles(presence).length : null,
    readErrors: errs,
  }
}

type CrossRow = { id: string; rule_id: string; severity: CrossProjectFinding['severity']; project_ids: string[]; resource_key: string | null; message: string; suggested_fix: { text?: string } | null }

const CROSS_LIMIT = 500

export async function buildPortfolioFindings(db: Db, deps: PortfolioRouteDeps, orgId: string, projectIds: string[]): Promise<PortfolioFindingsResponse> {
  const ids = [...projectIds].sort()
  const errs: ReadErrors = []
  const [runs, sdk, presence] = await Promise.all([loadLatestRuns(db, ids, errs), loadSdk(db, ids, errs), loadPresence(db, ids, errs)])
  const findings = await loadOpenFindings(db, runs, errs)
  const { data: cross, error: crossErr } = await db
    .from('portfolio_findings')
    .select('id, rule_id, severity, project_ids, resource_key, message, suggested_fix')
    .eq('organization_id', orgId)
    .eq('status', 'open')
    .order('id', { ascending: true })
    .limit(CROSS_LIMIT)
  if (crossErr) noteFailed(errs, 'cross_project', 'The problems shared across apps could not be read.', crossErr.message)
  else if ((cross ?? []).length >= CROSS_LIMIT) noteTruncated(errs, 'cross_project', `Only the first ${CROSS_LIMIT} problems shared across apps are listed.`)
  return {
    organizationId: orgId,
    generatedAt: deps.compose.now().toISOString(),
    groups: groupRepeatedFindings(findings),
    sdkSkew: sdk ? sdkSkew(ids, sdk.observations, sdk.latest) : [],
    holes: presence ? integrationHoles(presence) : [],
    // A cross-project finding is shown only when the caller can see every project it names.
    crossProject: ((crossErr ? [] : cross ?? []) as CrossRow[])
      .filter((f) => f.project_ids.every((p) => ids.includes(p)))
      .map((f) => ({ id: f.id, ruleId: f.rule_id, severity: f.severity, projectIds: f.project_ids, resourceKey: f.resource_key, message: f.message, suggestedFix: f.suggested_fix?.text ?? null })),
    readErrors: errs,
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
