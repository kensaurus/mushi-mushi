/**
 * Mushi report c633b22c: the Datadog adapter had no tests. The fixture is a
 * monitor alert rendered through the webhook template the adapter documents
 * ($ID, $ALERT_ID, $EVENT_TITLE, $EVENT_MSG, $LINK, $PRIORITY, $ALERT_STATUS,
 * $ALERT_TYPE, $TAGS; https://docs.datadoghq.com/integrations/webhooks/).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDatadogWebhookHandler } from '../datadog.js'
import { makeSink } from './shared-hmac-fixtures.js'

const rawBody = readFileSync(new URL('./fixtures/datadog-monitor-alert.json', import.meta.url), 'utf8')
const SECRET = 'dd-shared-secret-7f3a'

describe('Datadog webhook → Mushi report', () => {
  it('turns a monitor alert into the report it should file', async () => {
    const { sink, calls } = makeSink()
    const handler = createDatadogWebhookHandler({ sink, secret: SECRET })
    const res = await handler({ headers: { 'X-Datadog-Secret-Token': SECRET }, rawBody })
    expect(res).toEqual({ status: 200, body: { ok: true, reportId: 'rpt_test_id' } })
    expect(calls).toEqual([{
      description: '[Triggered on {service:checkout-api}] Error rate above 5% on checkout-api',
      category: 'bug',
      severity: 'high',
      component: 'checkout-api',
      source: 'datadog',
      tags: { env: 'prod', service: 'checkout-api', team: 'payments' },
      metadata: {
        alertId: '142683914',
        status: 'Triggered',
        link: 'https://app.datadoghq.com/monitors/142683914?group=service%3Acheckout-api',
        body: expect.stringContaining('Error rate is 7.82%'),
      },
    }])
  })

  it('files nothing without the shared secret', async () => {
    const { sink, calls } = makeSink()
    const handler = createDatadogWebhookHandler({ sink, secret: SECRET })
    const res = await handler({ headers: { 'X-Datadog-Secret-Token': 'wrong' }, rawBody })
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})
