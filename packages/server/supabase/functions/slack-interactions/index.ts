/**
 * FILE: packages/server/supabase/functions/slack-interactions/index.ts
 *
 * Slack interactive components endpoint. Receives the POST from Slack
 * when a user clicks `Dispatch fix` in a report notification (see
 * `_shared/slack.ts > buildReportBlocks`) and fires the `fix-worker` the
 * same way the admin UI does.
 *
 * Security:
 *   - HMAC-SHA256 signature check per Slack's `v0` signed-request spec
 *     (https://api.slack.com/authentication/verifying-requests-from-slack).
 *     Timestamp must be within 5 minutes to defeat replay.
 *   - We resolve the project via the clicked `value` (report_id) and
 *     its owning project, then the shared `dispatchFixForReport` helper
 *     re-validates the `autofix_enabled` flag.
 *   - We deliberately do NOT trust the Slack user ID as a project
 *     member — Slack auth is a separate identity system. The dispatch
 *     is therefore attributed to the system actor and the audit trail
 *     records `source = 'slack'`.
 *   - Every request (accepted or rejected) is recorded via the shared
 *     `_shared/webhook-middleware.ts` (audit log + per-IP rate limit +
 *     24h replay-cache keyed on the interaction's `trigger_id`), matching
 *     the same posture as the Sentry/GitHub webhook routes.
 *
 * Response format:
 *   - Slack requires a 200 within 3 seconds. We respond immediately
 *     with an ephemeral "Dispatching…" reply and then PATCH the ephemeral
 *     reply out-of-band once the dispatch resolves via `response_url`.
 *   - `withSentry` wraps the handler so any failure during signature
 *     verification or response delivery lands as a Sentry event with
 *     the right tags.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { withSentry, reportMessage } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { getServiceClient } from '../_shared/db.ts'
import { dispatchFixForReport } from '../_shared/dispatch.ts'
import { sendBotMessage } from '../_shared/slack.ts'
import { createWebhookMiddleware, ReplayAttackError, RateLimitError } from '../_shared/webhook-middleware.ts'

const log = rootLog.child('slack-interactions')

const SIGNATURE_VERSION = 'v0'
const MAX_TIMESTAMP_DRIFT_S = 60 * 5

/**
 * Minimal shim so the Hono-shaped `createWebhookMiddleware().audit()` can
 * read headers/method/url off a raw `Request` — this function predates the
 * Hono migration and still uses `Deno.serve` directly.
 */
function toWebhookContext(req: Request) {
  return {
    req: {
      header: (name: string) => req.headers.get(name) ?? undefined,
      method: req.method,
      url: req.url,
    },
  }
}

