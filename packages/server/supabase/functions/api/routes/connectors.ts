/**
 * connectors.ts — connect, probe, bind and switch capabilities of recipe
 * connectors (Plan 019 §2b / §5.2, Phase 2; ADR 0017).
 *
 *   GET    /v1/admin/orgs/:orgId/connectors              adminOrApiKey(mcp:read)  catalog + instances (never credentials)
 *   POST   /v1/admin/orgs/:orgId/connectors              jwtAuth, owner/admin     create (+ probe)
 *   POST   /v1/admin/orgs/:orgId/connectors/:id/probe    jwtAuth, owner/admin     probe now
 *   PATCH  /v1/admin/orgs/:orgId/connectors/:id          jwtAuth, owner/admin     name, config, bindings, capabilities, rotate credentials
 *   DELETE /v1/admin/orgs/:orgId/connectors/:id          jwtAuth, owner/admin
 *
 * Credentials go straight to Vault and are never returned. Read and write
 * credentials are separate; `act` cannot be enabled without a write
 * credential (also a CHECK in the table), and enabling it changes nothing on
 * its own — every action still needs its own human approval
 * (_shared/connector-actions.ts). GitHub, Supabase and Sentry stay on their
 * existing per-project settings (legacy-backed) and show their latest status.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { scanForSecrets } from '../../_shared/secret-scan.ts'
import { getConnector, isConnectorKind, LEGACY_BACKED, listConnectors, plannedKinds, UnknownConnectorKind } from '../../_shared/connectors/index.ts'
import { resolveCredential, storeCredential } from '../../_shared/connectors/credentials.ts'
import { CONNECTOR_CAPABILITIES, type ConnectorContext, type ProbeResult } from '../../_shared/connectors/types.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

const clog = log.child('connectors')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INSTANCE_FIELDS = ['id', 'organization_id', 'project_id', 'kind', 'display_name', 'granted_scopes', 'missing_scopes', 'last_probe_failure', 'enabled_capabilities', 'config', 'status', 'status_reason', 'last_probe_at', 'last_ok_at', 'last_error', 'created_at', 'updated_at'] as const
const INSTANCE_COLUMNS = INSTANCE_FIELDS.join(', ')

/** Whitelist the public fields, so a credential ref can never ride along whatever the select returned. */
function publicInstance(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  return Object.fromEntries(INSTANCE_FIELDS.map((k) => [k, row[k] ?? null]))
}

type Db = ReturnType<typeof getServiceClient>

export interface ConnectorRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => Date
  storeCredential: typeof storeCredential
  resolveCredential: typeof resolveCredential
}

export const defaultConnectorDeps: ConnectorRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  storeCredential,
  resolveCredential,
}

const configSchema = z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((c) => JSON.stringify(c).length <= 4096, 'config is over 4 KB')
const bindingSchema = z.object({ projectId: z.string().uuid(), externalId: z.string().min(1).max(300), role: z.string().min(1).max(60).default('primary') })
const createSchema = z.object({
  kind: z.string().max(40),
  displayName: z.string().min(1).max(120),
  projectId: z.string().uuid().nullable().optional(),
  config: configSchema.default({}),
  readCredential: z.string().min(1).max(20_000).optional(),
  writeCredential: z.string().min(1).max(20_000).optional(),
  bindings: z.array(bindingSchema).max(50).default([]),
}).strict()
const patchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  config: configSchema.optional(),
  enabledCapabilities: z.array(z.enum(CONNECTOR_CAPABILITIES)).max(4).optional(),
  readCredential: z.string().min(1).max(20_000).optional(),
  writeCredential: z.string().min(1).max(20_000).nullable().optional(),
  bindings: z.array(bindingSchema).max(50).optional(),
}).strict()

async function requireOrgAdmin(c: Context, db: Db, orgId: string): Promise<Response | null> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', c.get('userId') as string).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin' ? null : jsonError(c, 'FORBIDDEN', 'Only team owners and admins can manage connectors.', 403)
}

async function audit(db: Db, orgId: string, actorId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
  await db.from('org_audit_events').insert({ organization_id: orgId, actor_id: actorId, action, resource_type: 'connector', resource_id: resourceId, metadata }).then(() => {}, () => {})
}

