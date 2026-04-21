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
 *
 * Response format:
 *   - Slack requires a 200 within 3 seconds. We respond immediately
 *     with an ephemeral "Dispatching…" reply and then PATCH the ephemeral
 *     reply out-of-band once the dispatch resolves via `response_url`.
 *   - `withSentry` wraps the handler so any failure during signature
 *     verification or response delivery lands as a Sentry event with
 *     the right tags.
 */

import { withSentry, reportMessage } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { getServiceClient } from '../_shared/db.ts'
import { dispatchFixForReport } from '../_shared/dispatch.ts'

const log = rootLog.child('slack-interactions')

const SIGNATURE_VERSION = 'v0'
const MAX_TIMESTAMP_DRIFT_S = 60 * 5

Deno.serve(
  withSentry('slack-interactions', async (req) => {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const secret = Deno.env.get('SLACK_SIGNING_SECRET')
    if (!secret) {
      log.error('SLACK_SIGNING_SECRET is not set')
      reportMessage('Slack signing secret missing', {
        level: 'error',
        tags: { source: 'slack-interactions' },
      })
      return new Response('Server misconfigured', { status: 500 })
    }

    const signature = req.headers.get('x-slack-signature')
    const timestamp = req.headers.get('x-slack-request-timestamp')
    const rawBody = await req.text()

    if (!signature || !timestamp) {
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
      return new Response('Invalid signature', { status: 401 })
    }

    const params = new URLSearchParams(rawBody)
    const payloadRaw = params.get('payload')
    if (!payloadRaw) return new Response('Missing payload', { status: 400 })

    let payload: SlackInteractionPayload
    try {
      payload = JSON.parse(payloadRaw)
    } catch {
      return new Response('Malformed payload', { status: 400 })
    }

    if (payload.type !== 'block_actions') {
      return ephemeral('Unsupported interaction type.')
    }

    const action = payload.actions?.[0]
    if (!action) return ephemeral('No action in payload.')

    const [actionKind, reportId] = (action.action_id ?? '').split(':')
    if (actionKind !== 'dispatch_fix' || !reportId) {
      // Link-only buttons like `open_report:<id>` don't round-trip here.
      return ephemeral('Nothing to do.')
    }

    // Resolve the project from the report_id. This also serves as a
    // sanity check that the click actually references an existing report
    // in our system, not an attacker-forged payload that somehow slipped
    // past signature verification.
    const db = getServiceClient()
    const { data: report } = await db
      .from('reports')
      .select('id, project_id')
      .eq('id', reportId)
      .single()

    if (!report) {
      log.warn('Unknown report clicked', { reportId })
      return ephemeral('That report no longer exists.')
    }

    // Kick the dispatch in the background so we can answer Slack within
    // the 3s SLA. The response_url gets the final status.
    const responseUrl = payload.response_url
    const slackUser = payload.user?.id ?? 'unknown'

    finishDispatch({
      reportId,
      projectId: report.project_id,
      responseUrl,
      slackUser,
    }).catch((err) => {
      log.error('Async dispatch failed', { err: String(err) })
    })

    return ephemeral(':hourglass_flowing_sand: Dispatching fix — PR will land in `/fixes` shortly.')
  }),
)

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
}) {
  const result = await dispatchFixForReport({
    reportId: input.reportId,
    projectId: input.projectId,
    requestedBy: `slack:${input.slackUser}`,
    skipMembershipCheck: true,
  })

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
