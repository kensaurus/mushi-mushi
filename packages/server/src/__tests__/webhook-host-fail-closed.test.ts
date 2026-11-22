/**
 * The Discord triage notifier and the operator notifier checked the webhook
 * host but only logged a mismatch, then posted report summaries / operator
 * alerts to whatever host the URL named. They now refuse to send. Also covers
 * evaluateTriageDedupe falling back to notify when the report_groups lookup
 * errors (it used to drop that error and could suppress the canonical
 * report's announcement).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

import { evaluateTriageDedupe, postTriageNotice } from '../../supabase/functions/_shared/discord-triage.ts'
import { notifyOperator } from '../../supabase/functions/_shared/operator-notify.ts'

let envVars: Record<string, string> = {}
const fetchMock = vi.fn()

beforeEach(() => {
  envVars = {}
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => envVars[k] } }
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('postTriageNotice host check', () => {
  it('does not post to a non-Discord host', async () => {
    envVars.MUSHI_DISCORD_WEBHOOK_URL = 'https://discord.com.evil.test/api/webhooks/1/x'
    expect(await postTriageNotice('hello')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to Discord hosts, including PTB and Canary', async () => {
    for (const host of ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']) {
      envVars.MUSHI_DISCORD_WEBHOOK_URL = `https://${host}/api/webhooks/1/x`
      expect(await postTriageNotice('hello')).toBe(true)
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('notifyOperator host check', () => {
  it('skips Slack and Discord URLs on other hosts', async () => {
    envVars.OPERATOR_SLACK_WEBHOOK_URL = 'https://hooks.slack.com.evil.test/services/x'
    envVars.OPERATOR_DISCORD_WEBHOOK_URL = 'https://evil.test/discord.com/api/webhooks/1/x'
    expect(await notifyOperator({ level: 'info', title: 't', body: 'b' })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the real hosts', async () => {
    envVars.OPERATOR_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    envVars.OPERATOR_DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/x'
    expect(await notifyOperator({ level: 'info', title: 't', body: 'b' })).toBe(2)
  })
})

describe('evaluateTriageDedupe report_groups error', () => {
  it('notifies when the canonical lookup fails', async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: [{ report_group_id: 'g1', report_count: 4 }], error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
    }
    const verdict = await evaluateTriageDedupe(db as never, 'g1', 'r1')
    expect(verdict.notify).toBe(true)
  })
})

describe('notifyOperator Slack routing (Kensaurus Bot channels, 2026-11-17)', () => {
  const slackCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://hooks.slack.com/'))

  it('sends payments to #payments and alerts to #alerts, falling back to the single operator webhook', async () => {
    envVars.SLACK_PAYMENTS_WEBHOOK_URL = 'https://hooks.slack.com/services/payments'
    envVars.OPERATOR_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/operator'
    await notifyOperator({ level: 'info', title: 'New paid customer', body: 'b', category: 'payments' })
    await notifyOperator({ level: 'urgent', title: 'Down', body: 'b', category: 'alerts' })
    expect(slackCalls().map(([url]) => url)).toEqual(['https://hooks.slack.com/services/payments', 'https://hooks.slack.com/services/operator'])
  })

  it('starts every Slack message with the app name and puts the facts on one line', async () => {
    envVars.SLACK_PAYMENTS_WEBHOOK_URL = 'https://hooks.slack.com/services/payments'
    await notifyOperator({ level: 'info', title: 'New paid customer', body: 'a***@acme.com paid for Pro.', category: 'payments', fields: [{ label: 'Plan', value: 'Pro' }] })
    const body = JSON.parse(String(slackCalls()[0]![1]!.body))
    expect(body.text).toBe('Mushi Mushi · 💳 New paid customer')
    expect(JSON.stringify(body)).toContain('*Plan:* Pro')
  })

  it('sends Slack the personal-data-free version when one is given', async () => {
    envVars.SLACK_ALERTS_WEBHOOK_URL = 'https://hooks.slack.com/services/alerts'
    envVars.OPERATOR_DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/x'
    await notifyOperator({
      level: 'urgent',
      title: 'Support ticket',
      body: 'from someone@example.com: my card was charged twice',
      fields: [{ label: 'From', value: 'someone@example.com' }],
      category: 'alerts',
      slack: { body: 'A paying customer opened a support ticket about *billing*.' },
    })
    const slack = String(slackCalls()[0]![1]!.body)
    expect(slack).not.toContain('example.com')
    expect(slack).not.toContain('charged twice')
    const discord = String(fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://discord.com/'))![1]!.body)
    expect(discord).toContain('charged twice')
  })
})
