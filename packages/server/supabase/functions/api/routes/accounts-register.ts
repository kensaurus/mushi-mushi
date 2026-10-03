/**
 * accounts-register.ts — the accounts and resilience register on /portfolio
 * (Plan 020 §11).
 *
 *   GET    /v1/admin/orgs/:orgId/accounts              adminOrApiKey(mcp:read)  accounts, domains, open rules
 *   GET    /v1/admin/orgs/:orgId/accounts/export       adminOrApiKey(mcp:read)  the register as Markdown
 *   POST   /v1/admin/orgs/:orgId/accounts              jwtAuth, owner/admin     record an account
 *   PATCH  /v1/admin/orgs/:orgId/accounts/:id          jwtAuth, owner/admin     change it
 *   DELETE /v1/admin/orgs/:orgId/accounts/:id          jwtAuth, owner/admin
 *   PATCH  /v1/admin/orgs/:orgId/domains/:id           jwtAuth, owner/admin     declare a domain's auto-renew
 *
 * Names and metadata only: every text field is secret-scanned and a value
 * shaped like a key or token is refused. Domains are the organization's
 * `domain` resources that a project the caller can see uses (the same rule as
 * GET …/portfolio/resources), so a member never learns another team's domains.
 * The rules are computed on read here and by the daily org collector, which
 * writes them to portfolio_findings.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { scanForSecrets } from '../../_shared/secret-scan.ts'
import {
  ACCOUNT_PROVIDERS,
  accountExternalId,
  accountRegisterRules,
  REGISTER_COLUMNS,
  registerFromRows,
  renderRegisterMarkdown,
  type RegisterRow,
} from '../../_shared/accounts-register.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

const alog = log.child('accounts-register')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ACCOUNTS = 200

type Db = ReturnType<typeof getServiceClient>

export interface AccountsRegisterDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  now: () => Date
}

export const defaultAccountsRegisterDeps: AccountsRegisterDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  now: () => new Date(),
}

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : v === undefined ? undefined : null))

const accountSchema = z.object({
  provider: z.enum(ACCOUNT_PROVIDERS),
  displayName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().email().max(254).nullable().optional(),
  twoFactorDeclared: z.boolean().nullable().optional(),
  recoveryContact: nullableText(200),
  adminCount: z.number().int().min(1).max(100).optional(),
  autoRenew: z.boolean().nullable().optional(),
}).strict()
const accountPatchSchema = accountSchema.partial().strict()
const domainPatchSchema = z.object({ autoRenew: z.boolean().nullable() }).strict()

function issues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500)
}

/** The first field that looks like a secret, or null. The register holds names, never keys. */
function secretField(body: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string' && scanForSecrets(v)) return k
  return null
}

async function isOrgAdmin(db: Db, orgId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin'
}

async function audit(db: Db, orgId: string, actorId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await db.from('org_audit_events').insert({ organization_id: orgId, actor_id: actorId, action, resource_type: 'portfolio_account', resource_id: resourceId, metadata }).then(() => {}, () => {})
}

/** Accounts of the organization plus the domains its visible projects use. Throws on a failed read. */
async function loadRegister(db: Db, orgId: string, projectIds: readonly string[]) {
  const [res, uses] = await Promise.all([
    db.from('portfolio_resources').select(REGISTER_COLUMNS).eq('organization_id', orgId).in('kind', ['account', 'domain']).limit(1000),
    projectIds.length ? db.from('portfolio_resource_uses').select('resource_id, project_id').in('project_id', [...projectIds]).limit(5000) : Promise.resolve({ data: [], error: null }),
  ])
  if (res.error) throw new Error(`portfolio_resources: ${res.error.message}`)
  if (uses.error) throw new Error(`portfolio_resource_uses: ${uses.error.message}`)
  // Only uses by projects the caller can see, so a domain only another team's app uses stays hidden.
  const usesOf = new Map<string, string[]>()
  for (const u of (uses.data ?? []) as Array<{ resource_id: string; project_id: string }>) usesOf.set(u.resource_id, [...(usesOf.get(u.resource_id) ?? []), u.project_id])
  const register = registerFromRows((res.data ?? []) as unknown as RegisterRow[], usesOf)
  return { ...register, findings: accountRegisterRules(register.accounts, register.domains) }
}

