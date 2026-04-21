#!/usr/bin/env node
/**
 * scripts/pdca-bounded-loop.mjs
 *
 * §5: bounded PDCA orchestrator.
 *
 * Fires curated bug reports through Mushi → polls for triage + judge →
 * dispatches fixes for classified reports → polls fix-attempt status →
 * records every event into a JSONL stream and a JSON round-summary.
 *
 * Stops when EITHER:
 *   - 3 consecutive "clean" rounds (every fired report classified, judge
 *     score recorded, and at least one fix dispatched without failure), OR
 *   - 5 total round attempts have been spent.
 *
 * Then writes a SUMMARY.md aggregating the outcome of every round, and
 * (optionally) commits the artifacts.
 *
 * Usage:
 *   MUSHI_API_KEY=mushi_xxx \
 *   MUSHI_PROJECT_ID=<uuid> \
 *   MUSHI_ADMIN_TOKEN=<jwt-from-supabase-session> \
 *   [MUSHI_API_BASE=https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api] \
 *   [PDCA_AUTOCOMMIT=true] \
 *   node scripts/pdca-bounded-loop.mjs
 *
 * MUSHI_ADMIN_TOKEN is required because the script needs to hit
 * /v1/admin/* endpoints to dispatch fixes and read judge scores. Grab
 * one from the admin UI's `localStorage` (`sb-...-auth-token` → access_token)
 * or generate one via supabase auth signInWithPassword.
 */

import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.MUSHI_API_KEY
const PROJECT_ID = process.env.MUSHI_PROJECT_ID
const ADMIN_TOKEN = process.env.MUSHI_ADMIN_TOKEN
const API_BASE =
  process.env.MUSHI_API_BASE ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const INGEST_URL = `${API_BASE}/v1/reports`
const AUTOCOMMIT = process.env.PDCA_AUTOCOMMIT === 'true'

const MAX_ROUNDS = Number(process.env.PDCA_MAX_ROUNDS ?? 5)
const TARGET_CLEAN_ROUNDS = Number(process.env.PDCA_TARGET_CLEAN_ROUNDS ?? 3)
const CLASSIFY_TIMEOUT_MS = Number(process.env.PDCA_CLASSIFY_TIMEOUT_MS ?? 90_000)
const JUDGE_TIMEOUT_MS = Number(process.env.PDCA_JUDGE_TIMEOUT_MS ?? 120_000)
const FIX_TIMEOUT_MS = Number(process.env.PDCA_FIX_TIMEOUT_MS ?? 240_000)
const POLL_INTERVAL_MS = Number(process.env.PDCA_POLL_INTERVAL_MS ?? 5_000)

