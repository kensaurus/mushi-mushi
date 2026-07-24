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

  if (payload.component) {
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

  return parts.join('  ·  ')
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

export function buildReportBlocks(payload: SlackReportPayload): unknown[] {
  const base = adminBaseUrl()
  const reportUrl = base ? `${base}/reports/${encodeURIComponent(payload.reportId)}` : null
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

  // Summary — once, bold (header + fallback already carry severity/project)
  const summaryBlock: Record<string, unknown> = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: payload.summary?.trim()
        ? `*${payload.summary.trim()}*`
        : '_No summary provided_',
    },
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

/**
 * Post a message via the Slack Bot API (`chat.postMessage`).
 * Returns `{ ok, ts }` — when `ok`, `ts` is the message's unique timestamp
 * which can be stored on the report row and used to post threaded replies.
 *
 * Token resolution order:
 *   1. `opts.token` (explicit override)
 *   2. Per-project vaulted token via `opts.db` + `opts.projectId`
 *   3. Global `SLACK_BOT_TOKEN` env var
 */
export async function sendBotMessage(opts: BotMessageOptions): Promise<BotMessageResult> {
  let token = opts.token ?? null
  // Resolve per-project vaulted token if db + projectId are provided
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
  const channel = opts.channel ?? Deno.env.get('SLACK_CHANNEL_ID')

  if (!token) {
    slackLog.warn('sendBotMessage: no bot token available (set SLACK_BOT_TOKEN or connect via OAuth) — skipping')
    return { ok: false, ts: null, error: 'no_bot_token' }
  }
  if (!channel) {
    slackLog.warn('sendBotMessage: no channel — skipping')
    return { ok: false, ts: null, error: 'no_channel' }
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
      slackLog.error('chat.postMessage failed', { slackError: json.error })
      return { ok: false, ts: null, error: json.error }
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
  opts: { channelId?: string; webhookUrl?: string },
): Promise<string | null> {
  const blocks = buildReportBlocks(payload)
  const fallback = buildReportFallbackText(payload)
  const attachments = wrapReportAttachment(payload, blocks)

  const botToken = Deno.env.get('SLACK_BOT_TOKEN')
  if (botToken) {
    const result = await sendBotMessage({
      channel: opts.channelId ?? undefined,
      attachments,
      text: fallback,
    })
    return result.ts
  }
  // Legacy webhook fallback
  if (opts.webhookUrl) {
    await postToSlack(opts.webhookUrl, { text: fallback, attachments })
  }
  return null
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
