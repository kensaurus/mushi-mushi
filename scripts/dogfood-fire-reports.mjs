// Fires 4 realistic bug reports through the SDK ingest endpoint so we can
// watch the LLM pipeline classify them end-to-end. The fixtures are written
// in glot.it's voice (lessons, drills, Sing Along) because that is the
// canonical dogfood project, but the script accepts any Mushi project.
//
// Usage: MUSHI_API_KEY=mushi_xxx MUSHI_PROJECT_ID=<uuid> \
//        node scripts/dogfood-fire-reports.mjs
//
// Optional overrides:
//   MUSHI_INGEST_URL  defaults to the production ingest endpoint
//
// Notes
// - Each report mimics a different category so we exercise every branch of
//   the classifier (bug / slow / visual / confusing).
// - Adds a ROUND tag so we can pick out this batch on the admin console.

const ENDPOINT =
  process.env.MUSHI_INGEST_URL ??
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/reports'
const API_KEY = process.env.MUSHI_API_KEY
const PROJECT_ID = process.env.MUSHI_PROJECT_ID

if (!API_KEY || !PROJECT_ID) {
  console.error(
    'Missing required env vars. Set MUSHI_API_KEY and MUSHI_PROJECT_ID.\n' +
      'See packages/server/README.md for how to provision a project key.',
  )
  process.exit(1)
}
const ROUND = `dogfood-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`

const baseEnv = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  language: 'en-GB',
  viewport: { width: 360, height: 800 },
  referrer: 'https://6-6-ai.vercel.app/',
  timezone: 'Asia/Tokyo',
  connection: { effectiveType: '4g', downlink: 7.4, rtt: 75 },
  deviceMemory: 4,
  hardwareConcurrency: 8,
}

const reports = [
  {
    category: 'bug',
    description:
      'On the lesson list page, tapping any unfinished lesson card triggers a brief flash and the route URL changes, but the page silently bounces back to /glot-it/ home. Repro 100% on Pixel 8 / Chrome 132. Console shows "TypeError: Cannot read properties of undefined (reading slug)" at LessonCard.tsx:84 right before the bounce.',
    userIntent: 'open the second lesson to keep my streak going',
    consoleLogs: [
      { level: 'error', message: "TypeError: Cannot read properties of undefined (reading 'slug')", timestamp: Date.now() - 5000, stack: 'at LessonCard (app/glot-it/lessons/page.tsx:84:31)' },
      { level: 'warn', message: '[next-router] aborted navigation /glot-it/lessons/lesson-2', timestamp: Date.now() - 4900 },
    ],
    networkLogs: [
      { method: 'GET', url: '/glot-it/lessons/lesson-2', status: 200, duration: 412, timestamp: Date.now() - 4800 },
    ],
    url: '/glot-it/lessons',
  },
  {
    category: 'slow',
    description:
      'Vocab Quiz drill takes 6-9 seconds between submitting an answer and the next question appearing. Used to be instant. Happens on every drill once you reach question 3+ in a session. p95 worse on cold starts. INP > 600ms locked.',
    userIntent: 'finish my daily 10 vocab drills inside 2 minutes',
    performanceMetrics: { fcp: 1840, lcp: 2710, cls: 0.04, inp: 642, ttfb: 312, longTasks: 11 },
    consoleLogs: [
      { level: 'warn', message: '[react] suspense fallback shown for 6700ms (DrillNext)', timestamp: Date.now() - 7000 },
    ],
    url: '/glot-it/drills/vocab',
  },
  {
    category: 'visual',
    description:
      'Hero CTA "Start lesson" overlaps the bottom nav by ~14px on a 360x800 viewport in landscape. The text "Start" is fully clipped. Looks broken on first paint, no scroll fixes it. Fine in portrait.',
    userIntent: 'tap Start lesson without rotating my phone',
    url: '/glot-it/',
  },
  {
    category: 'confusing',
    description:
      'After finishing a Sing Along exercise the celebration sheet shows "+0 XP" but the streak counter still increments by 1. Either the XP is wrong or the streak is. Also no haptic feedback on the celebration which there used to be.',
    userIntent: 'understand whether my session counted',
    url: '/glot-it/sing-along/complete',
  },
]

function reporterToken() {
  return 'tok_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}

async function fire(report, index) {
  const now = new Date()
  const payload = {
    projectId: PROJECT_ID,
    category: report.category,
    description: report.description,
    userIntent: report.userIntent,
    environment: { ...baseEnv, url: report.url, timestamp: now.toISOString() },
    consoleLogs: report.consoleLogs ?? [],
    networkLogs: report.networkLogs ?? [],
    performanceMetrics: report.performanceMetrics,
    metadata: { round: ROUND, index, source: 'mushi-dogfood-script' },
    reporterToken: reporterToken(),
    sessionId: `sess-${ROUND}-${index}`,
    appVersion: '1.16.0',
    createdAt: now.toISOString(),
  }
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
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

const results = []
for (let i = 0; i < reports.length; i++) {
  const t0 = Date.now()
  try {
    const out = await fire(reports[i], i)
    results.push({ i, ...out, ms: Date.now() - t0 })
    console.log(`[${i}] ${out.status} reportId=${out.json?.data?.reportId ?? '—'} (${Date.now() - t0}ms)`)
  } catch (err) {
    console.error(`[${i}] FAILED`, err)
    results.push({ i, error: String(err), ms: Date.now() - t0 })
  }
}

console.log('\nROUND', ROUND)
console.log('OK', results.filter(r => r.status === 201).length, '/', results.length)
