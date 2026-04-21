// Post-deploy smoke test for the admin Edge Function.
//
// Hits every table-touching admin endpoint that the Beginner-mode + most-used
// Advanced-mode pages depend on, and asserts each one returns a non-5xx
// status. Built specifically to catch the 04-20 class of failure where the
// Edge Function bundle was deployed referencing a column or RPC that hadn't
// landed in the cloud DB yet (`is_saved`, `cost_usd`,
// `report_group_blast_radius`).
//
// Designed to run in CI immediately after `supabase functions deploy api` —
// any 5xx fails the deploy. Soft-degraded responses (the new
// `degraded: 'schema_pending'` flag) print a warning but pass, since the
// resilience layer keeps the admin UI usable while migrations chase the
// function bundle.
//
// Usage:
//   MUSHI_ADMIN_JWT=eyJ...    \
//   MUSHI_PROJECT_ID=<uuid>   \
//   node scripts/smoke-admin-endpoints.mjs
//
// Optional overrides:
//   MUSHI_API_BASE   default https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api

const BASE = (process.env.MUSHI_API_BASE ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api').replace(/\/$/, '')
const JWT = process.env.MUSHI_ADMIN_JWT
const PROJECT_ID = process.env.MUSHI_PROJECT_ID

if (!JWT) {
  console.error(
    'Missing required env var: MUSHI_ADMIN_JWT.\n' +
      '  Grab a fresh JWT from the admin SPA: Sign in, then DevTools > Application > Local Storage >\n' +
      '  sb-<project-ref>-auth-token > .currentSession.access_token',
  )
  process.exit(1)
}

// Endpoints grouped by which migration they would have caught had this script
// existed before the 04-20 dogfood. Kept narrow on purpose — we want a fast
// post-deploy gate, not full end-to-end coverage.
const CHECKS = [
  // Plan stage — Reports list + severity. Catches blast_radius RPC drift.
  { name: 'reports.list',          path: '/v1/admin/reports?limit=5',                  catches: 'report_group_blast_radius RPC' },
  { name: 'reports.severity',      path: '/v1/admin/reports/severity-stats?days=14',    catches: 'reports schema' },

  // Do stage — Fixes summary.
  { name: 'fixes.summary',         path: '/v1/admin/fixes/summary',                     catches: 'fix_attempts schema' },

  // Check stage — Health + integration probes + Judge + Intelligence (all read cost_usd).
  { name: 'health',                path: '/v1/admin/health',                            catches: 'llm_invocations.cost_usd' },
  { name: 'health.history',        path: '/v1/admin/health/history',                    catches: 'health_probes schema' },
  { name: 'integrations.platform', path: '/v1/admin/integrations/platform',             catches: 'integration_health schema' },
  { name: 'judge.scores',          path: '/v1/admin/judge',                             catches: 'judge_scores schema' },
  { name: 'intelligence.llm',      path: '/v1/admin/intelligence/llm?window=24h',       catches: 'llm_invocations.cost_usd (Intelligence)' },

  // Act stage — Settings + Notifications.
  { name: 'settings',              path: '/v1/admin/settings',                          catches: 'project_settings schema' },
  { name: 'notifications.policy',  path: '/v1/admin/notifications/policy',              catches: 'notification_policies schema' },

  // Workspace — Audit, Storage, DLQ, Compliance, Billing, Query history.
  { name: 'audit',                 path: '/v1/admin/audit?limit=5',                     catches: 'audit_logs schema' },
  { name: 'storage.buckets',       path: '/v1/admin/storage/buckets',                   catches: 'storage_buckets schema' },
  { name: 'dlq',                   path: '/v1/admin/dlq?limit=5',                       catches: 'dead_letter schema' },
  { name: 'compliance',            path: '/v1/admin/compliance/status',                 catches: 'compliance schema' },
  { name: 'billing.projects',      path: '/v1/admin/billing/projects',                  catches: 'llm_invocations.cost_usd (Billing)' },
  { name: 'query.history',         path: '/v1/admin/query/history?limit=5',             catches: 'nl_query_history.is_saved' },

  // Setup wizard — first thing a new user hits.
  { name: 'setup',                 path: '/v1/admin/setup',                             catches: 'projects/api_keys schema' },
]

const results = []
let hardFails = 0
let softDegraded = 0

for (const check of CHECKS) {
  const url = `${BASE}${check.path}`
  const start = Date.now()
  let status = 0
  let body = null
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${JWT}`,
        ...(PROJECT_ID ? { 'X-Mushi-Project': PROJECT_ID } : {}),
      },
    })
    status = res.status
    body = await res.json().catch(() => null)
  } catch (err) {
    status = 0
    body = { network_error: err instanceof Error ? err.message : String(err) }
  }
  const elapsed = Date.now() - start

  const isHardFail = status >= 500 || status === 0
  const isDegraded = body?.data?.degraded != null
  if (isHardFail) hardFails += 1
  if (isDegraded) softDegraded += 1

  const verdict = isHardFail ? 'FAIL' : isDegraded ? 'DEGRADED' : status >= 400 ? 'WARN' : 'PASS'
  results.push({ ...check, status, verdict, elapsed, degraded: body?.data?.degraded ?? null })
}

console.log('\nMushi Mushi — admin endpoint smoke test')
console.log(`Base: ${BASE}\n`)
const W = (s, n) => String(s).padEnd(n)
console.log(W('verdict', 9), W('status', 6), W('ms', 6), W('check', 30), 'catches')
console.log('-'.repeat(110))
for (const r of results) {
  const tag = r.verdict === 'PASS' ? r.verdict
    : r.verdict === 'DEGRADED' ? `${r.verdict}*`
    : r.verdict
  console.log(W(tag, 9), W(r.status, 6), W(r.elapsed, 6), W(r.name, 30), r.catches + (r.degraded ? `  [${r.degraded}]` : ''))
}

console.log('\nSummary')
console.log(`  Total:       ${results.length}`)
console.log(`  Hard fails:  ${hardFails}`)
console.log(`  Degraded:    ${softDegraded}`)
console.log(`  Warnings:    ${results.filter(r => r.verdict === 'WARN').length}`)

if (hardFails > 0) {
  console.error(`\n${hardFails} hard failure(s). The deploy is unhealthy — investigate before flipping traffic.`)
  process.exit(1)
}
if (softDegraded > 0) {
  console.warn(`\n${softDegraded} endpoint(s) returned a soft-degraded response (likely a pending migration). Run \`pnpm --filter @mushi-mushi/server db:push\` and re-run the smoke test.`)
  process.exit(0)
}
console.log('\nAll endpoints healthy.')
