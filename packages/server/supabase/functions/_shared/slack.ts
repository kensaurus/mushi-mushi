/**
 * FILE: packages/server/supabase/functions/_shared/slack.ts
 * PURPOSE: Slack delivery helper. Two delivery paths:
 *
 *   1. WEBHOOK PATH (legacy, still supported for backwards-compat):
 *      `sendSlackNotification(webhookUrl, payload)` / `sendSlackText(webhookUrl, text)`
 *      Uses incoming webhook URLs stored per project in `slack_webhook_url`.
 *      Pros: simple, no auth. Cons: no thread replies, no `ts` tracking.
 *
 *   2. BOT PATH (recommended, new default):
 *      `sendBotMessage({ channel, blocks, text, threadTs? })`
 *      Uses `chat.postMessage` with SLACK_BOT_TOKEN (xoxb-).
 *      Returns `{ ok, ts }` — the `ts` can be stored on the report row
 *      and used to post threaded follow-up messages (fix dispatched, PR link).
 *      `channel_not_found`, `not_in_channel` and `is_archived` are a stale
 *      channel, not an outage: they are recorded on
 *      `integration_health_history` as down and are not sent to Sentry.
 *      The same channel is not posted to again for an hour. The cooldown
 *      reads `detail.slack_error` and `detail.channel_id` on the health
 *      row, not the sentence in `message`.
 *
 * Threading flow
 * --------------
 *   classify-report/fast-filter
 *     → sendBotMessage → stores ts → reports.slack_message_ts
 *   slack-interactions (Dispatch fix button)
 *     → sendBotMessage({ threadTs: report.slack_message_ts })  ← threaded reply
 *   fix-worker / copilot
 *     → sendBotMessage({ threadTs }) once PR is opened
 *
 * Block layout (report notifications)
 * ------------------------------------
 *   header          — severity + category + project
 *   section         — bold summary (+ optional screenshot)
 *   context         — icon chips: location, confidence, reporter, env, page link
 *   actions         — Triage → + Dispatch fix (or Install GitHub App / Enable Autofix)
 *   context         — report id (+ session id)
 *
 * Delivery wraps blocks in a severity-colored attachment for the left stripe.
 *
 * Security note:
 *   SLACK_BOT_TOKEN must be the Bot User OAuth Token (xoxb-*) for `chat.postMessage`.
 *   Do NOT put it in the repo or in project_settings — keep it as a Supabase secret.
 */

import { fetchWithTimeout } from './http.ts'
import { log } from './logger.ts'

const slackLog = log.child('slack')

export interface SlackReportPayload {
  projectName: string
  category: string
  severity: string
  summary: string
  reporterToken: string
  pageUrl: string
  reportId: string
  /** Project UUID — scopes the Triage deep link (`?project=`) and resolves
   *  the per-project vaulted bot token. */
  projectId?: string | null
  /** Optional fields for richer messages (added in production-hardening pass) */
  screenshotUrl?: string | null
  /** Human-readable display name from end_users.display_name */
  reporterDisplayName?: string | null
  /** True when identity is JWT-verified */
  reporterVerified?: boolean
  sessionId?: string | null
  confidence?: number | null
  component?: string | null
  /** How many times this fingerprint has been seen (dedup count) */
  dedupCount?: number
  /** Sentry issue URL for cross-linking */
  sentryIssueUrl?: string | null
  /** Is the GitHub App installed? Drives Dispatch fix button preflight */
  githubAppInstalled?: boolean
  /** Is autofix enabled? */
  autofixEnabled?: boolean
  /** Stage-2 plain-language headline ("Checkout button does nothing"). */
  title?: string | null
  /** Coarse product-area tag from Stage 2 ("Checkout", "Auth", …). */
  area?: string | null
  /** One-line likely root cause from Stage 2. */
  rootCause?: string | null
  /** Reporter's app version + SDK provenance. */
  appVersion?: string | null
  sdkPackage?: string | null
  sdkVersion?: string | null
  /** Release/environment from the linked Sentry event, when present. */
  sentryRelease?: string | null
  sentryEnvironment?: string | null
  /** Evidence volume — chips render only when > 0. */
  consoleErrorCount?: number
  failedRequestCount?: number
  reproStepsCount?: number
}

interface SlackTextPayload {
  text: string
}

type SlackPayload = SlackReportPayload | SlackTextPayload

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F6A8}',
  high: '\u{1F534}',
  medium: '\u{1F7E1}',
  low: '\u{1F535}',
}

