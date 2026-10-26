/**
 * FILE: packages/server/supabase/functions/_shared/setup-signals.ts
 * PURPOSE: One source of truth for "is integration X actually connected?" as
 *          the setup checklist, the onboarding lanes and the dispatch
 *          preflight report it.
 *
 * Why this exists: the setup checklist said "Add your Anthropic key" while
 * Settings showed an active, verified key, because each builder carried its
 * own copy of these checks and read only the legacy `project_settings`
 * columns. The same drift hid three more ways:
 *   - BYOK keys live in the `byok_keys` pool now; the legacy column is empty
 *     for every project that added a key after the pool shipped.
 *   - GitHub and Sentry credentials may be inherited from the org defaults
 *     (`organization_integration_settings`), exactly as /integrations shows.
 *   - Slack "connected" needs something that can post: a webhook, or a channel
 *     plus a bot token. A channel id alone posts nowhere.
 *
 * The derivation is pure so a test pins every rule; the loader batches the
 * reads for any number of projects (one query per table, not per project).
 */

import type { getServiceClient } from './db.ts'
import { isOperatorUser } from './operator-gate.ts'
import { universalKeysByOrg } from './byok-scope.ts'

type Db = ReturnType<typeof getServiceClient>

export interface ProjectIntegrationRow {
  github_repo_url?: string | null
  github_installation_token_ref?: string | null
  sentry_org_slug?: string | null
  sentry_auth_token_ref?: string | null
  byok_anthropic_key_ref?: string | null
  slack_channel_id?: string | null
  slack_webhook_url?: string | null
  slack_bot_token_ref?: string | null
}

export interface OrgIntegrationRow {
  github_repo_url?: string | null
  github_installation_token_ref?: string | null
  sentry_org_slug?: string | null
  sentry_auth_token_ref?: string | null
  slack_bot_token_ref?: string | null
}

export interface IntegrationSignalInput {
  settings: ProjectIntegrationRow | null
  org: OrgIntegrationRow | null
  /** project_repos rows for the project. */
  repos: ReadonlyArray<{ github_app_installation_id?: number | null }>
  /** byok_keys rows for provider `anthropic`. */
  anthropicPoolKeys: ReadonlyArray<{ status?: string | null; test_status?: string | null }>
  /** Host env credentials. Each is only a fallback, never the primary truth. */
  env: { githubToken: boolean; slackBotToken: boolean }
  /** The operator's env Slack bot may only serve projects the operator owns. */
  operatorProject: boolean
}

export interface IntegrationSignals {
  hasGithub: boolean
  hasSentry: boolean
  hasByok: boolean
  hasSlack: boolean
}

