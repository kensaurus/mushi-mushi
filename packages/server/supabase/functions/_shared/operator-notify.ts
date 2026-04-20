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
 *   - Slack incoming webhook  (Block Kit, https://hooks.slack.com/...)
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
const DISCORD_HOST = 'discord.com'
const DISCORDAPP_HOST = 'discordapp.com'

export type NotifyLevel = 'info' | 'warn' | 'urgent'

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
  const slackUrl = (Deno.env.get('OPERATOR_SLACK_WEBHOOK_URL') ?? '').trim()
  const discordUrl = (Deno.env.get('OPERATOR_DISCORD_WEBHOOK_URL') ?? '').trim()

  if (!slackUrl && !discordUrl) return 0

  const targets: Promise<boolean>[] = []
  if (slackUrl) targets.push(postSlack(slackUrl, args))
  if (discordUrl) targets.push(postDiscord(discordUrl, args))

  const results = await Promise.allSettled(targets)
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}

async function postSlack(url: string, args: NotifyArgs): Promise<boolean> {
  if (!url.includes(SLACK_HOST)) {
    opLog.warn('slack_url_host_mismatch', { host: safeHost(url) })
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: prefixForLevel(args.level) + args.title, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: args.body },
    },
  ]

  if (args.fields?.length) {
    blocks.push({
      type: 'section',
      fields: args.fields.map((f) => ({
        type: 'mrkdwn',
        text: `*${f.label}*\n${f.value}`,
      })),
    })
  }

  if (args.url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open' },
          url: args.url,
          style: args.level === 'urgent' ? 'danger' : 'primary',
        },
      ],
    })
  }

  if (args.footer) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: args.footer }],
    })
  }

  const payload = {
    text: prefixForLevel(args.level) + args.title,
    attachments: [{ color: COLORS[args.level].slackBar, blocks }],
  }

  return await post(url, payload, 'slack')
}

async function postDiscord(url: string, args: NotifyArgs): Promise<boolean> {
  const host = safeHost(url)
  if (host !== DISCORD_HOST && host !== DISCORDAPP_HOST) {
    opLog.warn('discord_url_host_mismatch', { host })
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
