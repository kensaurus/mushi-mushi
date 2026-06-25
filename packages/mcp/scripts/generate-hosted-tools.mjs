#!/usr/bin/env node
/**
 * Generates packages/server/supabase/functions/mcp/tools-extended.ts from
 * packages/mcp/src/catalog.ts — adds every canonical tool not already in the
 * base TOOLS block of mcp/index.ts.
 *
 * Run: node packages/mcp/scripts/generate-hosted-tools.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

function extractCatalogEntries(content) {
  const entries = []
  let pending = null
  for (const line of content.split('\n')) {
    const nameMatch = line.match(/name: '([^']+)'/)
    if (nameMatch) pending = { name: nameMatch[1] }
    const scopeMatch = line.match(/scope: '(mcp:\w+)'/)
    const descMatch = line.match(/description:\s*$|description:\s*\n|description:\s*'/)
    if (pending && line.includes('description:') && !pending.description) {
      // multi-line descriptions handled below via join
    }
    if (scopeMatch && pending?.name) {
      entries.push({ name: pending.name, scope: scopeMatch[1] })
      pending = null
    }
  }
  return entries
}

function extractDescriptions(content) {
  const map = new Map()
  const blocks = content.split(/\n  \{\n    name: '/)
  for (const block of blocks.slice(1)) {
    const name = block.split("'")[0]
    const descMatch = block.match(/description:\s*\n?\s*'([^']*(?:\\'[^']*)*)'/s)
      || block.match(/description:\s*\n\s*'([^']*)/)
    if (name && descMatch) {
      map.set(name, descMatch[1].replace(/\\'/g, "'").slice(0, 500))
    }
  }
  return map
}

function extractHostedNames(indexContent) {
  const section = indexContent.split('const TOOLS')[1]?.split('// JSON-RPC')[0] ?? ''
  const names = new Set()
  for (const line of section.split('\n')) {
    const m = line.match(/^  ([a-z_]+): \{/)
    if (m) names.add(m[1])
  }
  return names
}

/** Hand-maintained REST route map for tools missing from the base hosted registry. */
const ROUTES = {
  get_report_timeline: { method: 'GET', path: (a) => `/v1/sync/reports/${a.reportId}/timeline`, args: ['reportId'] },
  get_similar_bugs: {
    method: 'POST',
    path: () => '/v1/admin/reports/similarity',
    body: (a, ctx) => ({ query: a.query, k: Math.min(Number(a.limit ?? 5), 20), threshold: 0.3, projectId: ctx.projectIdHint }),
    args: ['query'],
  },
  diff_inventory: {
    method: 'GET',
    path: (a, ctx) => {
      const pid = a.projectId ?? ctx.projectIdHint
      return `/v1/admin/inventory/${pid}/diff?from=${a.fromSha}&to=${a.toSha}`
    },
    args: ['fromSha', 'toSha'],
  },
  get_graph_neighborhood: {
    method: 'GET',
    path: (a) => `/v1/admin/graph/traverse?seed=${encodeURIComponent(a.seed)}&depth=${Math.min(Number(a.depth ?? 2), 4)}`,
    args: ['seed'],
  },
  suggest_fix: { method: 'GET', path: (a) => `/v1/admin/reports/${a.reportId}`, args: ['reportId'], transform: 'fix_suggest' },
  submit_fix_result: {
    method: 'POST',
    path: () => '/v1/admin/fixes',
    body: (a) => a,
    args: ['reportId'],
  },
  trigger_judge: { method: 'POST', path: () => '/v1/admin/judge/run', body: (a) => a, args: [] },
  test_gen_from_report: {
    method: 'POST',
    path: (a, ctx) => `/v1/admin/inventory/${a.projectId ?? ctx.projectIdHint}/test-gen/from-report/${a.reportId}`,
    args: ['reportId'],
  },
  merge_fix: { method: 'POST', path: (a) => `/v1/admin/fixes/${a.fixId}/merge`, args: ['fixId'] },
  refresh_ci: { method: 'POST', path: (a) => `/v1/admin/fixes/${a.fixId}/refresh-ci`, args: ['fixId'] },
  reopen_report: {
    method: 'PATCH',
    path: (a) => `/v1/sync/reports/${a.reportId}`,
    body: (a) => ({ status: 'reopened', note: a.note }),
    args: ['reportId'],
  },
  list_top_contributors: {
    method: 'GET',
    path: (a) => `/v1/admin/rewards/leaderboard?range=${a.range ?? '30d'}&limit=${a.limit ?? 10}`,
    args: [],
  },
  award_bonus_points: {
    method: 'POST',
    path: () => '/v1/admin/rewards/bonus-points',
    body: (a) => ({ external_user_id: a.external_user_id, points: a.points, reason: a.reason }),
    args: ['external_user_id', 'points', 'reason'],
  },
  set_tier: {
    method: 'POST',
    path: () => '/v1/admin/rewards/set-tier',
    body: (a) => ({ external_user_id: a.external_user_id, tier_slug: a.tier_slug, reason: a.reason }),
    args: ['external_user_id', 'tier_slug'],
  },
  setup_repo_for_mushi: {
    method: 'POST',
    path: (a, ctx) => `/v1/admin/projects/${a.projectId ?? ctx.projectIdHint}/repo/bootstrap`,
    body: () => ({}),
    args: [],
  },
  get_account_overview: { method: 'GET', path: () => '/v1/admin/mcp/account-overview', args: [] },
  project_dashboard: { method: 'GET', path: () => '/v1/admin/dashboard', args: [] },
  project_stats: { method: 'GET', path: () => '/v1/admin/stats', args: [] },
  project_settings: { method: 'GET', path: () => '/v1/admin/settings', args: [] },
  privacy_status: { method: 'GET', path: () => '/v1/admin/privacy-status', args: [] },
  evolution_history: {
    method: 'GET',
    path: (a, ctx) => {
      const pid = a.projectId ?? a.project_id ?? ctx.projectIdHint
      return pid
        ? `/v1/admin/projects/${encodeURIComponent(pid)}/evolution-history`
        : '/v1/admin/evolution/history'
    },
    args: [],
  },
  activation_status: {
    method: 'GET',
    path: (a, ctx) => {
      const pid = a.project_id ?? ctx.projectIdHint
      return pid ? `/v1/admin/activation?project_id=${encodeURIComponent(pid)}` : '/v1/admin/activation'
    },
    args: [],
  },
  project_integration_health: { method: 'GET', path: () => '/v1/admin/integrations/health', args: [] },
  inventory_current: {
    method: 'GET',
    path: (a, ctx) => `/v1/admin/inventory/${a.projectId ?? ctx.projectIdHint}`,
    args: [],
  },
  map_user_stories: {
    method: 'POST',
    path: (a) => `/v1/admin/inventory/${a.projectId}/map-from-live`,
    body: (a) => ({ base_url: a.baseUrl, max_pages: a.maxPages, provider: a.provider, cursor_cloud_refine: a.cursorCloudRefine }),
    args: ['projectId', 'baseUrl'],
  },
  get_map_run_status: { method: 'GET', path: (a) => `/v1/admin/inventory/${a.projectId}/map-runs`, args: ['projectId'] },
  generate_tdd_from_story: {
    method: 'POST',
    path: (a) => `/v1/admin/inventory/${a.projectId}/stories/${a.storyNodeId}/generate-test`,
    body: (a) => ({ automation_mode: a.automationMode, base_url: a.baseUrl, open_pr: a.openPr }),
    args: ['projectId', 'storyNodeId'],
  },
  improve_qa_story: {
    method: 'POST',
    path: () => '/v1/admin/pdca/improve-qa-stories',
    body: (a) => ({ project_id: a.projectId }),
    args: [],
  },
  run_qa_story: {
    method: 'POST',
    path: (a) => `/v1/admin/projects/${a.projectId}/qa-stories/${a.qaStoryId}/run`,
    args: ['projectId', 'qaStoryId'],
  },
  list_byok_keys: {
    method: 'GET',
    path: (a) => `/v1/admin/byok/keys?project_id=${encodeURIComponent(a.projectId)}`,
    args: ['projectId'],
  },
  add_byok_key: {
    method: 'POST',
    path: () => '/v1/admin/byok/keys',
    body: (a) => ({ project_id: a.projectId, provider_slug: a.provider, key: a.key, label: a.label, priority: a.priority }),
    args: ['projectId', 'provider', 'key'],
  },
  list_pending_review_stories: {
    method: 'GET',
    path: (a) => `/v1/admin/inventory/${a.projectId}/stories/pending-review`,
    args: ['projectId'],
  },
  approve_qa_story: {
    method: 'PATCH',
    path: (a) => `/v1/admin/inventory/${a.projectId}/stories/${a.qaStoryId}/approval`,
    body: (a) => ({ status: a.status }),
    args: ['projectId', 'qaStoryId', 'status'],
  },
  reply_to_reporter: {
    method: 'POST',
    path: (a) => `/v1/sync/reports/${a.reportId}/reply`,
    body: (a) => ({ message: a.message, author_name: a.authorName }),
    args: ['reportId', 'message'],
  },
  get_two_way_comms_health: { method: 'GET', path: () => '/v1/sync/two-way-health', args: [] },
  list_qa_story_runs: {
    method: 'GET',
    path: (a, ctx) =>
      `/v1/admin/projects/${a.projectId ?? ctx.projectIdHint}/qa-stories/${a.storyId}/runs?limit=${a.limit ?? 10}`,
    args: ['storyId'],
  },
  get_qa_story_run: {
    method: 'GET',
    path: (a, ctx) =>
      `/v1/admin/projects/${a.projectId ?? ctx.projectIdHint}/qa-stories/${a.storyId}/runs?limit=50`,
    args: ['storyId', 'runId'],
    transform: 'qa_run_pick',
  },
  test_notification_channel: {
    method: 'POST',
    path: (a, ctx) => `/v1/admin/projects/${a.projectId ?? ctx.projectIdHint}/integrations/${a.kind}/test`,
    args: ['kind'],
  },
  list_skills: {
    method: 'GET',
    path: (a) => {
      const qs = new URLSearchParams()
      if (a.category) qs.set('category', a.category)
      if (a.search) qs.set('q', a.search)
      qs.set('limit', String(Math.min(Number(a.limit ?? 200), 200)))
      return `/v1/admin/skills?${qs}`
    },
    args: [],
  },
  get_skill: { method: 'GET', path: (a) => `/v1/admin/skills/${a.slug}`, args: ['slug'] },
  start_skill_pipeline: {
    method: 'POST',
    path: () => '/v1/admin/skills/pipelines',
    body: (a, ctx) => ({ ...a, project_id: a.project_id ?? ctx.projectIdHint }),
    args: ['root_skill_slug'],
  },
  get_pipeline_run: { method: 'GET', path: (a) => `/v1/admin/skills/pipelines/${a.run_id}`, args: ['run_id'] },
  checkin_pipeline_step: {
    method: 'POST',
    path: (a) => `/v1/admin/skills/pipelines/${a.run_id}/steps/${a.step_index}/checkin`,
    body: (a) => ({ status: a.status, notes: a.notes, pr_url: a.pr_url, agent_ref: a.agent_ref }),
    args: ['run_id', 'step_index', 'status'],
  },
  run_fullstack_audit: {
    method: 'POST',
    path: (a, ctx) => `/v1/admin/projects/${a.project_id ?? ctx.projectIdHint}/audit`,
    body: () => ({}),
    args: [],
  },
  get_backend_health: { method: 'GET', path: (a, ctx) => `/v1/admin/projects/${a.project_id ?? ctx.projectIdHint}/backend/schema`, args: [], transform: 'backend_health' },
}

