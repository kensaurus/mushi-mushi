/**
 * contract-graph-builder — Phase 4a
 *
 * Builds a contract snapshot for a project by pulling:
 *   1. OpenAPI spec (from project settings `openapi_url`)
 *   2. Inventory nodes (from the existing inventory table)
 *   3. Postgres schema via the `execute_sql` RPC (migration 20260519100000)
 *
 * Stores the result in `contract_snapshots`. Called by the drift-walker
 * before every walk and can be triggered manually via POST.
 *
 * POST body: { project_id: string }
 */

import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { log as rootLog } from '../_shared/logger.ts'

const log = rootLog.child('contract-graph-builder')

Deno.serve(
  withSentry('contract-graph-builder', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = body.project_id ?? null
    if (!projectId) return new Response(
      JSON.stringify({ ok: false, error: { code: 'MISSING_PROJECT_ID', message: 'project_id required' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )

    try {
      // 1. Project settings (openapi_url etc.)
      const { data: project, error: projectErr } = await db
        .from('projects')
        .select('id, settings')
        .eq('id', projectId)
        .single()

      if (projectErr || !project) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: `Project ${projectId} not found` } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        )
      }

      const settings = (project?.settings as Record<string, string>) ?? {}
      const openapiUrl: string | null = settings.openapi_url ?? null

      // 2. Fetch OpenAPI spec (best-effort — a missing or unreachable URL is not fatal)
      let openapi: unknown = null
      if (openapiUrl) {
        try {
          const res = await fetch(openapiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
          if (res.ok) {
            openapi = await res.json()
          } else {
            log.warn('OpenAPI spec fetch returned non-OK status', { projectId, openapiUrl, status: res.status })
          }
        } catch (fetchErr) {
          log.warn('OpenAPI spec fetch failed (non-fatal)', { projectId, openapiUrl, error: String(fetchErr) })
        }
      }

      // Count OpenAPI edges (routes)
      let edgeCount = 0
      if (openapi && typeof openapi === 'object' && 'paths' in (openapi as object)) {
        const paths = (openapi as { paths: Record<string, unknown> }).paths
        for (const pathObj of Object.values(paths)) {
          edgeCount += Object.keys(pathObj as object).filter(k =>
            ['get','post','put','patch','delete','head','options'].includes(k)
          ).length
        }
      }

      // 3. Inventory nodes
      const { data: inventoryNodes, error: invErr } = await db
        .from('inventory_nodes')
        .select('id, path, method, handler, file_path, line')
        .eq('project_id', projectId)
        .limit(2000)
      if (invErr) {
        log.warn('Inventory nodes query failed (non-fatal)', { projectId, error: invErr.message })
      }
      edgeCount += (inventoryNodes ?? []).length

      // 4. Postgres schema — public tables + columns via the execute_sql RPC.
      // The RPC was added in migration 20260519100000 and executes the
      // information_schema query under SECURITY DEFINER so the edge function's
      // service-role credentials are sufficient. pg_schema is best-effort:
      // a failure here degrades schema-level drift checks but does NOT block
      // the snapshot or the OpenAPI/inventory drift walk.
      let pgSchema: unknown = null
      const { data: pgSchemaData, error: pgErr } = await db.rpc('execute_sql', {
        sql: `
          select
            t.table_name,
            json_agg(json_build_object(
              'column_name', c.column_name,
              'data_type',   c.data_type,
              'is_nullable', c.is_nullable
            ) order by c.ordinal_position) as columns
          from information_schema.tables t
          join information_schema.columns c
            on c.table_schema = t.table_schema and c.table_name = t.table_name
          where t.table_schema = 'public'
            and t.table_type = 'BASE TABLE'
          group by t.table_name
          order by t.table_name
        `,
      })
      if (pgErr) {
        log.warn('execute_sql RPC failed — pg_schema will be null', { projectId, error: pgErr.message })
      } else {
        pgSchema = pgSchemaData
      }

      // 5. Persist snapshot
      const { data: snapshot, error: insertErr } = await db
        .from('contract_snapshots')
        .insert({
          project_id: projectId,
          openapi,
          inventory_nodes: inventoryNodes ?? [],
          pg_schema: pgSchema ?? null,
          edge_count: edgeCount,
        })
        .select('id, snapshot_at, edge_count')
        .single()

      if (insertErr || !snapshot) {
        log.error('contract_snapshots insert failed', { projectId, error: insertErr?.message })
        return new Response(
          JSON.stringify({ ok: false, error: { code: 'DB_INSERT_FAILED', message: insertErr?.message ?? 'Unknown insert error' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        )
      }

      log.info('Contract snapshot built', {
        projectId,
        snapshotId: snapshot.id,
        edgeCount,
        hasPgSchema: pgSchema !== null,
        hasOpenapi: openapi !== null,
        inventoryNodes: (inventoryNodes ?? []).length,
      })

      return new Response(
        JSON.stringify({ ok: true, snapshot_id: snapshot.id, edge_count: edgeCount, snapshot_at: snapshot.snapshot_at }),
        { headers: { 'content-type': 'application/json' } },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('contract-graph-builder unhandled error', { projectId, error: message })
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message } }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }
  }),
)
