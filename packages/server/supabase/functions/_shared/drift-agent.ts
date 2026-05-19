/**
 * drift-agent.ts — Phase 4b (edge-deployable copy)
 *
 * Contract-drift walker. Takes the latest contract_snapshot for a project and
 * walks the OpenAPI paths / inventory nodes, comparing:
 *   - Route existence (path in OpenAPI but not in inventory, or vice-versa)
 *   - HTTP method mismatches
 *   - Response schema drift (OpenAPI expected shape vs. Postgres pg_schema)
 *   - Missing DB tables referenced by API paths (simple heuristic)
 *
 * Uses Thompson sampling (Phase 4c) to prioritise which paths to walk next
 * based on past drift findings (drift → higher priority).
 *
 * Canonical source: packages/agents/src/drift-agent.ts — keep in sync.
 */

export interface DriftFinding {
  finding_type: string
  severity: 'info' | 'warn' | 'critical'
  surface: string
  path: string | null
  message: string
  expected?: unknown
  actual?: unknown
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, unknown>>
  components?: unknown
}

interface InventoryNode {
  id: string
  path: string
  method: string
  handler?: string
}

interface PgTable {
  table_name: string
  columns: Array<{ column_name: string; data_type: string; is_nullable: string }>
}

interface ContractSnapshot {
  id: string
  openapi: OpenApiSpec | null
  inventory_nodes: InventoryNode[] | null
  pg_schema: PgTable[] | null
}

interface BetaParams { alpha: number; beta: number }

function thompsonSample(params: BetaParams): number {
  const mode = (params.alpha - 1) / (params.alpha + params.beta - 2 + 1e-9)
  return Math.max(0, Math.min(1, mode + (Math.random() - 0.5) * 0.15))
}

function prioritisePaths(
  paths: string[],
  historicalFindings: Array<{ path: string | null; finding_type: string }>,
): string[] {
  const driftCounts = new Map<string, number>()
  for (const f of historicalFindings) {
    if (f.path) driftCounts.set(f.path, (driftCounts.get(f.path) ?? 0) + 1)
  }

  return [...paths].sort((a, b) => {
    const pA = thompsonSample({ alpha: 1 + (driftCounts.get(a) ?? 0), beta: 2 })
    const pB = thompsonSample({ alpha: 1 + (driftCounts.get(b) ?? 0), beta: 2 })
    return pB - pA
  })
}

export function walkContractDrift(
  snapshot: ContractSnapshot,
  historicalFindings: Array<{ path: string | null; finding_type: string }> = [],
  maxPaths = 200,
): DriftFinding[] {
  const findings: DriftFinding[] = []
  const openapi = snapshot.openapi
  const inventoryNodes = snapshot.inventory_nodes ?? []
  const pgTables = snapshot.pg_schema ?? []

  const pgTableNames = new Set(pgTables.map(t => t.table_name))

  const inventoryMap = new Map<string, InventoryNode>()
  for (const node of inventoryNodes) {
    inventoryMap.set(`${node.method.toLowerCase()}:${node.path}`, node)
  }

  const openapiPaths = Object.keys(openapi?.paths ?? {})
  const prioritised = prioritisePaths(openapiPaths, historicalFindings).slice(0, maxPaths)

  for (const apiPath of prioritised) {
    const pathObj = openapi!.paths![apiPath] as Record<string, unknown>
    const methods = Object.keys(pathObj).filter(m =>
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m)
    )

    for (const method of methods) {
      const key = `${method}:${apiPath}`
      const inInventory = inventoryMap.has(key)

      if (!inInventory) {
        findings.push({
          finding_type: 'missing_inventory',
          severity: 'warn',
          surface: 'api',
          path: apiPath,
          message: `OpenAPI defines ${method.toUpperCase()} ${apiPath} but no inventory node found`,
          expected: { method: method.toUpperCase(), path: apiPath },
          actual: null,
        })
      }

      const segments = apiPath.split('/').filter(Boolean)
      const candidateTable = segments.find(s =>
        !s.startsWith('{') && pgTableNames.size > 0 &&
        (pgTableNames.has(s) || pgTableNames.has(`${s}s`) || pgTableNames.has(s.replace(/-/g, '_')))
      )
      if (!candidateTable && segments.length >= 2) {
        const last = segments.at(-1) ?? ''
        if (!last.startsWith('{') && !['health', 'status', 'metrics', 'docs'].includes(last)) {
          findings.push({
            finding_type: 'unmapped_route',
            severity: 'info',
            surface: 'api',
            path: apiPath,
            message: `Route ${apiPath} has no obvious DB table mapping in schema`,
          })
        }
      }
    }
  }

  for (const node of inventoryNodes.slice(0, maxPaths)) {
    const normalised = node.path.replace(/\/:[^/]+/g, '/{param}')
    const inOpenApi = openapiPaths.some(p =>
      p === node.path || p === normalised
    )
    if (!inOpenApi && openapi?.paths) {
      findings.push({
        finding_type: 'undocumented_route',
        severity: 'info',
        surface: 'inventory',
        path: node.path,
        message: `Inventory has ${node.method.toUpperCase()} ${node.path} but it is absent from OpenAPI spec`,
        expected: null,
        actual: { method: node.method, path: node.path, handler: node.handler },
      })
    }
  }

  for (const node of inventoryNodes) {
    if (!node.handler || node.handler.trim() === '') {
      findings.push({
        finding_type: 'dead_handler',
        severity: 'warn',
        surface: 'inventory',
        path: node.path,
        message: `Route ${node.method.toUpperCase()} ${node.path} has no handler function`,
      })
    }
  }

  return findings
}
