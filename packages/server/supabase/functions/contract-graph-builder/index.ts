/**
 * contract-graph-builder — Phase 4a
 *
 * Builds a contract snapshot for a project from three sources (see
 * _shared/contract-snapshot.ts for why these and not the old ones):
 *   1. OpenAPI spec   project_settings.openapi_spec_url, fetched with safeFetch
 *   2. Inventory      graph_nodes of type 'api_dep'
 *   3. Postgres       the latest backend_schema_snapshots row (the project's
 *                     own Supabase schema, from backend-drift-scanner)
 *
 * Stores the result in `contract_snapshots` and returns each source's state.
 * A failed read is a 500 naming the step that failed (the database error goes
 * to the log, not the response); a source that is simply not set up is
 * reported as `not_configured` / `not_connected`, never as an empty, healthy
 * snapshot. Called by drift-walker before every walk.
 *
 * POST body: { project_id: string }
 */

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { safeFetch } from '../_shared/inventory-guards.ts'
import {
  countContractEdges,
  describeOpenApiFetchError,
  inventoryNodesFromApiDeps,
  isOpenApiDocument,
  pgSchemaFromBackendSnapshot,
  type SourceStatus,
} from '../_shared/contract-snapshot.ts'

const clog = log.child('contract-graph-builder')

/** A JSON error response. `detail` (a database or runtime error) is logged, never returned. */
function fail(status: number, error: string, detail?: string): Response {
  if (detail !== undefined) clog.error(error, { detail })
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(
  withSentry('contract-graph-builder', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr) return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = typeof body.project_id === 'string' ? body.project_id : null
    if (!projectId) return fail(400, 'project_id required')

    // 1. OpenAPI spec (tenant-supplied URL → safeFetch: public https only,
    //    redirects re-validated).
    const { data: settings, error: settingsErr } = await db
      .from('project_settings')
      .select('openapi_spec_url, openapi_spec_path')
      .eq('project_id', projectId)
      .maybeSingle()
    if (settingsErr) return fail(500, 'Could not read the project settings.', settingsErr.message)

    let openapi: unknown = null
    let openapiStatus: SourceStatus
    const specUrl = (settings?.openapi_spec_url as string | null)?.trim() || null
    if (!specUrl) {
      openapiStatus = {
        state: 'not_configured',
        detail: settings?.openapi_spec_path
          ? 'Only a repo path is set; add an OpenAPI URL so the spec can be fetched.'
          : 'No OpenAPI URL set for this project.',
      }
    } else {
      try {
        const res = await safeFetch(specUrl, { headers: { Accept: 'application/json' } }, {
          timeoutMs: 15_000,
          maxRedirects: 2,
          url: {},
        })
        const json = res.ok ? await res.json().catch(() => null) : null
        if (!res.ok) openapiStatus = { state: 'error', detail: `HTTP ${res.status} from the OpenAPI URL` }
        else if (!isOpenApiDocument(json)) openapiStatus = { state: 'error', detail: 'The OpenAPI URL did not return an OpenAPI JSON document' }
        else {
          openapi = json
          openapiStatus = { state: 'ok' }
        }
      } catch (err) {
        clog.warn('OpenAPI fetch failed', { projectId, err: String(err instanceof Error ? err.message : err).slice(0, 300) })
        openapiStatus = { state: 'error', detail: describeOpenApiFetchError(err) }
      }
    }

    // 2. Inventory routes.
    const { data: apiDeps, error: invErr } = await db
      .from('graph_nodes')
      .select('id, label, metadata')
      .eq('project_id', projectId)
      .eq('node_type', 'api_dep')
      .limit(2000)
    if (invErr) return fail(500, 'Could not read the inventory routes.', invErr.message)
    const inventoryNodes = inventoryNodesFromApiDeps(
      (apiDeps ?? []) as Array<{ id: string; label: string | null; metadata: Record<string, unknown> | null }>,
    )
    const inventoryStatus: SourceStatus = inventoryNodes.length > 0
      ? { state: 'ok' }
      : { state: 'not_configured', detail: 'No inventory API routes yet (inventory.yaml backend entries).' }

    // 3. The project's own Postgres schema, as last captured.
    const { data: schemaSnap, error: schemaErr } = await db
      .from('backend_schema_snapshots')
      .select('schema_json, captured_at')
      .eq('project_id', projectId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (schemaErr) return fail(500, 'Could not read the schema snapshot.', schemaErr.message)
    const pgSchema = schemaSnap
      ? pgSchemaFromBackendSnapshot(schemaSnap.schema_json as Array<Record<string, unknown>> | null)
      : null
    const pgStatus: SourceStatus = schemaSnap
      ? { state: 'ok', detail: `captured ${schemaSnap.captured_at}` }
      : { state: 'not_connected', detail: 'Connect the Supabase project (BYOK supabase key + project ref) for schema checks.' }

    const edgeCount = countContractEdges(openapi, inventoryNodes)

    const { data: snapshot, error } = await db
      .from('contract_snapshots')
      .insert({
        project_id: projectId,
        openapi,
        inventory_nodes: inventoryNodes,
        pg_schema: pgSchema,
        edge_count: edgeCount,
      })
      .select('id')
      .single()
    if (error || !snapshot) return fail(500, 'Could not save the contract snapshot.', error?.message ?? 'no row returned')

    return new Response(
      JSON.stringify({
        ok: true,
        snapshot_id: snapshot.id,
        edge_count: edgeCount,
        sources: { openapi: openapiStatus, inventory: inventoryStatus, pg_schema: pgStatus },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
