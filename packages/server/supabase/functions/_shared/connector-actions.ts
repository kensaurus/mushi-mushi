/**
 * FILE: packages/server/supabase/functions/_shared/connector-actions.ts
 * PURPOSE: The only path from a request to a connector `act()` call (Plan 019
 *          §2b "Approval for act"; ADR 0017's exception: nothing executes
 *          automatically).
 *
 *   request  anyone with mcp:write may ask; the row stores the payload and the
 *            SHA-256 of its canonical JSON. Nothing runs.
 *   approve  a human owner/admin, console JWT only (the route refuses API
 *            keys). Sets a one-hour expiry.
 *   execute  a human, console JWT only. One UPDATE flips approved → executing
 *            guarded by status, expiry and the stored hash, so a second
 *            caller (or a replay) gets nothing. The payload passed to act()
 *            is the ROW's payload — never anything from the request — and its
 *            hash is recomputed and compared before the claim.
 */

import type { getServiceClient } from './db.ts'
import { canonicalJson } from './connectors/canonical.ts'
import { sha256Hex } from './connectors/jwt.ts'
import { getConnector } from './connectors/index.ts'
import { resolveCredential } from './connectors/credentials.ts'
import type { ConnectorActionResult } from './connectors/types.ts'

type Db = ReturnType<typeof getServiceClient>

export const APPROVAL_TTL_MS = 60 * 60 * 1000
export const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ActionOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; status: 400 | 403 | 404 | 409 | 410 | 502 }

interface ActionRow {
  id: string
  organization_id: string
  project_id: string | null
  connector_instance_id: string
  action: string
  payload: Record<string, unknown>
  payload_sha256: string
  status: string
  requested_at: string
  expires_at: string | null
}

export async function payloadHash(payload: unknown): Promise<string> {
  return sha256Hex(canonicalJson(payload))
}

async function audit(db: Db, row: Pick<ActionRow, 'organization_id' | 'project_id' | 'id' | 'action'>, actorId: string | null, what: string, metadata: Record<string, unknown> = {}) {
  await db.from('org_audit_events').insert({
    organization_id: row.organization_id, project_id: row.project_id, actor_id: actorId, action: `connector_action.${what}`,
    resource_type: 'connector_action', resource_id: row.id, metadata: { action: row.action, ...metadata },
  }).then(() => {}, () => {})
}

export async function requestConnectorAction(
  db: Db,
  input: { organizationId: string; instanceId: string; action: string; payload: Record<string, unknown>; requestedBy: string; reason?: string | null; projectId?: string | null },
): Promise<ActionOutcome<{ id: string; payloadSha256: string }>> {
  const { data: inst } = await db.from('connector_instances').select('id, kind, organization_id').eq('id', input.instanceId).eq('organization_id', input.organizationId).maybeSingle()
  if (!inst) return { ok: false, code: 'NOT_FOUND', message: 'Connector not found in this team.', status: 404 }
  const connector = getConnector((inst as { kind: string }).kind)
  if (!connector.act || !(connector.actions ?? []).includes(input.action)) {
    return { ok: false, code: 'ACTION_NOT_SUPPORTED', message: `${connector.title} has no "${input.action}" action.`, status: 400 }
  }
  const payloadSha256 = await payloadHash(input.payload)
  const { data, error } = await db.from('connector_actions').insert({
    organization_id: input.organizationId, project_id: input.projectId ?? null, connector_instance_id: input.instanceId,
    action: input.action, payload: input.payload, payload_sha256: payloadSha256, reason: input.reason ?? null,
    status: 'pending_approval', requested_by: input.requestedBy,
  }).select('id').single()
  if (error || !data) return { ok: false, code: 'DB_ERROR', message: 'The request could not be saved.', status: 400 }
  const id = (data as { id: string }).id
  await audit(db, { organization_id: input.organizationId, project_id: input.projectId ?? null, id, action: input.action }, null, 'requested', { requestedBy: input.requestedBy })
  return { ok: true, value: { id, payloadSha256 } }
}

async function load(db: Db, id: string, organizationId: string): Promise<ActionRow | null> {
  const { data } = await db.from('connector_actions').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle()
  return (data as ActionRow | null) ?? null
}

/**
 * Approve one action. `seenSha256` is the hash of the payload the approver
 * was shown; it must equal a fresh hash of the stored payload, so an approval
 * always covers exactly what the person read.
 */
