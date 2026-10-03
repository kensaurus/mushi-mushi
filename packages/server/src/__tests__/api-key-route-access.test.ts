/**
 * Gap #28: the routes this release added for the console must also take an
 * API key (CLI, MCP, CI), with the scope that matches what they do — reads
 * mcp:read, anything that writes or messages people mcp:write. Connector
 * create / probe / patch carry credentials and stay console-only.
 *
 * Reads the route sources verbatim (no Deno runtime), like
 * agent-context-routes-contract. A route's chain may name adminOrApiKey
 * directly, a const bound to it in the same file (readAuth / writeAuth), or a
 * deps slot (deps.adminOrApiKeyRead / deps.adminOrApiKeyWrite).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routesDir = resolve(__dirname, '../../supabase/functions/api/routes')

type Scope = 'mcp:read' | 'mcp:write' | 'jwt' | 'unknown'

interface Registration {
  file: string
  method: string
  path: string
  scope: Scope
}

function scopeOfChain(chain: string, aliases: Map<string, Scope>): Scope {
  const first = chain.trim().split(',')[0]?.trim() ?? ''
  const inline = /^adminOrApiKey\(\{\s*scope:\s*'(mcp:read|mcp:write)'\s*\}\)/.exec(first)
  if (inline) return inline[1] as Scope
  if (/^adminOrApiKey\(\s*\)/.test(first)) return 'mcp:read'
  if (first === 'deps.adminOrApiKeyRead') return 'mcp:read'
  if (first === 'deps.adminOrApiKeyWrite') return 'mcp:write'
  if (first === 'jwtAuth' || first === 'deps.jwtAuth') return 'jwt'
  return aliases.get(first) ?? 'unknown'
}

function registrations(): Registration[] {
  const out: Registration[] = []
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = readFileSync(join(routesDir, file), 'utf-8')
    const aliases = new Map<string, Scope>()
    for (const m of src.matchAll(/const (\w+) = adminOrApiKey\(\{\s*scope:\s*'(mcp:read|mcp:write)'\s*\}\)/g)) {
      aliases.set(m[1], m[2] as Scope)
    }
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
      out.push({ file, method: m[1].toUpperCase(), path: m[2], scope: scopeOfChain(m[3], aliases) })
    }
  }
  return out
}

const EXPECTED: ReadonlyArray<{ method: string; path: string; scope: Scope }> = [
  // releases.ts
  { method: 'GET', path: '/v1/admin/releases/stats', scope: 'mcp:read' },
  { method: 'GET', path: '/v1/admin/releases', scope: 'mcp:read' },
  { method: 'POST', path: '/v1/admin/releases/draft', scope: 'mcp:write' },
  { method: 'GET', path: '/v1/admin/releases/:id', scope: 'mcp:read' },
  { method: 'PATCH', path: '/v1/admin/releases/:id', scope: 'mcp:write' },
  { method: 'DELETE', path: '/v1/admin/releases/:id', scope: 'mcp:write' },
  { method: 'POST', path: '/v1/admin/releases/:id/publish', scope: 'mcp:write' },
  // growth funnel (operator + account-level key, checked in the handler)
  { method: 'GET', path: '/v1/admin/growth/funnel', scope: 'mcp:read' },
  // portfolio funnel
  { method: 'PUT', path: '/v1/admin/orgs/:orgId/funnel', scope: 'mcp:write' },
  // repo diagram publishing
  { method: 'GET', path: '/v1/admin/projects/:id/codebase/diagram/publish-preview', scope: 'mcp:read' },
  { method: 'POST', path: '/v1/admin/projects/:id/codebase/diagram/publish', scope: 'mcp:write' },
  { method: 'DELETE', path: '/v1/admin/projects/:id/codebase/diagram/publish', scope: 'mcp:write' },
  // shared-resource CSV import
  { method: 'POST', path: '/v1/ingest/recipe/csv', scope: 'mcp:write' },
  // autofix
  { method: 'GET', path: '/v1/admin/projects/:id/autofix', scope: 'mcp:read' },
  { method: 'POST', path: '/v1/admin/projects/:id/autofix/toggle', scope: 'mcp:write' },
  // explain_finding
  { method: 'GET', path: '/v1/admin/findings/:findingId', scope: 'mcp:read' },
]

describe('API-key access for this release\'s routes (gap #28)', () => {
  const regs = registrations()

  for (const route of EXPECTED) {
    it(`${route.method} ${route.path} takes an API key with ${route.scope}`, () => {
      const found = regs.filter((r) => r.method === route.method && r.path === route.path)
      expect(found, `${route.method} ${route.path} must be registered exactly once`).toHaveLength(1)
      expect(found[0].scope).toBe(route.scope)
    })
  }

  it('connector create, probe and patch stay console-only (they carry credentials)', () => {
    const connectorWrites = regs.filter(
      (r) => r.file === 'connectors.ts' && r.method !== 'GET' && r.path.startsWith('/v1/admin/orgs/:orgId/connectors'),
    )
    expect(connectorWrites.length).toBeGreaterThan(0)
    for (const r of connectorWrites) expect(r.scope, `${r.method} ${r.path}`).toBe('jwt')
  })

  it('the growth funnel refuses a project-bound key before the operator check', () => {
    const src = readFileSync(join(routesDir, 'growth.ts'), 'utf-8')
    const keyCheck = src.indexOf("c.get('isOrgScopedKey')")
    expect(keyCheck).toBeGreaterThan(0)
    expect(keyCheck).toBeLessThan(src.indexOf('requireOperator(c)'))
    expect(src).toContain('GROWTH_NEEDS_ACCOUNT_KEY')
  })
})
