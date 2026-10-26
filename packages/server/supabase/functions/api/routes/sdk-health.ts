/**
 * FILE: packages/server/supabase/functions/api/routes/sdk-health.ts
 * PURPOSE: SDK health with a fix for each problem, served by `api-ext` (deploy
 *          size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/projects/:id/sdk-health         { problems, notes, … } (members)
 *   POST /v1/admin/projects/:id/sdk-health/tasks   { kind: 'install' | 'csp' } (owner/admin)
 *
 * The decisions live in `_shared/sdk-health.ts`. This file does the reads:
 * the repo's package.json files and Actions secret names (recipe-github, every
 * call with a timeout), the app's SDK key heartbeats, the sdk_versions
 * catalogue and the live site's CSP (publicFetch). A read that fails becomes a
 * note, never a 500 and never "all good".
 *
 * A task is one `classified` report (source 'sdk_health') with exact steps and
 * observable "Done when" lines, written from a template with no model call.
 * The fix pipeline picks it up like any classified report. One open task per
 * kind: a second POST returns the open one.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { log } from '../../_shared/logger.ts'
import { publicFetch } from '../../_shared/safe-fetch.ts'
import {
  getDefaultHead,
  listActionsNames,
  listTree,
  readBlobsGraphql,
  resolveRecipeRepo,
  type RecipeRepo,
} from '../../_shared/recipe-github.ts'
import { lastHeartbeatAt, missingCiVars, nativeEverSeen, requiredCiVarNames, resolveStack, type KeyHeartbeat } from '../../_shared/sdk-diagnostics.ts'
import { pickHighestVersion } from '../../_shared/sdk-version-compare.ts'
import { isSdkKey } from '../../_shared/setup-signals.ts'
import { isUpgradePrStillRelevant } from '../../_shared/sdk-upgrade-gates.ts'
import {
  OPEN_REPORT_STATUSES,
  SDK_HEALTH_TASK_KINDS,
  cspAllowsConnect,
  cspTaskReport,
  detectAppTarget,
  installTaskReport,
  isSdkPackage,
  metaCspValues,
  mushiDeps,
  packageJsonPaths,
  parseCspPolicies,
  sdkHealthProblems,
  siteUrlsFromManifest,
  taskComponent,
  type CspVerdict,
  type PackageJsonFile,
  type Read,
  type SdkHealthInput,
  type SdkHealthTaskKind,
  type TaskReport,
} from '../../_shared/sdk-health.ts'
import { dbError, parseUuidParam, userCanAccessProject } from '../shared.ts'

const slog = log.child('sdk-health')

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

/** Whole-repo read budget; each GitHub call also has its own timeout. */
const REPO_READ_MS = 20_000
const SITE_FETCH_MS = 8_000

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200)
}

/** The ingest URL the SDK calls; the same value Sync CI secrets writes. Read per request (Deno tests run without env permission). */
function mushiEndpoint(): string {
  return (
    Deno.env.get('MUSHI_API_ENDPOINT') ??
    `https://${Deno.env.get('SUPABASE_URL')?.replace('https://', '').split('.')[0]}.supabase.co/functions/v1/api`
  ).replace(/\/$/, '')
}

async function access(c: Ctx, db: Db, write: boolean): Promise<{ projectId: string } | { response: Response }> {
  const parsed = parseUuidParam(c)
  if (!parsed.ok) return { response: parsed.error }
  const projectId = parsed.value
  const { allowed, role } = await userCanAccessProject(db, c.get('userId') as string, projectId)
  if (!allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) }
  if (write && role !== 'owner' && role !== 'admin') {
    return { response: c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only an owner or admin can file fix tasks.' } }, 403) }
  }
  return { projectId }
}

interface RepoRead {
  repo: RecipeRepo
  sha: string
  files: PackageJsonFile[]
  workflows: string[]
}