export async function approveConnectorAction(db: Db, id: string, organizationId: string, approverId: string, now: Date, seenSha256: unknown): Promise<ActionOutcome<{ expiresAt: string }>> {
  if (typeof seenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(seenSha256)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Send the payloadSha256 of the payload you are approving.', status: 400 }
  }
  const row = await load(db, id, organizationId)
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Action not found.', status: 404 }
  if (row.status !== 'pending_approval') return { ok: false, code: 'NOT_PENDING', message: `This action is ${row.status}, not waiting for approval.`, status: 409 }
  if (now.getTime() - Date.parse(row.requested_at) > REQUEST_TTL_MS) return { ok: false, code: 'EXPIRED', message: 'This request is older than a week. Ask for it again.', status: 410 }
  const fresh = await payloadHash(row.payload)
  if (fresh !== row.payload_sha256 || fresh !== seenSha256) {
    return { ok: false, code: 'HASH_MISMATCH', message: 'The payload is not the one you were shown. Reload, read it again, then approve.', status: 409 }
  }
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS).toISOString()
  const { data } = await db.from('connector_actions')
    .update({ status: 'approved', approved_by: approverId, approved_at: now.toISOString(), expires_at: expiresAt })
    .eq('id', id).eq('status', 'pending_approval').eq('payload_sha256', seenSha256)
    .select('id')
  if (!Array.isArray(data) || data.length !== 1) return { ok: false, code: 'NOT_PENDING', message: 'Someone else acted on this first.', status: 409 }
  await audit(db, row, approverId, 'approved', { expiresAt })
  return { ok: true, value: { expiresAt } }
}

export async function rejectConnectorAction(db: Db, id: string, organizationId: string, userId: string): Promise<ActionOutcome<null>> {
  const row = await load(db, id, organizationId)
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Action not found.', status: 404 }
  const { data } = await db.from('connector_actions').update({ status: 'rejected' }).eq('id', id).in('status', ['pending_approval', 'approved']).select('id')
  if (!Array.isArray(data) || data.length !== 1) return { ok: false, code: 'NOT_PENDING', message: `This action is ${row.status}.`, status: 409 }
  await audit(db, row, userId, 'rejected')
  return { ok: true, value: null }
}

export interface ExecuteDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => Date
  resolveCredential?: typeof resolveCredential
}

/** Run one approved action once. Never retries; a failure is recorded, not hidden. */
export async function executeConnectorAction(db: Db, id: string, organizationId: string, userId: string, deps: ExecuteDeps): Promise<ActionOutcome<ConnectorActionResult>> {
  const now = deps.now()
  const row = await load(db, id, organizationId)
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Action not found.', status: 404 }
  if (row.status !== 'approved') return { ok: false, code: 'NOT_APPROVED', message: `This action is ${row.status}; it needs a fresh approval.`, status: 409 }
  if (!row.expires_at || Date.parse(row.expires_at) <= now.getTime()) return { ok: false, code: 'APPROVAL_EXPIRED', message: 'The approval expired. Approve it again to run it.', status: 410 }
  // The stored hash must still describe the stored payload (tamper check).
  if (await payloadHash(row.payload) !== row.payload_sha256) {
    await db.from('connector_actions').update({ status: 'failed', error: 'payload does not match its approved hash' }).eq('id', id)
    return { ok: false, code: 'HASH_MISMATCH', message: 'The payload changed after it was approved. Nothing was run.', status: 409 }
  }
  // Claim it: exactly one caller can move approved → executing.
  const { data: claimed } = await db.from('connector_actions')
    .update({ status: 'executing', executed_at: now.toISOString() })
    .eq('id', id).eq('status', 'approved').eq('payload_sha256', row.payload_sha256).gt('expires_at', now.toISOString())
    .select('id')
  if (!Array.isArray(claimed) || claimed.length !== 1) return { ok: false, code: 'ALREADY_RUN', message: 'This action already ran or is running.', status: 409 }

  const finish = async (result: ConnectorActionResult) => {
    await db.from('connector_actions').update({ status: result.ok ? 'executed' : 'failed', result: result.result ?? { detail: result.detail }, error: result.ok ? null : result.detail }).eq('id', id)
    await audit(db, row, userId, result.ok ? 'executed' : 'failed', { detail: result.detail })
  }

  const { data: inst } = await db.from('connector_instances').select('id, kind, organization_id, project_id, config, read_credential_ref, write_credential_ref, enabled_capabilities').eq('id', row.connector_instance_id).maybeSingle()
  const instance = inst as { kind: string; project_id: string | null; config: Record<string, unknown>; read_credential_ref: string | null; write_credential_ref: string | null; enabled_capabilities: string[] } | null
  if (!instance || !instance.enabled_capabilities.includes('act')) {
    const r = { ok: false, detail: 'Act is not turned on for this connector.' }
    await finish(r)
    return { ok: false, code: 'ACT_DISABLED', message: r.detail, status: 403 }
  }
  const connector = getConnector(instance.kind)
  const resolve = deps.resolveCredential ?? resolveCredential
  let result: ConnectorActionResult
  try {
    result = await connector.act!({
      db, organizationId: organizationId, projectId: row.project_id ?? instance.project_id, config: instance.config ?? {},
      readCredential: await resolve(db, instance.read_credential_ref),
      writeCredential: await resolve(db, instance.write_credential_ref),
      fetch: deps.fetch, now: deps.now,
    }, { id: row.id, action: row.action, payload: row.payload, payloadSha256: row.payload_sha256 })
  } catch (err) {
    result = { ok: false, detail: ((err as Error)?.message ?? String(err)).slice(0, 300) }
  }
  await finish(result)
  return result.ok ? { ok: true, value: result } : { ok: false, code: 'ACTION_FAILED', message: result.detail, status: 502 }
}
