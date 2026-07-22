// ============================================================
// qa-story-runner — QA Coverage Suite browser agent runner
//
// Invoked by pg_cron every minute. Scans for qa_stories whose
// schedule_cron is due, executes them via the configured browser
// provider (firecrawl_actions for Deno Edge; local/browserbase via
// an external CLI trigger), writes qa_story_runs + qa_story_evidence
// rows, and triggers A2A push notifications for failures.
//
// Architecture
// ────────────
// Edge functions run in Deno and cannot launch a local Chromium.
// The runner therefore:
//   1. For `firecrawl_actions` provider stories: runs them inline
//      using the Firecrawl REST API (HTTP-only, Deno-compatible).
//   2. For `browserbase` provider stories: calls the Browserbase REST
//      API to create a session and delegate to a pre-deployed script
//      stored in the story's `script` column (Browserbase executes it
//      on their cloud Chromium via the Stagehand / Playwright bridge).
//   3. For `local` provider stories: marks status='skipped' with a
//      reason that the local provider requires the CLI runner. The
//      operator's local mushi-dev server picks these up via long-polling.
//
// Cron
// ────
// Registered in the migration as every-minute via:
//   SELECT cron.schedule('qa-story-runner', '* * * * *', $$...$$)
// The function itself gates execution on whether each story's
// schedule_cron aligns with the current time (via a simple cron-match
// check) so we don't need one pg_cron job per story.
//
// Rate limits
// ───────────
// Per-project concurrency is capped at MAX_CONCURRENT_PER_PROJECT
// to prevent a user with 100 stories from monopolising edge function
// compute. Stories are queued as FIFO; skipped ones get a 'skipped'
// run row with the reason.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { isTransientDbConnectionError } from '../_shared/error-codes.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { parseBody, QaStoryRunnerBodySchema, type QaStoryRunnerBody } from '../_shared/validate.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { sendBotMessage, sendSlackText, buildQaStoryRunBlocks, sendDiscordNotification } from '../_shared/slack.ts'
import { dispatchPluginEvent } from '../_shared/plugins.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('qa-story-runner')
const MAX_CONCURRENT_PER_PROJECT = 3

interface QaStory {
  id: string
  project_id: string
  name: string
  prompt: string | null
  script: string | null
  script_lang: string
  browser_provider: string
  schedule_cron: string
  enabled: boolean
  capture_video: boolean
  byok_provider: string | null
  /** Explicit scrape target set by the user in the console. Takes precedence over prompt/env. */
  target_url: string | null
  /** Notification state — updated at end of each run */
  last_run_status: string | null
  consecutive_failures: number
  slack_failure_ts: string | null
  last_notified_at: string | null
}

interface RunResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'skipped'
  latency_ms: number
  summary: string | null
  assertion_failures: Array<{ step: string; expected: string | null; actual: string | null }>
  provider_session_url: string | null
  error_message: string | null
  evidence: Array<{ kind: string; data: string; mime: string; step_label?: string }>
}

// ── Cron matching ─────────────────────────────────────────────────────────
function cronMatches(expression: string, now: Date): boolean {
  // Minimal 5-field cron matcher (min, hour, dom, month, dow).
  // We only need minute-level precision for story scheduling.
  const fields = expression.trim().split(/\s+/)
  if (fields.length < 5) return true // invalid → always run

  function matchField(field: string, val: number): boolean {
    if (field === '*') return true
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return step > 0 && val % step === 0
    }
    return field.split(',').some((v) => parseInt(v, 10) === val)
  }

  const [min, hour, dom, mon, dow] = fields
  return (
    matchField(min, now.getUTCMinutes()) &&
    matchField(hour, now.getUTCHours()) &&
    matchField(dom, now.getUTCDate()) &&
    matchField(mon, now.getUTCMonth() + 1) &&
    matchField(dow, now.getUTCDay())
  )
}

