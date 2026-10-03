import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Hono } from 'npm:hono@4'

import { registerWorkspaceNavMetaRoutes } from './workspace-nav-meta.ts'

// The Edge Runtime caps function-to-function fetches per execution trace. The
// old fan-out made ~37 HTTP self-calls in one trace and the runtime rejected the
// tail with "Rate limit exceeded for trace <id>". Model that runtime: any
// network fetch from inside the route throws exactly that.
function withRuntimeTraceLimit<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (() => {
    calls++
    return Promise.reject(new Error('Rate limit exceeded for trace 0123abcd. Retry after 59990ms.'))
  }) as typeof fetch
  return fn().finally(() => {
    globalThis.fetch = realFetch
    assertEquals(calls, 0, 'nav-meta must not re-enter the runtime over HTTP')
  })
}

// deno-lint-ignore no-explicit-any
function buildApp(): Hono<any> {
  // Same basePath Supabase forces on the api function.
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>().basePath('/api')
  app.get('/v1/admin/drift/stats', (c) => {
    // The slice sees the caller's auth + project headers.
    if (c.req.header('Authorization') !== 'Bearer user-jwt') return c.json({ ok: false }, 401)
    return c.json({ ok: true, data: { openFindings: 2, criticalOpen: 1, topPriority: 'critical_findings', extra: 'dropped' } })
  })
  app.get('/v1/admin/health/stats', (c) =>
    c.json({ ok: true, data: { cronErrorCount: 3, redCount: 0, amberCount: 1, topPriority: 'cron_errors' } }),
  )
  app.get('/v1/admin/fixes/stats', (c) => c.json({ ok: false, error: { code: 'DB_ERROR' } }, 500))
  registerWorkspaceNavMetaRoutes(app, async (_c, next) => {
    await next()
  })
  return app
}

Deno.test('nav-meta computes every slice in-process, without HTTP self-calls', async () => {
  await withRuntimeTraceLimit(async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://edge-runtime.internal/api/v1/admin/workspace/nav-meta', {
        headers: { Authorization: 'Bearer user-jwt', 'X-Mushi-Project-Id': 'p1' },
      }),
    )
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.data.slices.drift, { openFindings: 2, criticalOpen: 1, topPriority: 'critical_findings' })
    assertEquals(body.data.slices.health, { cronErrorCount: 3, redCount: 0, amberCount: 1, topPriority: 'cron_errors' })
  })
})

Deno.test('nav-meta names the slices that failed instead of returning silent nulls', async () => {
  await withRuntimeTraceLimit(async () => {
    const app = buildApp()
    const res = await app.fetch(
      new Request('http://edge-runtime.internal/api/v1/admin/workspace/nav-meta', {
        headers: { Authorization: 'Bearer user-jwt' },
      }),
    )
    const body = await res.json()
    const failed = body.data.failedSlices as Array<{ path: string; error: string }>
    assertEquals(body.data.slices.fixes, null)
    assert(failed.some((f) => f.path === '/v1/admin/fixes/stats' && f.error === 'HTTP 500'))
    // Unmounted routes fail with a plain 404, never a runtime trace limit.
    assert(failed.every((f) => !f.error.includes('Rate limit exceeded')))
    assert(!failed.some((f) => f.path === '/v1/admin/drift/stats'))
  })
})
