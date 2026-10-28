/**
 * FILE: packages/server/src/__tests__/api-ext-routes.test.ts
 * PURPOSE: `api` went over Supabase's 5 MB deploy limit again on 2026-10-22
 *          (#571), so the Codebase Atlas, modernization / super-admin and
 *          agent-skills groups moved to `api-ext`. Every path those route
 *          files register must be forwarded by `api` and registered in
 *          `api-ext`, or the route 404s in production while tests pass.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const fn = (rel: string) => readFileSync(resolve(__dirname, '../../supabase/functions', rel), 'utf8')
const api = fn('api/index.ts')
const ext = fn('api-ext/index.ts')

const MOVED: Array<{ file: string; register: string; count: number }> = [
  { file: 'codebase-understand', register: 'registerCodebaseUnderstandRoutes', count: 15 },
  { file: 'modernization-health-super', register: 'registerModernizationHealthSuperRoutes', count: 9 },
  { file: 'qa-coverage', register: 'registerQaCoverageRoutes', count: 9 },
  { file: 'fullstack-audit', register: 'registerFullstackAuditRoutes', count: 2 },
  { file: 'ux-runs', register: 'registerUxRunsRoutes', count: 6 },
  { file: 'pipeline', register: 'registerPipelineRoutes', count: 3 },
  { file: 'fresh-eyes', register: 'registerFreshEyesRoutes', count: 5 },
]

describe('route groups that run in api-ext', () => {
  for (const g of MOVED) {
    it(`api forwards every ${g.file} path, and api-ext registers the group`, () => {
      const src = fn(`api/routes/${g.file}.ts`)
      const paths = [...new Set([...src.matchAll(/(?:app|parent)\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => m[1]))]
      expect(paths).toHaveLength(g.count)
      for (const p of paths) expect(api, p).toContain(`'${p}'`)
      expect(api).not.toContain(`${g.register}(app)`)
      expect(ext).toContain(`${g.register}(app)`)
    })
  }

  it('api forwards the whole /v1/admin/skills prefix, and api-ext registers it', () => {
    expect(fn('api/routes/skills.ts')).toContain("parent.route('/v1/admin/skills'")
    expect(api).toContain("forwardToApiExt(['/v1/admin/skills', '/v1/admin/skills/*'])")
    expect(api).not.toContain('registerSkillsRoutes(app)')
    expect(ext).toContain('registerSkillsRoutes(app)')
  })
})
