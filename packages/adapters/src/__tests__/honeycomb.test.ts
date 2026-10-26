/**
 * Mushi report c633b22c: the Honeycomb adapter had no tests. The fixture is
 * Honeycomb's default trigger webhook body (version v0.1.0: `id`, `summary`,
 * `result_url`, `result_groups_triggered`, …), which names the trigger `id`,
 * not `trigger_id`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createHoneycombWebhookHandler } from '../honeycomb.js'
import { computeHmacSha256Hex, makeSink } from './shared-hmac-fixtures.js'

const rawBody = readFileSync(new URL('./fixtures/honeycomb-trigger.json', import.meta.url), 'utf8')
const SECRET = 'hny-trigger-secret-91c2'

describe('Honeycomb webhook → Mushi report', () => {
  it('turns a fired trigger into the report it should file', async () => {
    const { sink, calls } = makeSink()
    const handler = createHoneycombWebhookHandler({ sink, webhookSecret: SECRET })
    const signature = `sha256=${computeHmacSha256Hex(SECRET, rawBody)}`
    const res = await handler({ headers: { 'X-Honeycomb-Signature': signature }, rawBody })
    expect(res).toEqual({ status: 200, body: { ok: true, reportId: 'rpt_test_id' } })
    expect(calls).toEqual([{
      description: 'Triggered: Slow checkout requests',
      category: 'slow',
      severity: undefined,
      source: 'honeycomb',
      metadata: {
        triggerId: 'mH9UsEVi4W2',
        status: 'TRIGGERED',
        link: expect.stringContaining('https://ui.honeycomb.io/acme/environments/production/datasets/checkout-api/result/'),
        groups: [{ Group: { 'http.route': '/api/checkout' }, Result: 1873.4 }],
      },
    }])
  })

  it('files nothing when the signature does not match the body', async () => {
    const { sink, calls } = makeSink()
    const handler = createHoneycombWebhookHandler({ sink, webhookSecret: SECRET })
    const signature = computeHmacSha256Hex(SECRET, rawBody.replace('1500', '1'))
    const res = await handler({ headers: { 'X-Honeycomb-Signature': signature }, rawBody })
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})