/** A probe ran but its result could not be written: the connector would keep showing a stale status. */
class ProbeNotStored extends Error {}

async function probeInstance(db: Db, deps: ConnectorRouteDeps, row: { id: string; kind: string; organization_id: string; project_id: string | null; config: Record<string, unknown>; read_credential_ref: string | null; write_credential_ref: string | null }): Promise<ProbeResult> {
  const connector = getConnector(row.kind)
  const ctx: ConnectorContext = {
    db, organizationId: row.organization_id, projectId: row.project_id, config: row.config ?? {},
    readCredential: await deps.resolveCredential(db, row.read_credential_ref),
    writeCredential: await deps.resolveCredential(db, row.write_credential_ref),
    fetch: deps.fetch, now: deps.now,
  }
  let result: ProbeResult
  try {
    result = await connector.probe(ctx)
  } catch (err) {
    result = { ok: false, status: 'error', granted: [], missing: [], reason: ((err as Error)?.message ?? String(err)).slice(0, 300) }
  }
  const now = deps.now().toISOString()
  const { error } = await db.from('connector_instances').update({
    status: result.status, status_reason: result.reason ?? null, granted_scopes: result.granted, last_probe_at: now,
    // What was missing and why it failed, for the radar's store_credential_scope_missing / provider_key_invalid.
    missing_scopes: result.missing, last_probe_failure: result.ok ? null : result.failure ?? null,
    ...(result.ok ? { last_ok_at: now, last_error: null } : { last_error: result.reason ?? null }), updated_at: now,
  }).eq('id', row.id)
  if (error) {
    clog.error('connector probe not stored', { instanceId: row.id, kind: row.kind, err: error.message })
    throw new ProbeNotStored(error.message)
  }
  return result
}

const PROBE_NOT_SAVED = 'The check ran, but its result could not be saved, so the connector still shows its previous status. Press Check again in a minute.'

async function replaceBindings(db: Db, instanceId: string, bindings: Array<{ projectId: string; externalId: string; role: string }>, allowed: string[]): Promise<string | null> {
  for (const b of bindings) if (!allowed.includes(b.projectId)) return 'A binding names a project that is not in this team.'
  await db.from('connector_bindings').delete().eq('connector_instance_id', instanceId)
  if (bindings.length) {
    const { error } = await db.from('connector_bindings').insert(bindings.map((b) => ({ connector_instance_id: instanceId, project_id: b.projectId, external_id: b.externalId, role: b.role })))
    if (error) return 'The bindings could not be saved.'
  }
  return null
}

function issues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500)
}

