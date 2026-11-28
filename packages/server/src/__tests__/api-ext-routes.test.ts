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
const loop = fn('api-loop/index.ts')

const MOVED: Array<{ file: string; register: string; count: number }> = [
  { file: 'codebase-understand', register: 'registerCodebaseUnderstandRoutes', count: 15 },
  { file: 'modernization-health-super', register: 'registerModernizationHealthSuperRoutes', count: 9 },
  { file: 'qa-coverage', register: 'registerQaCoverageRoutes', count: 9 },
  { file: 'fullstack-audit', register: 'registerFullstackAuditRoutes', count: 2 },
  { file: 'pipeline', register: 'registerPipelineRoutes', count: 3 },
  { file: 'journeys', register: 'registerJourneyRoutes', count: 3 },
  { file: 'landing-visits', register: 'registerLandingVisitRoutes', count: 2 },
  { file: 'health-checks', register: 'registerHealthCheckRoutes', count: 1 },
  { file: 'recipe-ingest', register: 'registerRecipeIngestRoutes', count: 5 },
  { file: 'spend-ledger', register: 'registerSpendLedgerRoutes', count: 3 },
  { file: 'ops', register: 'registerOpsRoutes', count: 10 },
  { file: 'accounts-register', register: 'registerAccountsRegisterRoutes', count: 4 },
  { file: 'kensaurus-ops', register: 'registerKensaurusOpsRoutes', count: 1 },
]

// 2026-11-27: api-ext reached the deployment size limit (HTTP 413), so the
// loop's groups run in api-loop. api forwards them there, not to api-ext.
const LOOP: Array<{ file: string; register: string; count: number }> = [
  { file: 'ux-runs', register: 'registerUxRunsRoutes', count: 6 },
  { file: 'fresh-eyes', register: 'registerFreshEyesRoutes', count: 6 },
  { file: 'ux-scorecard', register: 'registerUxScorecardRoutes', count: 6 },
  { file: 'ux-timeline', register: 'registerUxTimelineRoutes', count: 6 },
  { file: 'ux-captures', register: 'registerUxCaptureRoutes', count: 1 },
  { file: 'personas', register: 'registerPersonaRoutes', count: 3 },
  { file: 'security-proof', register: 'registerSecurityProofRoutes', count: 5 },
  { file: 'fine-tuning', register: 'registerFineTuningRoutes', count: 9 },
]

describe('route groups that run in api-loop', () => {
  const loopForwards = [...api.matchAll(/forwardToApiLoop\(\[([\s\S]*?)\]\)/g)].map((m) => m[1]).join(' ')
  const loopPatterns = [...loopForwards.matchAll(/'([^']+)'/g)].map((m) => m[1])
  // A forward ending in /* covers every path under its prefix (Hono wildcard).
  const forwardedToLoop = (p: string) => loopPatterns.some((f) => f === p || (f.endsWith('/*') && p.startsWith(f.slice(0, -1))))
  for (const g of LOOP) {
    it(`api forwards every ${g.file} path to api-loop, and only api-loop registers the group`, () => {
      const src = fn(`api/routes/${g.file}.ts`)
      const paths = [...new Set([...src.matchAll(/(?:app|parent)\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => m[1]))]
      expect(paths).toHaveLength(g.count)
      for (const p of paths) expect(forwardedToLoop(p), p).toBe(true)
      expect(api).not.toContain(`${g.register}(app)`)
      expect(ext).not.toContain(`${g.register}(app)`)
      expect(loop).toContain(`${g.register}(app)`)
    })
  }

  it('api forwards every release-kit path to api-loop through the release prefix', () => {
    expect(loopForwards).toContain("'/v1/admin/projects/:id/releases/:rid/*'")
    expect(ext).not.toContain('registerReleaseKitRoutes(app)')
    expect(loop).toContain('registerReleaseKitRoutes(app)')
  })
})

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

  // 2026-11-11 audit: a forward is a second edge invocation. The runner push
  // and the worker heartbeat (each about one a minute per machine) are served
  // by `api` itself from small modules; api-ext keeps them for direct callers.
  it('api serves the runner push and the worker heartbeat itself, before any forward catches them', () => {
    expect(api).toContain('registerRunnerIngestRoute(app);')
    expect(api).toContain('registerWorkerHeartbeatRoute(app);')
    expect(api).not.toContain("'/v1/ingest/runner'")
    // Hono runs handlers in registration order: the heartbeat must come before the /v1/worker/* forward.
    expect(api.indexOf('registerWorkerHeartbeatRoute(app);')).toBeLessThan(api.indexOf("forwardToApiExt(['/v1/worker/*'"))
    expect(api).not.toContain('registerCiRoutes(app)')
    expect(api).not.toContain('registerWorkRoutes(app)')
    expect(ext).toContain('registerCiRoutes(app)')
    expect(ext).toContain('registerWorkRoutes(app)')
    expect(fn('api/routes/ci.ts')).toContain('registerRunnerIngestRoute(app, deps)')
    expect(fn('api/routes/work.ts')).toContain('registerWorkerHeartbeatRoute(app, deps)')
  })
})
