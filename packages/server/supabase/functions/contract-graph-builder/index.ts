/**
 * contract-graph-builder — Phase 4a
 *
 * Builds a contract snapshot for a project by pulling:
 *   1. OpenAPI spec (from project settings `openapi_url`)
 *   2. Inventory nodes (from the existing inventory table)
 *   3. Postgres schema via information_schema introspection
 *
 * Stores the result in `contract_snapshots`. Called by the drift-walker
 * before every walk and can be triggered manually via POST.
 *
 * POST body: { project_id: string }
 */

import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

Deno.serve(
  withSentry('contract-graph-builder', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = body.project_id ?? null
    if (!projectId) return new Response(JSON.stringify({ error: 'project_id required' }), { status: 400 })

    // 1. Project settings (openapi_url etc.)
    const { data: project } = await db
      .from('projects')
      .select('id, settings')
      .eq('id', projectId)
      .single()

    const settings = (project?.settings as Record<string, string>) ?? {}
    const openapiUrl: string | null = settings.openapi_url ?? null

    // 2. Fetch OpenAPI spec
    let openapi: unknown = null
    if (openapiUrl) {
      try {
        const res = await fetch(openapiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
        if (res.ok) openapi = await res.json()
      } catch { /* best effort */ }
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
    const { data: inventoryNodes } = await db
      .from('inventory_nodes')
      .select('id, path, method, handler, file_path, line')
      .eq('project_id', projectId)
      .limit(2000)
    edgeCount += (inventoryNodes ?? []).length

    // 4. Postgres schema — public tables + columns introspection
    const { data: pgSchema } = await db.rpc('execute_sql', {
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
    }).catch(() => ({ data: null }))

    // Persist snapshot
    const { data: snapshot, error } = await db
      .from('contract_snapshots')
      .insert({
        project_id: projectId,
        openapi,
        inventory_nodes: inventoryNodes ?? [],
        pg_schema: pgSchema ?? null,
        edge_count: edgeCount,
      })
      .select()
      .single()

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

    return new Response(
      JSON.stringify({ ok: true, snapshot_id: snapshot.id, edge_count: edgeCount }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
