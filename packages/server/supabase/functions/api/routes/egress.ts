/**
 * egress.ts — Verifiably local (Plan 023 Phase 0, ADR 0034).
 *
 *   GET  /v1/admin/egress/status     adminOrApiKey(mcp:read)
 *        { localOnly, allowlist, denials, integrations }: whether the
 *        local-only guard is on, what it allows, what it refused (per host,
 *        caller and day, last 30 days) and, per integration, where it would
 *        send data and whether the guard lets it.
 *   POST /v1/admin/egress/selftest   adminOrApiKey(mcp:write), non-viewers, 6/h per project
 *        Tries well-known cloud hosts from this edge runtime through the
 *        guarded fetch (3 s each) and reports each outcome. `passed` only
 *        when local-only is on and none was reachable. `mushi local verify`
 *        prints it next to the same attempts made from the host.
 *
 * Both answer `{ ok: true, data: … }` like every admin route.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import {
  activeEgressPolicy,
  checkEgress,
  describeAllowlist,
  isEgressBlockedError,
  type EgressPolicy,
} from '../../_shared/egress.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const elog = log.child('egress-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const EGRESS_SELFTESTS_PER_HOUR = 6
export const EGRESS_SELFTEST_TIMEOUT_MS = 3_000
export const EGRESS_DENIAL_DAYS = 30
/** Hosts the self-test tries. Each must fail when local-only mode works. */
export const EGRESS_SELFTEST_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'ollama.com',
  'sentry.io',
  'api.github.com',
  'registry.npmjs.org',
  'us.i.posthog.com',
  'api.cursor.com',
] as const

type Db = ReturnType<typeof getServiceClient>
type Env = Record<string, string | undefined>

export interface EgressDenial {
  host: string
  caller: string
  day: string
  count: number
  lastAt: string
}

export interface EgressIntegration {
  id: string
  label: string
  /** Where its traffic goes: a host, or a short description when it varies. */
  destination: string
  /** Configured (a key, URL or connection exists), so it would send traffic when used. */
  enabled: boolean
  /** The egress guard lets traffic to `destination` through (always true when local-only is off). */
  allowed: boolean
  note: string
}

export type SelftestOutcome = 'blocked_by_mushi' | 'network_unreachable' | 'reachable'
export interface SelftestResult {
  host: string
  outcome: SelftestOutcome
  ms: number
}

/** What the projects the caller can see have set up, for the integrations table. */
export interface EgressSettings {
  byok: Array<{ provider: string; baseUrl: string | null }>
  slack: boolean
  discord: boolean
  teams: boolean
  telegram: boolean
  storeConnectors: boolean
  storeReviewIntake: boolean
}

export const EMPTY_EGRESS_SETTINGS: EgressSettings = {
  byok: [],
  slack: false,
  discord: false,
  teams: false,
  telegram: false,
  storeConnectors: false,
  storeReviewIntake: false,
}

/** Env names the integrations table reads. Values never leave this module; only presence and hosts do. */
export const EGRESS_STATUS_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'MUSHI_EMBEDDING_BASE_URL',
  'MUSHI_EMBEDDING_MODEL',
  'CURSOR_API_KEY',
  'FIRECRAWL_API_KEY',
  'BROWSERBASE_API_KEY',
  'SENTRY_DSN_SERVER',
  'SENTRY_DSN',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_HOST',
  'STRIPE_SECRET_KEY',
  'RESEND_API_KEY',
  'SMTP_URL',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'SLACK_BOT_TOKEN',
  'OPERATOR_SLACK_WEBHOOK_URL',
  'OPERATOR_DISCORD_WEBHOOK_URL',
  'GITHUB_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_API_URL',
] as const

function readEnv(): Env {
  const out: Env = {}
  for (const name of EGRESS_STATUS_ENV) {
    try {
      out[name] = Deno.env.get(name) ?? undefined
    } catch {
      out[name] = undefined
    }
  }
  return out
}

/** `https://host[:port]/` for a URL-ish setting, or null when it does not parse. */
function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol === 'smtp:' || u.protocol === 'smtps:') return `smtp://${u.host}`
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

