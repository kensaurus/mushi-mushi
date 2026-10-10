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