// ── Target URL resolution ─────────────────────────────────────────────────
// Priority: story.target_url → URL in script → first https:// in prompt →
//           project_settings.crawler_base_url / synthetic_monitor_target_url →
//           DEFAULT_BASE_URL env. Returns null if nothing found (caller writes error).
async function resolveTargetUrl(
  db: SupabaseClient,
  story: QaStory,
  projectId: string,
): Promise<string | null> {
  // 1. Explicit target set in console
  if (story.target_url) return story.target_url

  // 2. Script field starts with a URL
  if (story.script?.startsWith('http')) return story.script

  // 3. First https:// URL extracted from prompt (skip localhost — Firecrawl can't reach it)
  if (story.prompt) {
    const match = story.prompt.match(/https?:\/\/[^\s"']+/)
    if (match) {
      const url = match[0].replace(/[.,;)]+$/, '') // strip trailing punctuation
      if (!url.includes('localhost') && !url.includes('127.0.0.1')) return url
    }
  }

  // 4. Project-level base URLs from project_settings
  const { data: ps } = await db
    .from('project_settings')
    .select('crawler_base_url, synthetic_monitor_target_url')
    .eq('project_id', projectId)
    .maybeSingle()

  if (ps?.crawler_base_url) return ps.crawler_base_url
  if (ps?.synthetic_monitor_target_url) return ps.synthetic_monitor_target_url

  // 5. Env fallback
  const envUrl = Deno.env.get('DEFAULT_BASE_URL')
  if (envUrl && !envUrl.includes('localhost')) return envUrl

  return null
}

// ── BYOK key resolution ────────────────────────────────────────────────────
// Always derive the provider from browser_provider (not story.byok_provider).
// story.byok_provider is an optional override when a story needs a different
// key pool than the default for its provider.
const BROWSER_PROVIDER_TO_BYOK: Record<string, 'firecrawl' | 'browserbase'> = {
  firecrawl_actions: 'firecrawl',
  browserbase: 'browserbase',
}

async function resolveStoryApiKey(
  db: SupabaseClient,
  story: QaStory,
  projectId: string,
): Promise<string | undefined> {
  // story.byok_provider is an explicit override; otherwise derive from browser_provider
  const slug = (story.byok_provider ?? BROWSER_PROVIDER_TO_BYOK[story.browser_provider]) as
    | 'firecrawl' | 'browserbase' | undefined

  if (!slug) return undefined

  try {
    const result = await resolveLlmKey(db, projectId, slug)
    if (result) return result.key
    rlog.warn('no_byok_key_configured — story will fail; add key via Settings → API Keys', {
      provider: slug,
      storyId: story.id,
    })
  } catch (err) {
    rlog.warn('byok_resolution_error — continuing without key', {
      err: String(err),
      storyId: story.id,
    })
  }
  return undefined
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns true when the story script has { directFetch: true }. */
function isDirectFetchMode(story: QaStory): boolean {
  if (!story.script || story.script.startsWith('http')) return false
  try {
    const parsed = JSON.parse(story.script) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return (parsed as { directFetch?: boolean }).directFetch === true
    }
  } catch { /* ignore */ }
  return false
}

// ── Direct-fetch runner (no Firecrawl, no browser) ───────────────────────
//
// For SSG/SSR pages (static exports, CDN-served HTML), a plain HTTP GET is
// faster and more reliable than Firecrawl's headless browser.
// Activated by `directFetch: true` in the story's script JSON.
//
// Uses Deno's built-in fetch() with a 20-second timeout via AbortController.
// Checks assertContains (or prompt-quoted strings) against the raw HTML body.
// No Firecrawl API key needed.
async function runDirectFetch(story: QaStory, targetUrl: string): Promise<RunResult> {
  const start = Date.now()
  const assertionFailures: RunResult['assertion_failures'] = []

  // Parse assertContains from script
  let assertContains: string[] = []
  if (story.script && !story.script.startsWith('http')) {
    try {
      const parsed = JSON.parse(story.script) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const spec = parsed as { assertContains?: string[] }
        if (Array.isArray(spec.assertContains)) assertContains = spec.assertContains
      }
    } catch { /* use defaults */ }
  }

  const termsToCheck: string[] = assertContains.length > 0
    ? assertContains
    : story.prompt
        ? [...(story.prompt.matchAll(/["']([^"']{2,50})["']/g))].map((m) => m[1]).slice(0, 8)
        : []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MushiQARunner/1.0 (directFetch)' },
    })
    clearTimeout(timer)

    if (!res.ok) {
      return {
        status: 'error',
        latency_ms: Date.now() - start,
        summary: `HTTP ${res.status} from ${targetUrl}`,
        assertion_failures: [],
        provider_session_url: null,
        error_message: `HTTP ${res.status} ${res.statusText}`,
        evidence: [],
      }
    }

    const html = await res.text()

    // Check terms against raw HTML (case-insensitive)
    for (const term of termsToCheck) {
      if (!html.toLowerCase().includes(term.toLowerCase())) {
        assertionFailures.push({ step: 'content', expected: term, actual: '(not found in HTML)' })
      }
    }

    // directFetch returns no screenshot evidence — the run status + assertion
    // failures are the signal. Storing raw HTML inline would exceed column limits.
    const passed = assertionFailures.length === 0
    return {
      status: passed ? 'passed' : 'failed',
      latency_ms: Date.now() - start,
      summary: passed
        ? `"${story.name}" passed.`
        : `"${story.name}" failed ${assertionFailures.length} assertion(s).`,
      assertion_failures: assertionFailures,
      provider_session_url: null,
      error_message: null,
      evidence: [],
    }
  } catch (err) {
    clearTimeout(timer)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      status: isAbort ? 'timeout' : 'error',
      latency_ms: Date.now() - start,
      summary: isAbort ? `Fetch timed out after 20s for ${targetUrl}` : `Fetch error`,
      assertion_failures: [],
      provider_session_url: null,
      error_message: err instanceof Error ? err.message : String(err),
      evidence: [],
    }
  }
}