function hostLabel(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/**
 * The per-integration "what leaves" table. Pure: env, settings and the policy
 * in, rows out. One row per destination, so an Anthropic key on a local base
 * URL and another on api.anthropic.com show as two rows.
 */
export function buildEgressIntegrations(env: Env, settings: EgressSettings, policy: EgressPolicy): EgressIntegration[] {
  const rows: EgressIntegration[] = []
  const add = (id: string, label: string, origin: string, enabled: boolean, purpose: string): void => {
    const decision = checkEgress(origin.startsWith('smtp://') ? `http://${origin.slice(7)}` : origin, policy)
    const destination = hostLabel(origin)
    let note: string
    if (!policy.localOnly) note = enabled ? `${purpose} Sends to ${destination} when used.` : `${purpose} Not configured.`
    else if (decision.allowed) note = `${purpose} Allowed: ${decision.reason}.`
    else
      note = enabled
        ? `${purpose} Blocked: local-only mode is on and ${destination} is not on the egress allowlist.`
        : `${purpose} Not configured; it would be blocked in local-only mode.`
    rows.push({ id, label, destination, enabled, allowed: decision.allowed, note })
  }
  const byokOf = (provider: string) => settings.byok.filter((k) => k.provider === provider)
  const multi = (id: string, label: string, defaults: string, envOrigin: string | null, envEnabled: boolean, provider: string, purpose: string): void => {
    const keys = byokOf(provider)
    const platform = envOrigin ?? defaults
    const seen = new Set<string>()
    const keysOnPlatform = keys.some((k) => (originOf(k.baseUrl) ?? platform) === platform)
    add(id, label, platform, envEnabled || keysOnPlatform, purpose)
    seen.add(platform)
    for (const k of keys) {
      const origin = originOf(k.baseUrl)
      if (!origin || seen.has(origin)) continue
      seen.add(origin)
      add(`${id}@${hostLabel(origin)}`, `${label} (key base URL)`, origin, true, purpose)
    }
  }

  multi('anthropic', 'Anthropic (Claude)', 'https://api.anthropic.com', originOf(env.ANTHROPIC_BASE_URL), Boolean(env.ANTHROPIC_API_KEY), 'anthropic', 'Classification, fixes and reviews.')
  multi('openai', 'OpenAI-compatible', 'https://api.openai.com', originOf(env.OPENAI_BASE_URL), Boolean(env.OPENAI_API_KEY), 'openai', 'Fallback model calls.')
  add('openrouter', 'OpenRouter', 'https://openrouter.ai', Boolean(env.OPENROUTER_API_KEY) || byokOf('openrouter').length > 0, 'Fallback model calls through OpenRouter.')
  const embeddingOrigin = originOf(env.MUSHI_EMBEDDING_BASE_URL) ?? originOf(env.OPENAI_BASE_URL) ?? 'https://api.openai.com'
  add('embeddings', 'Embeddings', embeddingOrigin, Boolean(env.MUSHI_EMBEDDING_BASE_URL || env.OPENAI_API_KEY) || byokOf('openai').length > 0, 'Similar-bug search and codebase search.')
  add('cursor', 'Cursor cloud agents', 'https://api.cursor.com', Boolean(env.CURSOR_API_KEY) || byokOf('cursor').length > 0, 'Cloud fix agents.')
  add('firecrawl', 'Firecrawl', 'https://api.firecrawl.dev', Boolean(env.FIRECRAWL_API_KEY) || byokOf('firecrawl').length > 0, 'QA stories, story mapping, site watch.')
  add('browserbase', 'Browserbase', 'https://api.browserbase.com', Boolean(env.BROWSERBASE_API_KEY) || byokOf('browserbase').length > 0, 'QA stories in a cloud browser.')
  const sentryOrigin = originOf(env.SENTRY_DSN_SERVER ?? env.SENTRY_DSN) ?? 'https://sentry.io'
  add('sentry', 'Sentry (server errors)', sentryOrigin, Boolean(env.SENTRY_DSN_SERVER ?? env.SENTRY_DSN), "Mushi's own error reports; off when its host is blocked.")
  const langfuseOrigin = originOf(env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST) ?? 'https://cloud.langfuse.com'
  add('langfuse', 'Langfuse (LLM traces)', langfuseOrigin, Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY), 'LLM call traces.')
  add('stripe', 'Stripe', 'https://api.stripe.com', Boolean(env.STRIPE_SECRET_KEY), 'Billing (Mushi Cloud only).')
  const smtp = originOf(env.SMTP_URL)
  if (smtp) add('email', 'Email (SMTP)', smtp, true, 'Invites, digests and reporter emails.')
  else add('email', 'Email (Resend)', 'https://api.resend.com', Boolean(env.RESEND_API_KEY), 'Invites, digests and reporter emails.')
  add('web_push', 'Web push', 'https://fcm.googleapis.com', Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), 'Push notifications; each browser picks its push service (FCM, Apple, Mozilla).')
  add('slack', 'Slack', 'https://slack.com', Boolean(env.SLACK_BOT_TOKEN || env.OPERATOR_SLACK_WEBHOOK_URL) || settings.slack, 'Notifications and threads.')
  add('discord', 'Discord', 'https://discord.com', Boolean(env.OPERATOR_DISCORD_WEBHOOK_URL) || settings.discord, 'Notifications.')
  add('teams', 'Microsoft Teams', 'https://outlook.office.com', settings.teams, 'Notifications through a Teams webhook.')
  add('telegram', 'Telegram', 'https://api.telegram.org', settings.telegram, 'Voice and chat intake.')
  add('npm_registry', 'npm registry', 'https://registry.npmjs.org', true, 'SDK version catalog and upgrade PRs; skipped when blocked.')
  const githubOrigin = originOf(env.GITHUB_API_URL) ?? 'https://api.github.com'
  add('github', env.GITHUB_API_URL ? 'GitHub Enterprise Server' : 'GitHub', githubOrigin, true, 'Fix PRs, CI status and code indexing for connected repos.')
  add('radar', 'Radar public probes', 'https://crt.sh', true, 'Certificate, domain and store-listing checks (crt.sh, rdap.org, store pages); skipped when blocked.')
  add('store_connectors', 'App Store / Google Play', 'https://api.appstoreconnect.apple.com', settings.storeConnectors || settings.storeReviewIntake, 'Store reviews and listing reads; skipped when blocked.')
  return rows
}

