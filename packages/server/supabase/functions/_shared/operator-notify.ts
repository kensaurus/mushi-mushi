/**
 * FILE: _shared/operator-notify.ts
 * PURPOSE: Out-of-band push to the human operator when something
 *          revenue-relevant or customer-blocking happens.
 *
 *   - New paid customer started a subscription
 *   - A paid invoice failed (the customer's card got declined)
 *   - A paying customer churned
 *   - A paid customer opened a support ticket
 *
 * TRANSPORTS:
 *   - The Ops hub (2026-11-18), when MUSHI_OPS_KEY is set: one POST /v1/ops/events with the
 *     Mushi Mushi app's ops:write key. The team's Slack bot then posts it with threads and
 *     buttons, and the console's Ops page keeps the record. When the hub takes the event, the
 *     Slack webhook below is skipped; when it does not (no key, 4xx/5xx, timeout), the webhook
 *     posts as before. Discord is unaffected.
 *   - Slack incoming webhook  (Block Kit, https://hooks.slack.com/...). Routed by `category`
 *     to the Kensaurus Bot channels (2026-11-17): SLACK_PAYMENTS_WEBHOOK_URL (#payments) or
 *     SLACK_ALERTS_WEBHOOK_URL (#alerts); OPERATOR_SLACK_WEBHOOK_URL stays as the fallback.
 *     Every Slack message starts with the app name, then one plain line, then the facts.
 *   - Discord incoming webhook (rich embeds, https://discord.com/api/webhooks/...)
 *   - Both auto-detected by URL host. Ship to whichever (or both) are set.
 *
 * GUARANTEES:
 *   - Fail-soft: any post error is captured to Sentry but NEVER thrown back
 *     to the caller. The Stripe webhook MUST still 200 so the payment state
 *     persists — operator notifications are nice-to-have, not blocking.
 *   - No PII in logs: only the customer email's domain part is logged.
 *   - Self-hosters skip silently when neither env var is set.
 *
 * USAGE:
 *   await notifyOperator({
 *     title: 'New paid customer',
 *     body: 'acme.com just started Pro.',
 *     level: 'info',
 *     fields: [{ label: 'Plan', value: 'Pro' }, { label: 'MRR', value: '+$99' }],
 *     url: 'https://dashboard.stripe.com/customers/cus_xxx',
 *   })
 */

import { log } from './logger.ts'
import { reportError } from './sentry.ts'

const opLog = log.child('operator-notify')

const SLACK_HOST = 'hooks.slack.com'
/** Hosts that serve Discord webhooks (stable, PTB, Canary and the legacy domain). */
const DISCORD_HOSTS = new Set(['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com'])

export type NotifyLevel = 'info' | 'warn' | 'urgent'
/** Which Slack channel: money in or out (#payments), or something broken (#alerts). */
export type NotifyCategory = 'payments' | 'alerts'

/** The app name every Slack message starts with. */
const APP_NAME = 'Mushi Mushi'

export interface NotifyField {
  label: string
  value: string
  /** Discord allows inline fields (3 per row). Slack lays them in 2 columns. */
  inline?: boolean
}

export interface NotifyArgs {
  /** Short headline. Will be the Slack `text` and Discord `title`. */
  title: string
  /** Body paragraph. Markdown-light: `*bold*`, `_italic_`, `<url|text>` for Slack. */
  body: string
  /** Severity. Drives colour and `@here` ping for `urgent`. */
  level: NotifyLevel
  /** Structured key/value rows rendered as a fields table on both transports. */
  fields?: NotifyField[]
  /** Primary action — usually the Stripe Dashboard or admin console deep link. */
  url?: string
  /** Free-form footer (e.g. environment, region). */
  footer?: string
  /** Slack channel. Without it, only OPERATOR_SLACK_WEBHOOK_URL is used. */
  category?: NotifyCategory
  /**
   * What Slack shows instead of `body` / `fields`, when those carry personal data (a support
   * ticket's text and sender). Slack keeps 90 days of history in a shared workspace; Discord
   * keeps the full version.
   */
  slack?: { body: string; fields?: NotifyField[] }
  /** Ops hub: a machine name such as `payment.succeeded` (default `<category>.notice`). */
  kind?: string
  /** Ops hub: a retried notice with the same key posts once (for example `stripe:evt_123`). */
  dedupeKey?: string
  /** Ops hub: groups a notice with its follow-ups in one Slack thread (for example `invoice:in_123`). */
  threadKey?: string
  /** Ops hub: money in (or out, for a `kind` with `refund`) in the currency's smallest unit. */
  amountMinor?: number
  /** Ops hub: ISO 4217 code, required with `amountMinor`. */
  currency?: string
}