async function readRepo(repo: RecipeRepo): Promise<RepoRead> {
  const head = await getDefaultHead(repo)
  const tree = await listTree(repo, head.sha)
  const paths = tree.entries.map((e) => e.path)
  const pkgPaths = packageJsonPaths(paths)
  const blobs = pkgPaths.length > 0 ? await readBlobsGraphql(repo, head.sha, pkgPaths) : new Map<string, string | null>()
  const files = pkgPaths.flatMap((p) => {
    const text = blobs.get(p)
    return typeof text === 'string' ? [{ path: p, text }] : []
  })
  const workflows = paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p)).slice(0, 10)
  return { repo, sha: head.sha, files, workflows }
}

/** The first known live site address: recipe deploy targets, then Site watch, then the site audit. */
async function siteUrl(db: Db, projectId: string): Promise<string | null> {
  const [snap, watch, audit] = await Promise.all([
    db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle(),
    db.from('site_watches').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('site_audits').select('base_url').eq('project_id', projectId).maybeSingle(),
  ])
  const candidates = [
    ...siteUrlsFromManifest((snap.data as { manifest?: unknown } | null)?.manifest ?? null),
    (watch.data as { base_url?: string } | null)?.base_url,
    (audit.data as { base_url?: string } | null)?.base_url,
  ]
  return candidates.find((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u)) ?? null
}

interface UpgradeJobRow {
  status: string
  pr_url: string | null
  pr_state: string | null
  merged_at: string | null
  check_run_status: string | null
  check_run_conclusion: string | null
}

/** The last upgrade PR while it is still open, with its CI in one word. */
function openUpgradePr(row: UpgradeJobRow | null): SdkHealthInput['openUpgradePr'] {
  if (!row?.pr_url || !isUpgradePrStillRelevant(row) || row.merged_at || row.pr_state === 'merged') return null
  const conclusion = row.check_run_conclusion
  const ci = conclusion && ['failure', 'cancelled', 'timed_out', 'action_required'].includes(conclusion)
    ? 'failing'
    : conclusion === 'success'
      ? 'passing'
      : row.check_run_status && row.check_run_status !== 'completed'
        ? 'running'
        : null
  const number = Number(/\/pull\/(\d+)/.exec(row.pr_url)?.[1])
  return { url: row.pr_url, number: Number.isFinite(number) ? number : null, ci }
}

type CspRead = Read<{ url: string; apiOrigin: string; verdict: CspVerdict }> | null

async function readCsp(url: string | null, endpoint: string): Promise<CspRead> {
  if (!url) return null
  try {
    const res = await publicFetch(url, { accept: 'text/html', timeoutMs: SITE_FETCH_MS })
    // A challenge page, a 404 or an error page is not the policy the app runs under.
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: `${url} answered ${res.status}` }
    const values = [res.headers.get('content-security-policy') ?? '', ...metaCspValues(res.text)].filter((v) => v.trim())
    const apiUrl = new URL(`${endpoint}/v1/reports`)
    const verdict = cspAllowsConnect(parseCspPolicies(values), apiUrl, new URL(res.finalUrl || url))
    return { ok: true, value: { url, apiOrigin: apiUrl.origin, verdict } }
  } catch (err) {
    return { ok: false, reason: `${url} could not be read (${reason(err)})` }
  }
}

function repoLabelOf(repo: RecipeRepo): string {
  return `${repo.ref.owner}/${repo.ref.repo}`
}

async function fileTask(
  c: Ctx,
  db: Db,
  projectId: string,
  kind: SdkHealthTaskKind,
  r: TaskReport,
): Promise<Response> {
  const nowIso = new Date().toISOString()
  const userId = c.get('userId') as string
  const { data, error } = await db
    .from('reports')
    .insert({
      project_id: projectId,
      source: 'sdk_health',
      category: 'other',
      title: r.title,
      summary: r.summary,
      description: r.description,
      component: r.component,
      severity: r.severity,
      status: 'classified',
      confidence: 1,
      bug_ontology_tags: r.tags,
      reporter_token_hash: 'console:sdk-health',
      reporter_user_id: userId,
      environment: r.environment,
      custom_metadata: { source: 'sdk_health', kind, filed_by: userId },
      synced_at: nowIso,
      created_at: nowIso,
    })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    // Most likely before migration 20261026120000 (reports.source has no 'sdk_health'): say so, never a quiet 200.
    slog.warn('sdk-health task insert failed', { projectId, kind, err: error?.message })
    return c.json({ ok: false, error: { code: 'TASK_NOT_FILED', message: `The task was not filed: ${(error?.message ?? 'no row returned').slice(0, 200)}` } }, 500)
  }
  const reportId = (data as { id: string }).id
  await logAudit(db, projectId, userId, 'report.created', 'report', reportId, { source: 'sdk_health', kind }).catch(() => {})
  return c.json({ ok: true, data: { reportId, existing: false } })
}

