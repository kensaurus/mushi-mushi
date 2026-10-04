/**
 * FILE: packages/server/src/__tests__/lessons-console-contract.test.ts
 * PURPOSE: Source-level contract for the /lessons console fixes (no Deno boot,
 *          same style as content-quality-admin-safety.test.ts).
 *
 *   #12  Query Sim: a console JWT caller that names no project in the body
 *        must fall back to the X-Mushi-Project-Id header apiFetch sends,
 *        instead of 400 PROJECT_REQUIRED on every click.
 *   #205 Promote: claim the cluster (candidate -> promoted) BEFORE inserting
 *        the lesson, so a second click cannot create a duplicate lesson.
 *   Viewers keep read access but cannot promote or retire.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/lessons.ts'), 'utf8')

function routeBody(signature: string): string {
  const start = src.indexOf(signature)
  expect(start, `${signature} should exist`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf('\n  app.', start + signature.length)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('lessons.query (#12)', () => {
  const body = routeBody("app.post('/v1/admin/lessons/query'")

  it('falls back to the console project header for JWT callers', () => {
    expect(body).toMatch(/body\.data\.project_id \?\? c\.req\.query\('project_id'\) \?\? c\.req\.header\('x-mushi-project-id'\)/)
  })

  it('never echoes the raw upstream embedding error to the caller', () => {
    expect(body).not.toMatch(/Embedding failed: \$\{err\}/)
  })

  it('answers with structured errors only', () => {
    expect(body).not.toMatch(/error: '[^']*'\s*\}/)
  })
})

describe('cluster promote (#205)', () => {
  const body = routeBody("app.post('/v1/admin/clusters/:id/promote'")

  it('claims the candidate cluster before inserting the lesson', () => {
    const claim = body.indexOf(".eq('status', 'candidate')")
    const insert = body.indexOf(".from('lessons').insert(")
    expect(claim).toBeGreaterThan(0)
    expect(insert).toBeGreaterThan(claim)
  })

  it('returns 409 ALREADY_PROMOTED when nothing was claimed', () => {
    expect(body).toMatch(/ALREADY_PROMOTED/)
    expect(body).toMatch(/409/)
  })

  it('denies viewers', () => {
    expect(body).toMatch(/denyViewerWrite\(/)
  })
})

describe('lesson retire/restore', () => {
  const body = routeBody("app.patch('/v1/admin/lessons/:id'")

  it('denies viewers', () => {
    expect(body).toMatch(/denyViewerWrite\(/)
  })
})
