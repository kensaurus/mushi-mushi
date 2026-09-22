/**
 * FILE: packages/server/src/__tests__/agent-context-routes-contract.test.ts
 * PURPOSE: The API routes MCP tools call must exist.
 *
 * Why (2026-09-21): triage_issue (stdio + hosted) called
 * /v1/admin/reports/:id/fix-context and /blast-radius, and
 * setup_repo_for_mushi called POST /v1/admin/projects/:id/repo/bootstrap,
 * since they shipped. None was registered: triage swallowed the 404s into
 * `null`, setup_repo_for_mushi failed outright.
 *
 * Reads sources verbatim (no Deno runtime), like sync-route-scope-contract.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const functionsDir = resolve(__dirname, '../../supabase/functions')
const routesDir = join(functionsDir, 'api/routes')
const mcpStdioSource = resolve(__dirname, '../../../mcp/src/server.ts')

interface Registration {
  method: string
  path: string
  chain: string
}

function registrations(): Registration[] {
  const out: Registration[] = []
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = readFileSync(join(routesDir, file), 'utf-8')
    for (const m of src.matchAll(/\b(?:app|parent)\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
      out.push({ method: m[1].toUpperCase(), path: m[2], chain: m[3] })
    }
  }
  return out
}

function findRoute(method: string, path: string): Registration | undefined {
  return registrations().find((r) => r.method === method && r.path === path)
}

/** Agent-facing routes and the suffix MCP sources use to call them. */
const AGENT_ROUTES = [
  { method: 'GET', path: '/v1/admin/reports/:id/fix-context', mcpSuffix: /\/v1\/admin\/reports\/\$\{[^}]+\}\/fix-context/ },
  { method: 'GET', path: '/v1/admin/reports/:id/blast-radius', mcpSuffix: /\/v1\/admin\/reports\/\$\{[^}]+\}\/blast-radius/ },
  { method: 'POST', path: '/v1/admin/projects/:id/repo/bootstrap', mcpSuffix: /\/v1\/admin\/projects\/(?:\$\{[^}]+\}|\{projectId\})\/repo\/bootstrap/ },
] as const

describe('agent context routes', () => {
  for (const route of AGENT_ROUTES) {
    it(`${route.method} ${route.path} is registered behind adminOrApiKey`, () => {
      const found = findRoute(route.method, route.path)
      expect(found, `${route.method} ${route.path} must be registered`).toBeTruthy()
      expect(found!.chain).toContain('adminOrApiKey(')
    })
  }

  it('every MCP call to these paths resolves to a registered route', () => {
    const sources = [
      join(functionsDir, 'mcp/index.ts'),
      join(functionsDir, '_shared/mcp-hosted-tool-manifest.json'),
      mcpStdioSource,
    ].filter((p) => existsSync(p))
    expect(sources.length).toBeGreaterThanOrEqual(2)
    for (const file of sources) {
      const src = readFileSync(file, 'utf-8')
      for (const route of AGENT_ROUTES) {
        if (!route.mcpSuffix.test(src)) continue
        expect(findRoute(route.method, route.path), `${file} calls ${route.path}`).toBeTruthy()
      }
    }
  })

  it('the report detail route and fix-context share one fix packet builder', () => {
    const reports = readFileSync(join(routesDir, 'reports.ts'), 'utf-8')
    expect(reports).toContain('buildReportFixPacket(')
    expect(reports).not.toContain('composeFixPacket(')
  })
})