Deno.serve(
  withSentry('slack-interactions', async (req) => {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const t0 = Date.now()
    const rawBody = await req.text()
    const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('slack')
    const sourceIp =
      req.headers.get('CF-Connecting-IP') ??
      req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
      null

    // Peek `trigger_id` before signature verification purely to get a stable
    // per-click dedup key for the replay cache — Slack mints a fresh
    // trigger_id per user interaction, so it's a reasonable proxy for a
    // delivery id (Slack doesn't send one for interactive components the way
    // GitHub/Sentry do). This is inert: a forged payload can only influence
    // which replay bucket gets touched, never bypass the signature check
    // that gates everything below.
    let deliveryId: string | null = null
    try {
      const peekParams = new URLSearchParams(rawBody)
      const peekPayload = JSON.parse(peekParams.get('payload') ?? '{}') as { trigger_id?: string }
      deliveryId = peekPayload.trigger_id ?? null
    } catch {
      /* not parseable yet — falls through to the signature/parse checks below */
    }

    const auditRow = await audit(toWebhookContext(req) as never, rawBody, deliveryId)
    try {
      checkRateLimit(sourceIp)
      await checkReplay(auditRow.id, deliveryId)
    } catch (err) {
      if (err instanceof RateLimitError) {
        await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message)
        return new Response('Rate limited', { status: 429 })
      }
      if (err instanceof ReplayAttackError) {
        await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message)
        return new Response('Duplicate delivery', { status: 409 })
      }
      throw err
    }

    const secret = Deno.env.get('SLACK_SIGNING_SECRET')
    if (!secret) {
      log.error('SLACK_SIGNING_SECRET is not set')
      reportMessage('Slack signing secret missing', 'error', {
        tags: { source: 'slack-interactions' },
      })
      await auditRow.resolve('error', 500, Date.now() - t0, 'SLACK_SIGNING_SECRET not set')
      return new Response('Server misconfigured', { status: 500 })
    }

    const signature = req.headers.get('x-slack-signature')
    const timestamp = req.headers.get('x-slack-request-timestamp')

    if (!signature || !timestamp) {
      await auditRow.resolve('rejected_signature', 400, Date.now() - t0, 'Missing signature headers')
      return new Response('Missing signature headers', { status: 400 })
    }

    const valid = await verifySlackSignature({
      signingSecret: secret,
      timestamp,
      rawBody,
      signature,
    })
    if (!valid) {
      log.warn('Invalid signature', { ts: timestamp })
      await auditRow.resolve('rejected_signature', 401, Date.now() - t0, 'Invalid signature')
      return new Response('Invalid signature', { status: 401 })
    }

    const params = new URLSearchParams(rawBody)
    const payloadRaw = params.get('payload')
    if (!payloadRaw) {
      await auditRow.resolve('error', 400, Date.now() - t0, 'Missing payload')
      return new Response('Missing payload', { status: 400 })
    }

    let payload: SlackInteractionPayload
    try {
      payload = JSON.parse(payloadRaw)
    } catch {
      await auditRow.resolve('error', 400, Date.now() - t0, 'Malformed payload')
      return new Response('Malformed payload', { status: 400 })
    }

    if (payload.type !== 'block_actions') {
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'Unsupported interaction type')
      return ephemeral('Unsupported interaction type.')
    }

    const action = payload.actions?.[0]
    if (!action) {
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'No action in payload')
      return ephemeral('No action in payload.')
    }

    const actionId = action.action_id ?? ''
    const colonIdx = actionId.indexOf(':')
    const actionKind = colonIdx >= 0 ? actionId.slice(0, colonIdx) : actionId
    const actionValue = colonIdx >= 0 ? actionId.slice(colonIdx + 1) : (action.value ?? '')

    const db = getServiceClient()
    const responseUrl = payload.response_url
    const slackUser = payload.user?.id ?? 'unknown'

    // ── QA story: pause_story ────────────────────────────────────────────────
    if (actionKind === 'pause_story') {
      const storyId = actionValue || action.value
      if (!storyId) {
        await auditRow.resolve('accepted', 200, Date.now() - t0, 'Missing story ID')
        return ephemeral('Missing story ID.')
      }

      const bgWork = finishPauseStory({ db, storyId, slackUser, responseUrl }).catch(
        (err) => log.error('pause_story failed', { err: String(err) }),
      )
      waitUntil(bgWork)
      await auditRow.resolve('accepted', 200, Date.now() - t0)
      return ephemeral(':hourglass_flowing_sand: Pausing story…')
    }

    // ── QA story: improve_story (PDCA) ───────────────────────────────────────
    if (actionKind === 'improve_story') {
      const storyId = actionValue || action.value
      if (!storyId) {
        await auditRow.resolve('accepted', 200, Date.now() - t0, 'Missing story ID')
        return ephemeral('Missing story ID.')
      }

      const bgWork = finishImproveStory({ db, storyId, slackUser, responseUrl }).catch(
        (err) => log.error('improve_story failed', { err: String(err) }),
      )
      waitUntil(bgWork)
      await auditRow.resolve('accepted', 200, Date.now() - t0)
      return ephemeral(':hourglass_flowing_sand: Queuing AI improvement…')
    }

    // ── Report: dispatch_fix ─────────────────────────────────────────────────
    if (actionKind !== 'dispatch_fix' || !actionValue) {
      // Link-only buttons like `open_report:<id>` / `open_qa_run:<id>` don't round-trip here.
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'Nothing to do')
      return ephemeral('Nothing to do.')
    }

    const reportId = actionValue
    const { data: report } = await db
      .from('reports')
      .select('id, project_id, slack_message_ts')
      .eq('id', reportId)
      .single()

    if (!report) {
      log.warn('Unknown report clicked', { reportId })
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'Unknown report clicked')
      return ephemeral('That report no longer exists.')
    }

    // Kick the dispatch in the background so we can answer Slack within the 3s SLA.
    const dispatchPromise = finishDispatch({
      reportId,
      projectId: report.project_id,
      responseUrl,
      slackUser,
      slackThreadTs: report.slack_message_ts ?? undefined,
      slackMeta: { source: 'slack', slackUserId: slackUser, triggeredAt: new Date().toISOString() },
    }).catch((err) => {
      log.error('Async dispatch failed', { err: String(err) })
    })

    waitUntil(dispatchPromise)
    await auditRow.resolve('accepted', 200, Date.now() - t0)
    return ephemeral(':hourglass_flowing_sand: Dispatching fix — PR will land in `/fixes` shortly.')
  }),
)

