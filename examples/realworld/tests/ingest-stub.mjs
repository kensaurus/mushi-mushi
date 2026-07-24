/**
 * Mushi ingest stub server for hermetic RealWorld journeys.
 *
 * Accepts the web and node SDKs' report/span/discovery/config POST payloads
 * without contacting Supabase. The journey spec can query what was received
 * via GET /__stub/reports etc.
 *
 * Routes accepted (prefix = /functions/v1/api):
 *   POST /v1/reports         — web + node reports (queried by journey)
 *   POST /v1/ingest/spans    — node trace spans   (queried by journey)
 *   POST /v1/sdk/discovery   — web discovery events
 *   GET  /v1/sdk/config      — returns {ok:true, config:{}}
 *   GET  /health             — liveness
 *
 * Query routes (test-only, path-only, NOT under /functions/v1/api):
 *   GET  /__stub/reports     — array of received report bodies
 *   GET  /__stub/spans       — array of received span bodies
 *   GET  /__stub/discovery   — array of received discovery bodies
 *   POST /__stub/reset       — clear all collections
 *
 * Usage:
 *   node tests/ingest-stub.mjs [--port 4199]
 */

import http from 'node:http'

const DEFAULT_PORT = 4199

function parsePort() {
  const idx = process.argv.indexOf('--port')
  return idx !== -1 ? Number(process.argv[idx + 1]) : DEFAULT_PORT
}

const store = { reports: [], spans: [], discovery: [] }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || 'null'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', reject)
  })
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Mushi-Api-Key, X-Mushi-Project, X-Mushi-Internal, X-Mushi-SDK-Package, X-Mushi-SDK-Version, X-Mushi-User-Token, User-Agent',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' })
    return res.end()
  }

  const url = req.url ?? '/'

  // ── ingest routes ────────────────────────────────────────────────────────
  if (url.endsWith('/v1/reports') && req.method === 'POST') {
    const body = await readBody(req)
    const id = `stub-${store.reports.length + 1}`
    store.reports.push({ ...body, __id: id })
    return json(res, 201, { data: { reportId: id } })
  }
  if (url.endsWith('/v1/ingest/spans') && req.method === 'POST') {
    const body = await readBody(req)
    store.spans.push(body)
    return json(res, 200, { ok: true })
  }
  if (url.endsWith('/v1/sdk/discovery') && req.method === 'POST') {
    const body = await readBody(req)
    store.discovery.push(body)
    return json(res, 200, { ok: true })
  }
  if (url.endsWith('/v1/sdk/config') && req.method === 'GET') {
    return json(res, 200, { ok: true, config: {} })
  }
  if (url.endsWith('/v1/sdk/config') && req.method === 'POST') {
    return json(res, 200, { ok: true, config: {} })
  }
  if (url === '/health' || url.endsWith('/health')) {
    return json(res, 200, { status: 'ok' })
  }

  // ── query routes (test-only) ──────────────────────────────────────────────
  if (url === '/__stub/reports' && req.method === 'GET') {
    return json(res, 200, store.reports)
  }
  if (url === '/__stub/spans' && req.method === 'GET') {
    return json(res, 200, store.spans)
  }
  if (url === '/__stub/discovery' && req.method === 'GET') {
    return json(res, 200, store.discovery)
  }
  if (url === '/__stub/reset' && req.method === 'POST') {
    store.reports.length = 0
    store.spans.length = 0
    store.discovery.length = 0
    return json(res, 200, { ok: true })
  }

  json(res, 404, { error: `stub: no handler for ${req.method} ${url}` })
})

const PORT = parsePort()
server.listen(PORT, () => {
  process.stdout.write(`[ingest-stub] listening on :${PORT}\n`)
})

export { server, store }