export function registerSdkHealthRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/sdk-health', jwtAuth, async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, false)
    if ('response' in a) return a.response
    const endpoint = mushiEndpoint()

    // The site fetch runs beside the repo reads, so a slow GitHub and a slow site do not add up.
    const site = siteUrl(db, a.projectId)
    const cspRead: Promise<CspRead> = site.then(
      (url) => readCsp(url, endpoint),
      (err) => ({ ok: false, reason: `the site address could not be read (${reason(err)})` }),
    )
    const [projectRes, keysRes, versionsRes, upgradeRes, repoRes] = await Promise.all([
      db.from('projects').select('slug').eq('id', a.projectId).maybeSingle(),
      db
        .from('project_api_keys')
        .select('scopes, last_seen_at, last_seen_origin, last_seen_user_agent')
        .eq('project_id', a.projectId)
        .eq('is_active', true),
      db.from('sdk_versions').select('package, version'),
      db
        .from('sdk_upgrade_jobs')
        .select('status, pr_url, pr_state, merged_at, check_run_status, check_run_conclusion')
        .eq('project_id', a.projectId)
        .eq('status', 'completed')
        .not('pr_url', 'is', null)
        // The same window and relevance rule the Update center uses (sdk-upgrade in-flight).
        .gte('finished_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      resolveRecipeRepo(db, a.projectId).catch((err): { ok: false; reason: string } => ({ ok: false, reason: reason(err) })),
    ])
    if (keysRes.error) return dbError(c, keysRes.error)
    const slug = (projectRes.data as { slug?: string } | null)?.slug ?? null

    // SDK keys only: a CLI or MCP key's calls are not the app's SDK.
    const keys = ((keysRes.data ?? []) as Array<KeyHeartbeat & { scopes?: string[] | null }>).filter((k) => isSdkKey(k.scopes))

    let packages: Read<PackageJsonFile[]>
    let ci: Read<string[]>
    let repoLabel: string | null = null
    const repoUrl = repoRes.ok ? repoRes.repo.repoUrl : null
    if (!repoRes.ok) {
      packages = { ok: false, reason: repoRes.reason }
      ci = { ok: false, reason: repoRes.reason }
    } else {
      repoLabel = repoLabelOf(repoRes.repo)
      const [read, names] = await Promise.allSettled([
        within(readRepo(repoRes.repo), REPO_READ_MS, 'Reading the repo'),
        within(listActionsNames(repoRes.repo), REPO_READ_MS, 'Listing Actions secrets'),
      ])
      packages = read.status === 'fulfilled' ? { ok: true, value: read.value.files } : { ok: false, reason: reason(read.reason) }
      // The names to expect depend on the framework, so an unread repo leaves them unknown.
      const stack = packages.ok ? resolveStack(slug, detectAppTarget(packages.value)?.stack) : null
      ci = names.status === 'rejected'
        ? { ok: false, reason: reason(names.reason) }
        : !stack
          ? { ok: false, reason: "the repo's package.json files could not be read, so the expected names are unknown" }
          : { ok: true, value: missingCiVars(requiredCiVarNames(stack), names.value) ?? [] }
    }

    let latest: Read<Record<string, string>>
    if (versionsRes.error) {
      latest = { ok: false, reason: versionsRes.error.message.slice(0, 160) }
    } else {
      const byPkg = new Map<string, Array<{ version: string }>>()
      for (const row of (versionsRes.data ?? []) as Array<{ package: string; version: string }>) {
        // Pre-releases are never the version an upgrade PR moves to.
        if (!row.version || /[-+]/.test(row.version)) continue
        byPkg.set(row.package, [...(byPkg.get(row.package) ?? []), row])
      }
      latest = { ok: true, value: Object.fromEntries([...byPkg].map(([pkg, rows]) => [pkg, pickHighestVersion(rows)!.version])) }
    }

    const result = sdkHealthProblems({
      repoLabel,
      packages,
      missingCiVars: ci,
      lastSeenAt: lastHeartbeatAt(keys),
      nativeEverSeen: nativeEverSeen(keys),
      sdkKeyCount: keys.length,
      openUpgradePr: openUpgradePr(upgradeRes.data as UpgradeJobRow | null),
      latest,
      csp: await cspRead,
      now: new Date(),
    })
    return c.json({ ok: true, data: { ...result, repoUrl, siteUrl: await site.catch(() => null), checkedAt: new Date().toISOString() } })
  })

  app.post('/v1/admin/projects/:id/sdk-health/tasks', jwtAuth, async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, true)
    if ('response' in a) return a.response
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown }
    const kind = body.kind
    if (typeof kind !== 'string' || !(SDK_HEALTH_TASK_KINDS as readonly string[]).includes(kind)) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: "kind must be 'install' or 'csp'." } }, 400)
    }
    const taskKind = kind as SdkHealthTaskKind

    const { data: open, error: openErr } = await db
      .from('reports')
      .select('id')
      .eq('project_id', a.projectId)
      .eq('source', 'sdk_health')
      .eq('component', taskComponent(taskKind))
      .in('status', OPEN_REPORT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
    if (openErr) return dbError(c, openErr)
    const existing = ((open ?? []) as Array<{ id: string }>)[0]
    if (existing) return c.json({ ok: true, data: { reportId: existing.id, existing: true } })

    const { data: project } = await db.from('projects').select('name, slug').eq('id', a.projectId).maybeSingle()
    const appName = (project as { name?: string } | null)?.name ?? 'this app'
    const slug = (project as { slug?: string } | null)?.slug ?? null
    const endpoint = mushiEndpoint()

    if (taskKind === 'install') {
      const res = await resolveRecipeRepo(db, a.projectId).catch((err): { ok: false; reason: string } => ({ ok: false, reason: reason(err) }))
      if (!res.ok) return c.json({ ok: false, error: { code: 'NO_REPO', message: `${res.reason} Connect the repo on the Connect page first.` } }, 412)
      let read: RepoRead
      try {
        read = await within(readRepo(res.repo), REPO_READ_MS, 'Reading the repo')
      } catch (err) {
        return c.json({ ok: false, error: { code: 'REPO_UNREADABLE', message: `Could not read the repo: ${reason(err)}` } }, 502)
      }
      if (mushiDeps(read.files).some((d) => isSdkPackage(d.name))) {
        return c.json({ ok: false, error: { code: 'ALREADY_INSTALLED', message: 'The repo already lists a @mushi-mushi package. Reload SDK health.' } }, 409)
      }
      return fileTask(c, db, a.projectId, taskKind, installTaskReport({
        appName,
        repoLabel: repoLabelOf(res.repo),
        repoUrl: res.repo.repoUrl,
        target: detectAppTarget(read.files),
        fallbackStack: resolveStack(slug, null),
        projectId: a.projectId,
        endpoint,
        workflows: read.workflows,
        commitSha: read.sha,
      }))
    }

    const csp = await readCsp(await siteUrl(db, a.projectId), endpoint)
    if (csp === null) return c.json({ ok: false, error: { code: 'NO_SITE', message: 'No live site address is known. Add it in Site watch first.' } }, 412)
    if (!csp.ok) return c.json({ ok: false, error: { code: 'SITE_UNREADABLE', message: csp.reason } }, 502)
    if (csp.value.verdict.allowed) {
      return c.json({ ok: false, error: { code: 'CSP_ALLOWS_API', message: "The site's policy already allows the Mushi API. Reload SDK health." } }, 409)
    }
    const repo = await resolveRecipeRepo(db, a.projectId).catch(() => null)
    return fileTask(c, db, a.projectId, taskKind, cspTaskReport({
      appName,
      repoLabel: repo?.ok ? repoLabelOf(repo.repo) : null,
      siteUrl: csp.value.url,
      apiOrigin: csp.value.apiOrigin,
      verdict: csp.value.verdict,
    }))
  })
}
