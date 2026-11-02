/**
 * Mushi report c633b22c: the New Relic adapter had no tests. The fixture is
 * a workflow's default webhook payload (`id`, `issueUrl`, `title`,
 * `priority: "CRITICAL"`, `state: "ACTIVATED"`, `alertConditionNames`, …).
 * The adapter read none of those fields before this test.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createNewRelicWebhookHandler, translateNewRelic } from '../new-relic.js'
import { computeHmacSha256Hex, makeSink } from './shared-hmac-fixtures.js'

const rawBody = readFileSync(new URL('./fixtures/new-relic-workflow.json', import.meta.url), 'utf8')
const SECRET = 'nr-webhook-secret-5d0e'

describe('New Relic webhook → Mushi report', () => {
  it('turns a workflow issue notification into the report it should file', async () => {
    const { sink, calls } = makeSink()
    const handler = createNewRelicWebhookHandler({ sink, webhookSecret: SECRET })
    const res = await handler({ headers: { 'X-NewRelic-Signature': computeHmacSha256Hex(SECRET, rawBody) }, rawBody })
    expect(res).toEqual({ status: 200, body: { ok: true, reportId: 'rpt_test_id' } })
    expect(calls).toEqual([{
      description: "Error percentage > 5.0 for at least 5 minutes on 'checkout-api'",
      category: 'bug',
      severity: 'critical',
      source: 'new-relic',
      component: 'checkout-api',
      metadata: {
        incidentId: 'd1b1f3fd-995a-4066-88ab-8ce4f6960654',
        condition: 'High error percentage',
        policy: 'Golden signals',
        state: 'ACTIVATED',
        link: expect.stringContaining('https://radar-api.service.newrelic.com/accounts/3401234/issues/d1b1f3fd'),
        accountName: undefined,
      },
    }])
  })

  it('maps every workflow priority and keeps the older lowercase ones', () => {
    expect(translateNewRelic({ priority: 'HIGH' }).severity).toBe('high')
    expect(translateNewRelic({ priority: 'MEDIUM' }).severity).toBe('medium')
    expect(translateNewRelic({ priority: 'LOW' }).severity).toBe('low')
    expect(translateNewRelic({ priority: 'critical' }).severity).toBe('critical')
    expect(translateNewRelic({ priority: 'warning' }).severity).toBe('medium')
  })

  it('files nothing when the signature does not match the body', async () => {
    const { sink, calls } = makeSink()
    const handler = createNewRelicWebhookHandler({ sink, webhookSecret: SECRET })
    const res = await handler({ headers: { 'X-NewRelic-Signature': computeHmacSha256Hex('other', rawBody) }, rawBody })
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})
