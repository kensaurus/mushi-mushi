/**
 * FILE: packages/server/supabase/functions/api/routes/inventory.ts
 *
 * Mushi Mushi v2 — Bidirectional Inventory routes (whitepaper §4.1, §6).
 *
 * Routes:
 *   POST   /v1/admin/inventory/:projectId                   — ingest yaml
 *   GET    /v1/admin/inventory/:projectId                   — current snapshot
 *   GET    /v1/admin/inventory/:projectId/diff              — between two SHAs
 *   POST   /v1/admin/inventory/:projectId/reconcile         — trigger crawler
 *   GET    /v1/admin/inventory/:projectId/user-stories      — denorm tree
 *   GET    /v1/admin/inventory/:projectId/findings          — gate findings
 *   POST   /v1/admin/inventory/:projectId/gates/run         — run gates
 *   GET    /v1/admin/inventory/:projectId/synthetic/:id     — synth history
 *   POST   /v1/admin/inventory/:projectId/test-gen/...      — test generator
 *
 * All routes are project-scoped and require either a Supabase JWT (admin)
 * or an API key with the `inventory:write` scope (CI / CLI).
 */

import type { Hono } from 'npm:hono@4'

import { adminOrApiKey } from '../../_shared/auth.ts'
import { requireFeature } from '../../_shared/entitlements.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { reportError } from '../../_shared/sentry.ts'
import {
  diffInventories,
  ingestInventory,
  parseInventoryYaml,
  validateInventoryObject,
  type Inventory,
} from '../../_shared/inventory.ts'
import { logAudit } from '../../_shared/audit.ts'
import { dbError, accessibleProjectIds } from '../shared.ts'

interface IngestBody {
  yaml?: string
  inventory?: unknown
  commit_sha?: string
  source?: 'explicit' | 'crawler' | 'hybrid' | 'cli'
}

const MAX_YAML_SIZE = 1_000_000 // 1 MB — generous; the largest real-world
//                                  inventory at design-partner scale is ~80 KB.

const inventoryV2 = requireFeature('inventory_v2')