function present(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** A pooled key counts once it is active and its last test passed. */
export function isUsableAnthropicPoolKey(k: { status?: string | null; test_status?: string | null }): boolean {
  return k.status === 'active' && k.test_status === 'ok'
}

export function deriveIntegrationSignals(i: IntegrationSignalInput): IntegrationSignals {
  const s = i.settings ?? {}
  const o = i.org ?? {}

  // GitHub: a repo to patch AND a credential to patch it with — the same two
  // required fields the GitHub card on /integrations checks, plus the GitHub
  // App install on a project_repos row (resolveProjectGithubToken mints from it).
  const hasRepo = present(s.github_repo_url) || present(o.github_repo_url) || i.repos.length > 0
  const hasToken =
    present(s.github_installation_token_ref) ||
    present(o.github_installation_token_ref) ||
    i.repos.some((r) => (r.github_app_installation_id ?? 0) > 0) ||
    i.env.githubToken
  const hasGithub = hasRepo && hasToken

  // Sentry: org slug AND auth token (both required on the Sentry card).
  const hasSentry =
    (present(s.sentry_org_slug) || present(o.sentry_org_slug)) &&
    (present(s.sentry_auth_token_ref) || present(o.sentry_auth_token_ref))

  // Anthropic BYOK: the key pool is the current source; the legacy column
  // still counts for projects that never migrated.
  const hasByok = present(s.byok_anthropic_key_ref) || i.anthropicPoolKeys.some(isUsableAnthropicPoolKey)

  // Slack: something must be able to post. Mirrors test-slack's resolution.
  const hasBot =
    present(s.slack_bot_token_ref) ||
    present(o.slack_bot_token_ref) ||
    (i.env.slackBotToken && i.operatorProject)
  // The project must have chosen a channel: the operator's env default
  // channel is not this project's choice, and the Slack card would still
  // (rightly) say "Not connected", so the checklist must not count it.
  const hasChannel = present(s.slack_channel_id)
  const hasSlack = present(s.slack_webhook_url) || (hasBot && hasChannel)

  return { hasGithub, hasSentry, hasByok, hasSlack }
}

function envFlags(): IntegrationSignalInput['env'] {
  // Read lazily: a module-level Deno.env.get aborts permissionless test runs.
  const get = (name: string) => {
    try {
      return Boolean((globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name))
    } catch {
      return false
    }
  }
  return {
    githubToken: get('GITHUB_TOKEN'),
    slackBotToken: get('SLACK_BOT_TOKEN'),
  }
}

/**
 * Load and derive integration signals for many projects in one batch.
 * A failed read degrades that input to "absent" — it can only make a step
 * look incomplete, never fake a connection.
 */
export async function loadIntegrationSignals(
  db: Db,
  projectIds: string[],
): Promise<Map<string, IntegrationSignals>> {
  const out = new Map<string, IntegrationSignals>()
  if (projectIds.length === 0) return out

  const [projectsRes, settingsRes, reposRes, byokRes] = await Promise.all([
    db.from('projects').select('id, organization_id, owner_id').in('id', projectIds),
    db
      .from('project_settings')
      .select(
        'project_id, github_repo_url, github_installation_token_ref, sentry_org_slug, sentry_auth_token_ref, byok_anthropic_key_ref, slack_channel_id, slack_webhook_url, slack_bot_token_ref',
      )
      .in('project_id', projectIds),
    db.from('project_repos').select('project_id, github_app_installation_id').in('project_id', projectIds),
    db
      .from('byok_keys')
      .select('project_id, status, test_status')
      .in('project_id', projectIds)
      .eq('provider_slug', 'anthropic'),
  ])

  const projects = (projectsRes.data ?? []) as Array<{ id: string; organization_id: string | null; owner_id: string | null }>
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((v): v is string => Boolean(v)))]
  const [orgRes, orgByokRes, universalByOrg] = orgIds.length
    ? await Promise.all([
        db
          .from('organization_integration_settings')
          .select('organization_id, github_repo_url, github_installation_token_ref, sentry_org_slug, sentry_auth_token_ref, slack_bot_token_ref')
          .in('organization_id', orgIds),
        // An organization's shared Anthropic key counts for each of its apps (ADR 0023).
        db
          .from('byok_keys')
          .select('organization_id, status, test_status')
          .in('organization_id', orgIds)
          .eq('provider_slug', 'anthropic'),
        // So does a universal key of one of its owners (ADR 0031).
        universalKeysByOrg<{ owner_user_id: string; status: string | null; test_status: string | null }>(
          db as never,
          orgIds,
          'status, test_status',
          'anthropic',
        ),
      ])
    : [{ data: [] }, { data: [] }, new Map<string, Array<{ status: string | null; test_status: string | null }>>()]

  const settingsBy = new Map<string, ProjectIntegrationRow>()
  for (const r of (settingsRes.data ?? []) as Array<ProjectIntegrationRow & { project_id: string }>) {
    settingsBy.set(r.project_id, r)
  }
  const orgBy = new Map<string, OrgIntegrationRow>()
  for (const r of (orgRes.data ?? []) as Array<OrgIntegrationRow & { organization_id: string }>) {
    orgBy.set(r.organization_id, r)
  }
  const reposBy = new Map<string, Array<{ github_app_installation_id: number | null }>>()
  for (const r of (reposRes.data ?? []) as Array<{ project_id: string; github_app_installation_id: number | null }>) {
    const list = reposBy.get(r.project_id) ?? []
    list.push(r)
    reposBy.set(r.project_id, list)
  }
  const byokBy = new Map<string, Array<{ status: string | null; test_status: string | null }>>()
  for (const r of (byokRes.data ?? []) as Array<{ project_id: string; status: string | null; test_status: string | null }>) {
    const list = byokBy.get(r.project_id) ?? []
    list.push(r)
    byokBy.set(r.project_id, list)
  }
  const orgByokBy = new Map<string, Array<{ status: string | null; test_status: string | null }>>()
  for (const r of (orgByokRes.data ?? []) as Array<{ organization_id: string; status: string | null; test_status: string | null }>) {
    const list = orgByokBy.get(r.organization_id) ?? []
    list.push(r)
    orgByokBy.set(r.organization_id, list)
  }
  const projectBy = new Map(projects.map((p) => [p.id, p]))
  const env = envFlags()

  for (const pid of projectIds) {
    const p = projectBy.get(pid)
    out.set(
      pid,
      deriveIntegrationSignals({
        settings: settingsBy.get(pid) ?? null,
        org: p?.organization_id ? orgBy.get(p.organization_id) ?? null : null,
        repos: reposBy.get(pid) ?? [],
        anthropicPoolKeys: [
          ...(byokBy.get(pid) ?? []),
          ...(p?.organization_id ? orgByokBy.get(p.organization_id) ?? [] : []),
          ...(p?.organization_id ? universalByOrg.get(p.organization_id) ?? [] : []),
        ],
        env,
        operatorProject: isOperatorUser(p?.owner_id ?? null),
      }),
    )
  }
  return out
}

