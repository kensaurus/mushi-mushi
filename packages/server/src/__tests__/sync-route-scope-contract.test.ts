/**
 * Contract test: every CLI/MCP `/v1/sync/*` route that reads or changes a
 * project's data must require a private-key scope after apiKeyAuth.
 *
 * Why (2026-09-21): apiKeyAuth accepts ANY active project key, because the
 * public SDK key — report:write only, shipped in every customer's browser
 * bundle — must reach the ingest routes. The sync routes also used bare
 * apiKeyAuth, so a key lifted from a public bundle could list every report,
 * change statuses and reply to end users as the team. They now chain
 * requireApiKeyScope('mcp:read' | 'mcp:write').
 *
 * This reads route sources verbatim (no Deno runtime): a new sync route that
 * forgets the gate fails CI. The two SDK-key diagnostics stay open on purpose.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const routesDir = resolve(__dirname, '../../supabase/functions/api/routes')

/** Routes an SDK key (report:write) must still reach. */
const OPEN_SYNC_ROUTES = new Set([
  'GET /v1/sync/whoami', // `mushi init` verifies the freshly written SDK key with it
  'GET /v1/sync/ingest-setup', // SDK heartbeat diagnostic polled with the SDK key
])

/** Writes require mcp:write; everything else at least mcp:read. */
const WRITE_METHODS = new Set(['PATCH', 'PUT', 'DELETE'])
const WRITE_POSTS = new Set(['/v1/sync/reports/:id/reply'])

interface Route {
  method: string
  path: string
  chain: string
  file: string
}

function syncRoutes(): Route[] {
  const out: Route[] = []
  for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = readFileSync(join(routesDir, file), 'utf-8')
    const re = /app\.(get|post|patch|put|delete)\(\s*'(\/v1\/(?:sync\/[^']*|admin\/codebase\/upload))'\s*,([^\n]*)/g
    for (const m of src.matchAll(re)) {
      out.push({ method: m[1].toUpperCase(), path: m[2], chain: m[3], file })
    }
  }
  return out
}

describe('sync route scope contract', () => {
  const routes = syncRoutes()

  it('finds the sync routes (sanity check the scanner)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12)
  })

  for (const r of routes) {
    const id = `${r.method} ${r.path}`
    if (OPEN_SYNC_ROUTES.has(id)) continue
    const needsWrite = WRITE_METHODS.has(r.method) || (r.method === 'POST' && WRITE_POSTS.has(r.path))
    const scope = needsWrite ? 'mcp:write' : 'mcp:read'
    it(`${id} (${r.file}) requires ${scope}`, () => {
      expect(r.chain, `${id} must chain requireApiKeyScope('${scope}') after apiKeyAuth`).toContain(
        `requireApiKeyScope('${scope}')`,
      )
    })
  }
})
