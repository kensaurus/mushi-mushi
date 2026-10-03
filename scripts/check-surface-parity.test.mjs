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