/**
 * project_codebase_files rows that are one live indexed file. The table also
 * holds a row per symbol chunk (symbol_name set) and tombstones for deleted
 * files, which outnumber the files by more than ten to one on a big repo.
 */
export const INDEXED_FILE_ROW = ['symbol_name', 'tombstoned_at']

/**
 * Exact per-project row counts. A shared `.limit(500)` across every project
 * let a busy project starve a quiet one, so a project with older reports read
 * as "no reports yet" and the Getting Started card showed a capped count.
 * One head-only count per project is exact and transfers no rows.
 */
export async function countRowsPerProject(
  db: Db,
  table: 'reports' | 'fix_attempts' | 'project_codebase_files',
  projectIds: string[],
  opts: { notNullColumn?: string; nullColumns?: string[]; strict?: boolean } = {},
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    projectIds.map(async (pid) => {
      let q = db.from(table).select('id', { count: 'exact', head: true }).eq('project_id', pid)
      if (opts.notNullColumn) q = q.not(opts.notNullColumn, 'is', null)
      for (const col of opts.nullColumns ?? []) q = q.is(col, null)
      const { count, error } = await q
      // strict: a failed count is an error, never a 0 that reads as "none".
      if (error && opts.strict) throw error
      return [pid, count ?? 0] as const
    }),
  )
  return new Map(counts)
}

/** The exact per-project counts the setup checklist and /projects show. */
export interface ProjectCounts {
  reports: number
  fixes: number
  mergedFixes: number
  indexedFiles: number
}

/**
 * Every project's counts in one round trip through `console_project_counts`
 * (migration 20261016100100). One /v1/admin/setup load used to send four head
 * counts per project, 52 requests for 13 projects. When the function is not
 * deployed yet, or the call fails, it falls back to those head counts.
 * `strict` (the /projects list) throws when a fallback count fails instead of
 * counting 0; the setup checklist keeps "a failed read only makes a step look
 * incomplete".
 */
export async function loadProjectCounts(
  db: Db,
  projectIds: string[],
  opts: { strict?: boolean } = {},
): Promise<Map<string, ProjectCounts>> {
  const out = new Map<string, ProjectCounts>()
  if (projectIds.length === 0) return out

  let data: unknown = null
  let error: { code?: string } | null = null
  try {
    ;({ data, error } = await db.rpc('console_project_counts', { p_project_ids: projectIds }))
  } catch (err) {
    error = { code: err instanceof Error ? err.name : 'THROWN' }
  }
  if (!error && Array.isArray(data)) {
    for (const r of data as Array<{
      project_id: string
      report_count: number | string | null
      fix_count: number | string | null
      merged_fix_count: number | string | null
      indexed_file_count: number | string | null
    }>) {
      out.set(r.project_id, {
        reports: Number(r.report_count ?? 0),
        fixes: Number(r.fix_count ?? 0),
        mergedFixes: Number(r.merged_fix_count ?? 0),
        indexedFiles: Number(r.indexed_file_count ?? 0),
      })
    }
    return out
  }

  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'console_project_counts unavailable — falling back to per-project head counts (apply migration 20261016100100)',
      code: error?.code ?? null,
    }),
  )
  const strict = opts.strict ?? false
  const [reports, fixes, mergedFixes, indexedFiles] = await Promise.all([
    countRowsPerProject(db, 'reports', projectIds, { strict }),
    countRowsPerProject(db, 'fix_attempts', projectIds, { strict }),
    countRowsPerProject(db, 'fix_attempts', projectIds, { notNullColumn: 'merged_at', strict }),
    // Head counts: a plain select is capped at the API's 1000-row limit.
    countRowsPerProject(db, 'project_codebase_files', projectIds, { nullColumns: INDEXED_FILE_ROW, strict }),
  ])
  for (const pid of projectIds) {
    out.set(pid, {
      reports: reports.get(pid) ?? 0,
      fixes: fixes.get(pid) ?? 0,
      mergedFixes: mergedFixes.get(pid) ?? 0,
      indexedFiles: indexedFiles.get(pid) ?? 0,
    })
  }
  return out
}