const CATEGORY_EMOJI: Record<string, string> = {
  bug: '\u{26A0}\u{FE0F}',
  slow: '\u{1F40C}',
  visual: '\u{1F3A8}',
  confusing: '\u{1F615}',
  other: '\u{1F4DD}',
}

function isReportPayload(p: SlackPayload): p is SlackReportPayload {
  return typeof (p as SlackReportPayload).reportId === 'string'
}

function adminBaseUrl(): string | null {
  const raw = Deno.env.get('ADMIN_BASE_URL')
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

// Severity → Slack attachment color (used on the legacy attachment path and
// as a visual indicator in the Block Kit context row).
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#E11D48', // rose-600
  high: '#F97316',     // orange-500
  medium: '#EAB308',   // yellow-500
  low: '#3B82F6',      // blue-500
}

/** Human-readable severity label for headers and fallback text. */
function titleCaseSeverity(severity: string): string {
  if (!severity) return 'Unknown'
  return severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase()
}

/** Derive environment badge from the reporter's page URL. */
function inferEnvironmentLabel(pageUrl: string): string {
  if (!pageUrl) return ':grey_question: Unknown'
  try {
    const host = new URL(pageUrl).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
      return ':hammer_and_wrench: Local'
    }
    if (/staging|stage|preview|dev\.|sandbox|test\./.test(host)) {
      return ':test_tube: Staging'
    }
    return ':globe_with_meridians: Production'
  } catch {
    return ':grey_question: Unknown'
  }
}

