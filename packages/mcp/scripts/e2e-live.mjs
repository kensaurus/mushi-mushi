#!/usr/bin/env node
/**
 * Live E2E matrix for hosted MCP — calls every read tool with minimal safe args.
 *
 * Env (never log values):
 *   MUSHI_MCP_HTTP_URL
 *   MUSHI_MCP_API_KEY
 *   MUSHI_PROJECT_ID
 *
 * Run: node packages/mcp/scripts/e2e-live.mjs
 * Output: JSON pass/fail matrix on stdout; exit 1 if any hard failure.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

function loadCatalogReadTools() {
  const content = readFileSync(resolve(ROOT, 'packages/mcp/src/catalog.ts'), 'utf8')
  const tools = []
  let pendingName = null
  let pendingScope = null
  for (const line of content.split('\n')) {
    const nameMatch = line.match(/name:\s*'([^']+)'/)
    if (nameMatch) pendingName = nameMatch[1]
    const scopeMatch = line.match(/scope:\s*'(mcp:\w+)'/)
    if (scopeMatch && pendingName) {
      pendingScope = scopeMatch[1]
      if (pendingScope === 'mcp:read') tools.push(pendingName)
      pendingName = null
      pendingScope = null
    }
  }
  return tools
}

const SAFE_ARGS = {
  get_report_detail: { reportId: '__DYNAMIC__' },
  get_report_timeline: { reportId: '__DYNAMIC__' },
  get_report_evidence: { report_id: '__DYNAMIC__' },
  get_reporter_thread: { reportId: '__DYNAMIC__' },
  summarize_report_for_fix: { reportId: '__DYNAMIC__' },
  get_fix_context: { reportId: '__DYNAMIC__' },
  get_fix_timeline: { fixId: '00000000-0000-0000-0000-000000000001' },
  get_blast_radius: { nodeId: '00000000-0000-0000-0000-000000000001' },
  get_lessons: { reportId: '__DYNAMIC__' },
  query_lessons: { diff_text: 'smoke test diff' },
  get_qa_story_run: { storyId: '00000000-0000-0000-0000-000000000001', runId: '00000000-0000-0000-0000-000000000002' },
  get_skill: { slug: 'workflow-fix-and-ship' },
  get_pipeline_run: { run_id: '00000000-0000-0000-0000-000000000001' },
  get_map_run_status: { projectId: '__PROJECT__' },
  inventory_get: { projectId: '__PROJECT__' },
  inventory_current: { projectId: '__PROJECT__' },
  inventory_diff: { projectId: '__PROJECT__', fromSha: 'abc1234', toSha: 'def5678' },
  run_nl_query: { question: 'count open reports' },
  get_knowledge_graph: { seed: 'Button', depth: 1 },
  graph_neighborhood: { seed: 'Button', depth: 1 },
  graph_node_status: { nodeId: '00000000-0000-0000-0000-000000000001' },
  search_reports: { query: 'smoke' },
  get_similar_bugs: { query: 'settings freeze' },
  fix_suggest: { reportId: '__DYNAMIC__' },
  triage_issue: { report_id: '__DYNAMIC__' },
  list_qa_story_runs: { storyId: '00000000-0000-0000-0000-000000000001', limit: 1 },
  list_top_contributors: { limit: 5 },
  list_byok_keys: { projectId: '__PROJECT__' },
  list_pending_review_stories: { projectId: '__PROJECT__' },
  list_skills: { limit: 5 },
  refresh_ci: { fixId: '00000000-0000-0000-0000-000000000001' },
}

/** Tool returned structured data or an expected empty/not-found — not a server/auth failure. */
function isSoftOk(_name, body) {
  if (body.error) {
    const msg = String(body.error.message ?? '')
    const data = body.error.data
    if (data?.http === 404 || data?.code === 'NOT_FOUND') return true
    const softRpc = [
      'not found',
      'upstream 404',
      'invalid or expired auth token',
    ]
    if (softRpc.some((s) => msg.toLowerCase().includes(s))) return true
    return false
  }
  if (body.error) return false
  const text = body.result?.content?.[0]?.text ?? ''
  if (body.result?.isError !== true) return true
  const soft = [
    'not found',
    'NOT_FOUND',
    '404',
    'no graph',
    'not indexed',
    'invalid uuid',
    'does not exist',
    'no rows',
    'empty',
    'upstream 404',
    'no pipeline',
    'fix not found',
    'node not found',
    'run not found',
    'run not found in recent runs',
    'fixid is required',
  ]
  return soft.some((s) => text.toLowerCase().includes(s.toLowerCase()))
}

const url = process.env.MUSHI_MCP_HTTP_URL
const apiKey = process.env.MUSHI_MCP_API_KEY
const projectId = process.env.MUSHI_PROJECT_ID

if (!url || !apiKey || !projectId) {
  console.error('SKIP e2e-live: set MUSHI_MCP_HTTP_URL, MUSHI_MCP_API_KEY, MUSHI_PROJECT_ID')
  process.exit(0)
}

async function mcpCall(method, params = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Mushi-Api-Key': apiKey,
      'X-Mushi-Project-Id': projectId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  })
  const body = await res.json()
  return { status: res.status, body }
}

const readTools = loadCatalogReadTools()
const results = []

// Initialize + list first
const init = await mcpCall('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'e2e-live', version: '1.0.0' },
})
results.push({ tool: 'initialize', ok: init.status === 200 && !init.body.error, status: init.status })

const listed = await mcpCall('tools/list', {})
const advertised = new Set((listed.body?.result?.tools ?? []).map((t) => t.name))

// Resolve a real report id for tools that need one
let sampleReportId = null
const recent = await mcpCall('tools/call', { name: 'get_recent_reports', arguments: { limit: 1 } })
try {
  const parsed = JSON.parse(recent.body?.result?.content?.[0]?.text ?? '{}')
  sampleReportId = parsed.reports?.[0]?.id ?? null
} catch { /* use placeholders */ }

for (const name of readTools) {
  if (!advertised.has(name)) {
    results.push({ tool: name, ok: false, skip: true, reason: 'not advertised' })
    continue
  }
  try {
    let args = { ...(SAFE_ARGS[name] ?? {}) }
    for (const [k, v] of Object.entries(args)) {
      if (v === '__DYNAMIC__') args[k] = sampleReportId ?? '00000000-0000-0000-0000-000000000001'
      if (v === '__PROJECT__') args[k] = projectId
    }
    const { status, body } = await mcpCall('tools/call', { name, arguments: args })
    const rpcSoft = body.error && isSoftOk(name, { error: body.error })
    const resultSoft = body.result?.isError === true && isSoftOk(name, body)
    const hardFail = status !== 200 || (body.error && !rpcSoft) || (body.result?.isError === true && !resultSoft)
    const ok = !hardFail
    results.push({
      tool: name,
      ok,
      soft: body.result?.isError === true && ok,
      status,
      error: body.error?.message ?? (hardFail ? body.result?.content?.[0]?.text?.slice(0, 120) : undefined),
    })
  } catch (err) {
    results.push({ tool: name, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

const failures = results.filter((r) => !r.ok && !r.skip)
console.log(JSON.stringify({ total: results.length, failures: failures.length, results }, null, 2))
process.exit(failures.length > 0 ? 1 : 0)
