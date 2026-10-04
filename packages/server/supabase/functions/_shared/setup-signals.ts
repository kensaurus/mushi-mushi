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
  env: { githubToken: boolean; slackBotToken: boolean; slackChannelId: boolean }
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
  const hasChannel = present(s.slack_channel_id) || (i.env.slackChannelId && i.operatorProject && !present(s.slack_bot_token_ref))
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
    slackChannelId: get('SLACK_CHANNEL_ID'),
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
  const orgRes = orgIds.length
    ? await db
        .from('organization_integration_settings')
        .select('organization_id, github_repo_url, github_installation_token_ref, sentry_org_slug, sentry_auth_token_ref, slack_bot_token_ref')
        .in('organization_id', orgIds)
    : { data: [] }

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
        anthropicPoolKeys: byokBy.get(pid) ?? [],
        env,
        operatorProject: isOperatorUser(p?.owner_id ?? null),
      }),
    )
  }
  return out
}

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
  opts: { notNullColumn?: string } = {},
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    projectIds.map(async (pid) => {
      let q = db.from(table).select('id', { count: 'exact', head: true }).eq('project_id', pid)
      if (opts.notNullColumn) q = q.not(opts.notNullColumn, 'is', null)
      const { count } = await q
      return [pid, count ?? 0] as const
    }),
  )
  return new Map(counts)
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
    reportCounts,
    fixCounts,
    mergedFixCounts,
    fileCounts,
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
    countRowsPerProject(db, 'reports', projectIds),
    countRowsPerProject(db, 'fix_attempts', projectIds),
    countRowsPerProject(db, 'fix_attempts', projectIds, { notNullColumn: 'merged_at' }),
    // Head counts: a plain select is capped at the API's 1000-row limit.
    countRowsPerProject(db, 'project_codebase_files', projectIds),
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
    out.set(pid, {
      ...(integrationSignals.get(pid) ?? { hasGithub: false, hasSentry: false, hasByok: false, hasSlack: false }),
      hasKey: keys.length > 0,
      heartbeat,
      hasSdk: Boolean(heartbeat) || sdkReportSignal.has(pid) || observed.has(pid),
      reportCount: reportCounts.get(pid) ?? 0,
      fixCount: fixCounts.get(pid) ?? 0,
      mergedFixCount: mergedFixCounts.get(pid) ?? 0,
      hasQaPassing: qaPassing.has(pid),
      indexedFileCount: fileCounts.get(pid) ?? 0,
    })
  }
  return out
}