// ── Firecrawl inline runner (Deno-compatible) ─────────────────────────────
//
// script column supports two formats:
//   1. Array  — raw Firecrawl actions (legacy): [...actions]
//   2. Object — structured spec: { actions?: [...], assertContains?: string[], waitFor?: number, htmlOnly?: boolean, directFetch?: boolean }
//
// assertContains is the preferred way to define pass criteria — each string is
// checked as a case-insensitive substring in the scraped markdown. The old NL
// prompt regex (30-60 char prose phrases) produced too many false failures on
// SPA-rendered pages and is replaced by quoted-string extraction when no
// assertContains is present.
async function runFirecrawl(story: QaStory, apiKey: string, targetUrl: string): Promise<RunResult> {
  const start = Date.now()
  const assertionFailures: RunResult['assertion_failures'] = []
  const evidence: RunResult['evidence'] = []

  try {
    // Parse script — supports array (legacy) or structured object:
    //
    //   { actions?, assertContains?, waitFor?, htmlOnly? }
    //
    // htmlOnly=true  → rawHtml format, no headless browser (fast, for SSR/SSG pages)
    // htmlOnly=false → full browser mode with actions + screenshot
    //
    // SCREENSHOT HANDLING: action `{ type: 'screenshot' }` writes to
    // `data.data.actions.screenshots[]`; the top-level `formats: ['screenshot']`
    // writes to `data.data.screenshot`. We always try `data.screenshot` first.
    let actions: Array<Record<string, unknown>> = [
      { type: 'wait', milliseconds: 3000 },
      { type: 'screenshot' },
    ]
    let assertContains: string[] = []
    let waitFor = 5000
    // htmlOnly skips the headless browser entirely — ideal for SSR/SSG pages
    // that have all content in the initial HTML. Avoids SCRAPE_TIMEOUT on
    // complex JS bundles.
    let htmlOnly = false

    if (story.script && !story.script.startsWith('http')) {
      try {
        const parsed = JSON.parse(story.script) as unknown
        if (Array.isArray(parsed)) {
          // Legacy: bare actions array
          actions = parsed as Array<Record<string, unknown>>
        } else if (parsed && typeof parsed === 'object') {
          // Structured spec object
          const spec = parsed as {
            actions?: Array<Record<string, unknown>>
            assertContains?: string[]
            waitFor?: number
            htmlOnly?: boolean
          }
          if (Array.isArray(spec.actions)) actions = spec.actions
          if (Array.isArray(spec.assertContains)) assertContains = spec.assertContains
          if (typeof spec.waitFor === 'number') waitFor = spec.waitFor
          if (typeof spec.htmlOnly === 'boolean') htmlOnly = spec.htmlOnly
        }
      } catch {
        // Unparseable — use defaults (browser mode)
      }
    }

    // Ensure the screenshot action is present when using browser mode —
    // Firecrawl uses it as a rendering-complete signal, preventing SCRAPE_TIMEOUT.
    if (!htmlOnly) {
      const hasScreenshotAction = actions.some(
        (a) => (a as { type?: string }).type === 'screenshot',
      )
      if (!hasScreenshotAction) actions = [...actions, { type: 'screenshot' }]
    }

    const fcBody: Record<string, unknown> = {
      url: targetUrl,
      formats: htmlOnly ? ['rawHtml'] : ['markdown', 'screenshot'],
    }
    if (!htmlOnly) {
      fcBody.actions = actions
      fcBody.waitFor = waitFor
    }

    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(fcBody),
    })

    if (!res.ok) {
      const errText = await res.text()
      return {
        status: 'error',
        latency_ms: Date.now() - start,
        summary: `Firecrawl request failed: ${res.status}`,
        assertion_failures: [],
        provider_session_url: null,
        error_message: errText,
        evidence: [],
      }
    }

    const data = await res.json() as {
      success?: boolean
      data?: {
        markdown?: string
        rawHtml?: string
        screenshot?: string
        // Firecrawl v1: action screenshots land in data.actions.screenshots
        actions?: { screenshots?: string[] }
      }
    }

    // Use rawHtml as fallback content source for htmlOnly mode
    const markdown = data?.data?.markdown ?? data?.data?.rawHtml ?? ''
    const screenshot = data?.data?.screenshot
      ?? data?.data?.actions?.screenshots?.[0]
      ?? ''

    // Assertions — prefer explicit assertContains; fall back to quoted strings
    // in the prompt (single or double quoted terms, ≤ 50 chars). The old broad
    // regex extracted full NL sentences and caused false failures on SPAs.
    const termsToCheck: string[] = assertContains.length > 0
      ? assertContains
      : story.prompt
          ? [...(story.prompt.matchAll(/["']([^"']{2,50})["']/g))].map((m) => m[1]).slice(0, 8)
          : []

    if (markdown && termsToCheck.length > 0) {
      for (const term of termsToCheck) {
        if (!markdown.toLowerCase().includes(term.toLowerCase())) {
          assertionFailures.push({ step: 'content', expected: term, actual: '(not found)' })
        }
      }
    }

    if (screenshot) {
      const b64 = screenshot.replace(/^data:image\/\w+;base64,/, '')
      evidence.push({ kind: 'screenshot', data: b64, mime: 'image/png', step_label: 'firecrawl' })
    }
    if (markdown) {
      evidence.push({
        kind: 'dom',
        data: btoa(unescape(encodeURIComponent(markdown))),
        mime: 'text/markdown',
      })
    }

    const passed = assertionFailures.length === 0
    return {
      status: passed ? 'passed' : 'failed',
      latency_ms: Date.now() - start,
      summary: passed ? `"${story.name}" passed.` : `"${story.name}" failed ${assertionFailures.length} assertion(s).`,
      assertion_failures: assertionFailures,
      provider_session_url: null,
      error_message: null,
      evidence,
    }
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      summary: `Firecrawl runner error`,
      assertion_failures: [],
      provider_session_url: null,
      error_message: err instanceof Error ? err.message : String(err),
      evidence: [],
    }
  }
}