if (!API_KEY || !PROJECT_ID || !ADMIN_TOKEN) {
  console.error(
    'Missing required env vars. Set MUSHI_API_KEY, MUSHI_PROJECT_ID, and MUSHI_ADMIN_TOKEN.\n' +
      'See scripts/pdca-bounded-loop.mjs header comment for how to obtain each.',
  )
  process.exit(1)
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Each round mutates the title slightly so dedup doesn't collapse them
// into the same group across rounds.

const FIXTURE_TEMPLATES = [
  {
    category: 'bug',
    label: 'lesson-card-crash',
    description: (round) =>
      `Round ${round}: Tapping any unfinished lesson card on the lesson list flashes briefly and bounces back to /home. Pixel 8 / Chrome 132. Console shows "TypeError: Cannot read properties of undefined (reading slug)" at LessonCard.tsx:84 right before the bounce.`,
    userIntent: 'open the second lesson to keep my streak going',
    consoleLogs: [
      {
        level: 'error',
        message: "TypeError: Cannot read properties of undefined (reading 'slug')",
        stack: 'at LessonCard (app/lessons/page.tsx:84:31)',
      },
    ],
    url: '/lessons',
  },
  {
    category: 'slow',
    label: 'vocab-quiz-latency',
    description: (round) =>
      `Round ${round}: Vocab quiz drill takes 6-9s between submitting an answer and the next question appearing. Used to be instant. Happens after question 3+. INP > 600ms locked.`,
    userIntent: 'finish my daily 10 vocab drills inside 2 minutes',
    performanceMetrics: { fcp: 1840, lcp: 2710, cls: 0.04, inp: 642, ttfb: 312, longTasks: 11 },
    url: '/drills/vocab',
  },
  {
    category: 'visual',
    label: 'cta-overlap',
    description: (round) =>
      `Round ${round}: Hero CTA "Start lesson" overlaps the bottom nav by ~14px on a 360x800 landscape viewport. Text "Start" is fully clipped. Fine in portrait.`,
    userIntent: 'tap Start lesson without rotating my phone',
    url: '/',
  },
]

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function ingestReport(template, round, index) {
  const reporterToken = 'tok_' + cryptoRandomHex(24)
  const payload = {
    projectId: PROJECT_ID,
    category: template.category,
    description: template.description(round),
    userIntent: template.userIntent,
    environment: {
      userAgent: 'pdca-bounded-loop/1.0',
      platform: 'Linux armv8l',
      language: 'en-GB',
      url: template.url,
      timezone: 'Asia/Tokyo',
      timestamp: new Date().toISOString(),
    },
    consoleLogs: template.consoleLogs ?? [],
    networkLogs: [],
    performanceMetrics: template.performanceMetrics,
    metadata: { round, index, label: template.label, source: 'pdca-bounded-loop' },
    reporterToken,
    sessionId: `pdca-r${round}-${index}-${Date.now()}`,
    appVersion: '1.0.0',
    createdAt: new Date().toISOString(),
  }
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mushi-api-key': API_KEY },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (res.status !== 201) {
    throw new Error(`ingest ${res.status}: ${text.slice(0, 200)}`)
  }
  return { reportId: json?.data?.reportId, label: template.label }
}

async function adminFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

async function getReport(reportId) {
  const { json } = await adminFetch(`/v1/admin/reports/${reportId}`)
  return json?.data ?? null
}

async function dispatchFix(reportId) {
  return adminFetch('/v1/admin/fixes/dispatch', {
    method: 'POST',
    body: JSON.stringify({ reportId, projectId: PROJECT_ID }),
  })
}

async function getDispatch(dispatchId) {
  const { json } = await adminFetch(`/v1/admin/fixes/dispatch/${dispatchId}`)
  return json?.data ?? null
}

// ─── Polling ─────────────────────────────────────────────────────────────────