export interface SdkHeartbeat {
  last_seen_at: string
  last_seen_origin: string | null
  last_seen_user_agent: string | null
  last_seen_endpoint_host: string | null
}

/** Every signal a setup / onboarding step reads, for one project. */
export interface ProjectSetupSignals extends IntegrationSignals {
  hasKey: boolean
  /** Freshest heartbeat across the project's active keys. */
  heartbeat: SdkHeartbeat | null
  hasSdk: boolean
  reportCount: number
  fixCount: number
  mergedFixCount: number
  hasQaPassing: boolean
  indexedFileCount: number
}

/** Freshest heartbeat across key rows, compared as instants. */
export function freshestHeartbeat(
  keys: ReadonlyArray<{
    last_seen_at?: string | null
    last_seen_origin?: string | null
    last_seen_user_agent?: string | null
    last_seen_endpoint_host?: string | null
  }>,
): SdkHeartbeat | null {
  let best: SdkHeartbeat | null = null
  let bestAt = -Infinity
  for (const k of keys) {
    if (!k.last_seen_at) continue
    const at = Date.parse(k.last_seen_at)
    if (!Number.isFinite(at) || at <= bestAt) continue
    bestAt = at
    best = {
      last_seen_at: k.last_seen_at,
      last_seen_origin: k.last_seen_origin ?? null,
      last_seen_user_agent: k.last_seen_user_agent ?? null,
      last_seen_endpoint_host: k.last_seen_endpoint_host ?? null,
    }
  }
  return best
}

/**
 * The one loader behind `/v1/admin/setup`, `/v1/admin/onboarding/stats` and
 * `/v1/admin/activation`. They used to carry four copies of these reads, each
 * with its own caps and legacy columns, so the same project could be "done"
 * on one page and "missing" on the next.
 */
export async function loadProjectSetupSignals(
  db: Db,
  projectIds: string[],
): Promise<Map<string, ProjectSetupSignals>> {
  const out = new Map<string, ProjectSetupSignals>()
  if (projectIds.length === 0) return out

  const [
    keysRes,
    recentReportsRes,
    qaRes,
    observationsRes,
    integrationSignals,
    counts,
  ] = await Promise.all([
    db
      .from('project_api_keys')
      .select('project_id, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host')
      .in('project_id', projectIds)
      .eq('is_active', true),
    // Recent reports feed only the "a real SDK sent this" platform signal.
    db
      .from('reports')
      .select('project_id, environment')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(500),
    db
      .from('qa_stories')
      .select('project_id')
      .in('project_id', projectIds)
      .eq('last_run_status', 'passed'),
    // The curated SDK observation (heartbeat / report / repo scan): the same
    // source the Connect page's SDK version reads.
    db.from('project_sdk_observations').select('project_id').in('project_id', projectIds),
    loadIntegrationSignals(db, projectIds),
    loadProjectCounts(db, projectIds),
  ])

  const keysBy = new Map<string, Array<Record<string, string | null>>>()
  for (const k of (keysRes.data ?? []) as Array<Record<string, string | null> & { project_id: string }>) {
    const list = keysBy.get(k.project_id) ?? []
    list.push(k)
    keysBy.set(k.project_id, list)
  }
  const sdkReportSignal = new Set<string>()
  for (const r of (recentReportsRes.data ?? []) as Array<{ project_id: string; environment: unknown }>) {
    const env = (r.environment ?? {}) as Record<string, unknown>
    const platform = typeof env.platform === 'string' ? env.platform : ''
    if (platform && platform !== 'mushi-admin') sdkReportSignal.add(r.project_id)
  }
  const qaPassing = new Set((qaRes.data ?? []).map((q: { project_id: string }) => q.project_id))
  const observed = new Set((observationsRes.data ?? []).map((o: { project_id: string }) => o.project_id))

  for (const pid of projectIds) {
    const keys = keysBy.get(pid) ?? []
    const heartbeat = freshestHeartbeat(keys)
    const count = counts.get(pid)
    out.set(pid, {
      ...(integrationSignals.get(pid) ?? { hasGithub: false, hasSentry: false, hasByok: false, hasSlack: false }),
      hasKey: keys.length > 0,
      heartbeat,
      hasSdk: Boolean(heartbeat) || sdkReportSignal.has(pid) || observed.has(pid),
      reportCount: count?.reports ?? 0,
      fixCount: count?.fixes ?? 0,
      mergedFixCount: count?.mergedFixes ?? 0,
      hasQaPassing: qaPassing.has(pid),
      indexedFileCount: count?.indexedFiles ?? 0,
    })
  }
  return out
}

