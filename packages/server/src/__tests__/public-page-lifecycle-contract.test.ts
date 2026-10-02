/**
 * FILE: packages/server/src/__tests__/public-page-lifecycle-contract.test.ts
 * PURPOSE: A public diagram page's files live in S3, outside every database
 *          cascade, so the only record of them is the public_repo_diagrams
 *          row. Each path that drops or rewrites that row must remove the
 *          files first and stop if it cannot:
 *            - unpublish deletes the files before the row;
 *            - a republish under another repo name deletes the old files
 *              before the upsert overwrites the row;
 *            - project delete removes the page before the cascade, and
 *              answers 503 instead of deleting when removal failed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { staleStaticPage } from '../../supabase/functions/_shared/public-page-store.ts'

const FN = resolve(__dirname, '../../supabase/functions/api/routes')
const diagramRoutes = readFileSync(resolve(FN, 'repo-diagram.ts'), 'utf8')
const projectRoutes = readFileSync(resolve(FN, 'projects-crud.ts'), 'utf8')

function indexOrFail(src: string, needle: string): number {
  const i = src.indexOf(needle)
  expect(i, needle).toBeGreaterThan(-1)
  return i
}

describe('staleStaticPage', () => {
  it('is the old page when the repo name changed, and nothing otherwise', () => {
    expect(staleStaticPage(null, { owner: 'a', repo: 'b' })).toBeNull()
    expect(staleStaticPage({ owner: 'Acme', repo: 'Shop' }, { owner: 'acme', repo: 'shop' })).toBeNull()
    expect(staleStaticPage({ owner: 'acme', repo: 'shop' }, { owner: 'acme', repo: 'store' })).toEqual({ owner: 'acme', repo: 'shop' })
    expect(staleStaticPage({ owner: 'old-org', repo: 'shop' }, { owner: 'new-org', repo: 'shop' })).toEqual({ owner: 'old-org', repo: 'shop' })
  })
})

describe('publish', () => {
  it('removes a renamed repo’s old page before overwriting the row, and fails closed', () => {
    const publish = diagramRoutes.slice(indexOrFail(diagramRoutes, "app.post('/v1/admin/projects/:id/codebase/diagram/publish'"))
    const stale = indexOrFail(publish, 'staleStaticPage(')
    const del = indexOrFail(publish, 'await deletePublicPage(storeConfig(), stale.owner, stale.repo)')
    const upsert = indexOrFail(publish, "db.from('public_repo_diagrams').upsert(")
    expect(stale).toBeLessThan(del)
    expect(del).toBeLessThan(upsert)
    expect(publish.slice(del, upsert)).toMatch(/PUBLISH_FAILED[\s\S]*503/)
  })
})

describe('unpublish', () => {
  it('deletes the files before the row and answers 503 when it cannot', () => {
    const unpublish = diagramRoutes.slice(indexOrFail(diagramRoutes, "app.delete('/v1/admin/projects/:id/codebase/diagram/publish'"))
    const del = indexOrFail(unpublish, 'await deletePublicPage(')
    const row = indexOrFail(unpublish, "db.from('public_repo_diagrams').delete()")
    expect(del).toBeLessThan(row)
    expect(unpublish.slice(del, row)).toMatch(/UNPUBLISH_FAILED[\s\S]*503/)
  })
})

describe('project delete', () => {
  it('removes the page before the cascade and stops on failure', () => {
    const remove = indexOrFail(projectRoutes, 'await removeProjectPublicPage(')
    const failed = indexOrFail(projectRoutes, "pageRemoval === 'failed'")
    const del = indexOrFail(projectRoutes, "db.from('projects').delete()")
    expect(remove).toBeLessThan(failed)
    expect(failed).toBeLessThan(del)
    expect(projectRoutes.slice(failed, del)).toMatch(/PUBLIC_PAGE_REMOVAL_FAILED[\s\S]*503/)
  })
})