const COLORS: Record<NotifyLevel, { slackBar: string; discordInt: number }> = {
  info: { slackBar: '#22c55e', discordInt: 0x22c55e },
  warn: { slackBar: '#f59e0b', discordInt: 0xf59e0b },
  urgent: { slackBar: '#ef4444', discordInt: 0xef4444 },
}

/**
 * Best-effort notifier. Returns the number of transports it successfully
 * pushed to. Caller should NOT await this in a critical path — fire and
 * forget is fine for webhook-driven notifications.
 */
export async function notifyOperator(args: NotifyArgs): Promise<number> {
  const viaOps = await postOpsHub(args)
  const slackUrl = viaOps ? '' : slackUrlFor(args.category)
  const discordUrl = (Deno.env.get('OPERATOR_DISCORD_WEBHOOK_URL') ?? '').trim()

  if (!slackUrl && !discordUrl) return viaOps ? 1 : 0

  const targets: Promise<boolean>[] = []
  if (viaOps) targets.push(Promise.resolve(true))
  if (slackUrl) targets.push(postSlack(slackUrl, args))
  if (discordUrl) targets.push(postDiscord(discordUrl, args))

  const results = await Promise.allSettled(targets)
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}

const OPS_KIND_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/
/** A masked address like `ab…@acme.com` still reads as an email to the hub's PII check: keep the domain only. */
const toDomain = (t: string) => t.replace(/[^\s@<>()|,;:"']+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '@$1')

/** @internal Exported for tests. The Ops hub event for a notice: the Slack-safe text, never the Discord-only detail. */
export function opsEventFor(args: NotifyArgs): Record<string, unknown> {
  const category = args.category ?? 'alerts'
  const body = toDomain(args.slack?.body ?? args.body).slice(0, 600)
  const fields = (args.slack ? args.slack.fields ?? [] : args.fields ?? []).slice(0, 8)
  const kind = args.kind && OPS_KIND_RE.test(args.kind) && args.kind.length <= 60 ? args.kind : `${category}.notice`
  const money = typeof args.amountMinor === 'number' && Number.isFinite(args.amountMinor) && /^[A-Z]{3}$/.test(args.currency ?? '')
  return {
    category,
    severity: args.level,
    kind,
    title: toDomain(args.title).slice(0, 150),
    ...(body ? { body } : {}),
    facts: fields.map((f) => ({ label: f.label.slice(0, 40), value: toDomain(f.value).slice(0, 200) })),
    ...(args.url?.startsWith('https://') ? { url: args.url.slice(0, 2000) } : {}),
    ...(money ? { amount_minor: Math.round(args.amountMinor as number), currency: args.currency } : {}),
    ...(args.threadKey ? { thread_key: args.threadKey.slice(0, 200) } : {}),
    ...(args.dedupeKey ? { dedupe_key: args.dedupeKey.slice(0, 200) } : {}),
  }
}

/** The Ops events URL: MUSHI_OPS_API_URL, else this project's own api. */
function opsEventsUrl(): string | null {
  const explicit = (Deno.env.get('MUSHI_OPS_API_URL') ?? '').trim().replace(/\/+$/, '')
  const own = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '')
  const base = explicit || (own ? `${own}/functions/v1/api` : '')
  return base.startsWith('https://') ? `${base}/v1/ops/events` : null
}

/** True when the Ops hub stored the notice (202, or 200 for a duplicate). Never throws. */
async function postOpsHub(args: NotifyArgs): Promise<boolean> {
  const key = (Deno.env.get('MUSHI_OPS_KEY') ?? '').trim()
  const url = key ? opsEventsUrl() : null
  if (!key || !url) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mushi-Api-Key': key },
      body: JSON.stringify(opsEventFor(args)),
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) return true
    opLog.warn('ops_hub_rejected', { status: res.status })
    return false
  } catch (err) {
    opLog.warn('ops_hub_unreachable', { err: err instanceof Error ? err.name : 'error' })
    return false
  }
}

