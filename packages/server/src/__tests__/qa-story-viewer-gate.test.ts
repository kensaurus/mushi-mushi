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

describe('generated-test approval refuses viewers', () => {
  it('checks the role before it updates the story', () => {
    const inv = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/inventory.ts'), 'utf8')
    const start = inv.indexOf("'/v1/admin/inventory/:projectId/stories/:qaStoryId/approval'")
    const body = inv.slice(start, start + 2000)
    const gate = body.indexOf('denyViewerWrite(')
    expect(gate).toBeGreaterThan(0)
    expect(body.indexOf(".from('qa_stories')")).toBeGreaterThan(gate)
  })
})
