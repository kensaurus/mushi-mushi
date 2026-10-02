import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  countContractEdges,
  inventoryNodesFromApiDeps,
  isOpenApiDocument,
  pgSchemaFromBackendSnapshot,
} from '../_shared/contract-snapshot.ts'
import { walkContractDrift } from '../_shared/drift-agent.ts'

Deno.test('inventory routes come from api_dep graph nodes (metadata, or the METHOD:path label)', () => {
  const nodes = inventoryNodesFromApiDeps([
    { id: 'a', label: 'GET:/api/reports', metadata: { method: 'GET', path: '/api/reports' } },
    { id: 'b', label: 'post:/api/reports', metadata: null },
    { id: 'c', label: 'not-a-route', metadata: {} },
    { id: 'd', label: 'FETCH:/x', metadata: null },
  ])
  assertEquals(nodes, [
    { id: 'a', method: 'GET', path: '/api/reports' },
    { id: 'b', method: 'POST', path: '/api/reports' },
  ])
})

Deno.test("pg schema comes from the project's own backend snapshot, public schema only", () => {
  const tables = pgSchemaFromBackendSnapshot([
    { name: 'reports', schema: 'public', rls_enabled: true, columns: [{ name: 'id', type: 'uuid', nullable: false }, { name: 'note', type: 'text', nullable: true }] } as never,
    { name: 'secrets', schema: 'vault', columns: [] } as never,
  ])
  assertEquals(tables, [
    {
      table_name: 'reports',
      columns: [
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
        { column_name: 'note', data_type: 'text', is_nullable: 'YES' },
      ],
    },
  ])
  assertEquals(pgSchemaFromBackendSnapshot(null), [])
})

Deno.test('edge count = spec operations + inventory routes', () => {
  const spec = { openapi: '3.1.0', paths: { '/reports': { get: {}, post: {}, parameters: [] }, '/health': { get: {} } } }
  assertEquals(countContractEdges(spec, [{ id: 'a', method: 'GET', path: '/reports' }]), 4)
  assertEquals(countContractEdges(null, []), 0)
  assertEquals(isOpenApiDocument(spec), true)
  assertEquals(isOpenApiDocument({ paths: {} }), false)
  assertEquals(isOpenApiDocument('<html>'), false)
})

Deno.test('api_dep inventory nodes (no handler field) are not flagged as dead handlers', () => {
  const findings = walkContractDrift(
    {
      id: 's1',
      openapi: { paths: { '/reports': { get: {} } } },
      inventory_nodes: [
        { id: 'a', method: 'GET', path: '/reports' },
        { id: 'b', method: 'GET', path: '/stale', handler: '' },
      ],
      pg_schema: [],
    },
    [],
  )
  const dead = findings.filter((f) => f.finding_type === 'dead_handler')
  assertEquals(dead.map((f) => f.path), ['/stale'])
})
