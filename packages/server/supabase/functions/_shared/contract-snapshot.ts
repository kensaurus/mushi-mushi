/**
 * FILE: packages/server/supabase/functions/_shared/contract-snapshot.ts
 * PURPOSE: Inputs for a contract snapshot (contract-graph-builder → drift-walker).
 *
 * The builder used to read `projects.settings` and `inventory_nodes` (neither
 * exists) and introspect Mushi's OWN Postgres through `execute_sql`, then
 * swallow every error — so it snapshotted nothing, or worse, stored Mushi's
 * schema in a tenant's snapshot. The real sources are:
 *
 *   OpenAPI    project_settings.openapi_spec_url, fetched with safeFetch
 *   inventory  graph_nodes of type 'api_dep' ({ method, path } metadata)
 *   pg schema  the latest backend_schema_snapshots row — the tenant's own
 *              Supabase schema, captured by backend-drift-scanner
 *
 * Each source reports a state so a missing one reads as "not connected" or
 * "error", never as an empty, healthy snapshot.
 *
 * Pure: no Deno globals, no I/O.
 */

export type SourceState = 'ok' | 'not_configured' | 'not_connected' | 'error'

export interface SourceStatus {
  state: SourceState
  detail?: string
}

export interface ContractInventoryNode {
  id: string
  path: string
  method: string
}

export interface ContractPgTable {
  table_name: string
  columns: Array<{ column_name: string; data_type: string; is_nullable: string }>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/** api_dep graph nodes → the inventory routes the drift walker compares against OpenAPI. */
export function inventoryNodesFromApiDeps(
  rows: Array<{ id: string; label: string | null; metadata: Record<string, unknown> | null }>,
): ContractInventoryNode[] {
  const out: ContractInventoryNode[] = []
  for (const r of rows) {
    let method = typeof r.metadata?.method === 'string' ? r.metadata.method : null
    let path = typeof r.metadata?.path === 'string' ? r.metadata.path : null
    // Older nodes carry only the "METHOD:path" label.
    if ((!method || !path) && r.label && r.label.includes(':')) {
      const idx = r.label.indexOf(':')
      method = method ?? r.label.slice(0, idx)
      path = path ?? r.label.slice(idx + 1)
    }
    if (!method || !path || !HTTP_METHODS.includes(method.toLowerCase())) continue
    out.push({ id: r.id, method: method.toUpperCase(), path })
  }
  return out
}

/** backend_schema_snapshots.schema_json (TableInfo[]) → the walker's table shape. */
export function pgSchemaFromBackendSnapshot(
  tables: Array<{ name?: unknown; schema?: unknown; columns?: unknown }> | null | undefined,
): ContractPgTable[] {
  if (!Array.isArray(tables)) return []
  return tables
    .filter((t) => typeof t?.name === 'string' && (t.schema === undefined || t.schema === 'public'))
    .map((t) => ({
      table_name: t.name as string,
      columns: (Array.isArray(t.columns) ? t.columns : [])
        .filter((c: unknown): c is { name: string; type?: unknown; nullable?: unknown } =>
          typeof (c as { name?: unknown })?.name === 'string')
        .map((c) => ({
          column_name: c.name,
          data_type: typeof c.type === 'string' ? c.type : 'unknown',
          is_nullable: c.nullable === false ? 'NO' : 'YES',
        })),
    }))
}

/** Routes in the spec plus inventory routes — the snapshot's edge count. */
export function countContractEdges(openapi: unknown, inventory: ContractInventoryNode[]): number {
  let edges = inventory.length
  const paths = (openapi as { paths?: unknown } | null)?.paths
  if (paths && typeof paths === 'object') {
    for (const pathObj of Object.values(paths as Record<string, unknown>)) {
      if (pathObj && typeof pathObj === 'object') {
        edges += Object.keys(pathObj).filter((k) => HTTP_METHODS.includes(k)).length
      }
    }
  }
  return edges
}

/** True when a parsed JSON body looks like an OpenAPI/Swagger document. */
export function isOpenApiDocument(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (typeof b.openapi === 'string' || typeof b.swagger === 'string') && typeof b.paths === 'object'
}

/**
 * Why the OpenAPI URL could not be read, as a fixed sentence for the
 * response. The thrown error itself is logged by the caller, never returned.
 */
export function describeOpenApiFetchError(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? String((err as { name?: unknown }).name ?? '') : ''
  const message = err instanceof Error ? err.message : String(err)
  if (message.startsWith('outbound-blocked:')) {
    return message.includes('TOO_MANY_REDIRECTS')
      ? 'The OpenAPI URL redirected too many times.'
      : 'The OpenAPI URL is not a public https address.'
  }
  if (name === 'TimeoutError' || name === 'AbortError') return 'The OpenAPI URL did not answer in time.'
  return 'The OpenAPI URL could not be fetched.'
}