export interface EgressRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  callerProjectIds: typeof callerProjectIds
  callerCanAccessProject: typeof callerCanAccessProject
  env: () => Env
  policy: () => EgressPolicy
  loadDenials: (db: Db, now: Date) => Promise<EgressDenial[]>
  loadSettings: (db: Db, projectIds: string[], userId: string) => Promise<EgressSettings>
  probe: (host: string) => Promise<SelftestResult>
  now: () => Date
}

export async function loadEgressDenials(db: Db, now: Date): Promise<EgressDenial[]> {
  const since = new Date(now.getTime() - EGRESS_DENIAL_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await db
    .from('egress_denials')
    .select('host, caller, day, count, last_at')
    .gte('day', since)
    .order('day', { ascending: false })
    .order('last_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ host: string; caller: string; day: string; count: number | string; last_at: string }>).map((r) => ({
    host: r.host,
    caller: r.caller,
    day: r.day,
    count: Number(r.count),
    lastAt: r.last_at,
  }))
}

/** Best effort: a table this deployment does not have reads as "not set up". */
export async function loadEgressSettings(db: Db, projectIds: string[], userId: string): Promise<EgressSettings> {
  if (projectIds.length === 0) return { ...EMPTY_EGRESS_SETTINGS }
  const out: EgressSettings = { ...EMPTY_EGRESS_SETTINGS, byok: [] }
  const orgIds = new Set<string>()
  const { data: projects } = await db.from('projects').select('organization_id').in('id', projectIds)
  for (const p of (projects ?? []) as Array<{ organization_id: string | null }>) if (p.organization_id) orgIds.add(p.organization_id)

  const filters = [`project_id.in.(${projectIds.join(',')})`]
  if (orgIds.size) filters.push(`organization_id.in.(${[...orgIds].join(',')})`)
  if (UUID_RE.test(userId)) filters.push(`owner_user_id.eq.${userId}`)
  const keys = await db.from('byok_keys').select('provider_slug, base_url, status').or(filters.join(','))
  if (!keys.error) {
    for (const k of (keys.data ?? []) as Array<{ provider_slug: string; base_url: string | null; status: string }>) {
      if (k.status === 'disabled') continue
      out.byok.push({ provider: k.provider_slug, baseUrl: k.base_url })
    }
  }
  const settings = await db
    .from('project_settings')
    .select('slack_webhook_url, slack_bot_token_ref, discord_webhook_url, teams_webhook_url, store_review_intake_enabled')
    .in('project_id', projectIds)
  if (!settings.error) {
    for (const s of (settings.data ?? []) as Array<Record<string, unknown>>) {
      if (s.slack_webhook_url || s.slack_bot_token_ref) out.slack = true
      if (s.discord_webhook_url) out.discord = true
      if (s.teams_webhook_url) out.teams = true
      if (s.store_review_intake_enabled === true) out.storeReviewIntake = true
    }
  }
  const telegram = await db.from('telegram_chat_bindings').select('project_id').in('project_id', projectIds).limit(1)
  if (!telegram.error && (telegram.data ?? []).length > 0) out.telegram = true
  if (orgIds.size) {
    const stores = await db
      .from('connector_instances')
      .select('kind')
      .in('organization_id', [...orgIds])
      .in('kind', ['app_store_connect', 'play_console'])
      .limit(1)
    if (!stores.error && (stores.data ?? []).length > 0) out.storeConnectors = true
  }
  return out
}