/** A probe older than this no longer proves a connection works (matches the console card). */
export const CONNECTION_VERIFIED_FRESH_MS = 7 * 24 * 60 * 60 * 1000

/**
 * sentry-seer-poll runs every 15 minutes (`8-53/15`). Three intervals without
 * a finished auto-import means the job stalled. Must match
 * SENTRY_AUTO_IMPORT_STALE_MS in apps/admin/src/lib/integrationConnection.ts.
 */
const SENTRY_AUTO_IMPORT_STALE_MS = 3 * 15 * 60 * 1000

/** True when the last auto-import finished within SENTRY_AUTO_IMPORT_STALE_MS. */
function sentryAutoImportRunFresh(lastRunAt: string | null | undefined, now: number): boolean {
  if (!lastRunAt) return false
  const at = Date.parse(lastRunAt)
  if (!Number.isFinite(at)) return false
  return now - at <= SENTRY_AUTO_IMPORT_STALE_MS
}

export type PlatformConnectionVerdict = 'working' | 'down' | 'attention'

/**
 * One configured platform connection → the verdict the /integrations banner
 * counts. Mirrors the console's ConnectionStatus rules so the banner can never
 * say "healthy" next to a card that says "Needs attention":
 *   - a failing probe is down;
 *   - no probe, or a probe older than 7 days, needs attention (not checked);
 *   - a connection that receives events (Sentry alerts) needs an accepted
 *     delivery, unless it imports by polling. Polling plus a fresh passing
 *     probe is working only when a poll finished within the last three
 *     15-minute intervals. No run yet, or an older run, is attention: the
 *     token probe does not prove the import is running. The latest delivery
 *     being rejected is still attention: a bad webhook secret is a real
 *     misconfiguration. Same rule as the console's sentryConnection.
 */
export function classifyPlatformConnection(input: {
  probeStatus: string | null | undefined
  probeCheckedAt: string | null | undefined
  needsInbound?: boolean
  inboundAccepted?: boolean
  /** Latest inbound delivery exists and was not accepted. */
  inboundRejected?: boolean
  /** Issues are imported on a poll, so a webhook delivery is optional. */
  inboundPolling?: boolean
  /** When the poll last finished. Ignored unless inboundPolling and there is no accepted delivery. */
  inboundPolledAt?: string | null
  now?: number
}): PlatformConnectionVerdict {
  const now = input.now ?? Date.now()
  if (input.probeStatus === 'down' || input.probeStatus === 'degraded') return 'down'
  const at = input.probeCheckedAt ? Date.parse(input.probeCheckedAt) : NaN
  if (input.probeStatus !== 'ok' || !Number.isFinite(at) || now - at > CONNECTION_VERIFIED_FRESH_MS) {
    return 'attention'
  }
  if (input.needsInbound && input.inboundRejected) return 'attention'
  if (input.needsInbound && !input.inboundAccepted && !input.inboundPolling) return 'attention'
  if (
    input.needsInbound &&
    input.inboundPolling &&
    !input.inboundAccepted &&
    !sentryAutoImportRunFresh(input.inboundPolledAt, now)
  ) {
    return 'attention'
  }
  return 'working'
}
