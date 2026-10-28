/**
 * Mushi report c633b22c: the Grafana / Loki adapter had no tests. The
 * fixture is Grafana Alerting's default webhook contact point payload
 * (receiver, status, alerts[], commonLabels, externalURL, …) for a Loki
 * log-count alert rule.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createGrafanaLokiWebhookHandler } from '../grafana-loki.js'
import { makeSink } from './shared-hmac-fixtures.js'

const rawBody = readFileSync(new URL('./fixtures/grafana-alert.json', import.meta.url), 'utf8')
const TOKEN = 'grafana-contact-point-token-3b8'

describe('Grafana alert webhook → Mushi report', () => {
  it('turns a firing Loki alert into the report it should file', async () => {
    const { sink, calls } = makeSink()
    const handler = createGrafanaLokiWebhookHandler({ sink, token: TOKEN })
    const res = await handler({ headers: { 'X-Grafana-Token': TOKEN }, rawBody })
    expect(res).toEqual({ status: 200, body: { ok: true, reportId: 'rpt_test_id' } })
    expect(calls).toEqual([{
      description: 'checkout-api logged 142 errors in 5m',
      category: 'bug',
      severity: 'critical',
      component: 'checkout-api',
      source: 'grafana-loki',
      tags: { alertname: 'CheckoutErrorLogs', service: 'checkout-api', severity: 'critical' },
      metadata: {
        externalURL: 'https://grafana.example.com/',
        generatorURL: 'https://grafana.example.com/alerting/grafana/c7a1d2/view',
        commonLabels: { alertname: 'CheckoutErrorLogs', service: 'checkout-api', severity: 'critical' },
        annotations: expect.objectContaining({ summary: 'checkout-api logged 142 errors in 5m' }),
        firingCount: 1,
      },
    }])
  })

  it('files nothing without the contact point token', async () => {
    const { sink, calls } = makeSink()
    const handler = createGrafanaLokiWebhookHandler({ sink, token: TOKEN })
    const res = await handler({ headers: {}, rawBody })
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})
