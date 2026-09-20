// scripts/marketing/seed-demo.mjs
//
// Seeds the live admin demo with 5 realistic, plausible bug reports so a
// first-time visitor lands on a dashboard that looks alive (the
// alternative — empty triage queue, zero PRs, no charts — is the single
// biggest predictor of bounce, per the storefronts / launch-week docs).
//
// The reports are NOT generic "Lorem ipsum bug" text. They mirror the
// kinds of user-felt issues an actual product team would see — login
// flow, checkout latency, viewport-specific visual regression, missing
// icon, confusing celebration flow — and each exercises a different
// branch of the LLM classifier (bug / slow / visual / confusing) so the
// PDCA loop can show its full spread on the live admin.
//
// Usage:
//   MUSHI_API_KEY=... MUSHI_PROJECT_ID=... node scripts/marketing/seed-demo.mjs
//   ... or set them in .env.local and just:  node scripts/marketing/seed-demo.mjs
//
// Flags:
//   --dry          Print the planned reports without firing
//   --batch <tag>  Override the batch tag (defaults to demo-seed-<ISO>)
//
// Idempotency: each report carries a `metadata.seed_batch` so we can
// quickly identify (and if needed, soft-delete via the admin UI) all
// reports created by a given run. The batch tag is logged at the end.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadEnv, need, maybe, parseArgs, step, ok, warn, err, announceDryRun } from './lib.mjs'

loadEnv()
const args = parseArgs()
announceDryRun(args)

const ENDPOINT =
  maybe('MUSHI_INGEST_URL') ??
  `${maybe('MUSHI_API_URL')?.replace(/\/$/, '') ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'}/v1/reports`
// Dry-run skips credential checks so contributors can preview the seed
// payloads without needing a real project key.
const API_KEY = args.dry
  ? maybe('MUSHI_API_KEY') ?? '<dry-run>'
  : need('MUSHI_API_KEY', 'See packages/server/README.md for how to provision a project key.')
const PROJECT_ID = args.dry
  ? maybe('MUSHI_PROJECT_ID') ?? '<dry-run>'
  : need('MUSHI_PROJECT_ID', 'The UUID of the demo project; visible in Settings → API keys.')

const BATCH_TAG =
  args.batch ?? `demo-seed-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`

step(`Endpoint   ${ENDPOINT}`)
step(`Project    ${PROJECT_ID}`)
step(`Batch tag  ${BATCH_TAG}`)

// Each report carries enough realism (console logs, network metrics, viewport,
// platform) for the LLM classifier to do an honest job. The point is to make
// the demo look like real production data, not staged screenshots.
// Fixtures are shared with the console's one-click test report:
// packages/server/supabase/functions/_shared/demo-report-fixtures.json
// (camelCase ingest keys; console/network/breadcrumb entries carry a relative
// tsOffsetMs which is rebased onto Date.now() here).
const FIXTURES_PATH = new URL(
  '../../packages/server/supabase/functions/_shared/demo-report-fixtures.json',
  import.meta.url,
)

function materialize(fixture) {
  const now = Date.now()
  const stamp = (entry) => {
    const { tsOffsetMs, ...rest } = entry
    return { ...rest, timestamp: now + (tsOffsetMs ?? 0) }
  }
  return {
    ...fixture,
    consoleLogs: (fixture.consoleLogs ?? []).map(stamp),
    networkLogs: (fixture.networkLogs ?? []).map(stamp),
    breadcrumbs: (fixture.breadcrumbs ?? []).map(stamp),
  }
}

const reports = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')).map(materialize)

step(`Will fire ${reports.length} reports.`)

if (args.dry) {
  for (const r of reports) {
    console.log('  •', r.label)
  }
  process.exit(0)
}

const reporterToken = () =>
  'tok_' + randomUUID().replace(/-/g, '').slice(0, 24)

let okCount = 0
const failures = []
for (let i = 0; i < reports.length; i++) {
  const r = reports[i]
  const now = new Date()
  // Two validators sit on this path: POST /v1/reports accepts the USER
  // category ('bug' | 'feedback' | 'question' | 'feature' | 'other') and
  // ingestReport() then accepts the CLASSIFIER category ('bug' | 'slow' |
  // 'visual' | 'confusing' | 'other'). Only 'bug' and 'other' satisfy both,
  // so map to those and keep the expected classifier verdict in metadata.
  const userCategory = r.category === 'confusing' ? 'other' : 'bug'
  const payload = {
    projectId: PROJECT_ID,
    category: userCategory,
    description: r.description,
    userIntent: r.userIntent,
    environment: { referrer: '', ...r.environment, timestamp: now.toISOString() },
    consoleLogs: r.consoleLogs ?? [],
    networkLogs: r.networkLogs ?? [],
    performanceMetrics: r.performanceMetrics,
    metadata: {
      seed_batch: BATCH_TAG,
      index: i,
      source: 'mushi-marketing-seed',
      expected_category: r.category,
    },
    reporterToken: reporterToken(),
    sessionId: `sess-${BATCH_TAG}-${i}`,
    appVersion: '1.16.0',
    createdAt: now.toISOString(),
  }
  const t0 = Date.now()
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mushi-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text }
    }
    if (res.status === 201 || res.status === 200) {
      okCount++
      ok(
        `[${i}] ${r.label}  → reportId=${json?.data?.reportId ?? '—'} (${Date.now() - t0}ms)`,
      )
    } else {
      failures.push({ i, status: res.status, body: text.slice(0, 200) })
      err(`[${i}] HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
  } catch (e) {
    failures.push({ i, error: String(e) })
    err(`[${i}] ${e}`)
  }
}

console.log('')
step(`Batch ${BATCH_TAG}`)
ok(`${okCount} / ${reports.length} reports landed.`)
if (failures.length) {
  warn(`${failures.length} failed — check the admin /reports queue and retry.`)
  process.exit(1)
}
