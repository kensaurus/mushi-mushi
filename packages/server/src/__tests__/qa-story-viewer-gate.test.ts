/**
 * FILE: packages/server/src/__tests__/qa-story-viewer-gate.test.ts
 * PURPOSE: Viewers read QA coverage but cannot add, change, delete or run a
 *          story. Route wiring is checked at source level (no Deno boot), the
 *          same style as console-group-j-write-gates.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/qa-coverage.ts'), 'utf8')

function routeSlice(signature: string): string {
  const start = src.indexOf(signature)
  expect(start, `${signature} should exist`).toBeGreaterThanOrEqual(0)
  const next = src.slice(start + signature.length).search(/\n {2}app\.(get|post|patch|delete)\(/)
  return next === -1 ? src.slice(start) : src.slice(start, start + signature.length + next)
}

describe('QA story writes refuse viewers', () => {
  it.each([
    ["app.post('/v1/admin/projects/:pid/qa-stories',", 'insert('],
    ["app.patch('/v1/admin/projects/:pid/qa-stories/:sid',", 'update('],
    ["app.delete('/v1/admin/projects/:pid/qa-stories/:sid',", '.delete()'],
    ["app.post('/v1/admin/projects/:pid/qa-stories/:sid/run',", ".from('qa_stories')"],
  ])('%s checks the role before it writes', (signature, write) => {
    const body = routeSlice(signature)
    const gate = body.indexOf('qaViewerDenied(')
    expect(gate).toBeGreaterThan(0)
    expect(body.indexOf(write)).toBeGreaterThan(gate)
  })

  it('the gate uses the shared viewer rule and skips project-bound API keys', () => {
    const helper = src.slice(src.indexOf('async function qaViewerDenied'), src.indexOf('async function qaViewerDenied') + 400)
    expect(helper).toContain('if (!userId) return null')
    expect(helper).toContain('userCanAccessProject(db, userId, projectId)')
    expect(helper).toContain('denyViewerWrite(c, access.role, action)')
  })
})

describe('inventory writes refuse viewers', () => {
  const inv = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/inventory.ts'), 'utf8')

  it('every write route uses the write scope, never the read scope', () => {
    const writes = [...inv.matchAll(/app\.(post|patch|put|delete)\(\s*'([^']+)'/g)]
    expect(writes.length).toBeGreaterThanOrEqual(12)
    for (const m of writes) {
      const body = inv.slice(m.index!, m.index! + 1500)
      const next = body.slice(10).search(/\n {2}app\.(get|post|patch|put|delete)\(/)
      const route = next === -1 ? body : body.slice(0, next + 10)
      expect(route, m[2]).toContain('assertProjectWriteScope(c, projectId, db,')
      expect(route, m[2]).not.toContain('assertProjectScope(c, projectId, db)')
    }
  })

  it('the write scope applies the shared viewer rule to signed-in callers', () => {
    const start = inv.indexOf('async function assertProjectWriteScope')
    const helper = inv.slice(start, start + 700)
    expect(helper).toContain("scope.authMethod !== 'jwt'")
    expect(helper).toContain('denyViewerWrite(c, access.role, action)')
  })
})
