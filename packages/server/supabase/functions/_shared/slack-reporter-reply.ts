/**
 * FILE: _shared/slack-reporter-reply.ts
 * PURPOSE: "Reply to reporter" from a report's Slack card (Plan 018 §3).
 *
 * Flow:
 *   button `reply_reporter:<reportId>` (block_actions)
 *     → `openReporterReplyModal` opens a modal (views.open, needs the click's trigger_id)
 *   modal submit (view_submission, callback_id `reply_reporter`)
 *     → `submitSlackReporterReply` posts through `postReporterReply`, the same
 *       path as the console API and MCP: one visible comment, and the
 *       report_comments trigger writes the in-app row and enqueues email /
 *       push (the reporter's own opt-ins and the frequency caps apply there).
 *
 * The Slack user is not a Mushi identity (same trust posture as the other
 * card buttons): the reply is attributed to the project owner, and Slack
 * signature verification is what authorises the click.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { fetchWithTimeout } from './http.ts'
import { log } from './logger.ts'
import { postReporterReply } from './reporter-comms.ts'
import { resolveSlackBotToken } from './slack.ts'

const replyLog = log.child('slack-reporter-reply')

export const REPLY_CALLBACK_ID = 'reply_reporter'
export const REPLY_BLOCK_ID = 'reply'
export const REPLY_ACTION_ID = 'message'
/** Same cap as a reporter's own reply. */
export const SLACK_REPLY_MAX_CHARS = 2000

/** A key the SDK widget wrote (`rk1_` + 64 hex) — someone who can read a reply. */
export function isWidgetReporterKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && /^rk1_[0-9a-f]{64}$/.test(key)
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** The modal: one multi-line box, shown to the reporter verbatim. */
export function buildReporterReplyModal(input: { reportId: string; reportTitle: string | null }): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: REPLY_CALLBACK_ID,
    private_metadata: input.reportId,
    title: { type: 'plain_text', text: 'Reply to reporter' },
    submit: { type: 'plain_text', text: 'Send' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: input.reportTitle
              ? `About: _${clip(input.reportTitle, 140).replace(/[*_`~<>]/g, '')}_`
              : `Report \`${input.reportId.slice(0, 8)}\``,
          },
        ],
      },
      {
        type: 'input',
        block_id: REPLY_BLOCK_ID,
        label: { type: 'plain_text', text: 'Your reply' },
        hint: {
          type: 'plain_text',
          text: 'The person who reported this sees it in "Your reports" in your app, word for word.',
        },
        element: {
          type: 'plain_text_input',
          action_id: REPLY_ACTION_ID,
          multiline: true,
          max_length: SLACK_REPLY_MAX_CHARS,
        },
      },
    ],
  }
}

export type OpenModalResult = { ok: true } | { ok: false; message: string }

/** Open the reply modal for a report. Never throws; `message` is ephemeral Slack copy. */
export async function openReporterReplyModal(
  db: SupabaseClient,
  input: { reportId: string; triggerId: string | undefined },
  fetchImpl: typeof fetch = fetchWithTimeout as unknown as typeof fetch,
): Promise<OpenModalResult> {
  if (!input.triggerId) return { ok: false, message: 'Slack did not send a trigger id — try the button again.' }
  const { data: report, error } = await db
    .from('reports')
    .select('id, project_id, title, summary, reporter_token_hash, closed_reason')
    .eq('id', input.reportId)
    .maybeSingle()
  if (error) return { ok: false, message: 'Could not load the report. Try again in a minute.' }
  const r = report as {
    project_id: string
    title: string | null
    summary: string | null
    reporter_token_hash: string | null
    closed_reason: string | null
  } | null
  if (!r) return { ok: false, message: 'That report no longer exists.' }
  if (!isWidgetReporterKey(r.reporter_token_hash) || r.closed_reason === 'spam') {
    return { ok: false, message: 'This report has no one to reply to (it did not come from your app’s widget).' }
  }
  const token = await resolveSlackBotToken(db, r.project_id)
  if (!token) return { ok: false, message: 'Slack is not connected with a bot token — reply from the Mushi console instead.' }

  try {
    const res = await fetchImpl('https://slack.com/api/views.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        trigger_id: input.triggerId,
        view: buildReporterReplyModal({ reportId: input.reportId, reportTitle: r.title || r.summary }),
      }),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    if (!json.ok) {
      replyLog.warn('views.open failed', { error: json.error })
      return { ok: false, message: `Slack could not open the reply box (${json.error ?? 'error'}).` }
    }
    return { ok: true }
  } catch (err) {
    replyLog.warn('views.open exception', { err: String(err) })
    return { ok: false, message: 'Slack could not open the reply box. Try again.' }
  }
}

interface ViewSubmissionPayload {
  view?: {
    callback_id?: string
    private_metadata?: string
    state?: { values?: Record<string, Record<string, { value?: string | null }>> }
  }
}

/** The report id and reply text from a modal submit, or a field error. */
export function parseReporterReplySubmission(
  payload: ViewSubmissionPayload,
): { ok: true; reportId: string; message: string } | { ok: false; error: string } {
  const reportId = payload.view?.private_metadata ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
    return { ok: false, error: 'This reply box is out of date — open it again from the report.' }
  }
  const message = (payload.view?.state?.values?.[REPLY_BLOCK_ID]?.[REPLY_ACTION_ID]?.value ?? '').trim()
  if (!message) return { ok: false, error: 'Write a reply first.' }
  if (message.length > SLACK_REPLY_MAX_CHARS) return { ok: false, error: `Keep it under ${SLACK_REPLY_MAX_CHARS} characters.` }
  return { ok: true, reportId, message }
}

/**
 * Post the reply. Resolves the Slack response for a `view_submission`:
 * `{ response_action: 'clear' }` on success, or field errors shown in the modal.
 */
export async function submitSlackReporterReply(
  db: SupabaseClient,
  payload: ViewSubmissionPayload,
): Promise<Record<string, unknown>> {
  const parsed = parseReporterReplySubmission(payload)
  if (!parsed.ok) return { response_action: 'errors', errors: { [REPLY_BLOCK_ID]: parsed.error } }

  const { data: report, error } = await db
    .from('reports')
    .select('id, project_id, reporter_token_hash, closed_reason')
    .eq('id', parsed.reportId)
    .maybeSingle()
  const r = report as { project_id: string; reporter_token_hash: string | null; closed_reason: string | null } | null
  if (error || !r) return { response_action: 'errors', errors: { [REPLY_BLOCK_ID]: 'That report no longer exists.' } }
  if (!isWidgetReporterKey(r.reporter_token_hash) || r.closed_reason === 'spam') {
    return { response_action: 'errors', errors: { [REPLY_BLOCK_ID]: 'This report has no one to reply to.' } }
  }

  const result = await postReporterReply(db as never, {
    projectId: r.project_id,
    reportId: parsed.reportId,
    message: parsed.message,
    authorName: 'Developer',
  })
  if (result.status !== 201) {
    replyLog.error('slack reporter reply failed', { reportId: parsed.reportId, status: result.status })
    return { response_action: 'errors', errors: { [REPLY_BLOCK_ID]: 'Could not send the reply. Try again in a minute.' } }
  }
  return { response_action: 'clear' }
}
