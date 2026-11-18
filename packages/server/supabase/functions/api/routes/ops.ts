/**
 * ops.ts — the Ops hub (docs/execplans/ops-hub-slack.md). Served by `api-ext`;
 * `api` forwards these paths (_shared/edge-proxy.ts).
 *
 *   POST /v1/ops/events                         apiKeyAuth + scope ops:write, 120/min per app (fails closed)
 *        One operational event from an app's server: a payment, a release, an
 *        alert. Refused from a browser (the key is server-side only). zod
 *        bounds, https URLs only, 422 PII_REJECTED for an email or phone
 *        number. Answers 202 at once; Slack delivery runs under waitUntil.
 *        A repeated dedupe_key answers 200 with the stored event.
 *   GET  /v1/admin/ops/events?org=&project=&category=&severity=&unacked=1&before=&limit=   jwtAuth, org members
 *   POST /v1/admin/ops/events/:id/ack           jwtAuth, org members who are not viewers
 *   GET  /v1/admin/ops/coverage?org=            jwtAuth, org members: per app and category, when it last
 *        reported and how often in 7 days ("which app is silent"), today's counts, mutes
 *   GET  /v1/admin/ops/slack-settings?org=      jwtAuth, org members (secrets as set / not set only)
 *   PUT  /v1/admin/ops/slack-settings?org=      jwtAuth, owners and admins; secrets go to Vault
 *   POST /v1/admin/ops/slack-settings/test?org=&category=   jwtAuth, owners and admins: one test post per channel
 *   POST /v1/admin/projects/:id/ops-key         jwtAuth, non-viewers, 10/h: a NEW key with scopes
 *        exactly ['ops:write'], label `ops:<project-slug>`, plaintext shown once
 *   POST /v1/ops/slack/commands                 Slack slash command, signed with the org's own
 *        signing secret (found by team_id). help answers inline; everything that reads data acks
 *        at once and answers through response_url (Slack's 3 s limit).
 *   POST /v1/ops/slack/interactions             Slack buttons: Acknowledge, Mute 24h.
 *   POST /v1/internal/ops/sentry                service role only: a Sentry outcome forwarded
 *        by `api` (_shared/ops-forward.ts), so `api` never bundles the Ops emitter.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { apiKeyAuth, getOrgIdFromContext, jwtAuth, requireApiKeyScope, requireServiceRoleAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { mintProjectApiKey } from '../../_shared/api-key-mint.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit, claimTenantRateLimitStrict, logOrgAudit } from '../../_shared/tenant-observability.ts'
import { verifySlackRequest } from '../../_shared/slack-verify.ts'
import { createWebhookMiddleware, RateLimitError, ReplayAttackError } from '../../_shared/webhook-middleware.ts'
import {
  findEventPii,
  OPS_ACTION_ACK,
  OPS_ACTION_MUTE,
  OPS_BODY_MAX,
  OPS_CATEGORIES,
  OPS_FACT_LABEL_MAX,
  OPS_FACT_VALUE_MAX,
  OPS_FACTS_MAX,
  OPS_SEVERITIES,
  OPS_TITLE_MAX,
  parseOpsCommand,
  type OpsCategory,
  type OpsEventRow,
} from '../../_shared/ops-format.ts'
import {
  ackOpsEvent,
  channelFor,
  deliverOpsEvent,
  isMissingRelation,
  muteProject,
  OPS_EVENT_COLUMNS,
  OPS_SETTINGS_COLUMNS,
  readOpsSettings,
  readVaultSecret,
  recordOpsEvent,
  runInBackground,
  type OpsSettingsRow,
} from '../../_shared/ops-events.ts'
import { eph, openAlerts, runOpsCommand, type SlashReply } from '../../_shared/ops-commands.ts'
import { scheduleSentryOps, type SentryOpsInput } from '../../_shared/ops-sources.ts'
import { looksLikeBotToken, looksLikeSigningSecret, postSlackWebhook, slackApi, slackAuthTest, SLACK_WEBHOOK_HOST } from '../../_shared/ops-slack.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const olog = log.child('ops-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const OPS_INGEST_PER_MINUTE = 120
export const OPS_KEY_MINTS_PER_HOUR = 10
export const OPS_KEY_SCOPES = ['ops:write'] as const
export const OPS_FEED_MAX = 100
export const MUTE_BUTTON_MS = 24 * 60 * 60_000
/** An event may claim at most this far in the past or the future (clock skew). */
const OCCURRED_PAST_MS = 30 * 24 * 60 * 60_000
const OCCURRED_FUTURE_MS = 10 * 60_000

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>

type WebhookMiddlewareFactory = (source: 'slack') => {
  audit: (c: never, body: string, deliveryId: string | null) => Promise<{ id: string; resolve: (...args: unknown[]) => Promise<void> }>
  checkReplay: (auditId: string, deliveryId: string | null) => Promise<void>
  checkRateLimit: (ip: string | null) => void
}