/** Short, clickable label for an affected page URL. */
function pageLinkLabel(pageUrl: string): string {
  if (!pageUrl) return 'Unknown page'
  try {
    const url = new URL(pageUrl)
    const path = url.pathname.replace(/^\//, '') || url.hostname
    const tab = url.searchParams.get('tab')
    return tab ? `${path} › ${tab}` : path
  } catch {
    return truncate(pageUrl, 48)
  }
}

function reporterLabel(payload: SlackReportPayload): string {
  if (payload.reporterDisplayName) {
    return payload.reporterVerified
      ? `${payload.reporterDisplayName} ✓`
      : `${payload.reporterDisplayName} (unverified)`
  }
  return `\`${payload.reporterToken.slice(0, 8)}…\` (anon)`
}

/** Plain-text fallback for notifications — short; details live in blocks only. */
export function buildReportFallbackText(payload: SlackReportPayload): string {
  const sev = titleCaseSeverity(payload.severity)
  const emoji = CATEGORY_EMOJI[payload.category] ?? '🐛'
  const dedup = payload.dedupCount && payload.dedupCount > 1 ? ` (${payload.dedupCount}×)` : ''
  return `${emoji} ${sev} ${payload.category} · ${payload.projectName}${dedup}`
}

/** Compact metadata chips for a single context row (no labeled field grid). */
function buildMetaContextLine(payload: SlackReportPayload): string {
  const parts: string[] = []

  if (payload.area) {
    parts.push(`:round_pushpin: ${payload.area}`)
  }
  if (payload.component && payload.component !== payload.area) {
    parts.push(`:file_folder: ${payload.component}`)
  }
  if (payload.confidence != null) {
    parts.push(`:brain: ${Math.round(payload.confidence * 100)}%`)
  }
  parts.push(`:bust_in_silhouette: ${reporterLabel(payload)}`)
  parts.push(inferEnvironmentLabel(payload.pageUrl))

  if (payload.pageUrl) {
    parts.push(`:link: <${payload.pageUrl}|${pageLinkLabel(payload.pageUrl)}>`)
  }
  if (payload.dedupCount && payload.dedupCount > 1) {
    parts.push(`:repeat: ${payload.dedupCount}×`)
  }
  if (payload.sentryIssueUrl) {
    parts.push(`:rotating_light: <${payload.sentryIssueUrl}|Sentry>`)
  }
  const release = payload.sentryRelease ?? payload.appVersion
  if (release) {
    parts.push(`:package: ${truncate(release, 24)}`)
  }

  return parts.join('  ·  ')
}

/** Evidence-volume chips: what the triager will find when they open the
 *  report. Only chips with signal render; returns null when there are none
 *  so the card doesn't grow an empty row. */
function buildEvidenceContextLine(payload: SlackReportPayload): string | null {
  const parts: string[] = []
  if (payload.consoleErrorCount && payload.consoleErrorCount > 0) {
    parts.push(`:x: ${payload.consoleErrorCount} console error${payload.consoleErrorCount === 1 ? '' : 's'}`)
  }
  if (payload.failedRequestCount && payload.failedRequestCount > 0) {
    parts.push(`:no_entry: ${payload.failedRequestCount} failed request${payload.failedRequestCount === 1 ? '' : 's'}`)
  }
  if (payload.reproStepsCount && payload.reproStepsCount > 0) {
    parts.push(`:footprints: ${payload.reproStepsCount}-step repro`)
  }
  if (payload.screenshotUrl) {
    parts.push(':camera_with_flash: screenshot')
  }
  if (payload.sdkPackage) {
    const sdk = payload.sdkVersion ? `${payload.sdkPackage}@${payload.sdkVersion}` : payload.sdkPackage
    parts.push(`:electric_plug: ${truncate(sdk, 40)}`)
  }
  return parts.length > 0 ? parts.join('  ·  ') : null
}

/** Wrap blocks in a colored attachment for the severity sidebar stripe. */
export function wrapReportAttachment(
  payload: SlackReportPayload,
  blocks: unknown[],
): unknown[] {
  return [{
    color: severityAttachmentColor(payload.severity),
    blocks,
  }]
}

/** Admin deep link for a report; carries `?project=` so the console opens in
 *  the right project context instead of the viewer's last-pinned one. */
export function buildReportDeepLink(reportId: string, projectId?: string | null): string | null {
  const base = adminBaseUrl()
  if (!base) return null
  const url = `${base}/reports/${encodeURIComponent(reportId)}`
  return projectId ? `${url}?project=${encodeURIComponent(projectId)}` : url
}

export function buildReportBlocks(payload: SlackReportPayload): unknown[] {
  const base = adminBaseUrl()
  const reportUrl = buildReportDeepLink(payload.reportId, payload.projectId)
  const severityBadge = SEVERITY_EMOJI[payload.severity] ?? '\u{26AA}'
  const sevLabel = titleCaseSeverity(payload.severity)
  const canDispatch = payload.githubAppInstalled !== false && payload.autofixEnabled !== false
  const setupUrl = base ? `${base}/integrations/config` : null

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: truncate(
          `${severityBadge} ${sevLabel} ${payload.category} · ${payload.projectName}${
            payload.dedupCount && payload.dedupCount > 1 ? ` (${payload.dedupCount}×)` : ''
          }`,
          150,
        ),
        emoji: true,
      },
    },
  ]

  // Headline — the Stage-2 plain-language title when we have one (what a
  // human said broke), with the technical summary as the second line for the
  // engineer scanning the channel. Falls back to summary-only.
  const title = payload.title?.trim()
  const summary = payload.summary?.trim()
  const lines: string[] = []
  if (title) {
    lines.push(`*${truncate(title, 150)}*`)
    if (summary && summary !== title) lines.push(truncate(summary, 200))
  } else if (summary) {
    lines.push(`*${truncate(summary, 200)}*`)
  } else {
    lines.push('_No summary provided_')
  }
  if (payload.rootCause?.trim()) {
    lines.push(`:mag: ${truncate(payload.rootCause.trim(), 220)}`)
  }
  const summaryBlock: Record<string, unknown> = {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
  }
  if (payload.screenshotUrl) {
    summaryBlock.accessory = {
      type: 'image',
      image_url: payload.screenshotUrl,
      alt_text: 'Screenshot',
    }
  }
  blocks.push(summaryBlock)

  // Single scannable metadata row (icons, not labeled columns)
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: buildMetaContextLine(payload) }],
  })

  // Evidence row — what the triager will find when they click through.
  const evidenceLine = buildEvidenceContextLine(payload)
  if (evidenceLine) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: evidenceLine }],
    })
  }

  // CTAs: Triage always; Dispatch or Setup as second button
  if (reportUrl) {
    const actionElements: unknown[] = [
      {
        type: 'button',
        style: 'primary',
        text: { type: 'plain_text', text: 'Triage →', emoji: true },
        url: reportUrl,
        action_id: `open_report:${payload.reportId}`,
      },
    ]

    if (canDispatch) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Dispatch fix', emoji: true },
        action_id: `dispatch_fix:${payload.reportId}`,
        value: payload.reportId,
        confirm: {
          title: { type: 'plain_text', text: 'Dispatch auto-fix?' },
          text: {
            type: 'mrkdwn',
            text: `Open a draft PR for this report?`,
          },
          confirm: { type: 'plain_text', text: 'Dispatch' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      })
    } else if (setupUrl) {
      actionElements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: payload.githubAppInstalled === false
            ? 'Install GitHub App'
            : 'Enable Autofix',
          emoji: true,
        },
        url: setupUrl,
        action_id: `setup_autofix:${payload.reportId}`,
      })
    }

    // Answer the person who reported it, from the channel (Plan 018 §3).
    // Only for reports filed through the SDK widget: nobody else can read it.
    if (/^rk1_[0-9a-f]{64}$/.test(payload.reporterToken ?? '')) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Reply to reporter', emoji: true },
        action_id: `reply_reporter:${payload.reportId}`,
        value: payload.reportId,
      })
    }

    // Routine calls straight from the channel — no console round-trip.
    // Handled by the slack-interactions edge function via the shared
    // report-transition contract (same side effects as the console PATCH).
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Resolve ✓', emoji: true },
      action_id: `resolve_report:${payload.reportId}`,
      value: payload.reportId,
    })
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Dismiss', emoji: true },
      action_id: `dismiss_report:${payload.reportId}`,
      value: payload.reportId,
      confirm: {
        title: { type: 'plain_text', text: 'Dismiss this report?' },
        text: {
          type: 'mrkdwn',
          text: 'Marks the report dismissed (noise / duplicate / won’t fix). The reporter is notified.',
        },
        confirm: { type: 'plain_text', text: 'Dismiss' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    })

    blocks.push({
      type: 'actions',
      block_id: `mushi_report_${payload.reportId}`,
      elements: actionElements,
    })
  }

  // Minimal footer — IDs only
  const footerParts = [`\`${payload.reportId.slice(0, 8)}…\``]
  if (payload.sessionId) {
    footerParts.push(`session \`${payload.sessionId.slice(0, 8)}…\``)
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: footerParts.join('  ·  ') }],
  })

  return blocks
}