export function registerInventoryRoutes(app: Hono): void {
  // ============================================================
  // POST /v1/admin/inventory/:projectId — ingest yaml
  // ============================================================
  app.post('/v1/admin/inventory/:projectId', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const apiKeyProjectId = c.get('projectId') as string | undefined
    const db = getServiceClient()

    if (apiKeyProjectId && apiKeyProjectId !== projectId) {
      return c.json(
        { ok: false, error: { code: 'PROJECT_MISMATCH', message: 'API key does not match :projectId' } },
        403,
      )
    }
    if (!apiKeyProjectId) {
      const allowed = await accessibleProjectIds(db, userId)
      if (!allowed.includes(projectId)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
      }
    }

    let body: IngestBody
    try {
      body = (await c.req.json()) as IngestBody
    } catch {
      return c.json(
        { ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } },
        400,
      )
    }

    let inventory: Inventory
    let rawYaml: string

    if (typeof body.yaml === 'string' && body.yaml.length > 0) {
      if (body.yaml.length > MAX_YAML_SIZE) {
        return c.json(
          { ok: false, error: { code: 'TOO_LARGE', message: 'inventory.yaml exceeds 1 MB' } },
          413,
        )
      }
      const parsed = parseInventoryYaml(body.yaml)
      if (!parsed.ok || !parsed.inventory) {
        return c.json(
          { ok: false, error: { code: 'VALIDATION_FAILED', message: 'inventory.yaml failed validation', issues: parsed.issues } },
          422,
        )
      }
      inventory = parsed.inventory
      rawYaml = body.yaml
    } else if (body.inventory && typeof body.inventory === 'object') {
      const parsed = validateInventoryObject(body.inventory)
      if (!parsed.ok || !parsed.inventory) {
        return c.json(
          { ok: false, error: { code: 'VALIDATION_FAILED', message: 'inventory failed validation', issues: parsed.issues } },
          422,
        )
      }
      inventory = parsed.inventory
      rawYaml = JSON.stringify(body.inventory, null, 2)
    } else {
      return c.json(
        { ok: false, error: { code: 'MISSING_BODY', message: 'Provide `yaml` or `inventory`' } },
        400,
      )
    }

    try {
      const result = await ingestInventory(db, projectId, inventory, rawYaml, {
        commitSha: body.commit_sha,
        source: body.source ?? 'explicit',
        ingestedBy: userId,
      })

      await logAudit(db, projectId, userId, 'inventory.ingest', 'inventory', result.inventoryId, {
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
        commit_sha: body.commit_sha ?? null,
      })

      log.info('inventory.ingested', { projectId, ...result })
      return c.json({ ok: true, data: result })
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        tags: { route: 'inventory.ingest', project: projectId },
      })
      return c.json(
        { ok: false, error: { code: 'INGEST_FAILED', message: err instanceof Error ? err.message : 'unknown' } },
        500,
      )
    }
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId — current snapshot
  // ============================================================
  app.get('/v1/admin/inventory/:projectId', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const { data: snapshot, error } = await db
      .from('inventories')
      .select('id, project_id, commit_sha, schema_version, parsed, validation_errors, source, ingested_at, stats, raw_yaml')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .maybeSingle()

    if (error) return dbError(c, error)

    const summaryRpc = await db.rpc('inventory_status_summary', { p_project_id: projectId })

    return c.json({
      ok: true,
      data: {
        snapshot: snapshot ?? null,
        summary: summaryRpc.data ?? null,
      },
    })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/user-stories — tree
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/user-stories', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const { data, error } = await db.rpc('inventory_user_story_tree', { p_project_id: projectId })
    if (error) return dbError(c, error)

    return c.json({ ok: true, data: { tree: data ?? [] } })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/diff?from=<sha>&to=<sha>
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/diff', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const fromSha = c.req.query('from') ?? null
    const toSha = c.req.query('to') ?? null
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const fetchByCommit = async (sha: string | null) => {
      let query = db
        .from('inventories')
        .select('parsed, commit_sha, ingested_at')
        .eq('project_id', projectId)
        .order('ingested_at', { ascending: false })
        .limit(1)
      if (sha) query = query.eq('commit_sha', sha)
      else query = query.eq('is_current', true)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data
    }

    try {
      const [before, after] = await Promise.all([fetchByCommit(fromSha), fetchByCommit(toSha)])
      if (!after) {
        return c.json({ ok: true, data: { entries: [], before: null, after: null } })
      }
      const entries = diffInventories(
        (before?.parsed as Inventory | undefined) ?? null,
        after.parsed as Inventory,
      )
      return c.json({
        ok: true,
        data: {
          entries,
          before: before ? { commit_sha: before.commit_sha, ingested_at: before.ingested_at } : null,
          after: { commit_sha: after.commit_sha, ingested_at: after.ingested_at },
        },
      })
    } catch (err) {
      return dbError(c, err as { message?: string; code?: string })
    }
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/findings
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/findings', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const gate = c.req.query('gate')
    const severity = c.req.query('severity')
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    let runsQuery = db
      .from('gate_runs')
      .select('id, gate, status, summary, findings_count, started_at, completed_at, commit_sha, pr_number')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(50)
    if (gate) runsQuery = runsQuery.eq('gate', gate)
    const { data: runs, error: runsErr } = await runsQuery
    if (runsErr) return dbError(c, runsErr)

    const runIds = (runs ?? []).map((r) => r.id)
    let findings: unknown[] = []
    if (runIds.length > 0) {
      let findingsQuery = db
        .from('gate_findings')
        .select('id, gate_run_id, severity, rule_id, message, file_path, line, col, node_id, suggested_fix, allowlisted, created_at')
        .in('gate_run_id', runIds)
        .order('created_at', { ascending: false })
        .limit(500)
      if (severity) findingsQuery = findingsQuery.eq('severity', severity)
      const { data, error } = await findingsQuery
      if (error) return dbError(c, error)
      findings = data ?? []
    }

    return c.json({ ok: true, data: { runs: runs ?? [], findings } })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/synthetic/:actionNodeId/history
  // ============================================================
  app.get(
    '/v1/admin/inventory/:projectId/synthetic/:actionNodeId/history',
    adminOrApiKey(),
    inventoryV2,
    async (c) => {
      const projectId = c.req.param('projectId')
      const actionNodeId = c.req.param('actionNodeId')
      const userId = c.get('userId') as string
      const db = getServiceClient()

      const allowed = await accessibleProjectIds(db, userId)
      if (!allowed.includes(projectId)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
      }

      const { data, error } = await db
        .from('synthetic_runs')
        .select('id, status, latency_ms, error_message, db_assertions, ran_at')
        .eq('project_id', projectId)
        .eq('action_node_id', actionNodeId)
        .order('ran_at', { ascending: false })
        .limit(200)
      if (error) return dbError(c, error)
      return c.json({ ok: true, data: { runs: data ?? [] } })
    },
  )

  // ============================================================
  // POST /v1/admin/inventory/:projectId/propose — kick off LLM proposer
  //
  // Fire-and-forget — the proposer can take 10-30s and we don't want
  // the click to hang. The UI watches `inventory_proposals` via
  // realtime for the new row.
  // ============================================================
  app.post('/v1/admin/inventory/:projectId/propose', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        { ok: false, error: { code: 'CONFIG_MISSING', message: 'SUPABASE_URL / SERVICE_ROLE_KEY not set' } },
        500,
      )
    }
    let body: { model?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    // Synchronous response: we await the proposer so the caller can
    // surface failures immediately (e.g. "no observations yet").
    const resp = await fetch(`${supabaseUrl}/functions/v1/inventory-propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ project_id: projectId, triggered_by: userId, model: body.model }),
    })
    const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: unknown }
    if (!resp.ok) {
      return c.json({ ok: false, error: json.error ?? { code: 'PROPOSE_FAILED' } }, 500)
    }
    return c.json({ ok: true, data: json.data })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/proposals — list
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/proposals', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const status = c.req.query('status')
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    let q = db
      .from('inventory_proposals')
      .select('id, status, llm_model, observation_count, inventory_id, created_at, decided_at, decided_by')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (status === 'draft' || status === 'accepted' || status === 'discarded') q = q.eq('status', status)
    const { data, error } = await q
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { proposals: data ?? [] } })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/proposals/:id — full detail
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/proposals/:id', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const proposalId = c.req.param('id')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }
    const { data, error } = await db
      .from('inventory_proposals')
      .select('*')
      .eq('project_id', projectId)
      .eq('id', proposalId)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
    return c.json({ ok: true, data })
  })

  // ============================================================
  // PATCH /v1/admin/inventory/:projectId/proposals/:id — edit YAML
  // ============================================================
  app.patch('/v1/admin/inventory/:projectId/proposals/:id', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const proposalId = c.req.param('id')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }
    let body: { yaml?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    if (typeof body.yaml !== 'string' || body.yaml.length === 0) {
      return c.json({ ok: false, error: { code: 'MISSING_YAML' } }, 400)
    }
    const parsed = parseInventoryYaml(body.yaml)
    if (!parsed.ok || !parsed.inventory) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', issues: parsed.issues } },
        422,
      )
    }
    const { error } = await db
      .from('inventory_proposals')
      .update({
        proposed_yaml: body.yaml,
        proposed_parsed: parsed.inventory as unknown as Record<string, unknown>,
      })
      .eq('project_id', projectId)
      .eq('id', proposalId)
    if (error) return dbError(c, error)
    await logAudit(db, projectId, userId, 'inventory.proposal.edit', 'inventory_proposal', proposalId, {})
    return c.json({ ok: true, data: { id: proposalId } })
  })

  // ============================================================
  // POST /v1/admin/inventory/:projectId/proposals/:id/accept
  //
  // Atomic accept: re-validate the proposal, run ingestInventory,
  // mark the proposal accepted with a back-link to the new inventory
  // row. If any step fails the proposal is left as-is.
  // ============================================================
  app.post('/v1/admin/inventory/:projectId/proposals/:id/accept', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const proposalId = c.req.param('id')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }
    const { data: prop, error: propErr } = await db
      .from('inventory_proposals')
      .select('proposed_yaml, status')
      .eq('project_id', projectId)
      .eq('id', proposalId)
      .maybeSingle()
    if (propErr) return dbError(c, propErr)
    if (!prop) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
    if (prop.status !== 'draft') {
      return c.json(
        { ok: false, error: { code: 'BAD_STATE', message: `Proposal already ${prop.status}` } },
        409,
      )
    }
    const parsed = parseInventoryYaml(prop.proposed_yaml as string)
    if (!parsed.ok || !parsed.inventory) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', issues: parsed.issues } },
        422,
      )
    }
    try {
      const result = await ingestInventory(db, projectId, parsed.inventory, prop.proposed_yaml as string, {
        source: 'hybrid',
        ingestedBy: userId,
      })
      await db
        .from('inventory_proposals')
        .update({
          status: 'accepted',
          inventory_id: result.inventoryId,
          decided_at: new Date().toISOString(),
          decided_by: userId,
        })
        .eq('id', proposalId)
      await logAudit(db, projectId, userId, 'inventory.proposal.accept', 'inventory_proposal', proposalId, {
        inventory_id: result.inventoryId,
      })
      log.info('inventory.proposal.accepted', { projectId, proposalId, ...result })
      return c.json({ ok: true, data: { inventoryId: result.inventoryId, ...result } })
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        tags: { route: 'inventory.proposal.accept', project: projectId },
      })
      return c.json(
        { ok: false, error: { code: 'INGEST_FAILED', message: err instanceof Error ? err.message : 'unknown' } },
        500,
      )
    }
  })

  // ============================================================
  // POST /v1/admin/inventory/:projectId/proposals/:id/discard
  // ============================================================
  app.post('/v1/admin/inventory/:projectId/proposals/:id/discard', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const proposalId = c.req.param('id')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }
    const { error } = await db
      .from('inventory_proposals')
      .update({ status: 'discarded', decided_at: new Date().toISOString(), decided_by: userId })
      .eq('project_id', projectId)
      .eq('id', proposalId)
      .eq('status', 'draft')
    if (error) return dbError(c, error)
    await logAudit(db, projectId, userId, 'inventory.proposal.discard', 'inventory_proposal', proposalId, {})
    return c.json({ ok: true, data: { id: proposalId } })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/discovery — observed inventory
  //
  // Read-out of the `discovery_observed_inventory` view plus the count
  // of total events so the admin UI can show "We've seen 1,247 events
  // across 18 routes from 23 distinct users in the last 30 days. Ready
  // to draft your first inventory.yaml?".
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/discovery', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const [{ data: routes, error: routesErr }, { count: totalCount }] = await Promise.all([
      db
        .from('discovery_observed_inventory')
        .select('*')
        .eq('project_id', projectId)
        .order('observation_count', { ascending: false })
        .limit(200),
      db
        .from('discovery_events')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .gte('observed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ])
    if (routesErr) return dbError(c, routesErr)

    const distinctUsers = new Set<string>()
    for (const r of routes ?? []) {
      // The view aggregates per-route; we synthesise an org-wide
      // distinct-user count by summing distinct hashes across routes
      // (the view doesn't expose them). This is a best-effort upper
      // bound — good enough for the "ready to propose?" gate.
      if (typeof (r as { distinct_users?: number }).distinct_users === 'number') {
        for (let i = 0; i < (r as { distinct_users: number }).distinct_users; i++) {
          distinctUsers.add(`${(r as { route: string }).route}:${i}`)
        }
      }
    }

    return c.json({
      ok: true,
      data: {
        routes: routes ?? [],
        total_events: totalCount ?? 0,
        ready_to_propose: (routes?.length ?? 0) >= 3 && (totalCount ?? 0) >= 10,
        // Threshold: ≥3 distinct routes and ≥10 events. Below this the
        // proposer doesn't have enough material to draft a useful inventory.
      },
    })
  })

  // ============================================================
  // GET /v1/admin/inventory/:projectId/settings — crawler config view
  //
  // Returns the project_settings row's crawler-related columns. Auth
  // tokens are NEVER returned in cleartext: we only echo back the
  // discriminator (`type`) and any non-sensitive shape (e.g. cookie
  // domain) so the admin UI can advertise what's configured without
  // ever pulling the secret over the wire.
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/settings', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    const { data, error } = await db
      .from('project_settings')
      .select(
        'crawler_base_url, crawler_auth_config, synthetic_monitor_enabled, synthetic_monitor_target_url, synthetic_monitor_cadence_minutes',
      )
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) return dbError(c, error)

    const auth = data?.crawler_auth_config as
      | {
          type?: string
          config?: { name?: string; domain?: string; login_path?: string }
        }
      | null
    const redactedAuth = auth?.type
      ? {
          type: auth.type,
          // Surface only the non-secret shape — name of the cookie, domain,
          // login_path of the scripted-auth handler. Token values stay on
          // the server.
          config:
            auth.type === 'cookie'
              ? { name: auth.config?.name ?? null, domain: auth.config?.domain ?? null, has_value: true }
              : auth.type === 'scripted'
                ? { login_path: auth.config?.login_path ?? null }
                : { has_token: true },
        }
      : null

    return c.json({
      ok: true,
      data: {
        crawler_base_url: data?.crawler_base_url ?? null,
        crawler_auth: redactedAuth,
        synthetic_monitor_enabled: data?.synthetic_monitor_enabled ?? false,
        synthetic_monitor_target_url: data?.synthetic_monitor_target_url ?? null,
        synthetic_monitor_cadence_minutes: data?.synthetic_monitor_cadence_minutes ?? 15,
      },
    })
  })

  // ============================================================
  // PATCH /v1/admin/inventory/:projectId/settings — crawler config write
  //
  // Accepts the same fields the GET returns. crawler_auth_config is
  // written verbatim — the admin UI is responsible for asking the user
  // for a token they're OK storing in our jsonb column. (Once we ship
  // a proper secret store this becomes a thin wrapper around it.)
  // ============================================================
  app.patch('/v1/admin/inventory/:projectId/settings', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    let body: {
      crawler_base_url?: string | null
      crawler_auth_config?: unknown
      synthetic_monitor_enabled?: boolean
      synthetic_monitor_target_url?: string | null
      synthetic_monitor_cadence_minutes?: number
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } }, 400)
    }

    const patch: Record<string, unknown> = {}
    if (Object.prototype.hasOwnProperty.call(body, 'crawler_base_url')) {
      patch.crawler_base_url = body.crawler_base_url
    }
    if (Object.prototype.hasOwnProperty.call(body, 'crawler_auth_config')) {
      patch.crawler_auth_config = body.crawler_auth_config
    }
    if (Object.prototype.hasOwnProperty.call(body, 'synthetic_monitor_enabled')) {
      patch.synthetic_monitor_enabled = !!body.synthetic_monitor_enabled
    }
    if (Object.prototype.hasOwnProperty.call(body, 'synthetic_monitor_target_url')) {
      patch.synthetic_monitor_target_url = body.synthetic_monitor_target_url
    }
    if (
      Object.prototype.hasOwnProperty.call(body, 'synthetic_monitor_cadence_minutes') &&
      typeof body.synthetic_monitor_cadence_minutes === 'number' &&
      body.synthetic_monitor_cadence_minutes >= 5
    ) {
      patch.synthetic_monitor_cadence_minutes = body.synthetic_monitor_cadence_minutes
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ ok: false, error: { code: 'NO_FIELDS', message: 'Nothing to update' } }, 400)
    }

    // Upsert so projects with no project_settings row yet still get one.
    const { error } = await db
      .from('project_settings')
      .upsert({ project_id: projectId, ...patch }, { onConflict: 'project_id' })
    if (error) return dbError(c, error)

    await logAudit(db, projectId, userId, 'inventory.settings.update', 'project_settings', projectId, {
      fields: Object.keys(patch),
    })

    return c.json({ ok: true, data: { updated: Object.keys(patch) } })
  })

  // ============================================================
  // POST /v1/admin/inventory/:projectId/reconcile — trigger crawler
  // ============================================================
  app.post('/v1/admin/inventory/:projectId/reconcile', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    // Trigger the inventory-crawler edge function. It will write a
    // gate_runs row (gate='crawl') and gate_findings on completion.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        { ok: false, error: { code: 'CONFIG_MISSING', message: 'SUPABASE_URL / SERVICE_ROLE_KEY not set' } },
        500,
      )
    }
    try {
      // Fire-and-forget — the crawler can take >60s and we don't want
      // to block the admin click. The UI watches gate_runs for the new row.
      void fetch(`${supabaseUrl}/functions/v1/inventory-crawler`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ project_id: projectId, triggered_by: userId }),
      }).catch((e) => log.error('crawler.invoke.error', { error: String(e) }))
      return c.json({ ok: true, data: { status: 'triggered' } })
    } catch (err) {
      return c.json(
        { ok: false, error: { code: 'TRIGGER_FAILED', message: err instanceof Error ? err.message : 'unknown' } },
        500,
      )
    }
  })

  // ============================================================
  // POST /v1/admin/inventory/:projectId/gates/run — run gates against a commit
  // ============================================================
  app.post('/v1/admin/inventory/:projectId/gates/run', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const apiKeyProjectId = c.get('projectId') as string | undefined
    const userId = c.get('userId') as string
    const db = getServiceClient()

    if (apiKeyProjectId && apiKeyProjectId !== projectId) {
      return c.json(
        { ok: false, error: { code: 'PROJECT_MISMATCH', message: 'API key does not match :projectId' } },
        403,
      )
    }
    if (!apiKeyProjectId) {
      const allowed = await accessibleProjectIds(db, userId)
      if (!allowed.includes(projectId)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
      }
    }

    let body: { commit_sha?: string; pr_number?: number; gates?: string[] }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) {
      return c.json(
        { ok: false, error: { code: 'CONFIG_MISSING', message: 'SUPABASE_URL / SERVICE_ROLE_KEY not set' } },
        500,
      )
    }

    // Hand off to the inventory-gates edge function which orchestrates
    // Gate 5 (status-claim) + the Sentinel sub-agent. Gates 1, 2, 4 run
    // in CI via the eslint-plugin + the GitHub Action.
    const resp = await fetch(`${supabaseUrl}/functions/v1/inventory-gates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        project_id: projectId,
        commit_sha: body.commit_sha ?? null,
        pr_number: body.pr_number ?? null,
        gates: body.gates ?? ['status_claim', 'api_contract'],
        triggered_by: userId,
      }),
    })
    const json = await resp.json().catch(() => ({}))
    return c.json({ ok: resp.ok, data: json })
  })

  // ============================================================
  // POST /v1/admin/inventory/:projectId/test-gen/from-report/:reportId
  // ============================================================
  app.post(
    '/v1/admin/inventory/:projectId/test-gen/from-report/:reportId',
    adminOrApiKey(),
    inventoryV2,
    async (c) => {
      const projectId = c.req.param('projectId')
      const reportId = c.req.param('reportId')
      const userId = c.get('userId') as string
      const db = getServiceClient()

      const allowed = await accessibleProjectIds(db, userId)
      if (!allowed.includes(projectId)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      if (!supabaseUrl || !serviceKey) {
        return c.json(
          { ok: false, error: { code: 'CONFIG_MISSING', message: 'service config missing' } },
          500,
        )
      }
      const resp = await fetch(`${supabaseUrl}/functions/v1/test-gen-from-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ project_id: projectId, report_id: reportId, triggered_by: userId }),
      })
      const json = await resp.json().catch(() => ({}))
      return c.json({ ok: resp.ok, data: json })
    },
  )

  // ============================================================
  // GET /v1/admin/inventory/:projectId/status-history?node_id=...
  // ============================================================
  app.get('/v1/admin/inventory/:projectId/status-history', adminOrApiKey(), inventoryV2, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const nodeId = c.req.query('node_id')
    const db = getServiceClient()

    const allowed = await accessibleProjectIds(db, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No access to project' } }, 403)
    }

    let q = db
      .from('status_history')
      .select('id, node_id, from_status, to_status, trigger, evidence, changed_at')
      .eq('project_id', projectId)
      .order('changed_at', { ascending: false })
      .limit(100)
    if (nodeId) q = q.eq('node_id', nodeId)
    const { data, error } = await q
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { transitions: data ?? [] } })
  })
}