export interface OpsRouteDeps {
  getServiceClient: () => Db
  apiKeyAuth: MiddlewareHandler
  /** After apiKeyAuth: the key must carry ops:write (and not come from a browser). */
  requireOpsScope: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  claimRateLimitStrict: typeof claimTenantRateLimitStrict
  claimRateLimit: typeof claimTenantRateLimit
  callerCanAccessProject: typeof callerCanAccessProject
  mintKey: typeof mintProjectApiKey
  logAudit: typeof logAudit
  logOrgAudit: typeof logOrgAudit
  verifySlack: typeof verifySlackRequest
  webhookMiddleware: WebhookMiddlewareFactory
  runInBackground: (p: Promise<unknown>) => void
  fetchImpl?: typeof fetch
  now: () => Date
  /** Console base URL (ADMIN_BASE_URL), for links in Slack. */
  adminBaseUrl: () => string | null
  /** This project's public Supabase URL, for the Request URLs to paste into Slack. */
  supabaseUrl: () => string | null
  /**
   * The database's region (MUSHI_FUNCTION_REGION, e.g. ap-northeast-1). Slack calls
   * from the US, so without it the function runs in a US region and every database
   * step crosses the ocean: 3.8 to 5 s, past Slack's 3 s limit (measured 2026-11-18).
   * When set, the Request URLs carry ?forceFunctionRegion=<region>.
   */
  functionRegion: () => string | null
}

function env(name: string): string | null {
  try {
    const v = (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name)
    return v ? v.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

export const defaultOpsRouteDeps: OpsRouteDeps = {
  getServiceClient,
  apiKeyAuth: apiKeyAuth as MiddlewareHandler,
  requireOpsScope: requireApiKeyScope('ops:write') as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  claimRateLimitStrict: claimTenantRateLimitStrict,
  claimRateLimit: claimTenantRateLimit,
  callerCanAccessProject,
  mintKey: mintProjectApiKey,
  logAudit,
  logOrgAudit,
  verifySlack: verifySlackRequest,
  webhookMiddleware: createWebhookMiddleware as unknown as WebhookMiddlewareFactory,
  runInBackground,
  now: () => new Date(),
  adminBaseUrl: () => env('ADMIN_BASE_URL'),
  supabaseUrl: () => env('SUPABASE_URL'),
  functionRegion: () => {
    const r = env('MUSHI_FUNCTION_REGION')
    return r && /^[a-z]{2}-[a-z]+-\d$/.test(r) ? r : null
  },
}

// ── schemas ─────────────────────────────────────────────────────────────────

const httpsUrl = z.string().max(2000).url().refine((u) => /^https:\/\//i.test(u), 'must be an https URL')

/** @internal Exported for tests. */
export const opsEventSchema = z
  .object({
    category: z.enum(OPS_CATEGORIES),
    severity: z.enum(OPS_SEVERITIES).default('info'),
    kind: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/, 'like payment.succeeded').max(60),
    title: z.string().trim().min(1).max(OPS_TITLE_MAX),
    body: z.string().trim().max(OPS_BODY_MAX).optional(),
    facts: z
      .array(z.object({ label: z.string().trim().min(1).max(OPS_FACT_LABEL_MAX), value: z.string().trim().min(1).max(OPS_FACT_VALUE_MAX) }).strict())
      .max(OPS_FACTS_MAX)
      .optional(),
    url: httpsUrl.optional(),
    amount_minor: z.number().int().safe().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code such as JPY').optional(),
    thread_key: z.string().trim().min(1).max(200).optional(),
    dedupe_key: z.string().trim().min(1).max(200).optional(),
    occurred_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => (v.amount_minor == null) === (v.currency == null), { message: 'amount_minor and currency go together', path: ['currency'] })

const channelId = z.string().regex(/^[CG][A-Z0-9]{2,20}$/, 'a channel id such as C0123ABCD (right-click the channel → Copy link)')

/** @internal Exported for tests. */
export const opsSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    botToken: z.string().trim().max(300).optional(),
    signingSecret: z.string().trim().max(100).optional(),
    webhooks: z.object({ payments: z.string().trim().max(500), releases: z.string().trim().max(500), alerts: z.string().trim().max(500) }).partial().strict().optional(),
    channels: z.object({ payments: channelId.nullable(), releases: channelId.nullable(), alerts: channelId.nullable() }).partial().strict().optional(),
    command: z.string().regex(/^\/[a-z0-9][a-z0-9_-]{0,31}$/, 'a slash command such as /kensaurus').optional(),
    iconBaseUrl: z.string().max(500).url().refine((u) => /^https:\/\//i.test(u), 'must be an https URL').nullable().optional(),
  })
  .strict()

function issues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ').slice(0, 500)
}

// ── registration ────────────────────────────────────────────────────────────

export function registerOpsRoutes(app: Hono<{ Variables: Variables }>, deps: OpsRouteDeps = defaultOpsRouteDeps): void {
  app.post('/v1/ops/events', deps.apiKeyAuth, deps.requireOpsScope, (c) => ingestEvent(c as Ctx, deps))
  app.get('/v1/admin/ops/events', deps.jwtAuth, (c) => listEvents(c as Ctx, deps))
  app.post('/v1/admin/ops/events/:id/ack', deps.jwtAuth, (c) => ackEvent(c as Ctx, deps))
  app.get('/v1/admin/ops/coverage', deps.jwtAuth, (c) => coverage(c as Ctx, deps))
  app.get('/v1/admin/ops/slack-settings', deps.jwtAuth, (c) => getSettings(c as Ctx, deps))
  app.put('/v1/admin/ops/slack-settings', deps.jwtAuth, (c) => putSettings(c as Ctx, deps))
  app.post('/v1/admin/ops/slack-settings/test', deps.jwtAuth, (c) => testSettings(c as Ctx, deps))
  app.post('/v1/admin/projects/:id/ops-key', deps.jwtAuth, (c) => mintOpsKey(c as Ctx, deps))
  app.post('/v1/ops/slack/commands', (c) => slackCommand(c as Ctx, deps))
  app.post('/v1/ops/slack/interactions', (c) => slackInteraction(c as Ctx, deps))
  // Sentry outcomes forwarded by `api` (_shared/ops-forward.ts): service role only.
  // The literal path (route manifest and api-ext parity read it); equals OPS_SENTRY_PATH (ops-forward.test.ts).
  app.post('/v1/internal/ops/sentry', (c) => internalSentry(c as Ctx, deps))
}

async function internalSentry(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const denied = requireServiceRoleAuth(c.req.raw)
  if (denied) return denied
  const body = (await c.req.json().catch(() => null)) as { projectId?: unknown; sentry?: SentryOpsInput } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!UUID_RE.test(projectId) || !body?.sentry || typeof body.sentry !== 'object') return jsonError(c, 'VALIDATION_ERROR', 'projectId and sentry are required', 400)
  const s = body.sentry
  const outcome = s.outcome === 'created' || s.outcome === 'reopened' || s.outcome === 'resolved' ? s.outcome : null
  if (!outcome) return jsonError(c, 'VALIDATION_ERROR', 'sentry.outcome is created, reopened or resolved', 400)
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null)
  scheduleSentryOps(deps.getServiceClient() as never, projectId, {
    outcome,
    issueId: str(s.issueId, 40),
    title: str(s.title, 300),
    culprit: str(s.culprit, 300),
    level: str(s.level, 20),
    environment: str(s.environment, 60),
    release: str(s.release, 100),
    url: str(s.url, 2000),
    firstSeen: str(s.firstSeen, 40),
    regressionCount: typeof s.regressionCount === 'number' && Number.isFinite(s.regressionCount) ? s.regressionCount : undefined,
  })
  return c.json({ ok: true }, 202)
}