export function registerAccountsRegisterRoutes(app: Hono<{ Variables: Variables }>, deps: AccountsRegisterDeps = defaultAccountsRegisterDeps): void {
  app.get('/v1/admin/orgs/:orgId/accounts', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const register = await loadRegister(db, access.orgId, access.projectIds)
      const canEdit = c.get('authMethod') !== 'apiKey' && await isOrgAdmin(db, access.orgId, c.get('userId') as string)
      return c.json({ ok: true, data: { organizationId: access.orgId, canEdit, ...register } })
    } catch (err) {
      alog.error('register read failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'REGISTER_FAILED', 'The accounts register could not be read. Try again in a minute.', 500)
    }
  })

  app.get('/v1/admin/orgs/:orgId/accounts/export', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const register = await loadRegister(db, access.orgId, access.projectIds)
      const md = renderRegisterMarkdown({ organizationName: access.orgName, generatedAt: deps.now().toISOString(), ...register })
      return new Response(md, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="accounts-register.md"',
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      alog.error('register export failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'REGISTER_FAILED', 'The accounts register could not be exported. Try again in a minute.', 500)
    }
  })

  /** Owner/admin of the organization, signed in (not an API key). */
  const forWrite = async (c: Context): Promise<{ ok: true; db: Db; orgId: string; userId: string; projectIds: string[] } | { ok: false; response: Response }> => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access
    const userId = c.get('userId') as string
    if (!(await isOrgAdmin(db, access.orgId, userId))) return { ok: false, response: jsonError(c, 'FORBIDDEN', 'Only team owners and admins can change the accounts register.', 403) }
    return { ok: true, db, orgId: access.orgId, userId, projectIds: access.projectIds }
  }

  app.post('/v1/admin/orgs/:orgId/accounts', deps.jwtAuth, async (c) => {
    const w = await forWrite(c)
    if (!w.ok) return w.response
    const raw = await c.req.json().catch(() => null)
    const parsed = accountSchema.safeParse(raw)
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    const secret = secretField(body as Record<string, unknown>)
    if (secret) return jsonError(c, 'SECRET_DETECTED', `${secret} looks like a key or token. The register keeps names and contacts only; store secrets in your password manager.`, 400)
    const { data: existing, error: countErr } = await w.db.from('portfolio_resources').select('id').eq('organization_id', w.orgId).eq('kind', 'account').limit(MAX_ACCOUNTS + 1)
    if (countErr) return jsonError(c, 'DB_ERROR', 'The register could not be read.', 500)
    if (((existing ?? []) as unknown[]).length >= MAX_ACCOUNTS) return jsonError(c, 'TOO_MANY_ACCOUNTS', `A register holds at most ${MAX_ACCOUNTS} accounts.`, 400)
    const externalId = accountExternalId(body.provider, body.displayName)
    const { data: dup } = await w.db.from('portfolio_resources').select('id').eq('organization_id', w.orgId).eq('kind', 'account').eq('external_id', externalId).maybeSingle()
    if (dup) return jsonError(c, 'ACCOUNT_EXISTS', 'An account with that provider and name is already in the register.', 409)
    const now = deps.now().toISOString()
    const { data: row, error } = await w.db.from('portfolio_resources').insert({
      organization_id: w.orgId, kind: 'account', external_id: externalId, metadata: {},
      display_name: body.displayName, account_provider: body.provider, owner_email: body.ownerEmail ?? null,
      two_factor_declared: body.twoFactorDeclared ?? null, recovery_contact: body.recoveryContact ?? null,
      admin_count: body.adminCount ?? 1, auto_renew: body.autoRenew ?? null, created_at: now, updated_at: now,
    }).select('id').single()
    if (error || !row) return jsonError(c, 'DB_ERROR', 'The account could not be saved.', 500)
    const id = (row as { id: string }).id
    await audit(w.db, w.orgId, w.userId, 'portfolio_account.created', id, { provider: body.provider })
    return c.json({ ok: true, data: { id } }, 201)
  })

  const withAccount = async (c: Context, kind: 'account' | 'domain') => {
    const w = await forWrite(c)
    if (!w.ok) return w
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return { ok: false as const, response: jsonError(c, 'NOT_FOUND', 'Not found', 404) }
    const { data: row } = await w.db.from('portfolio_resources').select(REGISTER_COLUMNS).eq('id', id).eq('organization_id', w.orgId).eq('kind', kind).maybeSingle()
    if (!row) return { ok: false as const, response: jsonError(c, 'NOT_FOUND', 'Not found', 404) }
    if (kind === 'domain') {
      // Same visibility as the read: a domain one of the caller's projects uses.
      const { data: use } = w.projectIds.length
        ? await w.db.from('portfolio_resource_uses').select('resource_id').eq('resource_id', id).in('project_id', w.projectIds).limit(1).maybeSingle()
        : { data: null }
      if (!use) return { ok: false as const, response: jsonError(c, 'NOT_FOUND', 'Not found', 404) }
    }
    return { ...w, row: row as unknown as RegisterRow }
  }

  app.patch('/v1/admin/orgs/:orgId/accounts/:id', deps.jwtAuth, async (c) => {
    const w = await withAccount(c, 'account')
    if (!w.ok) return w.response
    const parsed = accountPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    const secret = secretField(body as Record<string, unknown>)
    if (secret) return jsonError(c, 'SECRET_DETECTED', `${secret} looks like a key or token. The register keeps names and contacts only.`, 400)
    const update: Record<string, unknown> = { updated_at: deps.now().toISOString() }
    if (body.provider !== undefined || body.displayName !== undefined) {
      const provider = body.provider ?? (w.row.account_provider as (typeof ACCOUNT_PROVIDERS)[number])
      const name = body.displayName ?? w.row.display_name ?? w.row.external_id
      update.external_id = accountExternalId(provider, name)
      update.account_provider = provider
      update.display_name = name
      if (update.external_id !== w.row.external_id) {
        const { data: dup } = await w.db.from('portfolio_resources').select('id').eq('organization_id', w.orgId).eq('kind', 'account').eq('external_id', update.external_id as string).maybeSingle()
        if (dup) return jsonError(c, 'ACCOUNT_EXISTS', 'An account with that provider and name is already in the register.', 409)
      }
    }
    if (body.ownerEmail !== undefined) update.owner_email = body.ownerEmail
    if (body.twoFactorDeclared !== undefined) update.two_factor_declared = body.twoFactorDeclared
    if (body.recoveryContact !== undefined) update.recovery_contact = body.recoveryContact
    if (body.adminCount !== undefined) update.admin_count = body.adminCount
    if (body.autoRenew !== undefined) update.auto_renew = body.autoRenew
    const { error } = await w.db.from('portfolio_resources').update(update).eq('id', w.row.id)
    if (error) return jsonError(c, 'DB_ERROR', 'The account could not be updated.', 500)
    await audit(w.db, w.orgId, w.userId, 'portfolio_account.updated', w.row.id, { fields: Object.keys(body) })
    return c.json({ ok: true, data: { id: w.row.id } })
  })

  app.delete('/v1/admin/orgs/:orgId/accounts/:id', deps.jwtAuth, async (c) => {
    const w = await withAccount(c, 'account')
    if (!w.ok) return w.response
    const { error } = await w.db.from('portfolio_resources').delete().eq('id', w.row.id)
    if (error) return jsonError(c, 'DB_ERROR', 'The account could not be removed.', 500)
    await audit(w.db, w.orgId, w.userId, 'portfolio_account.deleted', w.row.id, { provider: w.row.account_provider })
    return c.json({ ok: true, data: { deleted: true } })
  })

  app.patch('/v1/admin/orgs/:orgId/domains/:id', deps.jwtAuth, async (c) => {
    const w = await withAccount(c, 'domain')
    if (!w.ok) return w.response
    const parsed = domainPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const { error } = await w.db.from('portfolio_resources').update({ auto_renew: parsed.data.autoRenew, updated_at: deps.now().toISOString() }).eq('id', w.row.id)
    if (error) return jsonError(c, 'DB_ERROR', 'The domain could not be updated.', 500)
    await audit(w.db, w.orgId, w.userId, 'portfolio_domain.updated', w.row.id, { autoRenew: parsed.data.autoRenew })
    return c.json({ ok: true, data: { id: w.row.id } })
  })
}