async function pollUntil(predicate, label, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await predicate().catch((e) => {
      console.warn(`[poll:${label}] error`, String(e))
      return null
    })
    if (result?.done) return result.value
    await sleep(POLL_INTERVAL_MS)
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cryptoRandomHex(len) {
  return [...crypto.getRandomValues(new Uint8Array(Math.ceil(len / 2)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, len)
}

// ─── Round logic ─────────────────────────────────────────────────────────────

async function runRound({ round, runDir }) {
  const jsonlPath = join(runDir, `round-${round}.jsonl`)
  const events = []
  const log = async (kind, payload) => {
    const event = { ts: new Date().toISOString(), round, kind, ...payload }
    events.push(event)
    await appendFile(jsonlPath, JSON.stringify(event) + '\n')
  }

  await log('round.start', { fixtureCount: FIXTURE_TEMPLATES.length })

  // ── Plan: fire reports ─────────────────────────────────────────────────────
  const fired = []
  for (let i = 0; i < FIXTURE_TEMPLATES.length; i++) {
    const t = FIXTURE_TEMPLATES[i]
    try {
      const result = await ingestReport(t, round, i)
      fired.push(result)
      await log('plan.report.fired', result)
    } catch (e) {
      await log('plan.report.failed', { label: t.label, error: String(e) })
    }
  }

  if (fired.length === 0) {
    await log('round.end', { ok: false, reason: 'no reports fired' })
    return summarizeRound(round, events)
  }

  // ── Do/Check: wait for triage + judge, then dispatch + wait for fix ─────────
  const reportOutcomes = []
  for (const r of fired) {
    const classified = await pollUntil(
      async () => {
        const rep = await getReport(r.reportId)
        if (!rep) return null
        if (['classified', 'grouped', 'fixing', 'fixed'].includes(rep.status)) {
          return { done: true, value: rep }
        }
        return null
      },
      `classify:${r.label}`,
      CLASSIFY_TIMEOUT_MS,
    )

    if (!classified) {
      await log('do.classify.timeout', { reportId: r.reportId, label: r.label })
      reportOutcomes.push({ ...r, classified: false })
      continue
    }
    await log('do.classify.ok', {
      reportId: r.reportId,
      label: r.label,
      category: classified.category,
      severity: classified.severity,
      component: classified.component,
      confidence: classified.confidence,
    })

    const judged = await pollUntil(
      async () => {
        const rep = await getReport(r.reportId)
        if (rep?.judge_score != null) return { done: true, value: rep }
        return null
      },
      `judge:${r.label}`,
      JUDGE_TIMEOUT_MS,
    )
    if (judged) {
      await log('check.judge.ok', { reportId: r.reportId, label: r.label, judgeScore: judged.judge_score })
    } else {
      await log('check.judge.timeout', { reportId: r.reportId, label: r.label })
    }

    // Dispatch fix only when classified — judge may still be pending; it's OK
    // for the loop to continue even if judge timed out (judge runs nightly
    // by default).
    const dispatch = await dispatchFix(r.reportId)
    if (dispatch.status >= 400) {
      await log('do.fix.dispatch.failed', {
        reportId: r.reportId,
        label: r.label,
        status: dispatch.status,
        error: dispatch.json?.error,
      })
      reportOutcomes.push({ ...r, classified: true, judged: !!judged, fixOk: false, fixError: dispatch.json?.error })
      continue
    }
    const dispatchId = dispatch.json?.data?.dispatchId
    await log('do.fix.dispatch.ok', { reportId: r.reportId, label: r.label, dispatchId })

    const finalDispatch = await pollUntil(
      async () => {
        const d = await getDispatch(dispatchId)
        if (!d) return null
        if (['completed', 'failed', 'cancelled'].includes(d.status)) {
          return { done: true, value: d }
        }
        return null
      },
      `fix:${r.label}`,
      FIX_TIMEOUT_MS,
    )

    if (!finalDispatch) {
      await log('act.fix.timeout', { reportId: r.reportId, label: r.label, dispatchId })
      reportOutcomes.push({ ...r, classified: true, judged: !!judged, fixOk: false, fixTimedOut: true })
      continue
    }

    const prUrl = finalDispatch.pr_url ?? null
    await log(finalDispatch.status === 'completed' ? 'act.fix.ok' : 'act.fix.failed', {
      reportId: r.reportId,
      label: r.label,
      dispatchId,
      status: finalDispatch.status,
      prUrl,
      fixAttemptId: finalDispatch.fix_attempt_id ?? null,
      error: finalDispatch.error_message ?? null,
    })

    reportOutcomes.push({
      ...r,
      classified: true,
      judged: !!judged,
      judgeScore: judged?.judge_score ?? null,
      fixOk: finalDispatch.status === 'completed',
      prUrl,
    })
  }

  const summary = {
    round,
    fired: fired.length,
    classified: reportOutcomes.filter((r) => r.classified).length,
    judged: reportOutcomes.filter((r) => r.judged).length,
    fixOk: reportOutcomes.filter((r) => r.fixOk).length,
    prUrls: reportOutcomes.map((r) => r.prUrl).filter(Boolean),
    reports: reportOutcomes,
  }
  // A round is "clean" if every fired report classified AND at least one
  // fix succeeded. Judge timeouts are tolerated (cron may not have run yet).
  summary.clean = summary.classified === summary.fired && summary.fixOk > 0

  await log('round.end', summary)
  await writeFile(join(runDir, `round-${round}.json`), JSON.stringify(summary, null, 2))

  return summary
}

function summarizeRound(round, events) {
  return { round, fired: 0, classified: 0, judged: 0, fixOk: 0, prUrls: [], reports: [], clean: false, events }
}

// ─── Driver ──────────────────────────────────────────────────────────────────

async function writeRunSummary(runDir, runId, rounds, finalReason) {
  const totalFired = rounds.reduce((s, r) => s + r.fired, 0)
  const totalClassified = rounds.reduce((s, r) => s + r.classified, 0)
  const totalJudged = rounds.reduce((s, r) => s + r.judged, 0)
  const totalFixed = rounds.reduce((s, r) => s + r.fixOk, 0)
  const allPrs = rounds.flatMap((r) => r.prUrls)
  const cleanRounds = rounds.filter((r) => r.clean).length

  const lines = [
    `# PDCA Bounded Loop · ${runId}`,
    '',
    `**Project:** \`${PROJECT_ID}\``,
    `**Outcome:** ${finalReason}`,
    `**Rounds attempted:** ${rounds.length} / ${MAX_ROUNDS} (target ${TARGET_CLEAN_ROUNDS} clean)`,
    `**Clean rounds:** ${cleanRounds}`,
    '',
    '## Totals',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Reports fired | ${totalFired} |`,
    `| Classified | ${totalClassified} |`,
    `| Judge-scored | ${totalJudged} |`,
    `| Fixes completed | ${totalFixed} |`,
    `| PRs opened | ${allPrs.length} |`,
    '',
    '## Per-round',
    '',
    `| Round | Fired | Classified | Judged | Fix OK | Clean? | PRs |`,
    `|---|---|---|---|---|---|---|`,
    ...rounds.map(
      (r) =>
        `| ${r.round} | ${r.fired} | ${r.classified} | ${r.judged} | ${r.fixOk} | ${r.clean ? '✅' : '⛔'} | ${r.prUrls.length} |`,
    ),
    '',
  ]

  if (allPrs.length > 0) {
    lines.push('## PRs opened', '')
    for (const pr of allPrs) lines.push(`- ${pr}`)
    lines.push('')
  }

  lines.push(
    '## Artifacts',
    '',
    'Per-round JSONL streams live next to this file:',
    '',
    ...rounds.map((r) => `- \`round-${r.round}.jsonl\` · \`round-${r.round}.json\``),
    '',
  )

  await writeFile(join(runDir, 'SUMMARY.md'), lines.join('\n'))
}

function gitCommit(runDir, message) {
  try {
    execSync(`git add "${runDir}"`, { cwd: REPO_ROOT, stdio: 'inherit' })
    execSync(`git diff --cached --quiet || git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
    })
  } catch (e) {
    console.warn('git commit failed (non-fatal):', String(e))
  }
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const runDir = join(REPO_ROOT, 'pdca-runs', runId)
  await mkdir(runDir, { recursive: true })

  console.log(`[pdca-bounded-loop] runId=${runId} dir=${runDir}`)

  const rounds = []
  let cleanRounds = 0
  let finalReason = ''

  for (let i = 1; i <= MAX_ROUNDS; i++) {
    console.log(`\n=== Round ${i} / ${MAX_ROUNDS} ===`)
    const result = await runRound({ round: i, runDir })
    rounds.push(result)
    if (result.clean) cleanRounds++
    console.log(
      `[round-${i}] fired=${result.fired} classified=${result.classified} judged=${result.judged} fixOk=${result.fixOk} clean=${result.clean}`,
    )

    if (AUTOCOMMIT) {
      gitCommit(
        runDir,
        `pdca: round ${i}/${MAX_ROUNDS} — fired=${result.fired} classified=${result.classified} fixOk=${result.fixOk} clean=${result.clean}`,
      )
    }

    if (cleanRounds >= TARGET_CLEAN_ROUNDS) {
      finalReason = `Stopped after ${cleanRounds} clean rounds (target ${TARGET_CLEAN_ROUNDS})`
      break
    }
  }

  if (!finalReason) finalReason = `Hit max rounds (${MAX_ROUNDS}) with ${cleanRounds} clean`

  await writeRunSummary(runDir, runId, rounds, finalReason)
  console.log(`\n[pdca-bounded-loop] ${finalReason}`)
  console.log(`[pdca-bounded-loop] summary: ${join(runDir, 'SUMMARY.md')}`)

  if (AUTOCOMMIT) {
    gitCommit(runDir, `pdca: SUMMARY for ${runId} — ${finalReason}`)
  }

  process.exit(cleanRounds >= TARGET_CLEAN_ROUNDS ? 0 : 1)
}

main().catch((e) => {
  console.error('[pdca-bounded-loop] fatal', e)
  process.exit(2)
})