const catalogContent = readFileSync(resolve(ROOT, 'packages/mcp/src/catalog.ts'), 'utf8')
const indexContent = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
const catalog = extractCatalogEntries(catalogContent)
const descriptions = extractDescriptions(catalogContent)
const hosted = extractHostedNames(indexContent)
const missing = catalog.filter((t) => !hosted.has(t.name))

const lines = [
  '/**',
  ' * AUTO-GENERATED by packages/mcp/scripts/generate-hosted-tools.mjs — do not edit by hand.',
  ' */',
  '',
  'import type { ToolDef } from "./tool-types.ts"',
  '',
  'export function buildExtendedTools(deps: {',
  '  apiCall: (path: string, init?: RequestInit) => Promise<unknown>',
  '  requireString: (v: unknown, name: string) => asserts v is string',
  '  McpError: new (code: number, message: string) => Error',
  '  ERR_INVALID_PARAMS: number',
  '  ERR_INVALID_REQUEST: number',
  '}): Record<string, ToolDef> {',
  '  const { apiCall, requireString, McpError, ERR_INVALID_PARAMS } = deps',
  '  const resolvePid = (args: Record<string, unknown>, ctx: { projectIdHint?: string }) =>',
  '    (args.projectId ?? args.project_id ?? ctx.projectIdHint) as string | undefined',
  '',
  '  return {',
]

