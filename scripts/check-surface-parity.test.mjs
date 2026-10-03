/**
 * Tests for scripts/check-surface-parity.mjs — run with `pnpm test:scripts`.
 * Fixtures are inline sources, so the cases do not depend on today's routes;
 * the last case runs the check against the real repo.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkParity,
  classifyAuth,
  consoleRoutes,
  extractAdminLiterals,
  extractCliCommands,
  extractDynamicCalls,
  extractServerRoutes,
  loadInputs,
  matchAdminLiteral,
  normalizeAdminLiteral,
} from './check-surface-parity.mjs'

const serverFiles = [
  {
    file: 'routes/portfolio.ts',
    source: `
      const readAuth = adminOrApiKey({ scope: 'mcp:read' })
      app.get('/v1/admin/orgs/:orgId/portfolio', readAuth, async (c) => {})
      app.post('/v1/admin/orgs/:orgId/connectors', deps.jwtAuth, async (c) => {})
      app.get('/v1/admin/reports/stats', jwtAuth, async (c) => {})
      app.get('/v1/admin/reports/:id', adminOrApiKey(), async (c) => {})
      for (const verb of ['approve']) {
        app.post(\`/v1/admin/orgs/:orgId/actions/:actionId/\${verb}\`, deps.jwtAuth, async (c) => {})
      }
    `,
  },
  {
    file: 'routes/board.ts',
    source: `
      export function registerBoard(parent) { parent.route('/v1/admin/board', boardRoutes()) }
      function boardRoutes() {
        const r = new Hono()
        r.use('*', (c, next) => c.req.method === 'GET' ? adminOrApiKey({ scope: 'mcp:read' })(c, next) : requireAuth(c, next), requireProjectAccess)
        r.get('/', async (c) => {})
        r.post('/:id/vote', async (c) => {})
        return r
      }
    `,
  },
  {
    file: 'routes/nav.ts',
    source: `
      const NAV_PATH = '/v1/admin/nav'
      export function registerNav(app, auth: MiddlewareHandler = jwtAuth) {
        app.get(NAV_PATH, auth, async (c) => {})
      }
    `,
  },
]

test('classifyAuth tells a console-only route from a key route, per method', () => {
  assert.equal(classifyAuth('jwtAuth'), 'jwt')
  assert.equal(classifyAuth('requireAuth, requireProjectAccess'), 'jwt')
  assert.equal(classifyAuth('requireAuthOrApiKey'), 'key')
  assert.equal(classifyAuth('deps.adminOrApiKeyRead'), 'key')
  assert.equal(classifyAuth('apiKeyAuth'), 'sdk')
  assert.equal(classifyAuth('async'), 'other')
  const split = "c.req.method === 'GET' ? adminOrApiKey({ scope: 'mcp:read' })(c, next) : requireAuth(c, next)"
  assert.equal(classifyAuth(split, 'GET'), 'key')
  assert.equal(classifyAuth(split, 'POST'), 'jwt')
})

test('extractServerRoutes resolves aliases, templates, sub-router mounts and path constants', () => {
  const routes = extractServerRoutes(serverFiles)
  const byKey = Object.fromEntries(routes.map((r) => [`${r.method} ${r.path}`, r.auth]))
  assert.equal(byKey['GET /v1/admin/orgs/:orgId/portfolio'], 'key')
  assert.equal(byKey['POST /v1/admin/orgs/:orgId/connectors'], 'jwt')
  assert.equal(byKey['POST /v1/admin/orgs/:orgId/actions/:actionId/:param'], 'jwt')
  assert.equal(byKey['GET /v1/admin/board'], 'key')
  assert.equal(byKey['POST /v1/admin/board/:id/vote'], 'jwt')
  assert.equal(byKey['GET /v1/admin/nav'], 'jwt')
})

test('normalizeAdminLiteral handles params, query suffixes and bare prefixes', () => {
  assert.deepEqual(normalizeAdminLiteral('/v1/admin/reports/${}'), ['v1', 'admin', 'reports', ':'])
  assert.deepEqual(normalizeAdminLiteral('/v1/admin/reports${}'), ['v1', 'admin', 'reports'])
  assert.deepEqual(normalizeAdminLiteral('/v1/admin/reports?status=new'), ['v1', 'admin', 'reports'])
  assert.deepEqual(normalizeAdminLiteral('/v1/admin/x-${}/y'), ['v1', 'admin', ':', 'y'])
  assert.equal(normalizeAdminLiteral('/v1/admin/inventory/'), null)
})

test('matchAdminLiteral prefers the exact static segment over a parameter', () => {
  const routes = extractServerRoutes(serverFiles)
  assert.deepEqual(matchAdminLiteral(['v1', 'admin', 'reports', 'stats'], routes), ['/v1/admin/reports/stats'])
  assert.deepEqual(matchAdminLiteral(['v1', 'admin', 'reports', ':'], routes), ['/v1/admin/reports/:id'])
  assert.deepEqual(matchAdminLiteral(['v1', 'admin', 'orgs', ':', 'actions', ':', 'approve'], routes), ['/v1/admin/orgs/:orgId/actions/:actionId/:param'])
})

test('consoleRoutes takes every server method on a matched path and counts unmatched literals', () => {
  const routes = extractServerRoutes(serverFiles)
  const literals = extractAdminLiterals([
    { file: 'Page.tsx', source: "apiFetch(`/v1/admin/orgs/${org}/portfolio`); apiFetch('/v1/admin/board'); apiFetch(`/v1/push/${x}`)" },
  ])
  const { used, unresolved } = consoleRoutes(literals, routes)
  assert.deepEqual([...used.keys()].sort(), ['GET /v1/admin/board', 'GET /v1/admin/orgs/:orgId/portfolio'])
  assert.equal(unresolved.length, 1)
})

// Routes for the composed-path cases below.
const composedServer = extractServerRoutes([{
  file: 'routes/composed.ts',
  source: `
    app.get('/v1/admin/orgs/:orgId/portfolio/findings', adminOrApiKey(), async (c) => {})
    app.get('/v1/admin/inventory/:projectId/findings', adminOrApiKey(), async (c) => {})
    app.get('/v1/admin/inventory/:projectId/user-stories', adminOrApiKey(), async (c) => {})
    app.post('/v1/admin/orgs/:orgId/connector-actions/:actionId/:verb', jwtAuth, async (c) => {})
    app.get('/v1/admin/projects/:id/codebase/digest', adminOrApiKey(), async (c) => {})
    app.get('/v1/admin/fixes/dispatch/:id/stream', adminOrApiKey(), async (c) => {})
  `,
}])

function usedKeys(files) {
  return [...consoleRoutes(extractAdminLiterals(files), composedServer).used.keys()].sort()
}

test('a call built from a same-file path constant (`${path}/x`) is a console route', () => {
  const files = [{
    file: 'apps/admin/src/pages/PortfolioPage.tsx',
    source: `
      function OrgPortfolio({ orgId }) {
        const path = \`/v1/admin/orgs/\${orgId}/portfolio\`
        const findings = usePageData(\`\${path}/findings\`)
      }
    `,
  }]
  assert.deepEqual(usedKeys(files), ['GET /v1/admin/orgs/:orgId/portfolio/findings'])
  assert.deepEqual(extractDynamicCalls(files), [])
})

test('a ternary base (`id ? `/v1/…` : null`) expands inside a later condition', () => {
  const files = [{
    file: 'apps/admin/src/pages/InventoryPage.tsx',
    source: `
      const basePath = projectId ? \`/v1/admin/inventory/\${projectId}\` : null
      const stories = usePageData(
        basePath ? \`\${basePath}/user-stories\` : null,
        { deps: [projectId] },
      )
      const findings = usePageData(
        basePath && (tab === 'gates' || tab === 'stories') ? \`\${basePath}/findings\` : null,
      )
    `,
  }]
  assert.deepEqual(usedKeys(files), ['GET /v1/admin/inventory/:projectId/findings', 'GET /v1/admin/inventory/:projectId/user-stories'])
  assert.deepEqual(extractDynamicCalls(files), [])
})

test('a local helper that forwards its first parameter is checked at its own call sites', () => {
  const files = [{
    file: 'apps/admin/src/components/portfolio/ActionsCard.tsx',
    source: `
      export function ActionsCard({ orgId, a }) {
        const path = \`/v1/admin/orgs/\${orgId}/connector-actions\`
        const run = async (url: string, body: unknown) => {
          const res = await apiFetchMutate(url, { method: 'POST', body: JSON.stringify(body) })
        }
        return <Btn onClick={() => run(\`\${path}/\${a.id}/approve\`, {})}>Approve</Btn>
      }
    `,
  }]
  assert.deepEqual(usedKeys(files), ['POST /v1/admin/orgs/:orgId/connector-actions/:actionId/:verb'])
  assert.deepEqual(extractDynamicCalls(files), [])
  // The same helper fed a prop is a route the check cannot see.
  const fed = [{ ...files[0], source: files[0].source.replace('run(`${path}/${a.id}/approve`, {})', 'run(a.url, {})') }]
  assert.deepEqual(extractDynamicCalls(fed), [{ file: files[0].file, call: 'run', arg: 'a.url' }])
})

test('a path builder imported from a sibling module resolves', () => {
  const files = [
    { file: 'apps/admin/src/lib/repo.ts', source: 'export function digestPath(id: string): string {\n  return `/v1/admin/projects/${id}/codebase/digest`\n}\n' },
    { file: 'apps/admin/src/components/Copy.tsx', source: "import { digestPath } from '../lib/repo'\nconst res = await apiFetch<X>(digestPath(projectId), { cache: 'no-store' })\n" },
  ]
  assert.deepEqual(extractDynamicCalls(files), [])
})

test('a path built from a prop fails the check unless dynamicCalls gives a reason', () => {
  const files = [{
    file: 'apps/admin/src/components/Card.tsx',
    source: `
      // apiFetch(base) in a comment is not a call
      export function Card({ base }: { base: string }) {
        const run = () => apiFetchMutate(\`\${base}/run\`, { method: 'POST' })
      }
    `,
  }]
  const dynamicCalls = extractDynamicCalls(files)
  assert.deepEqual(dynamicCalls, [{ file: 'apps/admin/src/components/Card.tsx', call: 'apiFetchMutate', arg: '`${base}/run`' }])
  const failing = checkParity({ used: used([]), mapping: mapping({}), mcpTools, cliCommands, dynamicCalls })
  assert.equal(failing.errors.length, 1)
  assert.match(failing.errors[0], /cannot follow/)
  const allowed = { ...mapping({}), dynamicCalls: { 'apps/admin/src/components/Card.tsx': { '`${base}/run`': 'base is always the radar path' } } }
  assert.deepEqual(checkParity({ used: used([]), mapping: allowed, mcpTools, cliCommands, dynamicCalls }).errors, [])
})

test('a destructured prop does not borrow an earlier component\'s path constant', () => {
  const file = 'apps/admin/src/components/Two.tsx'
  const files = [{
    file,
    source: `
      function A() {
        const path = '/v1/admin/a'
        return usePageData(path)
      }
      function B({ path }: Props) {
        return usePageData(path)
      }
      const C = ({ title, path }) => usePageData(path)
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'usePageData', arg: 'path' },
    { file, call: 'usePageData', arg: 'path' },
  ])
})

test('one literal branch does not vouch for a ternary whose other branch is a prop', () => {
  const file = 'apps/admin/src/components/Mixed.tsx'
  const files = [{
    file,
    source: `
      export function Mixed({ cond, props }) {
        const p = cond ? '/v1/admin/a' : props.url
        apiFetch(p)
        apiFetch(\`\${p}/x\`)
        const q = cond ? '/v1/admin/a' : null
        apiFetch(q)
        apiFetch(\`\${q}/x\`)
      }
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg: 'p' },
    { file, call: 'apiFetch', arg: '`${p}/x`' },
  ])
})

test('a nested ternary is split at the colon that closes the outer `?`', () => {
  const file = 'apps/admin/src/lib/useStatus.ts'
  const resolved = [{
    file,
    source: `
      const path = enabled
        ? projectId
          ? \`/v1/admin/activation?project_id=\${projectId}\`
          : '/v1/admin/activation'
        : null
      usePageData(path)
    `,
  }]
  assert.deepEqual(extractDynamicCalls(resolved), [])
  const leaky = [{ file, source: resolved[0].source.replace(": '/v1/admin/activation'", ': props.url') }]
  assert.deepEqual(extractDynamicCalls(leaky), [{ file, call: 'usePageData', arg: 'path' }])
})

test('a literal joined to anything else is not resolved, inline or through a const', () => {
  const file = 'apps/admin/src/components/Concat.tsx'
  const files = [{
    file,
    source: `
      export function Concat({ id, tail, props }) {
        apiFetch('/v1/admin/projects/' + id + '/brand-new', { method: 'POST' })
        const a = props.override ?? '/v1/admin/a'
        apiFetch(a)
        const b = props.url || '/v1/admin/b'
        apiFetch(b)
        const c = '/v1/admin/c/' + tail
        apiFetch(c)
        const base = '/v1/admin/d'
        apiFetch(base + tail)
        apiFetch(base)
        const e = props.url || enabled && '/v1/admin/e'
        apiFetch(e)
        const f = (props.url || enabled) && '/v1/admin/f'
        apiFetch(f)
      }
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg: "'/v1/admin/projects/' + id + '/brand-new'" },
    { file, call: 'apiFetch', arg: 'a' },
    { file, call: 'apiFetch', arg: 'b' },
    { file, call: 'apiFetch', arg: 'c' },
    { file, call: 'apiFetch', arg: 'base + tail' },
    { file, call: 'apiFetch', arg: 'e' },
  ])
})

test('a new route reached by concatenation fails the check end to end', () => {
  const routes = extractServerRoutes([{ file: 'routes/radar.ts', source: "app.post('/v1/admin/projects/:id/brand-new', adminOrApiKeyWrite, async (c) => {})" }])
  const files = [{ file: 'apps/admin/src/components/New.tsx', source: "export const go = (id) => apiFetch('/v1/admin/projects/' + id + '/brand-new', { method: 'POST' })\n" }]
  const { used: seen } = consoleRoutes(extractAdminLiterals(files), routes)
  const { errors } = checkParity({ used: seen, mapping: mapping({}), mcpTools, cliCommands, dynamicCalls: extractDynamicCalls(files) })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /New\.tsx: apiFetch\('\/v1\/admin\/projects\/' \+ id \+ '\/brand-new', …\) builds its path/)
})

test('a function binding resolves only when every return does; an IIFE likewise', () => {
  const file = 'apps/admin/src/lib/paths.ts'
  // Top-level functions start a line, as in a real module.
  const source = [
    'export function good(id: string): string {',
    '  if (!id) return null',
    '  return `/v1/admin/x/${id}`',
    '}',
    'export function bad(p: { override?: string }) {',
    "  return p.override ?? '/v1/admin/x'",
    '}',
    'const arrow = (id: string) => `/v1/admin/y/${id}`',
    'const catalogUrl = (() => {',
    "  const qs = new URLSearchParams({ limit: '200' })",
    '  return `/v1/admin/skills?${qs}`',
    '})()',
    'apiFetch(good(id))',
    'apiFetch(bad(p))',
    'apiFetch(arrow(id))',
    'usePageData(catalogUrl)',
  ].join('\n')
  const files = [{ file, source }]
  assert.deepEqual(extractDynamicCalls(files), [{ file, call: 'apiFetch', arg: 'bad(p)' }])
})

test('an arrow-callback parameter shadows an outer path constant', () => {
  const file = 'apps/admin/src/components/Shadow.tsx'
  const files = [{
    file,
    source: `
      export function Shadow({ items }) {
        const path = '/v1/admin/known'
        items.map((path) => apiFetch(\`\${path}/secret\`))
        const run = useCallback(async (path: string) => apiFetch(\`\${path}/secret\`), [])
        items.forEach(path => apiFetch(\`\${path}/secret\`))
        items.map((path) => path.length)
        return usePageData(\`\${path}/ok\`)
      }
    `,
  }]
  const arg = '`${path}/secret`'
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg },
    { file, call: 'apiFetch', arg },
    { file, call: 'apiFetch', arg },
  ])
  const literals = extractAdminLiterals(files).map((l) => l.literal)
  assert.ok(!literals.includes('/v1/admin/known/secret'), literals.join(', '))
  assert.ok(literals.includes('/v1/admin/known/ok'), literals.join(', '))
})

test('a run-time segment that lands on a static server segment needs a computedPaths reason', () => {
  const routes = extractServerRoutes([{
    file: 'routes/projects.ts',
    source: `
      app.post('/v1/admin/projects/:id/pause', adminOrApiKey(), async (c) => {})
      app.post('/v1/admin/projects/:id/resume', adminOrApiKey(), async (c) => {})
      app.get('/v1/admin/reports/:id', adminOrApiKey(), async (c) => {})
    `,
  }])
  const file = 'apps/admin/src/components/Toggle.tsx'
  const files = [{ file, source: "apiFetch(`/v1/admin/projects/${p.id}/${p.action}`, { method: 'POST' })\napiFetch(`/v1/admin/reports/${id}`)\n" }]
  const { used: seen, computed } = consoleRoutes(extractAdminLiterals(files), routes)
  assert.deepEqual(computed, [{ file, arg: '/v1/admin/projects/${}/${}', routes: ['/v1/admin/projects/:id/pause', '/v1/admin/projects/:id/resume'] }])
  const routeMap = mapping({
    'POST /v1/admin/projects/:id/pause': { allow: 'parity-debt' },
    'POST /v1/admin/projects/:id/resume': { allow: 'parity-debt' },
    'GET /v1/admin/reports/:id': { allow: 'parity-debt' },
  })
  const failing = checkParity({ used: seen, mapping: routeMap, mcpTools, cliCommands, computedPaths: computed })
  assert.equal(failing.errors.length, 1)
  assert.match(failing.errors[0], /Toggle\.tsx: path \/v1\/admin\/projects\/\$\{\}\/\$\{\} fills a static server segment .* 2 route\(s\)/)
  const allowed = { ...routeMap, computedPaths: { [file]: { '/v1/admin/projects/${}/${}': "action is 'pause' | 'resume'" } } }
  assert.deepEqual(checkParity({ used: seen, mapping: allowed, mcpTools, cliCommands, computedPaths: computed }).errors, [])
  const stale = checkParity({ used: seen, mapping: allowed, mcpTools, cliCommands, computedPaths: [] })
  assert.equal(stale.errors.length, 1)
  assert.match(stale.errors[0], /computedPaths .*Toggle\.tsx .*stale entry/)
})

test('openSseStream is checked through its url option, raw fetch once it writes an API path', () => {
  const file = 'apps/admin/src/lib/streams.ts'
  const files = [{
    file,
    source: `
      await openSseStream({ url: \`\${RESOLVED_API_URL}/v1/admin/fixes/dispatch/\${id}/stream\`, bearer, onEvent: (e) => handle(e, { a: 1 }) })
      await openSseStream({ bearer, url: props.url })
      await openSseStream(opts)
      await fetch(\`\${RESOLVED_API_URL}/v1/admin/ask-mushi/messages/stream\`, { method: 'POST' })
      await fetch(\`\${RESOLVED_API_URL}/v1/admin/\` + tail)
      const u = \`\${RESOLVED_API_URL}/v1/admin/\` + tail
      await fetch(u)
      await fetch(\`\${SUPABASE_URL}/auth/v1/health\`)
      await fetch(target.signedUrl, { method: 'PUT' })
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'openSseStream', arg: 'props.url' },
    { file, call: 'openSseStream', arg: 'opts' },
    { file, call: 'fetch', arg: '`${RESOLVED_API_URL}/v1/admin/` + tail' },
    { file, call: 'fetch', arg: 'u' },
  ])
})

test('a dynamicCalls entry for a call that no longer exists is stale', () => {
  const stale = { ...mapping({}), dynamicCalls: { 'apps/admin/src/components/Gone.tsx': { path: 'was a prop' } } }
  const { errors } = checkParity({ used: used([]), mapping: stale, mcpTools, cliCommands, dynamicCalls: [] })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /dynamicCalls .*Gone\.tsx "path": stale entry/)
})

test('`${API_URL}/v1/…` counts its /v1 tail as a console route', () => {
  const files = [{ file: 'apps/admin/src/lib/dispatchFix.ts', source: 'const url = `${RESOLVED_API_URL}/v1/admin/fixes/dispatch/${dispatchId}/stream`\n' }]
  assert.deepEqual(usedKeys(files), ['GET /v1/admin/fixes/dispatch/:id/stream'])
})

test('extractCliCommands follows variables, nesting and comment lines', () => {
  const cmds = extractCliCommands([{
    file: 'repo.ts',
    source: `
      const repo = program
        .command('repo')
      repo.command('digest')
      const diagram = repo
        .command('diagram')
      // a comment between the receiver and the call
      diagram
        // another
        .command('publish')
      program.command('releases').command('ignored-chain')
    `,
  }])
  for (const c of ['repo', 'repo digest', 'repo diagram', 'repo diagram publish', 'releases']) assert.ok(cmds.has(c), c)
})

function used(entries) {
  return new Map(entries.map(([key, auth]) => [key, { method: key.split(' ')[0], path: key.split(' ')[1], auth, file: 'routes/x.ts', from: new Set(['Page.tsx']) }]))
}
const mapping = (routes) => ({ reasons: { 'jwt-only': 'x', 'parity-debt': 'y' }, routes })
const mcpTools = new Set(['get_portfolio'])
const cliCommands = new Set(['portfolio show'])

test('checkParity passes a fully mapped console', () => {
  const { errors, stats } = checkParity({
    used: used([['GET /a', 'key'], ['POST /b', 'jwt'], ['GET /c', 'key']]),
    mapping: mapping({ 'GET /a': { mcp: ['get_portfolio'], cli: ['mushi portfolio show --org <id>'] }, 'POST /b': { allow: 'jwt-only' }, 'GET /c': { allow: 'parity-debt' } }),
    mcpTools,
    cliCommands,
  })
  assert.deepEqual(errors, [])
  assert.equal(stats.allowed, 2)
})

test('checkParity fails a new console route with no entry', () => {
  const { errors } = checkParity({ used: used([['GET /new', 'key']]), mapping: mapping({}), mcpTools, cliCommands })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /GET \/new .* no MCP tool, CLI command or allowlist reason/)
})

test('checkParity fails unknown tools, unknown commands, unknown reasons and mixed entries', () => {
  const { errors } = checkParity({
    used: used([['GET /a', 'key'], ['GET /b', 'key'], ['GET /c', 'key'], ['GET /d', 'key'], ['GET /e', 'key']]),
    mapping: mapping({
      'GET /a': { mcp: ['no_such_tool'] },
      'GET /b': { cli: ['portfolio missing'] },
      'GET /c': { allow: 'because' },
      'GET /d': { mcp: ['get_portfolio'], allow: 'parity-debt' },
      'GET /e': {},
    }),
    mcpTools,
    cliCommands,
  })
  assert.equal(errors.length, 5)
  assert.ok(errors.some((e) => e.includes('"no_such_tool"')))
  assert.ok(errors.some((e) => e.includes('mushi portfolio missing')))
  assert.ok(errors.some((e) => e.includes('unknown reason "because"')))
  assert.ok(errors.some((e) => e.includes('both a surface and "allow"')))
  assert.ok(errors.some((e) => e.includes('needs "mcp", "cli" or "allow"')))
})

test('checkParity refuses jwt-only on a route that takes an API key', () => {
  const { errors } = checkParity({ used: used([['GET /a', 'key']]), mapping: mapping({ 'GET /a': { allow: 'jwt-only' } }), mcpTools, cliCommands })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /accepts an API key/)
})

test('checkParity fails a stale entry the console no longer calls', () => {
  const { errors } = checkParity({ used: used([]), mapping: mapping({ 'GET /gone': { allow: 'parity-debt' } }), mcpTools, cliCommands })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /stale entry/)
})

test('the checked-in mapping matches the repo', () => {
  const { errors } = checkParity(loadInputs())
  assert.deepEqual(errors, [])
})

// ── name binding is scope-aware and fails closed ──────────────────────────────

test('a reassigned let does not resolve to its initializer', () => {
  const file = 'apps/admin/src/components/Reassign.tsx'
  const files = [{
    file,
    source: `
      export function Reassign({ id, props, list }) {
        let url = \`/v1/admin/projects/\${id}/radar\`
        url = props.url
        apiFetch(url, { method: 'POST' })
        let next = \`/v1/admin/projects/\${id}\`
        next += '/brand-new'
        apiFetch(next, { method: 'POST' })
        let maybe = '/v1/admin/projects/known/radar'
        maybe ??= props.url
        apiFetch(maybe)
        let raw = '/v1/admin/projects/known/radar'
        raw = props.url
        fetch(raw)
        let steady = '/v1/admin/projects/known/radar'
        apiFetch(steady)
      }
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg: 'url' },
    { file, call: 'apiFetch', arg: 'next' },
    { file, call: 'apiFetch', arg: 'maybe' },
    { file, call: 'fetch', arg: 'raw' },
  ])
  const literals = extractAdminLiterals(files).map((l) => l.literal)
  assert.ok(literals.includes('/v1/admin/projects/known/radar'), literals.join(', '))
})

test('a new route reached through `+=` fails the check end to end', () => {
  const routes = extractServerRoutes([{
    file: 'routes/radar.ts',
    source: `
      app.post('/v1/admin/projects/:id', adminOrApiKeyWrite, async (c) => {})
      app.post('/v1/admin/projects/:id/brand-new', adminOrApiKeyWrite, async (c) => {})
    `,
  }])
  const files = [{
    file: 'apps/admin/src/components/Append.tsx',
    source: "export function go(id) {\n  let url = `/v1/admin/projects/${id}`\n  url += '/brand-new'\n  return apiFetch(url, { method: 'POST' })\n}\n",
  }]
  const { used: seen } = consoleRoutes(extractAdminLiterals(files), routes)
  const allMapped = mapping(Object.fromEntries([...seen.keys()].map((k) => [k, { allow: 'parity-debt' }])))
  const { errors } = checkParity({ used: seen, mapping: allMapped, mcpTools, cliCommands, dynamicCalls: extractDynamicCalls(files) })
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(errors[0], /Append\.tsx: apiFetch\(url, …\) builds its path/)
})

test('a name shadowed in a nested scope does not borrow the outer path constant', () => {
  const file = 'apps/admin/src/components/Nested.tsx'
  const files = [{
    file,
    source: `
      const path = '/v1/admin/projects/known/radar'
      export function Outer({ list, props }) {
        function inner() {
          const path = '/v1/admin/projects/other/radar'
          return apiFetch(path)
        }
        const run = () => {
          const { path } = props
          return apiFetch(\`\${path}/run\`)
        }
        const all = async () => {
          for (const path of list) await apiFetch(\`\${path}/run\`)
        }
        try { load() } catch (path) { apiFetch(path) }
        return usePageData(\`\${path}/ok\`)
      }
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg: 'path' },
    { file, call: 'apiFetch', arg: '`${path}/run`' },
    { file, call: 'apiFetch', arg: '`${path}/run`' },
    { file, call: 'apiFetch', arg: 'path' },
  ])
  const literals = extractAdminLiterals(files).map((l) => l.literal)
  assert.ok(!literals.includes('/v1/admin/projects/known/radar/run'), literals.join(', '))
  assert.ok(literals.includes('/v1/admin/projects/known/radar/ok'), literals.join(', '))
})

test('a parameter of the same name shadows the outer path constant, in every function form', () => {
  const file = 'apps/admin/src/lib/params.ts'
  const files = [{
    file,
    source: `
      const path = '/v1/admin/projects/known/radar'
      export function run(path: string) {
        return apiFetch(\`\${path}/run\`)
      }
      export const api = {
        load(path) {
          return apiFetch(path)
        },
      }
      export const go = function (id, path = '') {
        return apiFetch(path)
      }
      export const ok = () => apiFetch(path)
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [
    { file, call: 'apiFetch', arg: '`${path}/run`' },
    { file, call: 'apiFetch', arg: 'path' },
    { file, call: 'apiFetch', arg: 'path' },
  ])
})

test('a binding in a sibling scope, or a later declarator, does not unsettle a resolved name', () => {
  const file = 'apps/admin/src/components/Siblings.tsx'
  const files = [{
    file,
    source: `
      export function A() {
        const base = 'x', path = '/v1/admin/a'
        return usePageData(path)
      }
      export function B({ path }) {
        return null
      }
      export function C() {
        for (const path of []) void path
        const path = '/v1/admin/c'
        return usePageData(path)
      }
    `,
  }]
  assert.deepEqual(extractDynamicCalls(files), [])
})