// ── ingest ──────────────────────────────────────────────────────────────────

async function ingestEvent(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const projectId = c.get('projectId') as string | null | undefined
  if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use an ops key bound to one app (Projects → Ops key).', 400)
  const db = deps.getServiceClient()
  const rate = await deps.claimRateLimitStrict(db as never, `project:${projectId}:ops_ingest`, OPS_INGEST_PER_MINUTE, 60)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 60))
    return rate.unavailable
      ? jsonError(c, 'RATE_LIMIT_UNAVAILABLE', 'Mushi Mushi could not check the rate limit. Retry shortly.', 503)
      : jsonError(c, 'RATE_LIMITED', `At most ${OPS_INGEST_PER_MINUTE} events a minute per app. Retry in a minute.`, 429)
  }
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON', 400)
  }
  const parsed = opsEventSchema.safeParse(raw)
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
  const b = parsed.data
  const pii = findEventPii({ title: b.title, body: b.body, facts: b.facts })
  if (pii) {
    return jsonError(c, 'PII_REJECTED', `${pii.field} looks like it carries ${pii.kind === 'email' ? 'an email address' : 'a phone number'}. Ops events must not carry personal data: send the email's domain or an id instead.`, 422, { field: pii.field })
  }
  const now = deps.now()
  if (b.occurred_at) {
    const at = Date.parse(b.occurred_at)
    if (at > now.getTime() + OCCURRED_FUTURE_MS || at < now.getTime() - OCCURRED_PAST_MS) {
      return jsonError(c, 'VALIDATION_ERROR', 'occurred_at must be within the last 30 days and not in the future.', 400)
    }
  }

  const { data: project, error: projErr } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (projErr) return jsonError(c, 'DB_ERROR', 'Could not read the app.', 500)
  const orgId = (project as { organization_id?: string | null } | null)?.organization_id
  if (!orgId) return jsonError(c, 'NO_ORGANIZATION', 'This app belongs to no team, so it has no Ops hub.', 409)

  const recorded = await recordOpsEvent(
    db as never,
    {
      organizationId: orgId,
      projectId,
      input: {
        category: b.category,
        severity: b.severity,
        kind: b.kind,
        title: b.title,
        body: b.body ?? null,
        facts: b.facts,
        url: b.url ?? null,
        amountMinor: b.amount_minor ?? null,
        currency: b.currency ?? null,
        threadKey: b.thread_key ?? null,
        dedupeKey: b.dedupe_key ?? null,
        occurredAt: b.occurred_at ? new Date(b.occurred_at).toISOString() : null,
        source: 'app',
      },
    },
    { now: deps.now },
  )
  if (recorded.status === 'error') {
    if (recorded.missing) return jsonError(c, 'MIGRATION_PENDING', 'The Ops hub is waiting for database update 20261117120000_ops_hub.', 409)
    olog.error('ops event insert failed', { projectId, err: recorded.error })
    return jsonError(c, 'DB_ERROR', 'The event could not be stored.', 500)
  }
  if (recorded.status === 'duplicate') {
    return c.json({ ok: true, data: { id: recorded.event.id, status: 'duplicate' } }, 200)
  }
  deps.runInBackground(
    deliverOpsEvent(db as never, recorded.event, { fetchImpl: deps.fetchImpl, now: deps.now, adminBaseUrl: deps.adminBaseUrl() }).catch((err) =>
      olog.error('ops delivery failed', { id: recorded.event.id, err: String(err).slice(0, 200) }),
    ),
  )
  return c.json({ ok: true, data: { id: recorded.event.id, status: 'created' } }, 202)
}

// ── org access ──────────────────────────────────────────────────────────────

async function orgRole(db: Db, orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(`organization_members read failed: ${error.message}`)
  return (data as { role?: string } | null)?.role ?? null
}