/** Build the Slack attachment color for an incoming report (used on legacy paths). */
export function severityAttachmentColor(severity: string): string {
  return SEVERITY_COLOR[severity] ?? '#64748B'
}

// ─── QA story run Block Kit builder ───────────────────────────────────────────

export interface QaRunPayload {
  storyId: string
  storyName: string
  projectName: string
  runId: string
  status: 'failed' | 'error'
  provider: string
  latencyMs: number
  summary: string | null
  errorMessage: string | null
  assertionFailures: Array<{ step: string; expected: string | null; actual: string | null }>
  consecutiveFailures: number
  screenshotBase64?: string | null
  runUrl: string | null
}

const STATUS_EMOJI: Record<string, string> = {
  failed: '\u274C', // ❌
  error: '\u26A0\uFE0F', // ⚠️
  passed: '\u2705', // ✅
  recovered: '\u{1F7E2}', // 🟢
}

export function buildQaStoryRunBlocks(payload: QaRunPayload): unknown[] {
  const statusEmoji = STATUS_EMOJI[payload.status] ?? '\u26AA'
  const isError = payload.status === 'error'
  const base = adminBaseUrl()

  const blocks: unknown[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} QA ${isError ? 'Error' : 'Failure'} · ${payload.storyName}`,
        emoji: true,
      },
    },
    // Context: project / provider / latency / consecutive count
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            `:file_folder: *${payload.projectName}*`,
            `:gear: ${payload.provider}`,
            `:stopwatch: ${(payload.latencyMs / 1000).toFixed(1)}s`,
            payload.consecutiveFailures > 1
              ? `:repeat: *${payload.consecutiveFailures}× consecutive failures*`
              : null,
          ]
            .filter(Boolean)
            .join('  ·  '),
        },
      ],
    },
  ]

  // Summary / error message
  const bodyText = payload.errorMessage
    ? `*${payload.summary ?? 'Error'}*\n\`\`\`${payload.errorMessage.slice(0, 300)}\`\`\``
    : `*${payload.summary ?? 'QA story failed'}*`

  const summaryBlock: Record<string, unknown> = {
    type: 'section',
    text: { type: 'mrkdwn', text: bodyText },
  }

  // Attach screenshot thumbnail if available
  if (payload.screenshotBase64) {
    const screenshotUrl = base
      ? `${base}/api/qa-evidence/${payload.runId}/screenshot`
      : null
    if (screenshotUrl) {
      summaryBlock.accessory = {
        type: 'image',
        image_url: screenshotUrl,
        alt_text: 'Screenshot from failed run',
      }
    }
  }
  blocks.push(summaryBlock)

  // Assertion failures (up to 5)
  if (payload.assertionFailures.length > 0) {
    const failLines = payload.assertionFailures.slice(0, 5).map(
      (f) => `• *${f.step}* — expected \`${f.expected ?? '?'}\`, got \`${f.actual ?? '(not found)'}\``,
    )
    if (payload.assertionFailures.length > 5) {
      failLines.push(`…and ${payload.assertionFailures.length - 5} more`)
    }
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: failLines.join('\n') },
    })
  }

  // Actions
  const actionElements: unknown[] = []

  if (payload.runUrl) {
    actionElements.push({
      type: 'button',
      style: 'primary',
      text: { type: 'plain_text', text: 'View run \u2192', emoji: true },
      url: payload.runUrl,
      action_id: `open_qa_run:${payload.runId}`,
    })
  }

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':pause_button: Pause story', emoji: true },
    action_id: `pause_story:${payload.storyId}`,
    value: payload.storyId,
    confirm: {
      title: { type: 'plain_text', text: 'Pause this story?' },
      text: {
        type: 'mrkdwn',
        text: `*${payload.storyName}* will stop running on its schedule until you re-enable it in the console.`,
      },
      confirm: { type: 'plain_text', text: 'Pause' },
      deny: { type: 'plain_text', text: 'Cancel' },
    },
  })

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':robot_face: Improve with AI', emoji: true },
    action_id: `improve_story:${payload.storyId}`,
    value: payload.storyId,
  })

  blocks.push({
    type: 'actions',
    block_id: `mushi_qa_${payload.storyId}`,
    elements: actionElements,
  })

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Run \`${payload.runId.slice(0, 8)}…\`  ·  Story \`${payload.storyId.slice(0, 8)}…\`  ·  via Mushi QA`,
    }],
  })

  blocks.push({ type: 'divider' })

  return blocks
}

