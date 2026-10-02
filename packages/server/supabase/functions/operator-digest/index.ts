// ============================================================
// operator-digest — one daily message across an organization's apps
// (Plan 020 §9, ADR 0017).
//
// Trigger: pg_cron hourly at :20 (migration 20261002170000), and
//          POST {"organizationId": "<uuid>", "force": true} from an
//          internal caller (the api's "send now").
// Auth:    requireServiceRoleAuth (internal only).
//
// Each organization with operator_digest_settings.enabled is sent once per
// UTC day, in its send_hour_utc hour. Delivery is off by default; a digest
// with nothing new is recorded as nothing_to_send and not posted.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { collectDigest, composeDigest, deliverDigest, isDigestDue, type DigestSettings } from '../_shared/operator-digest.ts'
import { digestConsoleUrl, liveDeliveryDeps } from '../_shared/operator-digest-delivery.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const dlog = log.child('operator-digest')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ORGS = 50

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp
  const db = getServiceClient()
  const now = new Date()

  let only: string | null = null
  let force = false
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { organizationId?: unknown; force?: unknown }
    if (typeof body.organizationId === 'string') {
      if (!UUID_RE.test(body.organizationId)) return json({ ok: false, error: 'organizationId must be a uuid' }, 400)
      only = body.organizationId
      force = body.force === true
    }
  }

  let q = db.from('operator_digest_settings').select('organization_id, enabled, slack_project_id, email, web_push, send_hour_utc, last_sent_at').eq('enabled', true).limit(MAX_ORGS)
  if (only) q = q.eq('organization_id', only)
  const { data, error } = await q
  if (error) {
    dlog.error('failed to read digest settings', { err: error.message })
    return json({ ok: false, error: error.message }, 500)
  }
  const due = ((data ?? []) as Array<DigestSettings & { send_hour_utc: number; last_sent_at: string | null }>).filter((r) => isDigestDue(r, now, force))

  const results: Array<{ organizationId: string; status: string }> = []
  for (const row of due) {
    try {
      const digest = composeDigest(await collectDigest(db, row.organization_id, now), digestConsoleUrl())
      const delivery = await deliverDigest(db, row, digest, liveDeliveryDeps)
      const failed = delivery.channels.filter((ch) => !ch.ok).map((ch) => `${ch.channel}: ${ch.detail}`).join('; ')
      await db.from('operator_digest_settings').update({
        last_sent_at: now.toISOString(),
        last_status: delivery.status,
        last_error: failed ? failed.slice(0, 500) : null,
      }).eq('organization_id', row.organization_id)
      results.push({ organizationId: row.organization_id, status: delivery.status })
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300)
      dlog.error('digest failed', { organizationId: row.organization_id, err: message })
      await db.from('operator_digest_settings').update({ last_status: 'failed', last_error: message, last_sent_at: now.toISOString() }).eq('organization_id', row.organization_id)
      results.push({ organizationId: row.organization_id, status: 'failed' })
    }
  }
  return json({ ok: true, data: { due: due.length, results } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('operator-digest', handler))
}