/** The org from `?org=` (or the console's X-Mushi-Org-Id) and the caller's role in it. */
async function resolveOrg(c: Ctx, db: Db): Promise<{ orgId: string; role: string } | { response: Response }> {
  const orgId = c.req.query('org') ?? c.req.query('organization_id') ?? getOrgIdFromContext(c)
  if (!orgId || !UUID_RE.test(orgId)) return { response: jsonError(c, 'ORG_REQUIRED', 'Pass the team as ?org=<uuid>.', 400) }
  let role: string | null
  try {
    role = await orgRole(db, orgId, c.get('userId') as string)
  } catch {
    return { response: jsonError(c, 'DB_ERROR', 'Could not read your team membership.', 500) }
  }
  if (!role) return { response: jsonError(c, 'FORBIDDEN', 'You are not a member of this team.', 403) }
  return { orgId, role }
}

const canManage = (role: string) => role === 'owner' || role === 'admin'

// ── feed ────────────────────────────────────────────────────────────────────

async function listEvents(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolveOrg(c, db)
  if ('response' in org) return org.response
  const project = c.req.query('project')
  const category = c.req.query('category')
  const severity = c.req.query('severity')
  const before = c.req.query('before')
  const limitRaw = Number(c.req.query('limit') ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(OPS_FEED_MAX, Math.max(1, Math.round(limitRaw))) : 50
  if (project && !UUID_RE.test(project)) return jsonError(c, 'VALIDATION_ERROR', 'project must be a uuid', 400)
  if (category && !(OPS_CATEGORIES as readonly string[]).includes(category)) return jsonError(c, 'VALIDATION_ERROR', 'category is payments, releases or alerts', 400)
  if (severity && !(OPS_SEVERITIES as readonly string[]).includes(severity)) return jsonError(c, 'VALIDATION_ERROR', 'severity is info, warn, urgent or resolved', 400)
  if (before && !Number.isFinite(Date.parse(before))) return jsonError(c, 'VALIDATION_ERROR', 'before must be an ISO time', 400)

  let q = db.from('ops_events').select(OPS_EVENT_COLUMNS).eq('organization_id', org.orgId)
  if (project) q = q.eq('project_id', project)
  if (category) q = q.eq('category', category)
  if (severity) q = q.eq('severity', severity)
  if (c.req.query('unacked') === '1') q = q.is('acked_at', null).neq('severity', 'resolved')
  if (before) q = q.lt('occurred_at', new Date(before).toISOString())
  const { data, error } = await q.order('occurred_at', { ascending: false }).limit(limit + 1)
  if (error) {
    if (isMissingRelation(error)) return jsonError(c, 'MIGRATION_PENDING', 'The Ops hub is waiting for database update 20261117120000_ops_hub.', 409)
    return jsonError(c, 'DB_ERROR', 'Could not read the Ops feed.', 500)
  }
  const rows = (data as OpsEventRow[] | null) ?? []
  const page = rows.slice(0, limit)
  const apps = await orgApps(db, org.orgId)
  return c.json({
    ok: true,
    data: {
      events: page,
      apps,
      nextBefore: rows.length > limit ? page[page.length - 1]?.occurred_at ?? null : null,
      canAck: org.role !== 'viewer',
    },
  })
}

async function orgApps(db: Db, orgId: string): Promise<Array<{ id: string; name: string | null; slug: string | null; icon_url: string | null }>> {
  const { data } = await db.from('projects').select('id, name, slug, icon_url').eq('organization_id', orgId).order('name', { ascending: true }).limit(200)
  return (data as Array<{ id: string; name: string | null; slug: string | null; icon_url: string | null }> | null) ?? []
}

async function ackEvent(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const db = deps.getServiceClient()
  const { data, error } = await db.from('ops_events').select(OPS_EVENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) return jsonError(c, 'DB_ERROR', 'Could not read the event.', 500)
  const event = data as OpsEventRow | null
  if (!event) return jsonError(c, 'NOT_FOUND', 'Event not found', 404)
  let role: string | null
  try {
    role = await orgRole(db, event.organization_id, c.get('userId') as string)
  } catch {
    return jsonError(c, 'DB_ERROR', 'Could not read your team membership.', 500)
  }
  if (!role) return jsonError(c, 'NOT_FOUND', 'Event not found', 404)
  const viewer = denyViewerWrite(c, role, 'acknowledge alerts')
  if (viewer) return viewer
  const now = deps.now()
  // The DB write is quick; the Slack ✅ and the thread reply run after the answer.
  const done = ackOpsEvent(db as never, event, { id: 'console', mention: 'someone in Mushi Mushi' }, { fetchImpl: deps.fetchImpl, now: deps.now })
  deps.runInBackground(done)
  const res = await done
  if (!res.ok) return jsonError(c, 'DB_ERROR', 'The event could not be acknowledged.', 500)
  return c.json({ ok: true, data: { id, acked_at: res.already ? event.acked_at : now.toISOString(), already: res.already } })
}

// ── coverage ────────────────────────────────────────────────────────────────

interface CoverageRpcRow {
  project_id: string
  category: string
  last_at: string | null
  count_7d: number | string
}

async function coverage(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolveOrg(c, db)
  if ('response' in org) return org.response
  const now = deps.now()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  const [apps, cov, today, alerts, mutes, settings] = await Promise.all([
    orgApps(db, org.orgId),
    db.rpc('ops_coverage', { p_organization_id: org.orgId }),
    db.from('ops_events').select('category, kind, amount_minor, currency').eq('organization_id', org.orgId).gte('occurred_at', dayStart).limit(10_000),
    db.from('ops_events').select('severity, thread_key, acked_at, occurred_at').eq('organization_id', org.orgId).eq('category', 'alerts').gte('occurred_at', new Date(now.getTime() - 7 * 86_400_000).toISOString()).limit(2000),
    db.from('ops_mutes').select('project_id, until, muted_by').eq('organization_id', org.orgId),
    readOpsSettings(db as never, org.orgId),
  ])
  for (const r of [cov, today, alerts, mutes]) {
    if (r.error) {
      if (isMissingRelation(r.error)) return jsonError(c, 'MIGRATION_PENDING', 'The Ops hub is waiting for database update 20261117120000_ops_hub.', 409)
      return jsonError(c, 'DB_ERROR', 'Could not read Ops coverage.', 500)
    }
  }
  const payments: Record<string, number> = {}
  let releases = 0
  for (const e of (today.data as Array<{ category: string; kind: string; amount_minor: number | null; currency: string | null }> | null) ?? []) {
    if (e.category === 'releases') releases++
    if (e.category === 'payments' && e.amount_minor != null && e.currency) {
      const refund = /refund|chargeback|reversal/i.test(e.kind)
      payments[e.currency] = (payments[e.currency] ?? 0) + (refund ? -Math.abs(e.amount_minor) : Math.abs(e.amount_minor))
    }
  }
  const alertRows = (alerts.data as Array<{ severity: OpsEventRow['severity']; thread_key: string | null; acked_at: string | null; occurred_at: string }> | null) ?? []
  const openCount = openAlerts(alertRows).length
  return c.json({
    ok: true,
    data: {
      apps,
      coverage: ((cov.data as CoverageRpcRow[] | null) ?? []).map((r) => ({ ...r, count_7d: Number(r.count_7d) || 0 })),
      today: { payments, releases, openAlerts: openCount, since: dayStart },
      mutes: ((mutes.data as Array<{ project_id: string; until: string }> | null) ?? []).filter((m) => Date.parse(m.until) > now.getTime()),
      slack: { enabled: settings.ok ? Boolean(settings.row?.enabled) : false },
    },
  })
}

// ── Slack settings ──────────────────────────────────────────────────────────

function settingsView(row: OpsSettingsRow | null, role: string, deps: OpsRouteDeps) {
  const base = deps.supabaseUrl()
  const region = deps.functionRegion()
  const regionQuery = region ? `?forceFunctionRegion=${region}` : ''
  return {
    enabled: row?.enabled ?? false,
    teamId: row?.team_id ?? null,
    botUserId: row?.bot_user_id ?? null,
    botToken: Boolean(row?.bot_token_secret_id),
    signingSecret: Boolean(row?.signing_secret_id),
    webhooks: {
      payments: Boolean(row?.payments_webhook_secret_id),
      releases: Boolean(row?.releases_webhook_secret_id),
      alerts: Boolean(row?.alerts_webhook_secret_id),
    },
    channels: { payments: row?.channel_payments ?? null, releases: row?.channel_releases ?? null, alerts: row?.channel_alerts ?? null },
    command: row?.command ?? '/mushi-ops',
    iconBaseUrl: row?.icon_base_url ?? null,
    updatedAt: row?.updated_at ?? null,
    requestUrls: base
      ? { commands: `${base}/functions/v1/api/v1/ops/slack/commands${regionQuery}`, interactions: `${base}/functions/v1/api/v1/ops/slack/interactions${regionQuery}` }
      : null,
    canEdit: canManage(role),
  }
}

async function getSettings(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolveOrg(c, db)
  if ('response' in org) return org.response
  const read = await readOpsSettings(db as never, org.orgId)
  if (!read.ok) {
    if (read.missing) return jsonError(c, 'MIGRATION_PENDING', 'The Ops hub is waiting for database update 20261117120000_ops_hub.', 409)
    return jsonError(c, 'DB_ERROR', 'Could not read the Slack settings.', 500)
  }
  return c.json({ ok: true, data: settingsView(read.row, org.role, deps) })
}

async function storeSecret(db: Db, orgId: string, kind: string, value: string): Promise<string> {
  const { data, error } = await db.rpc('vault_store_secret', { secret_name: `mushi/ops/${orgId}/${kind}`, secret_value: value })
  if (error || typeof data !== 'string') throw new Error(`vault_store_secret failed for ${kind}`)
  return data
}

async function putSettings(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolveOrg(c, db)
  if ('response' in org) return org.response
  if (!canManage(org.role)) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can change the Slack bot.', 403)
  const parsed = opsSettingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
  const body = parsed.data
  const read = await readOpsSettings(db as never, org.orgId)
  if (!read.ok) {
    if (read.missing) return jsonError(c, 'MIGRATION_PENDING', 'The Ops hub is waiting for database update 20261117120000_ops_hub.', 409)
    return jsonError(c, 'DB_ERROR', 'Could not read the Slack settings.', 500)
  }
  const prior = read.row
  const patch: Record<string, unknown> = { organization_id: org.orgId, updated_at: deps.now().toISOString(), updated_by: c.get('userId') as string }
  const changed: string[] = []

  try {
    if (body.botToken !== undefined) {
      if (body.botToken === '') {
        patch.bot_token_secret_id = null
      } else {
        if (!looksLikeBotToken(body.botToken)) return jsonError(c, 'VALIDATION_ERROR', 'botToken: a bot token starts with xoxb- (Slack app → OAuth & Permissions).', 400)
        const who = await slackAuthTest(body.botToken, { fetchImpl: deps.fetchImpl })
        if (!who.ok) return jsonError(c, 'BOT_TOKEN_REJECTED', `Slack refused the bot token (${who.error}).`, 400)
        const { data: other } = await db.from('ops_slack_settings').select('organization_id').eq('team_id', who.team_id).neq('organization_id', org.orgId).maybeSingle()
        if (other) return jsonError(c, 'TEAM_IN_USE', 'This Slack workspace is already connected to another Mushi Mushi team.', 409)
        patch.bot_token_secret_id = await storeSecret(db, org.orgId, 'bot_token', body.botToken)
        patch.team_id = who.team_id
        patch.bot_user_id = who.user_id
      }
      changed.push('botToken')
    }
    if (body.signingSecret !== undefined) {
      if (body.signingSecret === '') patch.signing_secret_id = null
      else {
        if (!looksLikeSigningSecret(body.signingSecret)) return jsonError(c, 'VALIDATION_ERROR', 'signingSecret: the signing secret is 32 hex characters (Slack app → Basic Information).', 400)
        patch.signing_secret_id = await storeSecret(db, org.orgId, 'signing_secret', body.signingSecret)
      }
      changed.push('signingSecret')
    }
    for (const cat of OPS_CATEGORIES) {
      const v = body.webhooks?.[cat]
      if (v === undefined) continue
      if (v === '') patch[`${cat}_webhook_secret_id`] = null
      else {
        let host = ''
        try {
          host = new URL(v).host
        } catch {
          host = ''
        }
        if (host !== SLACK_WEBHOOK_HOST || !v.startsWith('https://')) return jsonError(c, 'VALIDATION_ERROR', `webhooks.${cat}: an incoming webhook URL starts with https://hooks.slack.com/.`, 400)
        patch[`${cat}_webhook_secret_id`] = await storeSecret(db, org.orgId, `${cat}_webhook`, v)
      }
      changed.push(`webhooks.${cat}`)
    }
  } catch (err) {
    olog.error('ops settings vault write failed', { orgId: org.orgId, err: String(err).slice(0, 200) })
    return jsonError(c, 'VAULT_ERROR', 'The secret could not be saved. Nothing was changed.', 500)
  }
  for (const cat of OPS_CATEGORIES) {
    const v = body.channels?.[cat]
    if (v === undefined) continue
    patch[`channel_${cat}`] = v
    changed.push(`channels.${cat}`)
  }
  if (body.command !== undefined) {
    patch.command = body.command
    changed.push('command')
  }
  if (body.iconBaseUrl !== undefined) {
    patch.icon_base_url = body.iconBaseUrl
    changed.push('iconBaseUrl')
  }
  if (body.enabled !== undefined) {
    patch.enabled = body.enabled
    changed.push('enabled')
  }

  const { data, error } = await db.from('ops_slack_settings').upsert(patch, { onConflict: 'organization_id' }).select(OPS_SETTINGS_COLUMNS).single()
  if (error) {
    if (error.code === '23505') return jsonError(c, 'TEAM_IN_USE', 'This Slack workspace is already connected to another Mushi Mushi team.', 409)
    olog.error('ops settings save failed', { orgId: org.orgId, err: error.message })
    return jsonError(c, 'DB_ERROR', 'The Slack settings could not be saved.', 500)
  }
  void deps
    .logOrgAudit(db as never, {
      organizationId: org.orgId,
      actorId: c.get('userId') as string,
      action: 'settings.updated',
      resourceType: 'ops_slack_settings',
      resourceId: org.orgId,
      metadata: { changed, first_save: !prior },
    })
    .catch(() => {})
  return c.json({ ok: true, data: settingsView(data as OpsSettingsRow, org.role, deps) })
}

async function testSettings(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolveOrg(c, db)
  if ('response' in org) return org.response
  if (!canManage(org.role)) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can test the Slack bot.', 403)
  const only = c.req.query('category')
  if (only && !(OPS_CATEGORIES as readonly string[]).includes(only)) return jsonError(c, 'VALIDATION_ERROR', 'category is payments, releases or alerts', 400)
  const rate = await deps.claimRateLimit(db as never, `org:${org.orgId}:ops_slack_test`, 20, 3600)
  if (!rate.allowed) return jsonError(c, 'RATE_LIMITED', 'At most 20 test posts an hour.', 429)
  const read = await readOpsSettings(db as never, org.orgId)
  if (!read.ok || !read.row) return jsonError(c, 'NOT_CONFIGURED', 'Save the bot token and channels first.', 409)
  const row = read.row
  const token = await readVaultSecret(db as never, row.bot_token_secret_id)
  const cats = (only ? [only] : OPS_CATEGORIES) as OpsCategory[]
  const results: Array<{ category: OpsCategory; ok: boolean; via: 'bot' | 'webhook' | null; error?: string }> = []
  for (const cat of cats) {
    const text = `✅ Mushi Mushi can post here: this is the ${cat} channel for your apps' Ops events.`
    const channel = channelFor(row, cat)
    if (token && channel) {
      const res = await slackApi(token, 'chat.postMessage', { channel, text }, { fetchImpl: deps.fetchImpl })
      results.push(res.ok ? { category: cat, ok: true, via: 'bot' } : { category: cat, ok: false, via: 'bot', error: res.error })
      continue
    }
    const hookId = cat === 'payments' ? row.payments_webhook_secret_id : cat === 'releases' ? row.releases_webhook_secret_id : row.alerts_webhook_secret_id
    const hook = await readVaultSecret(db as never, hookId)
    if (hook) {
      const res = await postSlackWebhook(hook, { text }, { fetchImpl: deps.fetchImpl })
      results.push(res.ok ? { category: cat, ok: true, via: 'webhook' } : { category: cat, ok: false, via: 'webhook', error: res.error })
      continue
    }
    results.push({ category: cat, ok: false, via: null, error: !channel ? 'no channel set' : 'no bot token set' })
  }
  return c.json({ ok: true, data: { results } })
}

// ── ops key ─────────────────────────────────────────────────────────────────

async function mintOpsKey(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const access = await deps.callerCanAccessProject(c as never, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const viewer = denyViewerWrite(c, access.role, 'mint an ops key')
  if (viewer) return viewer
  const rate = await deps.claimRateLimit(db as never, `project:${projectId}:ops_key_mint`, OPS_KEY_MINTS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${OPS_KEY_MINTS_PER_HOUR} ops keys an hour per app.`, 429)
  }
  const { data: proj } = await db.from('projects').select('slug, name').eq('id', projectId).maybeSingle()
  const p = proj as { slug?: string | null; name?: string | null } | null
  const slug = ((p?.slug ?? p?.name ?? 'app').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app').slice(0, 56)
  const label = `ops:${slug}`
  const mint = await deps.mintKey(db, { projectId, label, scopes: OPS_KEY_SCOPES })
  if (!mint.ok) {
    olog.error('ops key mint failed', { projectId, err: mint.error.message })
    return jsonError(c, 'DB_ERROR', 'The ops key could not be created.', 500)
  }
  void deps.logAudit(db as never, projectId, userId, 'api_key.created', 'project_api_key', mint.minted.id ?? undefined, { source: 'ops_key', scopes: [...OPS_KEY_SCOPES], key_prefix: mint.minted.prefix, label }, { actorType: 'user' })
  return c.json({ ok: true, data: { id: mint.minted.id, key: mint.minted.key, prefix: mint.minted.prefix, scopes: [...OPS_KEY_SCOPES], label } }, 201)
}

// ── Slack: shared verification ──────────────────────────────────────────────

/** @internal Exported for tests: the workspace a Slack request says it comes from, read before verifying. */
export function slackTeamIdOf(rawBody: string): string | null {
  const form = new URLSearchParams(rawBody)
  const direct = form.get('team_id')
  if (direct) return direct
  const payload = form.get('payload')
  if (!payload) return null
  try {
    const p = JSON.parse(payload) as { team?: { id?: string } }
    return typeof p.team?.id === 'string' ? p.team.id : null
  } catch {
    return null
  }
}

type Verified = { ok: true; settings: OpsSettingsRow } | { ok: false; status: 401 | 404 | 500; reason: string }

/** Find the org by team_id, then verify the raw body with THAT org's signing secret. */
async function verifyFromTeam(c: Ctx, deps: OpsRouteDeps, db: Db, rawBody: string): Promise<Verified> {
  const teamId = slackTeamIdOf(rawBody)
  if (!teamId || !/^T[A-Z0-9]{2,20}$/.test(teamId)) return { ok: false, status: 401, reason: 'no team id' }
  const { data, error } = await db.from('ops_slack_settings').select(OPS_SETTINGS_COLUMNS).eq('team_id', teamId).maybeSingle()
  if (error) return { ok: false, status: 500, reason: 'settings read failed' }
  const settings = data as OpsSettingsRow | null
  if (!settings) return { ok: false, status: 404, reason: 'workspace not connected' }
  const secret = await readVaultSecret(db as never, settings.signing_secret_id)
  if (!secret) return { ok: false, status: 404, reason: 'no signing secret saved' }
  const verdict = await deps.verifySlack({
    signingSecret: secret,
    timestamp: c.req.header('x-slack-request-timestamp'),
    signature: c.req.header('x-slack-signature'),
    rawBody,
    nowSeconds: Math.floor(deps.now().getTime() / 1000),
  })
  if (!verdict.ok) return { ok: false, status: 401, reason: verdict.reason }
  return { ok: true, settings }
}

/** POST a reply to Slack's response_url, only to Slack's own host. */
async function postResponseUrl(url: string, reply: SlashReply, deps: OpsRouteDeps): Promise<void> {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return
  }
  if (host !== SLACK_WEBHOOK_HOST || !url.startsWith('https://')) return
  try {
    await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...reply, replace_original: true }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    olog.warn('ops response_url post failed', { err: String(err).slice(0, 120) })
  }
}

async function auditStart(c: Ctx, deps: OpsRouteDeps, rawBody: string, deliveryId: string | null): Promise<{ resolve: (outcome: string, status: number, note?: string) => Promise<void>; rejected: Response | null }> {
  const t0 = Date.now()
  const { audit, checkReplay, checkRateLimit } = deps.webhookMiddleware('slack')
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null
  const row = await audit(c as never, rawBody, deliveryId)
  const resolve = (outcome: string, status: number, note?: string) => row.resolve(outcome, status, Date.now() - t0, note).catch(() => {}) as Promise<void>
  try {
    checkRateLimit(ip)
    await checkReplay(row.id, deliveryId)
  } catch (err) {
    if (err instanceof RateLimitError) {
      await resolve('rejected_rate_limit', 429, err.message)
      return { resolve, rejected: c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Rate limited' } }, 429) }
    }
    if (err instanceof ReplayAttackError) {
      await resolve('rejected_replay', 409, err.message)
      return { resolve, rejected: c.json({ ok: false, error: { code: 'DUPLICATE', message: 'Duplicate delivery' } }, 409) }
    }
    throw err
  }
  return { resolve, rejected: null }
}

// ── Slack: slash command ────────────────────────────────────────────────────

async function slackCommand(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const rawBody = await c.req.text()
  const form = new URLSearchParams(rawBody)
  const triggerId = form.get('trigger_id') || null
  const audit = await auditStart(c, deps, rawBody, triggerId)
  if (audit.rejected) return audit.rejected
  const db = deps.getServiceClient()
  const verified = await verifyFromTeam(c, deps, db, rawBody)
  if (!verified.ok) {
    await audit.resolve(verified.status === 401 ? 'rejected_signature' : 'accepted', verified.status === 401 ? 401 : 200, verified.reason)
    if (verified.status === 401) return c.json({ ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid Slack signature' } }, 401)
    if (verified.status === 500) return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'Try again shortly' } }, 500)
    // Unknown workspace: a plain answer, no data (nothing was verified).
    return c.json(eph('This Slack workspace is not connected to Mushi Mushi yet. A team owner can connect it in Mushi Mushi → Settings → Slack bot.'))
  }
  const settings = verified.settings
  const cmd = parseOpsCommand(form.get('text'))
  const ctx = {
    orgId: settings.organization_id,
    slackUserId: (form.get('user_id') ?? '').slice(0, 40),
    command: form.get('command') || settings.command,
    consoleBase: deps.adminBaseUrl(),
    now: deps.now(),
  }
  if (cmd.sub === 'help' || cmd.sub === 'usage') {
    await audit.resolve('accepted', 200)
    return c.json(await runOpsCommand(db as never, cmd, ctx))
  }
  const responseUrl = form.get('response_url') ?? ''
  deps.runInBackground(
    runOpsCommand(db as never, cmd, ctx)
      .catch((err) => {
        olog.error('ops command failed', { sub: cmd.sub, orgId: ctx.orgId, err: String(err).slice(0, 200) })
        return eph('Something went wrong reading that. Try again in a minute.')
      })
      .then((reply) => postResponseUrl(responseUrl, reply, deps)),
  )
  await audit.resolve('accepted', 200)
  // An empty 200 is Slack's plain acknowledgement. A text reply here would stay on
  // screen as a second message: the response_url answer cannot replace it.
  return c.body(null, 200)
}

// ── Slack: buttons ──────────────────────────────────────────────────────────

interface BlockActionsPayload {
  type?: string
  trigger_id?: string
  team?: { id?: string }
  user?: { id?: string }
  actions?: Array<{ action_id?: string; value?: string }>
}

async function slackInteraction(c: Ctx, deps: OpsRouteDeps): Promise<Response> {
  const rawBody = await c.req.text()
  let payload: BlockActionsPayload = {}
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}') as BlockActionsPayload
  } catch {
    payload = {}
  }
  const audit = await auditStart(c, deps, rawBody, payload.trigger_id ?? null)
  if (audit.rejected) return audit.rejected
  const db = deps.getServiceClient()
  const verified = await verifyFromTeam(c, deps, db, rawBody)
  if (!verified.ok) {
    await audit.resolve(verified.status === 401 ? 'rejected_signature' : 'accepted', verified.status === 401 ? 401 : 200, verified.reason)
    return verified.status === 401 ? c.json({ ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid Slack signature' } }, 401) : c.body(null, 200)
  }
  const action = payload.actions?.[0]
  const eventId = action?.value ?? ''
  const userId = (payload.user?.id ?? '').replace(/[^A-Z0-9]/gi, '').slice(0, 30)
  if (payload.type !== 'block_actions' || (action?.action_id !== OPS_ACTION_ACK && action?.action_id !== OPS_ACTION_MUTE) || !UUID_RE.test(eventId)) {
    // Link buttons (Open, Open in Mushi Mushi) also arrive here: nothing to do.
    await audit.resolve('accepted', 200, 'ignored')
    return c.body(null, 200)
  }
  const orgId = verified.settings.organization_id
  const work = (async () => {
    const { data } = await db.from('ops_events').select(OPS_EVENT_COLUMNS).eq('id', eventId).maybeSingle()
    const event = data as OpsEventRow | null
    // Only an event of the organization whose secret verified this request.
    if (!event || event.organization_id !== orgId) return
    const opts = { fetchImpl: deps.fetchImpl, now: deps.now }
    if (action.action_id === OPS_ACTION_ACK) {
      await ackOpsEvent(db as never, event, { id: `slack:${userId}`, mention: userId ? `<@${userId}>` : 'someone in Slack' }, opts)
      return
    }
    if (!event.project_id) return
    const until = new Date(deps.now().getTime() + MUTE_BUTTON_MS)
    const muted = await muteProject(db as never, { organizationId: orgId, projectId: event.project_id, until, by: `slack:${userId}` })
    if (!muted.ok || !event.slack_ts || !event.slack_channel || event.slack_channel === 'webhook') return
    const token = await readVaultSecret(db as never, verified.settings.bot_token_secret_id)
    if (token) {
      await slackApi(token, 'chat.postMessage', { channel: event.slack_channel, thread_ts: event.slack_thread_ts ?? event.slack_ts, text: `🔕 Muted here for 24 hours by ${userId ? `<@${userId}>` : 'someone'}. Events are still kept in Mushi Mushi.` }, opts)
    }
  })().catch((err) => olog.error('ops interaction failed', { eventId, err: String(err).slice(0, 200) }))
  deps.runInBackground(work)
  await audit.resolve('accepted', 200)
  return c.body(null, 200)
}