// ─── Legacy webhook path ──────────────────────────────────────────────────────

async function postToSlack(webhookUrl: string, body: object): Promise<void> {
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      slackLog.error('Webhook non-2xx', { status: res.status, body: text.slice(0, 400) })
    }
  } catch (err) {
    slackLog.error('Webhook delivery failed', { err: String(err) })
  }
}

export async function sendSlackNotification(webhookUrl: string, payload: SlackPayload): Promise<void> {
  if (isReportPayload(payload)) {
    const blocks = buildReportBlocks(payload)
    const fallback = buildReportFallbackText(payload)
    await postToSlack(webhookUrl, {
      text: fallback,
      attachments: wrapReportAttachment(payload, blocks),
    })
    return
  }
  await postToSlack(webhookUrl, { text: payload.text })
}

/** Typed passthrough for plain-text callers (judge drift alerts, intelligence reports). */
export async function sendSlackText(webhookUrl: string, text: string): Promise<void> {
  await postToSlack(webhookUrl, { text })
}

// ─── Bot token path (chat.postMessage) ───────────────────────────────────────

export interface BotMessageOptions {
  /** Slack channel ID (e.g. C0B82A322RW). Falls back to SLACK_CHANNEL_ID env var. */
  channel?: string
  /** Block Kit blocks array. Prefer `attachments` for severity-colored report cards. */
  blocks?: unknown[]
  /** Legacy attachments wrapper (color bar + nested blocks). */
  attachments?: unknown[]
  /** Plain-text fallback (required by Slack if blocks are provided). */
  text: string
  /** When set, posts as a threaded reply to this message timestamp. */
  threadTs?: string | null
  /** Override the bot token. Falls back to per-project vault, then SLACK_BOT_TOKEN env var. */
  token?: string
  /**
   * Optional Supabase client + projectId for per-project token resolution.
   * When provided, the vaulted `slack_bot_token_ref` from `project_settings` is
   * tried before the global SLACK_BOT_TOKEN env var.
   */
  db?: unknown
  projectId?: string
}

export interface BotMessageResult {
  ok: boolean
  /** The Slack message timestamp — store on the report for threading follow-ups. */
  ts: string | null
  error?: string
}

/** Slack errors that mean this channel cannot take a post. Not an outage. */
const SLACK_CHANNEL_UNUSABLE = new Set(['channel_not_found', 'not_in_channel', 'is_archived'])

/** How long a recorded dead channel skips chat.postMessage. */
const SLACK_CHANNEL_UNUSABLE_COOLDOWN_MS = 60 * 60 * 1000

/** Stored on integration_health_history.detail. The sentence in message can change. */
export type SlackChannelHealthDetail = {
  slack_error: string
  channel_id: string
}

/**
 * Facts from conversations.info. A public channel with is_member false stays
 * usable: the Slack install requests chat:write.public, so the bot can post
 * there without /invite. Marking that down would skip every notification.
 * A private channel the bot can see but has not joined cannot take a post.
 */
export function slackChannelProbeCode(info: {
  ok: boolean
  error?: string
  channel?: { is_archived?: boolean; is_member?: boolean; is_private?: boolean }
} | null): string | null {
  if (!info) return null
  if (!info.ok) return info.error ?? null
  if (info.channel?.is_archived) return 'is_archived'
  if (info.channel?.is_private === true && info.channel.is_member === false) return 'not_in_channel'
  return null
}