/** The channel's webhook, else the single operator webhook from before 2026-11-17. */
function slackUrlFor(category: NotifyCategory | undefined): string {
  const byCategory = category === 'payments' ? 'SLACK_PAYMENTS_WEBHOOK_URL' : category === 'alerts' ? 'SLACK_ALERTS_WEBHOOK_URL' : null
  const specific = byCategory ? (Deno.env.get(byCategory) ?? '').trim() : ''
  return specific || (Deno.env.get('OPERATOR_SLACK_WEBHOOK_URL') ?? '').trim()
}

/** A glanceable mark: money (💳), needs a look (⚠️), broken (🔴), fine again (✅). */
function emojiFor(args: Pick<NotifyArgs, 'level' | 'category'>): string {
  if (args.level === 'urgent') return '🔴'
  if (args.level === 'warn') return '⚠️'
  return args.category === 'payments' ? '💳' : '✅'
}

/** @internal Exported for tests. The Slack payload: app name and headline, one plain paragraph, the facts on one line, one button. */
export function slackPayload(args: NotifyArgs): Record<string, unknown> {
  const body = args.slack?.body ?? args.body
  const fields = args.slack ? args.slack.fields ?? [] : args.fields ?? []
  const headline = `${APP_NAME} · ${emojiFor(args)} ${args.title}`
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text: `*${headline}*
${body}` } }]
  const facts = fields.map((f) => `*${f.label}:* ${f.value}`)
  if (args.footer) facts.push(args.footer)
  if (facts.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: facts.join('  ·  ').slice(0, 2900) }] })
  if (args.url) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open' }, url: args.url, ...(args.level === 'urgent' ? { style: 'danger' } : {}) }],
    })
  }
  return { text: headline, attachments: [{ color: COLORS[args.level].slackBar, blocks }] }
}

async function postSlack(url: string, args: NotifyArgs): Promise<boolean> {
  // Compare the parsed host, not a substring (js/incomplete-url-substring-
  // sanitization): `url.includes('hooks.slack.com')` also matches hostile
  // hosts like `hooks.slack.com.evil.test` or `evil.test/hooks.slack.com`.
  // Fail closed so a wrong URL cannot carry operator notifications elsewhere.
  if (safeHost(url) !== SLACK_HOST) {
    opLog.warn('slack_url_host_mismatch', { host: safeHost(url) })
    return false
  }

  const payload = slackPayload(args)

  return await post(url, payload, 'slack')
}

async function postDiscord(url: string, args: NotifyArgs): Promise<boolean> {
  const host = safeHost(url)
  if (!DISCORD_HOSTS.has(host)) {
    opLog.warn('discord_url_host_mismatch', { host })
    return false
  }

  const embed: Record<string, unknown> = {
    title: prefixForLevel(args.level) + args.title,
    description: args.body,
    color: COLORS[args.level].discordInt,
    timestamp: new Date().toISOString(),
  }
  if (args.fields?.length) {
    embed.fields = args.fields.slice(0, 25).map((f) => ({
      name: f.label,
      value: f.value,
      inline: f.inline ?? true,
    }))
  }
  if (args.url) embed.url = args.url
  if (args.footer) embed.footer = { text: args.footer }

  const payload: Record<string, unknown> = { embeds: [embed] }

  if (args.level === 'urgent') {
    payload.content = '@here'
    payload.allowed_mentions = { parse: ['everyone'] }
  }

  return await post(url, payload, 'discord')
}

async function post(url: string, payload: unknown, transport: 'slack' | 'discord'): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // A slow chat service must never hold up a Stripe webhook or a cron.
      signal: AbortSignal.timeout(5_000),
    })
    // Slack returns "ok" plain text on success (200). Discord returns 204.
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`${transport}_webhook_${res.status}: ${text.slice(0, 200)}`)
      opLog.error('post_failed', { transport, status: res.status })
      reportError(err, { tags: { transport } })
      return false
    }
    return true
  } catch (err) {
    opLog.error('post_threw', {
      transport,
      err: err instanceof Error ? err.message : String(err),
    })
    reportError(err, { tags: { transport } })
    return false
  }
}

function prefixForLevel(level: NotifyLevel): string {
  switch (level) {
    case 'info': return 'mushi-mushi: '
    case 'warn': return 'mushi-mushi (warn): '
    case 'urgent': return 'mushi-mushi (urgent): '
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}

declare const Deno: { env: { get(name: string): string | undefined } }