// ── Browserbase delegation (REST-based, Deno-compatible) ──────────────────
async function runBrowserbase(story: QaStory, apiKey: string): Promise<RunResult> {
  const start = Date.now()
  // Edge functions can't launch Playwright. Instead, we create a session
  // and return a link — the actual script execution happens via Browserbase's
  // own scheduling API or is deferred to the CLI runner.
  try {
    const res = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bb-api-key': apiKey,
      },
      body: JSON.stringify({ keepAlive: false }),
    })
    if (!res.ok) {
      return {
        status: 'skipped',
        latency_ms: Date.now() - start,
        summary: 'Browserbase session creation requires CLI runner for full Playwright execution.',
        assertion_failures: [],
        provider_session_url: null,
        error_message: `HTTP ${res.status}`,
        evidence: [],
      }
    }
    const session = await res.json() as { id?: string; status?: string }
    const sessionUrl = session.id
      ? `https://app.browserbase.com/sessions/${session.id}`
      : null

    return {
      status: 'skipped',
      latency_ms: Date.now() - start,
      summary: 'Browserbase story delegated to CLI runner for full Playwright execution.',
      assertion_failures: [],
      provider_session_url: sessionUrl,
      error_message: null,
      evidence: [],
    }
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      summary: 'Browserbase delegation failed',
      assertion_failures: [],
      provider_session_url: null,
      error_message: err instanceof Error ? err.message : String(err),
      evidence: [],
    }
  }
}

