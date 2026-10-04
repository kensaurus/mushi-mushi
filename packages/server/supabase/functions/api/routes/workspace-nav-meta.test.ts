import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Hono } from 'npm:hono@4'

import { jwtAuth } from '../../_shared/auth.ts'
import {
  buildProjectDirectory,
  clearNavMetaCache,
  parseNavMetaInclude,
  registerWorkspaceNavMetaRoutes,
} from './workspace-nav-meta.ts'

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

// deno-lint-ignore no-explicit-any
function buildAuthedApp(counter: { drift: number }): Hono<any> {
  // deno-lint-ignore no-explicit-any
  const app = new Hono<any>().basePath('/api')
  // The real jwtAuth guards the slice. A trusted sub-request must pass it
  // without a GoTrue call (withRuntimeTraceLimit fails any network fetch).
  app.get('/v1/admin/drift/stats', jwtAuth, (c) => {
    counter.drift++
    return c.json({ ok: true, data: { openFindings: (c as unknown as { get(k: string): unknown }).get('userId') === 'user-1' ? 4 : 0, criticalOpen: 0 } })
  })
  app.get('/v1/admin/fixes/summary', (c) => c.json({ ok: true, data: { inProgress: 2, failed: 1, prsOpen: 3 } }))
  app.get('/v1/admin/reports', (c) => c.json({ ok: true, data: { total: 5 } }))
  app.get('/v1/admin/queue/summary', (c) => c.json({ ok: true, data: { byStatus: { dead_letter: 2, failed: 1, completed: 9 } } }))
  app.get('/v1/admin/inbox/stats', (c) => c.json({ ok: true, data: { openActions: 6 } }))
  app.get('/v1/admin/judge/stats', (c) => c.json({ ok: false, error: { code: 'DB_ERROR' } }, 500))
  registerWorkspaceNavMetaRoutes(app, async (c, next) => {
    c.set('userId', 'user-1')
    c.set('userEmail', 'u1@example.test')
    await next()
  })
  return app
}

function navMetaRequest(query = ''): Request {
  return new Request(`http://edge-runtime.internal/api/v1/admin/workspace/nav-meta${query}`, {
    headers: { Authorization: 'Bearer user-jwt', 'X-Mushi-Org-Id': 'org-1' },
  })
}

Deno.test('nav-meta slices reuse the verified user instead of calling GoTrue again', async () => {
  clearNavMetaCache()
  await withRuntimeTraceLimit(async () => {
    const counter = { drift: 0 }
    const res = await buildAuthedApp(counter).fetch(navMetaRequest())
    const body = await res.json()
    assertEquals(body.data.slices.drift.openFindings, 4)
    assertEquals(counter.drift, 1)
  })
})

Deno.test('a forged request never inherits the trust of a fan-out sub-request', async () => {
  // Direct call to the slice: no fan-out marked it, so jwtAuth must try to
  // verify the token for real (here: a network call that fails -> 401/500).
  const realFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  try {
    const counter = { drift: 0 }
    const res = await Promise.resolve(
      buildAuthedApp(counter).fetch(
        new Request('http://edge-runtime.internal/api/v1/admin/drift/stats', {
          headers: { Authorization: 'Bearer user-jwt' },
        }),
      ),
    ).catch(() => null)
    assert(res === null || res.status === 401 || res.status === 500)
    assertEquals(counter.drift, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})

Deno.test('nav-meta folds the sidebar counters in when asked, keeping null for a failed one', async () => {
  clearNavMetaCache()
  await withRuntimeTraceLimit(async () => {
    const res = await buildAuthedApp({ drift: 0 }).fetch(navMetaRequest('?include=counts'))
    const { counts } = (await res.json()).data
    assertEquals(counts.fixesInFlight, 2)
    assertEquals(counts.fixesFailed, 1)
    assertEquals(counts.prsOpen, 3)
    assertEquals(counts.untriagedBacklog, 5)
    assertEquals(counts.queueFailed, 3)
    assertEquals(counts.inboxOpenActions, 6)
    // judge/stats failed: no number, not a fake zero.
    assertEquals(counts.judgeDisagreements, null)
    // Not requested: no inventory or super-admin numbers.
    assertEquals(counts.regressedActions, null)
    assertEquals(counts.superAdminSignups7d, null)
  })
})

Deno.test('nav-meta without include keeps the old shape (counts: null)', async () => {
  clearNavMetaCache()
  await withRuntimeTraceLimit(async () => {
    const res = await buildAuthedApp({ drift: 0 }).fetch(navMetaRequest())
    assertEquals((await res.json()).data.counts, null)
  })
})

Deno.test('nav-meta reuses a recent answer per user, and fresh=1 recomputes it', async () => {
  clearNavMetaCache()
  await withRuntimeTraceLimit(async () => {
    const counter = { drift: 0 }
    const app = buildAuthedApp(counter)
    const first = (await (await app.fetch(navMetaRequest())).json()).data
    const second = (await (await app.fetch(navMetaRequest())).json()).data
    assertEquals(first.servedFromCache, false)
    assertEquals(second.servedFromCache, true)
    assertEquals(counter.drift, 1)
    const fresh = (await (await app.fetch(navMetaRequest('?fresh=1'))).json()).data
    assertEquals(fresh.servedFromCache, false)
    assertEquals(counter.drift, 2)
    // A counts request is a different answer, never served from the plain one.
    const withCounts = (await (await app.fetch(navMetaRequest('?include=counts'))).json()).data
    assertEquals(withCounts.servedFromCache, false)
    assert(typeof withCounts.timingsMs['/v1/admin/drift/stats'] === 'number')
  })
})

Deno.test('parseNavMetaInclude keeps only known parts', () => {
  assertEquals([...parseNavMetaInclude('counts, inventory,bogus,SUPERADMIN')].sort(), [
    'counts',
    'inventory',
    'superadmin',
  ])
  assertEquals(parseNavMetaInclude(undefined).size, 0)
})

Deno.test('buildProjectDirectory lists teams in join order and names every project team', () => {
  const dir = buildProjectDirectory(
    [
      { role: 'owner', organizations: { id: 'o1', name: 'Mushi', is_personal: false } },
      { role: 'member', organizations: [{ id: 'o2', name: '  ', is_personal: true }] },
      { role: 'member', organizations: { id: 'o1', name: 'dup' } },
    ],
    [
      { id: 'p2', name: 'glot.it', organization_id: 'o2' },
      { id: 'p1', name: 'mushi-mushi', organization_id: 'o1' },
      { id: 'p3', name: null, organization_id: null },
    ],
  )
  assertEquals(dir.teams.map((t) => [t.id, t.name, t.role, t.isPersonal]), [
    ['o1', 'Mushi', 'owner', false],
    ['o2', 'Untitled team', 'member', true],
  ])
  assertEquals(dir.projects.map((p) => [p.id, p.organizationId]), [
    ['p2', 'o2'],
    ['p1', 'o1'],
    ['p3', null],
  ])
})