export function registerConnectorRoutes(app: Hono<{ Variables: Variables }>, deps: ConnectorRouteDeps = defaultConnectorDeps): void {
  app.get('/v1/admin/orgs/:orgId/connectors', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const [{ data: instances }, { data: legacy }] = await Promise.all([
      db.from('connector_instances').select(INSTANCE_COLUMNS).eq('organization_id', access.orgId).order('created_at', { ascending: true }),
      access.projectIds.length
        ? db.from('connector_snapshots').select('kind, project_id, ok, error, observed_at').in('project_id', access.projectIds).is('connector_instance_id', null).eq('is_current', true)
        : Promise.resolve({ data: [] }),
    ])
    const ids = ((instances ?? []) as unknown as Array<{ id: string }>).map((i) => i.id)
    const { data: binds } = ids.length ? await db.from('connector_bindings').select('connector_instance_id, project_id, external_id, role').in('connector_instance_id', ids) : { data: [] }
    return c.json({
      ok: true,
      data: {
        organizationId: access.orgId,
        available: listConnectors().map((k) => ({ kind: k.kind, title: k.title, capabilities: k.capabilities, requiredScopes: k.requiredScopes, credentialNote: k.credentialNote, actions: k.actions ?? [], legacyBacked: LEGACY_BACKED.includes(k.kind) })),
        planned: plannedKinds(),
        instances: ((instances ?? []) as unknown as Array<Record<string, unknown>>).map((i) => ({
          ...publicInstance(i),
          bindings: ((binds ?? []) as Array<{ connector_instance_id: string; project_id: string; external_id: string; role: string }>).filter((b) => b.connector_instance_id === i.id && access.projectIds.includes(b.project_id)).map((b) => ({ projectId: b.project_id, externalId: b.external_id, role: b.role })),
        })),
        legacy: (legacy ?? []) as unknown[],
      },
    })
  })

  app.post('/v1/admin/orgs/:orgId/connectors', deps.jwtAuth, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return denied
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    if (!isConnectorKind(body.kind)) return jsonError(c, 'UNKNOWN_CONNECTOR', `Unknown connector kind: ${body.kind.slice(0, 40)}`, 400)
    try {
      getConnector(body.kind)
    } catch (err) {
      if (err instanceof UnknownConnectorKind) return jsonError(c, 'CONNECTOR_NOT_AVAILABLE', `${body.kind} is planned but not built yet.`, 400)
      throw err
    }
    if ((LEGACY_BACKED as readonly string[]).includes(body.kind)) {
      return jsonError(c, 'USE_EXISTING_SETTINGS', `${body.kind} uses the project's existing connection. Connect it from the project's settings instead.`, 400)
    }
    if (scanForSecrets(JSON.stringify(body.config))) return jsonError(c, 'SECRET_IN_CONFIG', 'The config looks like it holds a secret. Put credentials in the credential field; they go to Vault.', 400)
    if (body.projectId && !access.projectIds.includes(body.projectId)) return jsonError(c, 'NOT_FOUND', 'That project is not in this team.', 404)
    const id = crypto.randomUUID()
    try {
      const readRef = body.readCredential ? await deps.storeCredential(db, `mushi_connector_${id}_read`, body.readCredential) : null
      const writeRef = body.writeCredential ? await deps.storeCredential(db, `mushi_connector_${id}_write`, body.writeCredential) : null
      const row = {
        id, organization_id: access.orgId, project_id: body.projectId ?? null, kind: body.kind, display_name: body.displayName,
        read_credential_ref: readRef, write_credential_ref: writeRef, config: body.config, enabled_capabilities: ['snapshot', 'drift'],
        created_by: c.get('userId') as string,
      }
      const { error } = await db.from('connector_instances').insert(row)
      if (error) return jsonError(c, 'DB_ERROR', 'The connector could not be saved.', 500)
      const bindErr = await replaceBindings(db, id, body.bindings, access.projectIds)
      if (bindErr) return jsonError(c, 'VALIDATION_ERROR', bindErr, 400)
      let probe: ProbeResult
      try {
        probe = await probeInstance(db, deps, row)
      } catch (err) {
        // The connector and its credential are saved; only the first check is not.
        if (err instanceof ProbeNotStored) return jsonError(c, 'PROBE_NOT_SAVED', `The connector was saved. ${PROBE_NOT_SAVED}`, 500)
        throw err
      }
      await audit(db, access.orgId, c.get('userId') as string, 'connector.created', id, { kind: body.kind, status: probe.status })
      const { data: saved } = await db.from('connector_instances').select(INSTANCE_COLUMNS).eq('id', id).maybeSingle()
      return c.json({ ok: true, data: { instance: publicInstance(saved as unknown as Record<string, unknown> | null), probe } }, 201)
    } catch (err) {
      clog.error('connector create failed', { orgId: access.orgId, kind: body.kind, err: (err as Error)?.message })
      return jsonError(c, 'CONNECTOR_FAILED', 'The connector could not be saved. Its credential was not stored.', 500)
    }
  })

  const withInstance = async (c: Context): Promise<{ ok: true; db: Db; orgId: string; projectIds: string[]; row: Record<string, any> } | { ok: false; response: Response }> => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access
    const denied = await requireOrgAdmin(c, db, access.orgId)
    if (denied) return { ok: false, response: denied }
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Connector not found', 404) }
    const { data: row } = await db.from('connector_instances').select('*').eq('id', id).eq('organization_id', access.orgId).maybeSingle()
    if (!row) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Connector not found', 404) }
    return { ok: true, db, orgId: access.orgId, projectIds: access.projectIds, row: row as Record<string, any> }
  }

  app.post('/v1/admin/orgs/:orgId/connectors/:id/probe', deps.jwtAuth, async (c) => {
    const w = await withInstance(c)
    if (!w.ok) return w.response
    try {
      return c.json({ ok: true, data: await probeInstance(w.db, deps, w.row as never) })
    } catch (err) {
      if (err instanceof ProbeNotStored) return jsonError(c, 'PROBE_NOT_SAVED', PROBE_NOT_SAVED, 500)
      throw err
    }
  })

  app.patch('/v1/admin/orgs/:orgId/connectors/:id', deps.jwtAuth, async (c) => {
    const w = await withInstance(c)
    if (!w.ok) return w.response
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    const connector = getConnector(w.row.kind)
    if (body.config && scanForSecrets(JSON.stringify(body.config))) return jsonError(c, 'SECRET_IN_CONFIG', 'The config looks like it holds a secret.', 400)
    const update: Record<string, unknown> = { updated_at: deps.now().toISOString() }
    if (body.displayName) update.display_name = body.displayName
    if (body.config) update.config = body.config
    if (body.readCredential) update.read_credential_ref = await deps.storeCredential(w.db, `mushi_connector_${w.row.id}_read`, body.readCredential)
    if (body.writeCredential !== undefined) {
      update.write_credential_ref = body.writeCredential ? await deps.storeCredential(w.db, `mushi_connector_${w.row.id}_write`, body.writeCredential) : null
      if (!body.writeCredential) {
        await w.db.rpc('vault_delete_secret', { secret_name: `mushi_connector_${w.row.id}_write` }).then(() => {}, () => {})
        // Without a write credential, propose and act switch off (the table CHECK would refuse act anyway).
        update.enabled_capabilities = ((body.enabledCapabilities ?? w.row.enabled_capabilities) as string[]).filter((cap) => cap !== 'act' && cap !== 'propose')
      }
    }
    if (body.enabledCapabilities) {
      const unsupported = body.enabledCapabilities.filter((cap) => !connector.capabilities.includes(cap))
      if (unsupported.length) return jsonError(c, 'CAPABILITY_NOT_SUPPORTED', `${connector.title} cannot ${unsupported.join(', ')}.`, 400)
      const writeRef = 'write_credential_ref' in update ? update.write_credential_ref : w.row.write_credential_ref
      if ((body.enabledCapabilities.includes('act') || body.enabledCapabilities.includes('propose')) && !writeRef) {
        return jsonError(c, 'WRITE_CREDENTIAL_REQUIRED', 'Store a separate write credential before turning on propose or act.', 400)
      }
      update.enabled_capabilities = [...new Set(body.enabledCapabilities)]
    }
    const { error } = await w.db.from('connector_instances').update(update).eq('id', w.row.id)
    if (error) return jsonError(c, 'DB_ERROR', 'The connector could not be updated.', 500)
    if (body.bindings) {
      const bindErr = await replaceBindings(w.db, w.row.id, body.bindings, w.projectIds)
      if (bindErr) return jsonError(c, 'VALIDATION_ERROR', bindErr, 400)
    }
    await audit(w.db, w.orgId, c.get('userId') as string, 'connector.updated', w.row.id, { fields: Object.keys(body), capabilities: body.enabledCapabilities ?? null })
    const { data: saved } = await w.db.from('connector_instances').select(INSTANCE_COLUMNS).eq('id', w.row.id).maybeSingle()
    return c.json({ ok: true, data: publicInstance(saved as unknown as Record<string, unknown> | null) })
  })

  app.delete('/v1/admin/orgs/:orgId/connectors/:id', deps.jwtAuth, async (c) => {
    const w = await withInstance(c)
    if (!w.ok) return w.response
    const { error } = await w.db.from('connector_instances').delete().eq('id', w.row.id)
    if (error) return jsonError(c, 'DB_ERROR', 'The connector could not be removed.', 500)
    // The Vault secrets go with it.
    for (const suffix of ['read', 'write']) {
      await w.db.rpc('vault_delete_secret', { secret_name: `mushi_connector_${w.row.id}_${suffix}` }).then(() => {}, () => {})
    }
    await audit(w.db, w.orgId, c.get('userId') as string, 'connector.deleted', w.row.id, { kind: w.row.kind })
    return c.json({ ok: true, data: { deleted: true } })
  })
}