/** Null unless `error` is one this channel cannot be posted to. */
export function slackChannelHealthDetail(error: string, channel: string): SlackChannelHealthDetail | null {
  if (!channel || !SLACK_CHANNEL_UNUSABLE.has(error)) return null
  return { slack_error: error, channel_id: channel }
}

/**
 * Newest health row after the channel id is saved. Status is not `down`,
 * so the send cooldown ends and the next notification tries this channel.
 */
export function slackChannelReselectedHealthRow(projectId: string, channelId: string): {
  project_id: string
  kind: 'slack'
  status: 'unknown'
  message: string
  source: 'manual'
  detail: { channel_id: string }
} {
  return {
    project_id: projectId,
    kind: 'slack',
    status: 'unknown',
    message: `Slack channel ${channelId} saved. The next notification will try this channel.`.slice(0, 300),
    source: 'manual',
    detail: { channel_id: channelId },
  }
}

/**
 * Plain-English reason a chat.postMessage (or conversations.info) error is
 * the channel, not the token. Null for every other Slack error. `channel`
 * is included so a later send can tell which channel was marked down.
 */
export function slackChannelUnusableCopy(error: string, channel?: string): string | null {
  const named = channel ? `Slack channel ${channel}` : 'This Slack channel'
  if (error === 'channel_not_found') {
    return `${named} was not found. It may have been deleted or belong to another workspace. Pick the channel again on Integrations.`
  }
  if (error === 'not_in_channel') {
    const where = channel ? `Slack channel ${channel}` : 'this Slack channel'
    // Kept under 160 characters with a normal channel id: the Slack card
    // clips probe messages there, and this sentence is that status line.
    // "Send test" writes an ok health row, so notifications resume at once
    // instead of waiting out the hour cooldown.
    return `The Mushi bot is not in ${where}. Invite it with /invite, then run Send test to resume notifications immediately.`
  }
  if (error === 'is_archived') {
    return `${named} is archived. Pick another channel, or unarchive it and run Send test to resume notifications immediately.`
  }
  return null
}

type SlackHealthRow = {
  status?: string
  checked_at?: string
  detail?: { slack_error?: unknown; channel_id?: unknown } | null
}

