/**
 * digest.ts — the daily operator digest settings and preview (Plan 020 §9).
 *
 *   GET  /v1/admin/orgs/:orgId/digest            adminOrApiKey(mcp:read)  settings + today's preview
 *   PUT  /v1/admin/orgs/:orgId/digest/settings   jwtAuth, owner/admin     switch channels on or off
 *   POST /v1/admin/orgs/:orgId/digest/send       jwtAuth, owner/admin     send now (1 per 5 min)
 *
 * Channels: a project's Slack channel, Discord webhook, Teams webhook or
 * Telegram chats (each reuses that project's existing connection), email and
 * push to owners and admins. gtmWeekday adds each app's weekly signups and
 * activations from the team funnel on that UTC weekday (null = never).
 *
 * Delivery is off until an owner or admin turns a channel on. The settings
 * writes are console-only (JWT), never an API key: they decide where an
 * organization's summary gets posted.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { collectDigest, composeDigest, deliverDigest, isGtmDay, type DeliveryDeps } from '../../_shared/operator-digest.ts'
import { digestConsoleUrl, liveDeliveryDeps } from '../../_shared/operator-digest-delivery.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

const dlog = log.child('digest')
const SEND_COOLDOWN_MS = 5 * 60 * 1000

type Db = ReturnType<typeof getServiceClient>

export interface DigestRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  delivery: DeliveryDeps
  now: () => Date
}

export const defaultDigestDeps: DigestRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  delivery: liveDeliveryDeps,
  now: () => new Date(),
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  slackProjectId: z.string().uuid().nullable().optional(),
  discordProjectId: z.string().uuid().nullable().optional(),
  teamsProjectId: z.string().uuid().nullable().optional(),
  telegramProjectId: z.string().uuid().nullable().optional(),
  gtmWeekday: z.number().int().min(0).max(6).nullable().optional(),
  email: z.boolean().optional(),
  webPush: z.boolean().optional(),
  sendHourUtc: z.number().int().min(0).max(23).optional(),
}).strict()

interface SettingsRow {
  organization_id: string
  enabled: boolean
  slack_project_id: string | null
  discord_project_id: string | null
  teams_project_id: string | null
  telegram_project_id: string | null
  email: boolean
  web_push: boolean
  send_hour_utc: number
  gtm_weekday: number | null
  last_sent_at: string | null
  last_status: string | null
  last_error: string | null
}

function toWire(orgId: string, row: SettingsRow | null) {
  return {
    organizationId: orgId,
    enabled: row?.enabled ?? false,
    slackProjectId: row?.slack_project_id ?? null,
    discordProjectId: row?.discord_project_id ?? null,
    teamsProjectId: row?.teams_project_id ?? null,
    telegramProjectId: row?.telegram_project_id ?? null,
    email: row?.email ?? false,
    webPush: row?.web_push ?? false,
    sendHourUtc: row?.send_hour_utc ?? 0,
    // A team with no settings row gets the column default (Monday).
    gtmWeekday: row ? row.gtm_weekday ?? null : 1,
    lastSentAt: row?.last_sent_at ?? null,
    lastStatus: row?.last_status ?? null,
    lastError: row?.last_error ?? null,
  }
}

async function loadSettings(db: Db, orgId: string): Promise<SettingsRow | null> {
  const { data } = await db.from('operator_digest_settings').select('*').eq('organization_id', orgId).maybeSingle()
  return (data as SettingsRow | null) ?? null
}

async function isOrgAdmin(db: Db, orgId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin'
}

export function registerDigestRoutes(app: Hono<{ Variables: Variables }>, deps: DigestRouteDeps = defaultDigestDeps): void {
  app.get('/v1/admin/orgs/:orgId/digest', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const row = await loadSettings(db, access.orgId)
      const weekday = row ? row.gtm_weekday : 1
      // The preview shows the weekly lines whenever they are switched on, so the team can see them before that day.
      const data = await collectDigest(db, access.orgId, deps.now(), { gtm: weekday !== null })
      // The preview only lists apps the caller can reach.
      const visible = { ...data, projects: data.projects.filter((p) => access.projectIds.includes(p.projectId)) }
      return c.json({ ok: true, data: { settings: toWire(access.orgId, row), preview: composeDigest(visible, digestConsoleUrl()) } })
    } catch (err) {
      dlog.error('digest preview failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'DIGEST_FAILED', 'The digest preview could not be built. Try again in a minute.', 500)
    }
  })

  app.put('/v1/admin/orgs/:orgId/digest/settings', deps.jwtAuth, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const userId = c.get('userId') as string
    if (!(await isOrgAdmin(db, access.orgId, userId))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can change the digest.', 403)
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400)
    const body = parsed.data
    for (const id of [body.slackProjectId, body.discordProjectId, body.teamsProjectId, body.telegramProjectId]) {
      if (id && !access.projectIds.includes(id)) return jsonError(c, 'NOT_FOUND', 'That project is not in this team.', 404)
    }
    const current = await loadSettings(db, access.orgId)
    const keep = <T>(value: T | undefined, stored: T): T => (value === undefined ? stored : value)
    const next = {
      organization_id: access.orgId,
      enabled: body.enabled,
      slack_project_id: keep(body.slackProjectId, current?.slack_project_id ?? null),
      discord_project_id: keep(body.discordProjectId, current?.discord_project_id ?? null),
      teams_project_id: keep(body.teamsProjectId, current?.teams_project_id ?? null),
      telegram_project_id: keep(body.telegramProjectId, current?.telegram_project_id ?? null),
      email: body.email ?? current?.email ?? false,
      web_push: body.webPush ?? current?.web_push ?? false,
      send_hour_utc: body.sendHourUtc ?? current?.send_hour_utc ?? 0,
      gtm_weekday: keep(body.gtmWeekday, current ? current.gtm_weekday : 1),
      updated_by: userId,
      updated_at: deps.now().toISOString(),
    }
    const anyChannel = next.slack_project_id || next.discord_project_id || next.teams_project_id || next.telegram_project_id || next.email || next.web_push
    if (next.enabled && !anyChannel) {
      return jsonError(c, 'NO_CHANNEL', 'Turn on at least one place to send the digest: Slack, Discord, Teams, Telegram, email or push.', 400)
    }
    const { error } = await db.from('operator_digest_settings').upsert(next, { onConflict: 'organization_id' })
    if (error) return jsonError(c, 'DB_ERROR', 'The digest settings could not be saved.', 500)
    return c.json({ ok: true, data: toWire(access.orgId, { ...(current ?? {} as SettingsRow), ...next } as SettingsRow) })
  })

  app.post('/v1/admin/orgs/:orgId/digest/send', deps.jwtAuth, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    if (!(await isOrgAdmin(db, access.orgId, c.get('userId') as string))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can send the digest.', 403)
    const row = await loadSettings(db, access.orgId)
    if (!row?.enabled) return jsonError(c, 'DIGEST_OFF', 'Turn the digest on and pick a channel first.', 400)
    const now = deps.now()
    if (row.last_sent_at && now.getTime() - Date.parse(row.last_sent_at) < SEND_COOLDOWN_MS) {
      return jsonError(c, 'RATE_LIMITED', 'The digest went out a few minutes ago. Try again shortly.', 429)
    }
    try {
      const digest = composeDigest(await collectDigest(db, access.orgId, now, { gtm: isGtmDay(row.gtm_weekday, now) }), digestConsoleUrl())
      const delivery = await deliverDigest(db, row, digest, deps.delivery)
      const failed = delivery.channels.filter((ch) => !ch.ok).map((ch) => `${ch.channel}: ${ch.detail}`).join('; ')
      await db.from('operator_digest_settings').update({ last_sent_at: now.toISOString(), last_status: delivery.status, last_error: failed || null }).eq('organization_id', access.orgId)
      return c.json({ ok: true, data: delivery })
    } catch (err) {
      dlog.error('digest send failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'DIGEST_FAILED', 'The digest could not be sent.', 500)
    }
  })
}