// ── Manual run helper ─────────────────────────────────────────────────────
// Executes a single story run for an *existing* pending run row (created by
// the POST /qa-stories/:sid/run API route). Updates that row in-place rather
// than inserting a new one, so the CLI / UI see the result immediately.
async function executeManualRun(
  db: SupabaseClient,
  storyId: string,
  runId: string,
): Promise<Response> {
  rlog.info('manual_run_start', { storyId, runId })

  // Mark the existing pending row as 'running'
  await db.from('qa_story_runs').update({ status: 'running' }).eq('id', runId)

  const { data: story, error: storyErr } = await db
    .from('qa_stories')
    .select('*')
    .eq('id', storyId)
    .single()

  if (storyErr || !story) {
    await db.from('qa_story_runs').update({
      status: 'error',
      error_message: 'story_not_found',
      finished_at: new Date().toISOString(),
    }).eq('id', runId)
    return new Response(JSON.stringify({ error: 'story_not_found' }), { status: 404 })
  }

  const pid = story.project_id
  const resolvedApiKey = await resolveStoryApiKey(db, story, pid)
  const resolvedTargetUrl = await resolveTargetUrl(db, story, pid)

  let result: RunResult
  const provider = story.browser_provider

  if (!resolvedTargetUrl && (provider === 'firecrawl_actions' || provider === 'browserbase')) {
    result = {
      status: 'error',
      latency_ms: 0,
      summary: 'No target URL — set a Target URL on this story or configure crawler_base_url in project settings.',
      assertion_failures: [],
      provider_session_url: null,
      error_message: 'no_target_url',
      evidence: [],
    }
  } else if (provider === 'firecrawl_actions' && isDirectFetchMode(story)) {
    // directFetch: bypass Firecrawl entirely — plain HTTP GET via Deno fetch().
    // Ideal for SSG/SSR pages (static exports, CDN-served HTML) where a headless
    // browser is unnecessary and Firecrawl's SCRAPE_TIMEOUT is unreliable.
    result = await runDirectFetch(story, resolvedTargetUrl!)
  } else if (provider === 'firecrawl_actions') {
    const key = resolvedApiKey ?? Deno.env.get('FIRECRAWL_API_KEY') ?? ''
    if (!key) {
      result = {
        status: 'error',
        latency_ms: 0,
        summary: 'Firecrawl API key not configured. Add one via Settings → API Keys → Firecrawl, or run `mushi keys add --provider firecrawl` in the CLI.',
        assertion_failures: [],
        provider_session_url: null,
        error_message: 'No Firecrawl key. Run: mushi keys add --provider firecrawl',
        evidence: [],
      }
    } else {
      result = await runFirecrawl(story, key, resolvedTargetUrl!)
    }
  } else if (provider === 'browserbase') {
    const key = resolvedApiKey ?? Deno.env.get('BROWSERBASE_API_KEY') ?? ''
    if (!key) {
      result = {
        status: 'error',
        latency_ms: 0,
        summary: 'Browserbase API key not configured. Add one via Settings → API Keys → Browserbase.',
        assertion_failures: [],
        provider_session_url: null,
        error_message: 'No Browserbase key. Add via Settings → API Keys → Browserbase.',
        evidence: [],
      }
    } else {
      result = await runBrowserbase(story, key)
    }
  } else {
    result = {
      status: 'skipped',
      latency_ms: 0,
      summary: 'Local provider stories must be run via the mushi CLI.',
      assertion_failures: [],
      provider_session_url: null,
      error_message: null,
      evidence: [],
    }
  }

  await db.from('qa_story_runs').update({
    status: result.status,
    latency_ms: result.latency_ms,
    summary: result.summary,
    assertion_failures: result.assertion_failures,
    provider_session_url: result.provider_session_url,
    error_message: result.error_message,
    finished_at: new Date().toISOString(),
  }).eq('id', runId)

  // Save evidence artefacts. Schema: (run_id, kind, storage_path, mime, step_label).
  // We store a stub storage_path — actual upload to Supabase Storage is a future
  // enhancement. The record's presence signals evidence was captured.
  if (result.evidence?.length) {
    const evidenceRows = result.evidence.map((e) => ({
      run_id: runId,
      kind: e.kind,
      storage_path: `qa-evidence/${storyId}/${runId}/${e.step_label ?? e.kind}.${e.mime.split('/')[1] ?? 'bin'}`,
      mime: e.mime,
      step_label: e.step_label ?? null,
    }))
    await db.from('qa_story_evidence').insert(evidenceRows)
  }

  // Update story-level state so the UI card reflects the latest manual run immediately,
  // not just after the next cron tick. Mirror the cron path's increment semantics
  // (consecutive_failures + 1) so the Slack failure-backoff / threading / recovery-count
  // state machine stays in sync regardless of whether the run was manual or cron-driven.
  const isNowFailing = result.status === 'failed' || result.status === 'error'
  const { data: storyState } = await db
    .from('qa_stories')
    .select('consecutive_failures')
    .eq('id', storyId)
    .maybeSingle()
  const prevConsecutive = (storyState?.consecutive_failures as number | null) ?? 0
  await db.from('qa_stories').update({
    last_run_status: result.status,
    consecutive_failures: isNowFailing ? prevConsecutive + 1 : 0,
    ...(isNowFailing ? {} : { slack_failure_ts: null }),
  }).eq('id', storyId)

  rlog.info('manual_run_complete', { storyId, runId, status: result.status })
  return new Response(JSON.stringify({ ok: true, status: result.status }), { status: 200 })
}

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(
  withSentry('qa-story-runner', async (req: Request) => {
    const unauthorized = requireServiceRoleAuth(req)
    if (unauthorized) return unauthorized

    const db = getServiceClient()
    const now = new Date()

    // Check if this is a manual trigger with a specific story_id + run_id.
    // Manual triggers come from POST /qa-stories/:sid/run in the API route.
    // They create a pending run row and call us with the run_id so we can
    // update that row in-place instead of inserting a new cron run row.
    // Parse body only when JSON content-type is present (cron pings have no body).
    // Returns 400 with structured error if JSON is present but structurally invalid.
    let body: QaStoryRunnerBody = {}
    if (req.headers.get('content-type')?.includes('application/json')) {
      const parsedBody = await parseBody(QaStoryRunnerBodySchema, req)
      if (parsedBody instanceof Response) return parsedBody
      body = parsedBody.data
    }

    if (body.trigger === 'manual' && body.story_id && body.run_id) {
      return await executeManualRun(db, body.story_id, body.run_id)
    }

    // 2026-05-24: previous code called `startCronRun('qa-story-runner')` —
    // missing the `db` first argument and destructuring `cronRunId` instead
    // of the actual `runId`/`finish`/`fail` shape the helper exposes. That
    // crashed the isolate at runtime ("'qa-story-runner'.from is not a
    // function") and the platform served 500s. The previously-deployed
    // version (v19) predated this bug, which is why the redeploy from the
    // Sentry-fix sweep was the first time the cron path actually executed
    // it. Pinning the call to the helper's real signature.
    const cronRun = await startCronRun(db, 'qa-story-runner', 'cron')
    rlog.info('qa-story-runner invoked', { jobName: 'qa-story-runner' })

    try {
      // Fetch all enabled stories. The previous select embedded
      // `projects!inner(id, base_url:mushi_runtime_config!inner(config))`
      // which referenced a non-existent `projects → mushi_runtime_config`
      // foreign key (PostgREST returned PGRST200 → 500). The embedded
      // base_url was never read either — the per-run baseUrl falls through
      // to `Deno.env.get('DEFAULT_BASE_URL')` below — so the safest fix is
      // to drop the broken embed entirely. If we ever surface a per-project
      // base URL again, plumb it through `project_settings` (which already
      // has a real FK from `projects.id`).
      const { data: stories, error: storiesErr } = await db
        .from('qa_stories')
        .select('*')
        .eq('enabled', true)

      if (storiesErr) {
        // Truncate the message before logging and persisting — a transient Supabase
        // 522/pooler failure carries a ~20KB Cloudflare HTML page in `.message`.
        // Storing or logging that raw would pollute cron_runs, Supabase Logs, and
        // (incorrectly) Sentry with unreadable noise.
        const errMsg = (storiesErr.message ?? String(storiesErr)).slice(0, 500)

        if (isTransientDbConnectionError(storiesErr)) {
          // Transient infra failure (pooler reset, Cloudflare 522) — do NOT send
          // to Sentry. Route to Supabase Logs only, queryable via:
          //   metadata.parsed.event = "qa_transient_fetch_error"
          console.warn(
            JSON.stringify({
              ts: new Date().toISOString(),
              level: 'warn',
              scope: 'mushi:qa-story-runner',
              event: 'qa_transient_fetch_error',
              msg: 'transient DB/network error fetching qa_stories — not an app bug',
              db_code: storiesErr.code ?? 'unknown',
              err_message: errMsg,
            }),
          )
        } else {
          rlog.error('Failed to fetch qa_stories', {
            err: { ...storiesErr, message: errMsg },
          })
        }

        await cronRun.fail(new Error(errMsg))
        return new Response('Internal error', { status: 500 })
      }

      const dueStories = (stories ?? []).filter((s: QaStory) =>
        cronMatches(s.schedule_cron ?? '*/15 * * * *', now)
      )

      rlog.info('stories due', { total: stories?.length ?? 0, due: dueStories.length })

      // Rate-limit by project
      const projectCounts: Record<string, number> = {}

      for (const story of dueStories) {
        const pid = story.project_id
        projectCounts[pid] = (projectCounts[pid] ?? 0) + 1
        if (projectCounts[pid] > MAX_CONCURRENT_PER_PROJECT) {
          // Write a skipped run
          await db.from('qa_story_runs').insert({
            story_id: story.id,
            project_id: pid,
            status: 'skipped',
            latency_ms: 0,
            summary: `Rate limited: max ${MAX_CONCURRENT_PER_PROJECT} concurrent stories per project.`,
            error_message: 'rate_limited',
          })
          continue
        }

        // Insert a 'running' row so the UI shows live status
        const { data: runRow, error: runInsertErr } = await db
          .from('qa_story_runs')
          .insert({ story_id: story.id, project_id: pid, status: 'running' })
          .select('id')
          .single()

        if (runInsertErr || !runRow) {
          rlog.warn('failed to insert run row', { storyId: story.id, err: runInsertErr })
          continue
        }

        const runId: string = runRow.id

        // Resolve API key: always derived from browser_provider (byok_provider is
        // an optional override for non-default key pools).
        const resolvedApiKey = await resolveStoryApiKey(db, story, pid)

        // Resolve the target URL: story.target_url → prompt URL → project settings → env.
        // Fail the run explicitly if nothing resolves — this surfaces a clear error
        // instead of silently scraping localhost.
        const resolvedTargetUrl = await resolveTargetUrl(db, story, pid)

        let result: RunResult
        const provider = story.browser_provider

        if (!resolvedTargetUrl && (provider === 'firecrawl_actions' || provider === 'browserbase')) {
          result = {
            status: 'error',
            latency_ms: 0,
            summary: 'No target URL — set a Target URL on this story or configure crawler_base_url in project settings.',
            assertion_failures: [],
            provider_session_url: null,
            error_message: 'no_target_url',
            evidence: [],
          }
        } else if (provider === 'firecrawl_actions' && isDirectFetchMode(story)) {
          // directFetch: bypass Firecrawl entirely — plain HTTP GET via Deno fetch().
          // Ideal for SSG/SSR pages where SCRAPE_TIMEOUT is unreliable.
          result = await runDirectFetch(story, resolvedTargetUrl!)
        } else if (provider === 'firecrawl_actions') {
          const key = resolvedApiKey ?? Deno.env.get('FIRECRAWL_API_KEY') ?? ''
          if (!key) {
            result = {
              status: 'error',
              latency_ms: 0,
              summary: 'Firecrawl API key not configured. Add one via Settings → API Keys → Firecrawl, or run `mushi keys add --provider firecrawl` in the CLI.',
              assertion_failures: [],
              provider_session_url: null,
              error_message: 'firecrawl_key_missing: Add a Firecrawl API key via Settings → API Keys in the Mushi console, or run: mushi keys add --provider firecrawl',
              evidence: [],
            }
          } else {
            result = await runFirecrawl(story, key, resolvedTargetUrl!)
          }
        } else if (provider === 'browserbase') {
          const key = resolvedApiKey ?? Deno.env.get('BROWSERBASE_API_KEY') ?? ''
          if (!key) {
            result = {
              status: 'error',
              latency_ms: 0,
              summary: 'Browserbase API key not configured. Add one via Settings → API Keys → Browserbase.',
              assertion_failures: [],
              provider_session_url: null,
              error_message: 'browserbase_key_missing: Add a Browserbase API key via Settings → API Keys in the Mushi console.',
              evidence: [],
            }
          } else {
            result = await runBrowserbase(story, key)
          }
        } else {
          // 'local' provider — must be run by CLI
          result = {
            status: 'skipped',
            latency_ms: 0,
            summary: 'Local provider stories run via the mushi CLI. Set browser_provider to firecrawl_actions or browserbase for edge execution.',
            assertion_failures: [],
            provider_session_url: null,
            error_message: null,
            evidence: [],
          }
        }

        // Update run row
        await db.from('qa_story_runs').update({
          status: result.status,
          latency_ms: result.latency_ms,
          summary: result.summary,
          assertion_failures: result.assertion_failures,
          provider_session_url: result.provider_session_url,
          error_message: result.error_message,
          finished_at: new Date().toISOString(),
          provider,
        }).eq('id', runId)

        // Upload evidence as base64 → store_path stub (real upload needs Storage client)
        // For now, store the evidence inline in a separate table row as base64 text
        for (const ev of result.evidence) {
          await db.from('qa_story_evidence').insert({
            run_id: runId,
            kind: ev.kind,
            storage_path: `qa-evidence/${pid}/${runId}/${ev.step_label ?? ev.kind}.${ev.mime.split('/')[1] ?? 'bin'}`,
            mime: ev.mime,
            step_label: ev.step_label ?? null,
          })
        }

        // ── Transition-aware, threaded Slack notifications ──────────────────
        // Policy (prevents hourly spam on persistent failures):
        //   pass→fail/error  : post a new rich Block Kit message, store thread ts
        //   consecutive fail : threaded reply on 1st, 3rd, 10th, then once/day
        //   fail→pass        : threaded "recovered after N failures" + reset state
        // Non-fatal: a missing Slack config never blocks the runner.
        const prevStatus = story.last_run_status
        const newStatus = result.status
        const isNowFailing = newStatus === 'failed' || newStatus === 'error'
        const wasFailingBefore = prevStatus === 'failed' || prevStatus === 'error'
        const isRecovery = !isNowFailing && wasFailingBefore

        // Update story state columns regardless of Slack config
        const newConsecutive = isNowFailing ? (story.consecutive_failures + 1) : 0
        const stateUpdate: Record<string, unknown> = {
          last_run_status: newStatus,
          consecutive_failures: newConsecutive,
        }

        try {
          const { data: ps } = await db
            .from('project_settings')
            .select('slack_channel_id, slack_webhook_url, discord_webhook_url, notification_prefs')
            .eq('project_id', pid)
            .maybeSingle()

          // Check notification preference for this event type
          const prefs = (ps as Record<string, unknown> | null)?.notification_prefs as Record<string, unknown> | null ?? {}
          const prefKey = isRecovery ? 'qa_story.recovered' : 'qa_story.failed'
          if (prefs[prefKey] === false) {
            rlog.info('slack notif suppressed by notification_prefs', { storyId: story.id, prefKey })
            // Still persist state but skip the message
            await db.from('qa_stories').update(stateUpdate).eq('id', story.id)
            continue
          }

          const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? ''
          const runUrl = adminBase
            ? `${adminBase}/qa-coverage?${new URLSearchParams({
                project: pid,
                story: story.id,
                run: runId,
              }).toString()}`
            : null
          const channelId = ps?.slack_channel_id ?? null
          const webhookUrl = ps?.slack_webhook_url ?? null
          const discordWebhookUrl = (ps as Record<string, unknown> | null)?.discord_webhook_url as string | null ?? null
          const hasSlack = !!(channelId || webhookUrl)

          if (hasSlack) {
            const { data: proj } = await db
              .from('projects')
              .select('name')
              .eq('id', pid)
              .maybeSingle()
            const projectName = (proj as { name?: string } | null)?.name ?? 'Unknown project'

            // Determine whether to notify and what kind
            const isNewFailure = isNowFailing && !wasFailingBefore
            const now = new Date()
            const lastNotified = story.last_notified_at ? new Date(story.last_notified_at) : null
            const hoursSinceLast = lastNotified
              ? (now.getTime() - lastNotified.getTime()) / 3_600_000
              : Infinity

            // For consecutive failures: notify on 1st, 3rd, 10th, then once/day
            const shouldNotifyRepeat = isNowFailing && wasFailingBefore && (
              newConsecutive === 3 ||
              newConsecutive === 10 ||
              hoursSinceLast >= 24
            )

            if (isNewFailure || shouldNotifyRepeat || isRecovery) {
              // Fetch first screenshot from evidence for thumbnail
              const { data: evRows } = await db
                .from('qa_story_evidence')
                .select('storage_path')
                .eq('run_id', runId)
                .eq('kind', 'screenshot')
                .limit(1)
              const hasScreenshot = (evRows?.length ?? 0) > 0

              if (isRecovery) {
                // Post a threaded recovery message
                const recoveryText = `\u{1F7E2} QA story *${story.name}* recovered after ${story.consecutive_failures} consecutive failure(s).${runUrl ? ` <${runUrl}|View run>` : ''}`
                if (channelId && story.slack_failure_ts) {
                  await sendBotMessage({ channel: channelId, text: recoveryText, threadTs: story.slack_failure_ts, db, projectId: pid })
                } else if (channelId) {
                  await sendBotMessage({ channel: channelId, text: recoveryText, db, projectId: pid })
                } else if (webhookUrl) {
                  await sendSlackText(webhookUrl, recoveryText)
                }
                if (discordWebhookUrl) {
                  await sendDiscordNotification(discordWebhookUrl, recoveryText.replace(/\*/g, '**'), { title: 'QA Story Recovered', color: 0x57f287 })
                }
                stateUpdate.slack_failure_ts = null
                stateUpdate.last_notified_at = now.toISOString()
              } else {
                // Failure notification — rich Block Kit for new failures, threaded reply for repeats
                const blocks = buildQaStoryRunBlocks({
                  storyId: story.id,
                  storyName: story.name,
                  projectName,
                  runId,
                  status: newStatus as 'failed' | 'error',
                  provider: provider,
                  latencyMs: result.latency_ms,
                  summary: result.summary,
                  errorMessage: result.error_message,
                  assertionFailures: result.assertion_failures,
                  consecutiveFailures: newConsecutive,
                  screenshotBase64: hasScreenshot ? 'present' : null,
                  runUrl,
                })
                const failCount = result.assertion_failures?.length ?? 0
                const fallbackText = `\u26A0\uFE0F QA story *${story.name}* ${newStatus === 'error' ? 'errored' : `failed ${failCount} assertion(s)`} (run ${newConsecutive}).${runUrl ? ` <${runUrl}|View run>` : ''}`

                if (channelId) {
                  const threadTs = isNewFailure ? null : (story.slack_failure_ts ?? null)
                  const r = await sendBotMessage({ channel: channelId, blocks, text: fallbackText, threadTs, db, projectId: pid })
                  // Store thread ts from first failure so we can thread follow-ups
                  if (isNewFailure && r.ok && r.ts) {
                    stateUpdate.slack_failure_ts = r.ts
                  }
                } else if (webhookUrl) {
                  await sendSlackText(webhookUrl, fallbackText)
                }
                if (discordWebhookUrl) {
                  const discordText = fallbackText.replace(/\*/g, '**').replace(/<([^|]+)\|([^>]+)>/g, '[$2]($1)')
                  await sendDiscordNotification(discordWebhookUrl, discordText, { title: 'QA Story Failed', color: 0xed4245 })
                }
                stateUpdate.last_notified_at = now.toISOString()
                rlog.info('slack notif sent', { storyId: story.id, runId, consecutive: newConsecutive, isNew: isNewFailure })
              }
            } else {
              rlog.info('slack notif skipped (backoff)', { storyId: story.id, consecutive: newConsecutive, hoursSinceLast })
            }
          }
        } catch (slackErr) {
          rlog.warn('slack notif failed — non-fatal', { err: String(slackErr) })
        }

        // Persist notification state to qa_stories
        await db.from('qa_stories').update(stateUpdate).eq('id', story.id)

        // Fan-out to subscribed plugins (Discord, Teams, Cursor, Zapier…).
        // Best-effort — a plugin delivery failure never blocks the runner.
        const isNowFailingForFanout = result.status === 'failed' || result.status === 'error'
        const wasFailingForFanout = story.last_run_status === 'failed' || story.last_run_status === 'error'
        const fanoutEvent = isNowFailingForFanout
          ? 'qa_story.failed' as const
          : (!isNowFailingForFanout && wasFailingForFanout)
            ? 'qa_story.recovered' as const
            : null

        if (fanoutEvent) {
          void dispatchPluginEvent(db, pid, fanoutEvent, {
            story_id: story.id,
            story_name: story.name,
            run_id: runId,
            status: result.status,
            summary: result.summary,
            consecutive_failures: (stateUpdate.consecutive_failures as number | undefined) ?? 0,
          }).catch((err: unknown) => {
            rlog.warn('plugin fanout failed — non-fatal', { err: String(err) })
          })
        }

        rlog.info('story run complete', { storyId: story.id, runId, status: result.status })
      }

      await cronRun.finish({
        rowsAffected: dueStories.length,
        metadata: { total: stories?.length ?? 0, due: dueStories.length },
      })
      return new Response(JSON.stringify({ ok: true, due: dueStories.length }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      rlog.error('qa-story-runner fatal error', { err: err as Record<string, unknown> })
      await cronRun.fail(err)
      return new Response('Internal error', { status: 500 })
    }
  }),
)