/** Keep the Deno isolate alive for background promises. */
function waitUntil(p: Promise<unknown>): void {
  if (typeof (globalThis as Record<string, unknown>).EdgeRuntime !== 'undefined') {
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).EdgeRuntime.waitUntil(p)
  }
}

async function finishPauseStory(input: {
  db: SupabaseClient
  storyId: string
  slackUser: string
  responseUrl?: string
}): Promise<void> {
  const { error } = await input.db
    .from('qa_stories')
    .update({ enabled: false })
    .eq('id', input.storyId)

  const text = error
    ? `:x: Could not pause story — ${error.message}`
    : `:pause_button: Story paused by Slack user <@${input.slackUser}>. Re-enable it in the Mushi console under QA Coverage.`

  if (input.responseUrl) {
    await fetch(input.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
    }).catch((err) => log.error('response_url POST failed', { err: String(err) }))
  }
}

async function finishImproveStory(input: {
  db: SupabaseClient
  storyId: string
  slackUser: string
  responseUrl?: string
}): Promise<void> {
  // Invoke the pdca-runner function with mode=qa_story_improve targeting this story
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  let text: string
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/pdca-runner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ mode: 'qa_story_improve', story_id: input.storyId }),
    })
    text = res.ok
      ? `:robot_face: AI improvement queued for this story. Check back in a few minutes — an improved version will appear in QA Coverage under "Pending review".`
      : `:x: Could not start improvement — HTTP ${res.status}`
  } catch (err) {
    text = `:x: Could not start improvement — ${String(err)}`
  }

  if (input.responseUrl) {
    await fetch(input.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
    }).catch((err) => log.error('response_url POST failed', { err: String(err) }))
  }
}

interface SlackInteractionPayload {
  type?: string
  response_url?: string
  user?: { id?: string }
  actions?: Array<{ action_id?: string; value?: string }>
}

async function finishDispatch(input: {
  reportId: string
  projectId: string
  responseUrl?: string
  slackUser: string
  slackThreadTs?: string
  slackMeta?: Record<string, unknown>
}) {
  const result = await dispatchFixForReport({
    reportId: input.reportId,
    projectId: input.projectId,
    requestedBy: null,
    skipMembershipCheck: true,
    metadata: input.slackMeta,
  })

  // Post a threaded Slack reply via bot if we have the thread timestamp.
  if (input.slackThreadTs) {
    const threadText = result.ok
      ? `:white_check_mark: Fix dispatched by <@${input.slackUser}>. A draft PR will appear in \`/fixes\` shortly.`
      : `:x: Fix dispatch failed — ${result.message ?? result.code ?? 'unknown error'}`
    await sendBotMessage({
      text: threadText,
      threadTs: input.slackThreadTs,
    }).catch((err) => log.error('Threaded reply failed', { err: String(err) }))
  }

  if (!input.responseUrl) return

  const body = result.ok
    ? {
        response_type: 'ephemeral',
        replace_original: false,
        text: `:white_check_mark: Fix dispatched. Watch progress at \`/fixes\`.`,
      }
    : {
        response_type: 'ephemeral',
        replace_original: false,
        text: `:x: Could not dispatch — ${result.message ?? result.code ?? 'unknown error'}.`,
      }

  await fetch(input.responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((err) => log.error('response_url POST failed', { err: String(err) }))
}

function ephemeral(text: string): Response {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function verifySlackSignature(input: {
  signingSecret: string
  timestamp: string
  rawBody: string
  signature: string
}): Promise<boolean> {
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_S) return false

  const base = `${SIGNATURE_VERSION}:${input.timestamp}:${input.rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base))
  const expected = `${SIGNATURE_VERSION}=${Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`

  return constantTimeEqual(expected, input.signature)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