/**
 * One self-test attempt through the global (guarded) fetch. The guard's
 * refusal is `blocked_by_mushi`; a timeout, DNS failure or refused
 * connection is `network_unreachable` (the network-level block in the local
 * compose profile); any HTTP answer at all is `reachable`.
 */
export async function probeEgressHost(host: string, timeoutMs = EGRESS_SELFTEST_TIMEOUT_MS): Promise<SelftestResult> {
  const started = Date.now()
  try {
    const res = await fetch(`https://${host}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    await res.body?.cancel().catch(() => {})
    return { host, outcome: 'reachable', ms: Date.now() - started }
  } catch (err) {
    return { host, outcome: isEgressBlockedError(err) ? 'blocked_by_mushi' : 'network_unreachable', ms: Date.now() - started }
  }
}

export const defaultEgressRouteDeps: EgressRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  callerProjectIds,
  callerCanAccessProject,
  env: readEnv,
  policy: activeEgressPolicy,
  loadDenials: loadEgressDenials,
  loadSettings: loadEgressSettings,
  probe: (host) => probeEgressHost(host),
  now: () => new Date(),
}

export function registerEgressRoutes(app: Hono<{ Variables: Variables }>, deps: EgressRouteDeps = defaultEgressRouteDeps): void {
  app.get('/v1/admin/egress/status', deps.adminOrApiKeyRead, (c) => egressStatus(c, deps))
  app.post('/v1/admin/egress/selftest', deps.adminOrApiKeyWrite, (c) => egressSelftest(c, deps))
}

async function egressStatus(c: Context, deps: EgressRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const policy = deps.policy()
  let denials: EgressDenial[]
  try {
    denials = await deps.loadDenials(db, deps.now())
  } catch (err) {
    elog.error('egress denials read failed', { err: (err as Error).message })
    return jsonError(c, 'DB_ERROR', 'Could not read the egress denial log.', 500)
  }
  let settings = EMPTY_EGRESS_SETTINGS
  try {
    settings = await deps.loadSettings(db, await deps.callerProjectIds(c, db, userId), userId)
  } catch (err) {
    // The table still answers from env alone.
    elog.warn('egress settings read failed', { err: (err as Error).message })
  }
  return c.json({
    ok: true,
    data: {
      localOnly: policy.localOnly,
      allowlist: policy.localOnly ? describeAllowlist(policy) : [],
      denials,
      integrations: buildEgressIntegrations(deps.env(), settings, policy),
    },
  })
}

async function selftestProject(c: Context, deps: EgressRouteDeps, db: Db, userId: string): Promise<string | null> {
  const body = (await c.req.json().catch(() => ({}))) as { project_id?: unknown; projectId?: unknown }
  const requested =
    c.req.query('project_id') ??
    c.req.query('projectId') ??
    (typeof body.project_id === 'string' ? body.project_id : typeof body.projectId === 'string' ? body.projectId : null) ??
    ((c.get('projectId') as string | undefined) || null)
  if (requested) return requested
  const ids = await deps.callerProjectIds(c, db, userId)
  return ids[0] ?? null
}

async function egressSelftest(c: Context, deps: EgressRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const projectId = await selftestProject(c, deps, db, userId)
  if (!projectId) return jsonError(c, 'PROJECT_REQUIRED', 'Pass project_id: the self-test is rate limited per project.', 400)
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const access = await deps.callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const viewer = denyViewerWrite(c, access.role, 'run the egress self-test')
  if (viewer) return viewer

  const rate = await deps.claimRateLimit(db, `project:${projectId}:egress_selftest`, EGRESS_SELFTESTS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${EGRESS_SELFTESTS_PER_HOUR} egress self-tests an hour per project.`, 429)
  }

  const policy = deps.policy()
  const results = await Promise.all(EGRESS_SELFTEST_HOSTS.map((host) => deps.probe(host)))
  const passed = policy.localOnly && results.every((r) => r.outcome !== 'reachable')
  return c.json({ ok: true, data: { localOnly: policy.localOnly, results, passed } })
}
