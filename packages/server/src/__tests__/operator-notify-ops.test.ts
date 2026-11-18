/**
 * Operator notices go to the Ops hub first (2026-11-18) when MUSHI_OPS_KEY is set, so the
 * team's Slack bot posts them with threads and buttons. The Slack webhook is the fallback when
 * there is no key or the hub refuses or times out. The hub refuses email addresses (422), so
 * the masked `ab…@acme.com` becomes `@acme.com` on that path.
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

import { notifyOperator, opsEventFor } from '../../supabase/functions/_shared/operator-notify.ts'

let envVars: Record<string, string> = {}
const fetchMock = vi.fn()
const SLACK = 'https://hooks.slack.com/services/T0/B0/x'
const OPS = 'https://proj.supabase.co/functions/v1/api/v1/ops/events'

beforeEach(() => {
  envVars = { SUPABASE_URL: 'https://proj.supabase.co', SLACK_PAYMENTS_WEBHOOK_URL: SLACK }
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => envVars[k] } }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const failed = {
  category: 'payments' as const,
  level: 'urgent' as const,
  title: 'Payment failed',
  body: 'ab…@acme.com could not pay the Pro invoice.',
  fields: [{ label: 'Customer', value: 'ab…@acme.com' }, { label: 'Attempt', value: '2' }],
  url: 'https://dashboard.stripe.com/invoices/in_1',
  kind: 'payment.failed',
  dedupeKey: 'stripe:in_1:failed:2',
  threadKey: 'invoice:in_1',
}

describe('opsEventFor', () => {
  it('maps a notice to an Ops event: category, severity, kind, keys, and no email address', () => {
    const e = opsEventFor(failed)
    expect(e).toMatchObject({ category: 'payments', severity: 'urgent', kind: 'payment.failed', title: 'Payment failed', thread_key: 'invoice:in_1', dedupe_key: 'stripe:in_1:failed:2', url: failed.url })
    expect(JSON.stringify(e)).not.toMatch(/[^\s@"]+@acme\.com/)
    expect(e.body).toBe('@acme.com could not pay the Pro invoice.')
    expect(e.facts).toEqual([{ label: 'Customer', value: '@acme.com' }, { label: 'Attempt', value: '2' }])
  })

  it('uses the Slack-safe text, a default kind, and money only with a valid currency', () => {
    const e = opsEventFor({ category: 'alerts', level: 'warn', title: 'Ticket', body: 'full text with a name', slack: { body: 'A paid customer opened a ticket.' }, kind: 'Not A Kind!', amountMinor: 500, currency: 'yen' })
    expect(e.body).toBe('A paid customer opened a ticket.')
    expect(e.kind).toBe('alerts.notice')
    expect(e).not.toHaveProperty('amount_minor')
    expect(opsEventFor({ ...failed, amountMinor: 1200, currency: 'JPY' })).toMatchObject({ amount_minor: 1200, currency: 'JPY' })
  })
})

describe('notifyOperator with the Ops hub', () => {
  it('sends to the hub and skips the webhook when the hub takes it', async () => {
    envVars.MUSHI_OPS_KEY = 'mushi_' + '0'.repeat(32)
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 202 }))
    expect(await notifyOperator(failed)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(OPS)
    expect((init.headers as Record<string, string>)['X-Mushi-Api-Key']).toBe(envVars.MUSHI_OPS_KEY)
  })

  it('falls back to the Slack webhook when the hub refuses', async () => {
    envVars.MUSHI_OPS_KEY = 'mushi_' + '0'.repeat(32)
    fetchMock.mockResolvedValueOnce(new Response('{"ok":false}', { status: 422 })).mockResolvedValue(new Response('ok', { status: 200 }))
    expect(await notifyOperator(failed)).toBe(1)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([OPS, SLACK])
  })

  it('without a key, posts to the webhook only, as before', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    expect(await notifyOperator(failed)).toBe(1)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([SLACK])
  })
})