type SlackHealthTable = {
  select: (cols: string) => SlackHealthTable
  eq: (col: string, val: string) => SlackHealthTable
  order: (col: string, opts: { ascending: boolean }) => SlackHealthTable
  limit: (n: number) => SlackHealthTable
  maybeSingle: () => Promise<{ data: SlackHealthRow | null }>
  insert: (row: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
}

function slackHealthTable(db: unknown): SlackHealthTable | null {
  const from = (db as { from?: (table: string) => SlackHealthTable } | null)?.from
  if (typeof from !== 'function') return null
  try {
    return from('integration_health_history')
  } catch {
    return null
  }
}

/** The Slack error code stored on a down health row for this exact channel. */
function slackChannelDownCode(row: SlackHealthRow | null, channel: string): string | null {
  if (!row || row.status !== 'down' || !row.detail) return null
  const code = row.detail.slack_error
  const id = row.detail.channel_id
  if (typeof code !== 'string' || typeof id !== 'string' || id !== channel) return null
  if (!SLACK_CHANNEL_UNUSABLE.has(code)) return null
  return code
}

/**
 * Skip chat.postMessage while the newest slack health row says this exact
 * channel is down and that row is still inside the cooldown. A different
 * channel, an older row, or a failed read all post normally.
 */
async function slackChannelCoolingDown(db: unknown, projectId: string, channel: string): Promise<string | null> {
  try {
    const table = slackHealthTable(db)
    if (!table) return null
    const { data } = await table
      .select('status, detail, checked_at')
      .eq('project_id', projectId)
      .eq('kind', 'slack')
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const code = slackChannelDownCode(data, channel)
    if (!code || !data?.checked_at) return null
    const at = Date.parse(data.checked_at)
    if (!Number.isFinite(at) || Date.now() - at > SLACK_CHANNEL_UNUSABLE_COOLDOWN_MS) return null
    return code
  } catch {
    return null
  }
}

/** Best-effort. A failed insert must not fail the notification call. */
async function recordSlackChannelDown(
  db: unknown,
  projectId: string,
  message: string,
  detail: SlackChannelHealthDetail,
): Promise<void> {
  try {
    const table = slackHealthTable(db)
    if (!table) return
    const { error } = await table.insert({
      project_id: projectId,
      kind: 'slack',
      status: 'down',
      message: message.slice(0, 300),
      source: 'send',
      detail,
    })
    if (error) slackLog.warn('slack channel health not stored', { projectId, err: error.message })
  } catch (err) {
    slackLog.warn('slack channel health not stored', { projectId, err: String(err) })
  }
}

/**
 * The project's Slack bot token: the per-project vaulted token, else the
 * global `SLACK_BOT_TOKEN`. Null when neither exists. Never throws.
 */
export async function resolveSlackBotToken(db: unknown, projectId: string | null | undefined): Promise<string | null> {
  if (db && projectId) {
    try {
      const { data: ps } = await (db as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
        .from('project_settings')
        .select('slack_bot_token_ref')
        .eq('project_id', projectId)
        .maybeSingle()
      const ref = (ps as Record<string, unknown> | null)?.slack_bot_token_ref as string | null
      if (ref) {
        const { data: secret } = await (db as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> })
          .rpc('vault_get_secret', { secret_id: ref })
        if (typeof secret === 'string') return secret
      }
    } catch { /* fall through to env */ }
  }
  return Deno.env.get('SLACK_BOT_TOKEN') ?? null
}

/**
 * Post a message via the Slack Bot API (`chat.postMessage`).
 * Returns `{ ok, ts }` — when `ok`, `ts` is the message's unique timestamp
 * which can be stored on the report row and used to post threaded replies.
 *
 * Token resolution order:
 *   1. `opts.token` (explicit override)
 *   2. Per-project vaulted token via `opts.db` + `opts.projectId`
 *   3. Global `SLACK_BOT_TOKEN` env var
 *
 * `channel_not_found`, `not_in_channel` and `is_archived` are recorded as a
 * down slack health row and are not forwarded to Sentry. The same channel
 * is not posted to again until that row is an hour old.
 */
export async function sendBotMessage(opts: BotMessageOptions): Promise<BotMessageResult> {
  // Explicit token, else the per-project vaulted token, else SLACK_BOT_TOKEN.
  const token = opts.token || (await resolveSlackBotToken(opts.db, opts.projectId))
  const channel = opts.channel ?? Deno.env.get('SLACK_CHANNEL_ID')

  if (!token) {
    slackLog.warn('sendBotMessage: no bot token available (set SLACK_BOT_TOKEN or connect via OAuth) — skipping')
    return { ok: false, ts: null, error: 'no_bot_token' }
  }
  if (!channel) {
    slackLog.warn('sendBotMessage: no channel — skipping')
    return { ok: false, ts: null, error: 'no_channel' }
  }

  // A deleted, archived, or unjoined channel fails the same way on every
  // notification. One indexed read of the newest slack health row (project_id,
  // kind, checked_at) skips chat.postMessage until that row is an hour old.
  if (opts.db && opts.projectId) {
    const cooling = await slackChannelCoolingDown(opts.db, opts.projectId, channel)
    if (cooling) {
      slackLog.warn('chat.postMessage skipped; channel still marked down', {
        channel,
        slackError: cooling,
        projectId: opts.projectId,
      })
      return { ok: false, ts: null, error: cooling }
    }
  }

  const body: Record<string, unknown> = {
    channel,
    text: opts.text,
  }
  if (opts.attachments?.length) body.attachments = opts.attachments
  else if (opts.blocks?.length) body.blocks = opts.blocks
  if (opts.threadTs) body.thread_ts = opts.threadTs

  try {
    const res = await fetchWithTimeout('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json() as { ok: boolean; ts?: string; error?: string }
    if (!json.ok) {
      const slackError = json.error ?? 'slack_error'
      const copy = slackChannelUnusableCopy(slackError, channel)
      if (copy) {
        // warn, not error: error is forwarded to Sentry, and a stale channel
        // is a setup problem the user can fix, not a crash on every send.
        slackLog.warn('chat.postMessage channel unusable', { slackError, channel })
        const detail = slackChannelHealthDetail(slackError, channel)
        if (detail && opts.db && opts.projectId) {
          await recordSlackChannelDown(opts.db, opts.projectId, copy, detail)
        }
        return { ok: false, ts: null, error: slackError }
      }
      slackLog.error('chat.postMessage failed', { slackError })
      return { ok: false, ts: null, error: slackError }
    }
    return { ok: true, ts: json.ts ?? null }
  } catch (err) {
    slackLog.error('chat.postMessage exception', { err: String(err) })
    return { ok: false, ts: null, error: String(err) }
  }
}

/**
 * Convenience wrapper: build report blocks and post via bot.
 * Falls back to webhook if no bot token is configured.
 * Returns the Slack message ts for threading (null when falling back to webhook).
 */
export async function sendReportNotification(
  payload: SlackReportPayload,
  opts: {
    channelId?: string
    webhookUrl?: string
    /** Supabase client + projectId enable the per-project vaulted bot token
     *  (project_settings.slack_bot_token_ref). Without them only the global
     *  SLACK_BOT_TOKEN works and per-project Slack workspaces silently fall
     *  back to the webhook path. */
    db?: unknown
    projectId?: string
  },
): Promise<string | null> {
  const blocks = buildReportBlocks(payload)
  const fallback = buildReportFallbackText(payload)
  const attachments = wrapReportAttachment(payload, blocks)

  // Try the bot path first: sendBotMessage resolves explicit token → per-
  // project vault → SLACK_BOT_TOKEN env, so a project-scoped OAuth install
  // works even when the global env token is absent.
  const canTryBot = Boolean(
    Deno.env.get('SLACK_BOT_TOKEN') || (opts.db && (opts.projectId ?? payload.projectId)),
  )
  if (canTryBot) {
    const result = await sendBotMessage({
      channel: opts.channelId ?? undefined,
      attachments,
      text: fallback,
      db: opts.db,
      projectId: opts.projectId ?? payload.projectId ?? undefined,
    })
    if (result.ok) return result.ts
    // Bot resolution failed (no token in vault/env) — fall through to webhook.
  }
  // Legacy webhook fallback
  if (opts.webhookUrl) {
    await postToSlack(opts.webhookUrl, { text: fallback, attachments })
  }
  return null
}

/**
 * Rewrite an already-posted report card in place (`chat.update`) so channel
 * state tracks reality: after Resolve/Dismiss/Dispatch the card shows the
 * outcome instead of offering the same buttons forever.
 *
 * `channel` is required and never defaulted: chat.update addresses a message
 * by (channel, ts), so it must be the channel the card was actually posted
 * in — the interaction payload's channel id — not SLACK_CHANNEL_ID.
 */
export async function updateReportMessage(opts: {
  channel: string
  ts: string
  attachments?: unknown[]
  blocks?: unknown[]
  text: string
  db?: unknown
  projectId?: string
  token?: string
}): Promise<{ ok: boolean; error?: string }> {
  let token = opts.token ?? null
  if (!token && opts.db && opts.projectId) {
    try {
      const { data: ps } = await (opts.db as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
        .from('project_settings')
        .select('slack_bot_token_ref')
        .eq('project_id', opts.projectId)
        .maybeSingle()
      const ref = (ps as Record<string, unknown> | null)?.slack_bot_token_ref as string | null
      if (ref) {
        const { data: secret } = await (opts.db as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> })
          .rpc('vault_get_secret', { secret_id: ref })
        if (typeof secret === 'string') token = secret
      }
    } catch { /* fall through to env */ }
  }
  if (!token) token = Deno.env.get('SLACK_BOT_TOKEN') ?? null
  const channel = opts.channel
  if (!token || !channel) return { ok: false, error: token ? 'no_channel' : 'no_bot_token' }

  const body: Record<string, unknown> = { channel, ts: opts.ts, text: opts.text }
  if (opts.attachments?.length) body.attachments = opts.attachments
  else if (opts.blocks?.length) body.blocks = opts.blocks

  try {
    const res = await fetchWithTimeout('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json() as { ok: boolean; error?: string }
    if (!json.ok) {
      slackLog.error('chat.update failed', { slackError: json.error })
      return { ok: false, error: json.error }
    }
    return { ok: true }
  } catch (err) {
    slackLog.error('chat.update exception', { err: String(err) })
    return { ok: false, error: String(err) }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  return input.slice(0, max - 1) + '\u2026'
}

// ─── Discord webhook helper ───────────────────────────────────────────────────
// Posts a plain text or embed message directly to a Discord webhook URL.
// Converts a Slack-style `text` string into a Discord message. No library needed.

export async function sendDiscordNotification(
  webhookUrl: string,
  text: string,
  opts: { title?: string; color?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) return { ok: false, error: 'no_webhook_url' }
  try {
    const payload: Record<string, unknown> = opts.title
      ? { embeds: [{ title: opts.title, description: text, color: opts.color ?? 0x57f287 }] }
      : { content: text }

    const res = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 204 || res.ok) return { ok: true }
    const body = await res.text().catch(() => '')
    slackLog.warn('discord webhook error', { status: res.status, body: body.slice(0, 200) })
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
