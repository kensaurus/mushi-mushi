#!/usr/bin/env node
/**
 * Terminal QA matrix for ingest-setup feature: CLI, HTTP API, cloud MCP.
 * Reads credentials from glot.it .env.local silently — never prints secrets.
 */
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const GLOT_ROOT = resolve(process.env.GLOT_ROOT ?? 'C:/Users/kensa/Documents/GitHub/glot.it')
const CLI = resolve(process.env.MUSHI_CLI ?? 'C:/Users/kensa/Documents/GitHub/mushi-mushi/packages/cli/dist/index.js')

function loadEnv(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const i = t.indexOf('=')
      const k = t.slice(0, i)
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[k] = v
    }
  } catch { /* optional */ }
  return out
}

const env = { ...loadEnv(join(GLOT_ROOT, '.env')), ...loadEnv(join(GLOT_ROOT, '.env.local')) }
const endpoint = env.NEXT_PUBLIC_MUSHI_API_ENDPOINT ?? env.MUSHI_API_ENDPOINT
const apiKey = env.NEXT_PUBLIC_MUSHI_API_KEY ?? env.MUSHI_API_KEY
const projectId = env.NEXT_PUBLIC_MUSHI_PROJECT_ID ?? env.MUSHI_PROJECT_ID

if (!endpoint || !apiKey || !projectId) {
  console.error('Missing MUSHI credentials in glot.it .env.local')
  process.exit(2)
}

const baseEnv = { ...process.env, MUSHI_API_ENDPOINT: endpoint, MUSHI_API_KEY: apiKey, MUSHI_PROJECT_ID: projectId }
const results = []

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function runCli(args, { cwd = GLOT_ROOT, env = baseEnv, expect = 0 } = {}) {
  const r = spawnSync('node', [CLI, ...args], { cwd, env, encoding: 'utf8' })
  const ok = r.status === expect
  if (!ok) record(`CLI ${args.join(' ')}`, false, `exit ${r.status}: ${(r.stderr || r.stdout).slice(0, 160)}`)
  return { ok, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1 }
}

async function httpJson(url, headers, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* */ }
  return { status: res.status, json, text }
}

async function mcpRpc(method, params = {}) {
  const mcpUrl = endpoint.replace('/functions/v1/api', '/functions/v1/mcp')
  const { status, json } = await httpJson(
    mcpUrl,
    { Authorization: `Bearer ${apiKey}`, 'X-Mushi-Api-Key': apiKey },
    'POST',
    { jsonrpc: '2.0', id: Date.now(), method, params },
  )
  return { status, json }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
for (const args of [
  ['ping'],
  ['whoami'],
  ['doctor'],
  ['doctor', '--ingest'],
  ['doctor', '--server'],
  ['doctor', '--ingest', '--server'],
]) {
  const { ok, stdout } = runCli(args)
  if (ok) record(`CLI mushi ${args.join(' ')}`, true, stdout.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 80) ?? 'ok')
}

const jsonDoc = runCli(['doctor', '--ingest', '--json'])
if (jsonDoc.ok) {
  try {
    const parsed = JSON.parse(jsonDoc.stdout)
    const ingestChecks = parsed.checks?.filter((c) => c.name?.startsWith('[ingest]')) ?? []
    record('CLI doctor --ingest --json shape', ingestChecks.length >= 4, `${ingestChecks.length} ingest checks`)
  } catch (e) {
    record('CLI doctor --ingest --json shape', false, String(e))
  }
}

const aliasEnv = { ...baseEnv }
delete aliasEnv.MUSHI_API_ENDPOINT
aliasEnv.MUSHI_ENDPOINT = endpoint
const alias = runCli(['doctor'], { env: aliasEnv })
record('CLI MUSHI_ENDPOINT alias', alias.ok && alias.stdout.includes('endpoint='))

const dry = runCli(['upgrade', '--dry-run'], { cwd: GLOT_ROOT })
record('CLI upgrade --dry-run', dry.ok)

const dryJson = runCli(['upgrade', '--dry-run', '--json'], { cwd: GLOT_ROOT })
if (dryJson.ok) {
  try {
    const p = JSON.parse(dryJson.stdout)
    record('CLI upgrade --json plan', Array.isArray(p.plan?.entries))
  } catch { record('CLI upgrade --json plan', false) }
}

