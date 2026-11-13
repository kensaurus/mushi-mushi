/**
 * FILE: cloudwatch-webhook.test.ts
 * PURPOSE: The webhooks-cloudwatch flow end to end on an in-memory database
 *          (ADR 0061): the SNS subscription handshake, and CloudWatch alarm
 *          state changes becoming one deduped report per alarm. Messages are
 *          signed with a key and certificate generated in this run.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase'
import { makeTestSigner, snsSign } from './fixtures/sns-test-cert'

const verify = await import('../../supabase/functions/_shared/sns-verify.ts')
const ingest = await import('../../supabase/functions/_shared/cloudwatch-ingest.ts')
const { handleCloudWatchWebhook } = await import('../../supabase/functions/_shared/cloudwatch-webhook.ts')

const TOPIC = 'arn:aws:sns:us-east-1:590715976857:kensaurus-account-alerts'
const PROJECT = '84f3eba2-058f-48c9-97a1-43d20561e118'
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem'
const ALARM_ARN = 'arn:aws:cloudwatch:us-east-1:590715976857:alarm:kensaurus-e246-5xx-rate'
const signer = makeTestSigner()

let seq = 0
function signed(fields: Record<string, unknown>): string {
  const m: Record<string, unknown> = {
    MessageId: `msg-${++seq}`,
    TopicArn: TOPIC,
    Timestamp: '2026-11-13T10:00:00.000Z',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    Signature: '',
    ...fields,
  }
  m.Signature = snsSign(signer.privateKey, verify.snsStringToSign(verify.parseSnsBody(JSON.stringify(m))!)!, m.SignatureVersion as '2')
  return JSON.stringify(m)
}

function alarmMessage(state: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA', changedAt: string, over: Record<string, unknown> = {}): string {
  return signed({
    Type: 'Notification',
    Subject: `${state}: "kensaurus-e246-5xx-rate" in US East (N. Virginia)`,
    Timestamp: changedAt.replace('+0000', 'Z').replace(/\.\d{3}Z$/, '.000Z'),
    Message: JSON.stringify({
      AlarmName: 'kensaurus-e246-5xx-rate',
      AlarmDescription: 'kensaur.us CloudFront 5xxErrorRate above 1%',
      AWSAccountId: '590715976857',
      AlarmArn: ALARM_ARN,
      NewStateValue: state,
      OldStateValue: state === 'ALARM' ? 'OK' : 'ALARM',
      NewStateReason: 'Threshold Crossed: 2 out of the last 3 datapoints were greater than the threshold (1.0).',
      StateChangeTime: changedAt,
      Region: 'US East (N. Virginia)',
      Trigger: {
        MetricName: '5xxErrorRate',
        Namespace: 'AWS/CloudFront',
        Statistic: 'AVERAGE',
        Dimensions: [{ name: 'DistributionId', value: 'E246VQ1C9QYZVB' }, { name: 'Region', value: 'Global' }],
        Period: 300,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 1,
      },
      ...over,
    }),
  })
}

interface Harness {
  db: FakeDb
  fetch: ReturnType<typeof vi.fn>
  classify: ReturnType<typeof vi.fn>
  audits: Array<{ outcome: string; status: number; project?: string; messageId: string | null }>
  accepted: Set<string>
  post: (body: string, nowIso?: string) => Promise<{ status: number; body: Record<string, unknown> }>
}

function harness(seed: Record<string, Array<Record<string, unknown>>> = {}): Harness {
  const db = makeFakeDb(
    { project_settings: [{ project_id: PROJECT, cloudwatch_sns_topic_arn: TOPIC }], cloudwatch_alarms: [], reports: [], ...seed },
    { uniques: { cloudwatch_alarms: ['project_id', 'alarm_key'] }, autoId: true },
  )
  const fetch = vi.fn(async () => new Response('<ConfirmSubscriptionResponse/>', { status: 200 }))
  const classify = vi.fn()
  const audits: Harness['audits'] = []
  const accepted = new Set<string>()
  const h: Harness = {
    db,
    fetch,
    classify,
    audits,
    accepted,
    post: async (body, nowIso = '2026-11-13T10:00:30.000Z') => {
      const res = await handleCloudWatchWebhook(
        new Request('https://x.supabase.co/functions/v1/webhooks-cloudwatch', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'x-amz-sns-message-type': 'Notification' },
          body,
        }),
        {
          db: db as never,
          audit: async (_raw, messageId) => {
            const row: Harness['audits'][number] = { outcome: 'pending', status: 0, messageId }
            audits.push(row)
            return {
              id: `audit-${audits.length}`,
              resolve: async (outcome, status) => {
                row.outcome = outcome
                row.status = status
                if (outcome === 'accepted' && messageId) accepted.add(messageId)
              },
              setProject: async (p) => {
                row.project = p
              },
            }
          },
          rateLimit: () => null,
          hasAcceptedDuplicate: async (_id, key) => accepted.has(key.deliveryId),
          fetchCertPem: async () => signer.certPem,
          fetch: fetch as never,
          now: () => new Date(nowIso),
          classify,
        },
      )
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    },
  }
  return h
}

const T1 = '2026-11-13T10:00:00.000+0000'
const T2 = '2026-11-13T10:10:00.000+0000'
const T3 = '2026-11-13T10:20:00.000+0000'
const at = (t: string) => t.replace('.000+0000', '.000Z').replace(/T(\d\d):(\d\d)/, (_m, h, mm) => `T${h}:${mm}`)
const soon = (t: string) => new Date(Date.parse(at(t)) + 30_000).toISOString()

describe('subscription handshake', () => {
  it('confirms a signed SubscriptionConfirmation by GETting its SubscribeURL', async () => {
    const h = harness()
    const subscribeUrl = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}&Token=tok`
    const res = await h.post(signed({ Type: 'SubscriptionConfirmation', Message: 'confirm', SubscribeURL: subscribeUrl, Token: 'tok' }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, data: { action: 'subscription_confirmed' } })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.fetch.mock.calls[0][0]).toBe(subscribeUrl)
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(h.audits[0]).toMatchObject({ outcome: 'accepted', status: 200, project: PROJECT })
  })

  it('never GETs a SubscribeURL off the SNS host, even when the message is signed', async () => {
    const h = harness()
    const res = await h.post(
      signed({ Type: 'SubscriptionConfirmation', Message: 'confirm', SubscribeURL: `https://evil.example/?Action=ConfirmSubscription&TopicArn=${TOPIC}`, Token: 'tok' }),
    )
    expect(res.status).toBe(403)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('answers 502 when AWS refuses the confirmation', async () => {
    const h = harness()
    h.fetch.mockResolvedValueOnce(new Response('denied', { status: 403 }))
    const res = await h.post(
      signed({ Type: 'SubscriptionConfirmation', Message: 'confirm', SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}&Token=t`, Token: 't' }),
    )
    expect(res.status).toBe(502)
    expect(h.audits[0].outcome).toBe('error')
  })

  it('records an UnsubscribeConfirmation without acting on it', async () => {
    const h = harness()
    const res = await h.post(
      signed({ Type: 'UnsubscribeConfirmation', Message: 'bye', SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}&Token=t`, Token: 't' }),
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ data: { action: 'unsubscribe_recorded' } })
    expect(h.fetch).not.toHaveBeenCalled()
  })
})

describe('rejections', () => {
  it('401s a tampered notification and files nothing', async () => {
    const h = harness()
    const body = JSON.parse(alarmMessage('ALARM', T1)) as Record<string, unknown>
    body.Message = String(body.Message).replace('kensaurus-e246-5xx-rate', 'kensaurus-forged')
    const res = await h.post(JSON.stringify(body), soon(T1))
    expect(res.status).toBe(401)
    expect(h.db.tables.reports).toHaveLength(0)
    expect(h.audits[0].outcome).toBe('rejected_signature')
  })

  it('403s a topic no project is bound to', async () => {
    const h = harness({ project_settings: [{ project_id: PROJECT, cloudwatch_sns_topic_arn: null }] })
    const res = await h.post(alarmMessage('ALARM', T1), soon(T1))
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: 'UNKNOWN_TOPIC' })
  })

  it('400s a body that is not SNS, whatever the content type', async () => {
    const h = harness()
    expect((await h.post('hello')).status).toBe(400)
  })

  it('answers 200 to a MessageId it already accepted, so SNS stops retrying, and applies it once', async () => {
    const h = harness()
    const body = alarmMessage('ALARM', T1)
    expect((await h.post(body, soon(T1))).body).toMatchObject({ data: { action: 'created' } })
    const again = await h.post(body, soon(T1))
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ data: { action: 'duplicate' } })
    expect(h.db.tables.reports).toHaveLength(1)
  })
})

describe('alarm state changes', () => {
  it('ALARM files one high-severity cloudwatch report and queues classification', async () => {
    const h = harness()
    const res = await h.post(alarmMessage('ALARM', T1), soon(T1))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, data: { action: 'created' } })
    const [report] = h.db.tables.reports
    expect(report).toMatchObject({ project_id: PROJECT, source: 'cloudwatch', severity: 'high', status: 'new', category: 'bug' })
    expect(String(report.title)).toBe('AWS alarm: kensaurus-e246-5xx-rate is in ALARM')
    expect(String(report.description)).toContain('AWS/CloudFront/5xxErrorRate [DistributionId=E246VQ1C9QYZVB, Region=Global]')
    expect(String(report.description)).toContain('(2 of 3 × 300 s)')
    expect(report.custom_metadata).toMatchObject({ alarmArn: ALARM_ARN, region: 'us-east-1', topicArn: TOPIC })
    expect(h.db.tables.cloudwatch_alarms[0]).toMatchObject({ alarm_key: ALARM_ARN, state: 'ALARM', report_id: report.id, alarm_count: 1 })
    expect(h.classify).toHaveBeenCalledWith(report.id, PROJECT)
  })

  it('a flapping alarm dedupes onto its open report', async () => {
    const h = harness()
    await h.post(alarmMessage('ALARM', T1), soon(T1))
    const ok = await h.post(alarmMessage('OK', T2), soon(T2))
    expect(ok.body).toMatchObject({ data: { action: 'annotated' } })
    const again = await h.post(alarmMessage('ALARM', T3), soon(T3))
    expect(again.body).toMatchObject({ data: { action: 'deduped' } })
    expect(h.db.tables.reports).toHaveLength(1)
    expect(h.classify).toHaveBeenCalledTimes(1)
    expect(h.db.tables.cloudwatch_alarms[0]).toMatchObject({ alarm_count: 2, ok_count: 1, state: 'ALARM' })
    expect((h.db.tables.reports[0].custom_metadata as Record<string, unknown>).cloudwatch).toMatchObject({ state: 'ALARM', alarmCount: 2, okCount: 1 })
  })

  it('OK annotates the report and leaves it open for a person', async () => {
    const h = harness()
    await h.post(alarmMessage('ALARM', T1), soon(T1))
    await h.post(alarmMessage('OK', T2), soon(T2))
    const [report] = h.db.tables.reports
    expect(report.status).toBe('new')
    expect((report.custom_metadata as Record<string, unknown>).cloudwatch).toMatchObject({ state: 'OK', lastOkAt: '2026-11-13T10:10:00.000Z' })
  })

  it('ALARM after the report was fixed reopens it and counts the regression', async () => {
    const h = harness()
    await h.post(alarmMessage('ALARM', T1), soon(T1))
    h.db.tables.reports[0].status = 'fixed'
    const res = await h.post(alarmMessage('ALARM', T3), soon(T3))
    expect(res.body).toMatchObject({ data: { action: 'reopened' } })
    expect(h.db.tables.reports).toHaveLength(1)
    expect(h.db.tables.reports[0]).toMatchObject({ status: 'reopened', regression_count: 1 })
  })

  it('drops a transition older than the last one applied (SNS order is not guaranteed)', async () => {
    const h = harness()
    await h.post(alarmMessage('ALARM', T1), soon(T1))
    await h.post(alarmMessage('OK', T3), soon(T3))
    const late = await h.post(alarmMessage('ALARM', T2), soon(T2))
    expect(late.body).toMatchObject({ data: { action: 'stale' } })
    expect(h.db.tables.cloudwatch_alarms[0]).toMatchObject({ state: 'OK', alarm_count: 1 })
  })

  it('an OK that arrives before any ALARM files nothing, and a later ALARM still files', async () => {
    const h = harness()
    const ok = await h.post(alarmMessage('OK', T1), soon(T1))
    expect(ok.body).toMatchObject({ data: { action: 'recorded' } })
    expect(h.db.tables.reports).toHaveLength(0)
    const alarm = await h.post(alarmMessage('ALARM', T2), soon(T2))
    expect(alarm.body).toMatchObject({ data: { action: 'created' } })
    expect(h.db.tables.cloudwatch_alarms).toHaveLength(1)
    expect(h.db.tables.cloudwatch_alarms[0].report_id).toBe(h.db.tables.reports[0].id)
  })

  it('INSUFFICIENT_DATA records the state only', async () => {
    const h = harness()
    const res = await h.post(alarmMessage('INSUFFICIENT_DATA', T1), soon(T1))
    expect(res.body).toMatchObject({ data: { action: 'recorded' } })
    expect(h.db.tables.reports).toHaveLength(0)
  })

  it('files another alarm on the same topic as its own report', async () => {
    const h = harness()
    await h.post(alarmMessage('ALARM', T1), soon(T1))
    await h.post(
      alarmMessage('ALARM', T1, {
        AlarmName: 'kensaurus-e246-lambda-limit-exceeded',
        AlarmArn: 'arn:aws:cloudwatch:us-east-1:590715976857:alarm:kensaurus-e246-lambda-limit-exceeded',
      }),
      soon(T1),
    )
    expect(h.db.tables.reports).toHaveLength(2)
    expect(h.db.tables.cloudwatch_alarms).toHaveLength(2)
  })

  it('answers 200 "ignored" to a signed message that is not a CloudWatch alarm', async () => {
    const h = harness()
    const res = await h.post(signed({ Type: 'Notification', Message: 'AWS Budget Notification: you are at 80% of kensaurus-monthly' }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ data: { action: 'ignored', reason: 'not_a_cloudwatch_alarm' } })
    expect(h.db.tables.reports).toHaveLength(0)
  })
})

describe('parseCloudWatchAlarm', () => {
  it('needs an AlarmName and a known state', () => {
    expect(ingest.parseCloudWatchAlarm('{"AlarmName":"a","NewStateValue":"ALARM"}')).not.toBeNull()
    expect(ingest.parseCloudWatchAlarm('{"AlarmName":"a","NewStateValue":"PANIC"}')).toBeNull()
    expect(ingest.parseCloudWatchAlarm('{"NewStateValue":"ALARM"}')).toBeNull()
    expect(ingest.parseCloudWatchAlarm('plain text')).toBeNull()
    expect(ingest.parseCloudWatchAlarm('[1]')).toBeNull()
  })

  it('keys an alarm without an ARN by account and name', () => {
    expect(ingest.alarmKey({ AlarmName: 'x', NewStateValue: 'OK', AWSAccountId: '590715976857' })).toBe('590715976857:x')
  })
})
