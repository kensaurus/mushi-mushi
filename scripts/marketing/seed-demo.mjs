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
const reports = [
  {
    label: '🔴 high — login button does nothing on iPad Safari',
    category: 'bug',
    description:
      "Tapping the Sign in button on the login screen does literally nothing on iPad Safari (iOS 17.6). No spinner, no error toast, no console output, no network request fires. Form is filled correctly. Switching to Chrome on the same iPad works fine. Tested 5 times across two devices.",
    userIntent: 'sign in to my account from my iPad in bed',
    consoleLogs: [],
    networkLogs: [],
    environment: {
      url: '/login',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15',
      platform: 'iPad',
      language: 'en-US',
      viewport: { width: 820, height: 1180 },
      timezone: 'America/Los_Angeles',
    },
  },
  {
    label: '🟠 high — checkout pause after card entry',
    category: 'slow',
    description:
      "After typing my card number on the checkout page, the page freezes for ~8s before the spinner appears. The first time I thought it crashed and refreshed (losing my cart). Multiple users in the discord report the same. INP > 800ms locked, p95 worse on the first checkout of a session.",
    userIntent: 'pay for my pro plan upgrade without dropping off',
    performanceMetrics: { fcp: 1420, lcp: 2310, cls: 0.02, inp: 824, ttfb: 287, longTasks: 14 },
    consoleLogs: [
      { level: 'warn', message: '[stripe] elements ready took 7280ms (cold start)', timestamp: Date.now() - 9000 },
    ],
    environment: {
      url: '/checkout',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
      platform: 'MacIntel',
      language: 'en-GB',
      viewport: { width: 1440, height: 900 },
      timezone: 'Europe/London',
    },
  },
  {
    label: '🟡 medium — settings icon missing on Pixel 7 portrait',
    category: 'visual',
    description:
      "On a Pixel 7 in portrait orientation the gear/settings icon in the top-right of the dashboard is just… not there. The clickable area still works (tapping where it should be opens the menu) but the icon is invisible. Landscape is fine. Pixel 8 is fine. Repro 100% on Pixel 7 + Chrome 132.",
    userIntent: 'open settings to switch my notification preferences',
    environment: {
      url: '/dashboard',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      language: 'en-US',
      viewport: { width: 412, height: 915 },
      timezone: 'America/Chicago',
    },
  },
  {
    label: '🔵 medium — celebration says +0 XP but streak still incremented',
    category: 'confusing',
    description:
      "After finishing the daily lesson the celebration sheet shows '+0 XP earned today' but my streak counter on the home screen incremented by 1. So either I earned XP or I didn't — both can't be true. Also the haptic 'tada' on the celebration sheet that used to fire is silent now. Lost trust in whether sessions are counting at all.",
    userIntent: 'understand whether my daily lesson actually counted',
    environment: {
      url: '/lesson/complete',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      language: 'ja-JP',
      viewport: { width: 393, height: 852 },
      timezone: 'Asia/Tokyo',
    },
  },
  {
    label: '🟢 low — markdown links in chat panel render as plain text',
    category: 'bug',
    description:
      "Pasting a markdown link like [docs](https://example.com) into the chat panel renders the literal source instead of a clickable link. Slack-style auto-link of bare URLs still works, so it's specifically the [text](url) syntax that's broken. Started after the v1.16 release based on when teammates first complained in #support.",
    userIntent: 'share a doc link with my teammate without it looking ugly',
    environment: {
      url: '/chat/team-eng',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      platform: 'Linux x86_64',
      language: 'en-US',
      viewport: { width: 1920, height: 1080 },
      timezone: 'America/New_York',
    },
  },
]

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
  const payload = {
    projectId: PROJECT_ID,
    category: r.category,
    description: r.description,
    userIntent: r.userIntent,
    environment: { ...r.environment, timestamp: now.toISOString() },
    consoleLogs: r.consoleLogs ?? [],
    networkLogs: r.networkLogs ?? [],
    performanceMetrics: r.performanceMetrics,
    metadata: { seed_batch: BATCH_TAG, index: i, source: 'mushi-marketing-seed' },
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