// connect isolated
const tmp = mkdtempSync(join(tmpdir(), 'mushi-qa-'))
try {
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'qa', private: true, dependencies: { '@mushi-mushi/web': '^1.7.8' } }))
  writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n')

  const noIde = runCli([
    'connect', '--api-key', apiKey, '--project-id', projectId, '--endpoint', endpoint,
    '--no-env', '--no-ide', '--json',
  ], { cwd: tmp })
  record('CLI connect --no-ide', noIde.ok && !existsSync(join(tmp, '.cursor', 'mcp.json')))

  const withIde = runCli([
    'connect', '--api-key', apiKey, '--project-id', projectId, '--endpoint', endpoint,
    '--no-env', '--json',
  ], { cwd: tmp })
  const mcpPath = join(tmp, '.cursor', 'mcp.json')
  const gi = readFileSync(join(tmp, '.gitignore'), 'utf8')
  if (existsSync(mcpPath)) {
    const mcp = readFileSync(mcpPath, 'utf8')
    record('CLI connect mcp package name', mcp.includes('@mushi-mushi/mcp@latest'))
    record('CLI connect gitignore mcp.json', gi.includes('.cursor/mcp.json'))
  } else {
    record('CLI connect writes mcp.json', false)
  }
  record('CLI connect exit 0', withIde.ok)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── HTTP API ────────────────────────────────────────────────────────────────
const hdr = {
  Authorization: `Bearer ${apiKey}`,
  'X-Mushi-Api-Key': apiKey,
  'X-Mushi-Project': projectId,
}

const ingest = await httpJson(`${endpoint.replace(/\/$/, '')}/v1/sync/ingest-setup`, hdr)
if (ingest.status === 200 && ingest.json?.ok) {
  const d = ingest.json.data ?? {}
  record('API ingest-setup 200', true)
  record('API recent_report_count field', 'recent_report_count' in d && !('report_count' in d), `count=${d.recent_report_count}`)
  record('API ingest ready', d.ready === true, `${d.required_complete}/${d.required_total}`)
} else {
  record('API ingest-setup', false, `status ${ingest.status}`)
}

const pre = await httpJson(`${endpoint.replace(/\/$/, '')}/v1/admin/projects/${projectId}/preflight`, hdr)
if (pre.status === 200 && pre.json?.data?.checks) {
  record('API preflight (api key)', true, `${pre.json.data.checks.length} checks, ready=${pre.json.data.ready}`)
} else {
  record('API preflight (api key)', false, `status ${pre.status}`)
}

// ── Cloud MCP ─────────────────────────────────────────────────────────────────
const list = await mcpRpc('tools/list', {})
const toolNames = (list.json?.result?.tools ?? []).map((t) => t.name)
// setup_check + ingest_setup_check were consolidated into diagnose_setup
// (mode=full|ingest|dispatch).
record('MCP tools/list includes diagnose_setup', toolNames.includes('diagnose_setup'))

for (const [label, args] of [
  ['diagnose_setup (ingest)', { mode: 'ingest' }],
  ['diagnose_setup (dispatch)', { mode: 'dispatch', projectId }],
]) {
  const call = await mcpRpc('tools/call', { name: 'diagnose_setup', arguments: args })
  const err = call.json?.error
  if (err) {
    record(`MCP ${label}`, false, err.message ?? JSON.stringify(err))
    continue
  }
  const content = call.json?.result?.content?.[0]?.text
  let parsed = {}
  try { parsed = content ? JSON.parse(content) : call.json?.result?.structuredContent ?? {} } catch { /* */ }
  record(`MCP ${label}`, Boolean(parsed.summary), parsed.summary?.slice(0, 100))
}

// JWT should fail diagnose_setup (ingest) with clear message (no API key header)
const mcpUrl = endpoint.replace('/functions/v1/api', '/functions/v1/mcp')
const jwtRes = await fetch(mcpUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-jwt-token' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'diagnose_setup', arguments: { mode: 'ingest' } } }),
  signal: AbortSignal.timeout(15000),
})
const jwtBody = await jwtRes.json()
const jwtMsg = jwtBody?.error?.message ?? jwtBody?.result?.content?.[0]?.text ?? ''
record(
  'MCP diagnose_setup (ingest) rejects non-API-key',
  jwtBody?.error != null || String(jwtMsg).includes('API-key auth'),
  String(jwtMsg).slice(0, 100),
)

// ── SDK package tests (already run separately; quick smoke) ─────────────────
try {
  execSync('pnpm --filter @mushi-mushi/web exec node -e "import(\'@mushi-mushi/web\').then(m=>console.log(typeof m.init))"', {
    cwd: resolve('C:/Users/kensa/Documents/GitHub/mushi-mushi'),
    stdio: 'pipe',
    encoding: 'utf8',
  })
  record('SDK @mushi-mushi/web import', true)
} catch (e) {
  record('SDK @mushi-mushi/web import', false, e.message?.slice(0, 80))
}

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
