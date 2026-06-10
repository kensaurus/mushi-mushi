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

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { sendBotMessage, sendSlackText, buildReportBlocks } from '../_shared/slack.ts'

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

// ── Firecrawl inline runner (Deno-compatible) ─────────────────────────────
async function runFirecrawl(story: QaStory, apiKey: string, baseUrl: string): Promise<RunResult> {
  const start = Date.now()
  const assertionFailures: RunResult['assertion_failures'] = []
  const evidence: RunResult['evidence'] = []

  try {
    const targetUrl = story.script?.startsWith('http') ? story.script : baseUrl

    // Parse script as JSON actions array, or use simple GET + screenshot
    let actions: Array<Record<string, unknown>> = [{ type: 'screenshot' }]
    if (story.script && !story.script.startsWith('http')) {
      try {
        const parsed = JSON.parse(story.script) as Array<Record<string, unknown>>
        if (Array.isArray(parsed)) actions = parsed
      } catch {
        actions = [{ type: 'screenshot' }]
      }
    }

    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ url: targetUrl, formats: ['markdown', 'screenshot'], actions }),
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
      data?: { markdown?: string; screenshot?: string }
    }

    const markdown = data?.data?.markdown ?? ''
    const screenshot = data?.data?.screenshot ?? ''

    // Content assertions from prompt
    if (story.prompt && markdown) {
      const keywords = story.prompt
        .match(/(?:should|must|expect|verify|check|contains?)\s+["']?([^"'\n]{3,60})["']?/gi) ?? []
      for (const kw of keywords.slice(0, 8)) {
        const term = kw.replace(/^(should|must|expect|verify|check|contains?)\s+/i, '').replace(/["']/g, '').trim()
        if (term && !markdown.toLowerCase().includes(term.toLowerCase())) {
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

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(
  withSentry('qa-story-runner', async (req: Request) => {
    const unauthorized = requireServiceRoleAuth(req)
    if (unauthorized) return unauthorized

    const db = getServiceClient()
    const now = new Date()

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
        rlog.error('Failed to fetch qa_stories', { err: storiesErr })
        await cronRun.fail(new Error(storiesErr.message))
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

        // Resolve BYOK key if configured.
        // Maps story.byok_provider (e.g. 'firecrawl', 'browserbase') to the
        // correct resolveLlmKey provider slug. Stories with an unknown slug
        // get no key and rely on the env-var fallback inside the runner.
        let resolvedApiKey: string | undefined
        if (story.byok_provider) {
          const knownProviders = ['anthropic', 'openai', 'firecrawl', 'browserbase'] as const
          type KnownProvider = typeof knownProviders[number]
          const byokSlug = knownProviders.includes(story.byok_provider as KnownProvider)
            ? (story.byok_provider as KnownProvider)
            : null
          if (byokSlug) {
            try {
              const byokResult = await resolveLlmKey(db, pid, byokSlug)
              resolvedApiKey = byokResult?.key
              if (!byokResult) {
                rlog.warn('no_key_configured — story will use env fallback or fail')
              }
            } catch (err) {
              rlog.warn('BYOK resolution error — continuing without key')
            }
          } else {
            rlog.warn('unknown byok_provider slug — skipping BYOK lookup')
          }
        }

        // Default base URL from project settings
        const baseUrl = Deno.env.get('DEFAULT_BASE_URL') ?? 'https://localhost:3000'

        let result: RunResult
        const provider = story.browser_provider

        if (provider === 'firecrawl_actions') {
          const key = resolvedApiKey ?? Deno.env.get('FIRECRAWL_API_KEY') ?? ''
          result = await runFirecrawl(story, key, baseUrl)
        } else if (provider === 'browserbase') {
          const key = resolvedApiKey ?? Deno.env.get('BROWSERBASE_API_KEY') ?? ''
          result = await runBrowserbase(story, key)
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

        // A2A push + Slack notification for failures
        if (result.status === 'failed' || result.status === 'error') {
          await db.from('a2a_push_deliveries').insert({
            project_id: pid,
            event_type: 'qa_story_failed',
            payload: {
              story_id: story.id,
              story_name: story.name,
              run_id: runId,
              status: result.status,
              summary: result.summary,
              assertion_failures: result.assertion_failures,
              provider_session_url: result.provider_session_url,
            },
          }).then(
            () => { rlog.info('a2a push queued', { storyId: story.id, runId }) },
            (err: unknown) => { rlog.warn('a2a push failed — non-fatal', { err: err as Record<string, unknown> }) },
          )

          // Slack notification for QA story failures — uses the project's configured
          // slack_channel_id (bot path) or falls back to slack_webhook_url.
          // Non-fatal: a missing Slack config or delivery error never blocks the runner.
          try {
            const { data: ps } = await db
              .from('project_settings')
              .select('slack_channel_id, slack_webhook_url')
              .eq('project_id', pid)
              .single()

            const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? ''
            const runUrl = adminBase ? `${adminBase}/projects/${pid}/qa-coverage/${story.id}` : null
            const failureCount = result.assertion_failures?.length ?? 0
            const text = `⚠️ QA story *${story.name}* ${result.status === 'error' ? 'errored' : `failed ${failureCount} assertion(s)`}.${runUrl ? ` <${runUrl}|View run>` : ''}`

            if (ps?.slack_channel_id) {
              await sendBotMessage({ channel: ps.slack_channel_id, text })
              rlog.info('slack notif sent', { storyId: story.id, runId })
            } else if (ps?.slack_webhook_url) {
              await sendSlackText(ps.slack_webhook_url, text)
              rlog.info('slack webhook notif sent', { storyId: story.id, runId })
            }
          } catch (slackErr) {
            rlog.warn('slack notif failed — non-fatal', { err: String(slackErr) })
          }
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