for (const tool of missing) {
  const route = ROUTES[tool.name]
  if (!route) {
    console.warn(`WARN: no route for ${tool.name} — skipping`)
    continue
  }
  const desc = (descriptions.get(tool.name) ?? tool.name).replace(/'/g, "\\'")
  lines.push(`    ${tool.name}: {`)
  lines.push(`      scope: '${tool.scope}',`)
  lines.push(`      description: '${desc.slice(0, 400)}',`)
  lines.push(`      inputSchema: { type: 'object', properties: {} },`)
  lines.push(`      annotations: { readOnlyHint: ${tool.scope === 'mcp:read'}, openWorldHint: true },`)
  lines.push(`      handler: async (args, ctx) => {`)
  for (const arg of route.args) {
    lines.push(`        requireString(args.${arg}, '${arg}')`)
  }
  if (route.transform === 'diagnose') {
    lines.push(`        return apiCall('/v1/sync/ingest-setup', { headers: ctx.authHeaders })`)
  } else if (route.transform === 'fix_suggest') {
    lines.push(`        const report = await apiCall(\`/v1/admin/reports/\${args.reportId}\`, { headers: ctx.authHeaders }) as Record<string, unknown>`)
    lines.push(`        const s2 = report.stage2_analysis as Record<string, unknown> | null | undefined`)
    lines.push(`        return { reportId: args.reportId, rootCause: s2?.rootCause ?? null, suggestedFix: s2?.suggestedFix ?? null, reproductionSteps: report.reproduction_steps ?? [], summary: report.summary ?? null, component: report.component ?? null }`)
  } else if (route.transform === 'qa_run_pick') {
    lines.push(`        requireString(args.runId, 'runId')`)
    lines.push(`        const pid = resolvePid(args, ctx)`)
    lines.push(`        if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required')`)
    lines.push(`        const data = await apiCall(\`/v1/admin/projects/\${encodeURIComponent(pid)}/qa-stories/\${args.storyId}/runs?limit=50\`, { headers: ctx.authHeaders }) as { data?: { runs?: Array<{ id: string }> } }`)
    lines.push(`        const run = data?.data?.runs?.find((r) => r.id === args.runId) ?? null`)
    lines.push(`        if (!run) throw new McpError(ERR_INVALID_PARAMS, 'Run not found in recent runs')`)
    lines.push(`        return run`)
  } else if (route.transform === 'backend_health') {
    lines.push(`        const pid = resolvePid(args, ctx)`)
    lines.push(`        if (!pid) throw new McpError(ERR_INVALID_PARAMS, 'project_id is required')`)
    lines.push(`        const [schema, advisors, logs] = await Promise.allSettled([`)
    lines.push(`          apiCall(\`/v1/admin/projects/\${pid}/backend/schema\`, { headers: ctx.authHeaders }),`)
    lines.push(`          apiCall(\`/v1/admin/projects/\${pid}/db-advisors\`, { headers: ctx.authHeaders }),`)
    lines.push(`          args.include_logs !== false ? apiCall(\`/v1/admin/projects/\${pid}/backend/logs?service=api\`, { headers: ctx.authHeaders }) : Promise.resolve(null),`)
    lines.push(`        ])`)
    lines.push(`        return { schema: schema.status === 'fulfilled' ? schema.value : { error: String(schema.reason) }, advisors: advisors.status === 'fulfilled' ? advisors.value : { error: String(advisors.reason) }, logs: logs.status === 'fulfilled' ? logs.value : null }`)
  } else {
    lines.push(`        const pid = resolvePid(args, ctx)`)
    if (route.path.toString().includes('projectIdHint') || route.path.toString().includes('ctx')) {
      lines.push(`        if (!pid && ${JSON.stringify(route.args)}.some((k) => k === 'projectId')) throw new McpError(ERR_INVALID_PARAMS, 'projectId is required')`)
    }
    lines.push(`        const path = (${route.path.toString()})(args, ctx)`)
    const initParts = [`headers: ctx.authHeaders`]
    if (route.method !== 'GET') initParts.unshift(`method: '${route.method}'`)
    if (route.body) {
      initParts.push(`body: JSON.stringify((${route.body.toString()})(args, ctx))`)
    }
    lines.push(`        return apiCall(path, { ${initParts.join(', ')} })`)
  }
  lines.push(`      },`)
  lines.push(`    },`)
}

lines.push('  }')
lines.push('}')
lines.push('')

const outPath = resolve(ROOT, 'packages/server/supabase/functions/mcp/tools-extended.ts')
writeFileSync(outPath, lines.join('\n'))
console.log(`Wrote ${missing.length} extended tools → ${outPath}`)
