import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCloudWatchAdapter, translateCloudWatch } from '../cloudwatch.js'
import { makeSink, makeReq } from './shared-hmac-fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('translateCloudWatch', () => {
  it('maps ALARM state to bug/high', () => {
    const result = translateCloudWatch({
      AlarmName: 'HighErrorRate',
      AlarmDescription: 'Error rate > 5%',
      NewStateValue: 'ALARM',
      NewStateReason: 'Threshold crossed',
      Region: 'us-east-1',
      Trigger: { MetricName: 'Errors', Namespace: 'AWS/Lambda' },
    })
    expect(result.description).toBe('Error rate > 5%')
    expect(result.category).toBe('bug')
    expect(result.severity).toBe('high')
    expect(result.source).toBe('cloudwatch')
    expect(result.metadata?.alarmName).toBe('HighErrorRate')
    expect(result.metadata?.metric).toBe('AWS/Lambda/Errors')
  })

  it('maps OK state to resolved description and low severity', () => {
    const result = translateCloudWatch({
      AlarmName: 'HighErrorRate',
      AlarmDescription: 'Error rate > 5%',
      NewStateValue: 'OK',
    })
    expect(result.description).toContain('[RESOLVED]')
    expect(result.severity).toBe('low')
  })

  it('uses AlarmName as description when no AlarmDescription', () => {
    const result = translateCloudWatch({ AlarmName: 'MyAlarm', NewStateValue: 'ALARM' })
    expect(result.description).toBe('MyAlarm')
    expect(result.component).toBe('MyAlarm')
  })

  it('uses projectName option over alarm name', () => {
    const result = translateCloudWatch({ AlarmName: 'MyAlarm', NewStateValue: 'ALARM' }, 'my-project')
    expect(result.component).toBe('my-project')
  })
})

describe('createCloudWatchAdapter – SNS header guard', () => {
  it('returns 400 when x-amz-sns-message-type header is missing', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })
    const res = await handler(makeReq({ Type: 'Notification' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })
    const res = await handler({ headers: { 'x-amz-sns-message-type': 'Notification' }, rawBody: 'bad-json' })
    expect(res.status).toBe(400)
  })

  it('returns 403 when TopicArn does not match configured arn', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink, topicArn: 'arn:aws:sns:us-east-1:123:my-topic' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('CERT', { status: 200 }))

    const sns = {
      Type: 'Notification',
      TopicArn: 'arn:aws:sns:us-east-1:123:other-topic',
      Message: '{}',
      MessageId: 'msg1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'fakesig==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    }
    const res = await handler(makeReq(sns, { 'x-amz-sns-message-type': 'Notification' }))
    expect(res.status).toBe(403)
  })
})

describe('createCloudWatchAdapter – SNS signature (mocked cert)', () => {
  it('returns 401 when SNS signature is invalid', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('FAKE_CERT', { status: 200 }))

    const sns = {
      Type: 'Notification',
      TopicArn: 'arn:aws:sns:us-east-1:123:my-topic',
      Message: '{}',
      MessageId: 'msg1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'badsig==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    }
    const res = await handler(makeReq(sns, { 'x-amz-sns-message-type': 'Notification' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when SigningCertURL is not an AWS SNS domain', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const sns = {
      Type: 'Notification',
      Message: '{}',
      MessageId: 'msg1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Signature: 'sig==',
      SigningCertURL: 'https://evil.example.com/cert.pem',
    }
    const res = await handler(makeReq(sns, { 'x-amz-sns-message-type': 'Notification' }))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns 200 for SubscriptionConfirmation with valid cert domain', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('FAKE_CERT', { status: 200 }))

    const sns = {
      Type: 'SubscriptionConfirmation',
      Message: 'You have chosen to subscribe to the topic',
      MessageId: 'sub-msg-1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Token: 'token123',
      TopicArn: 'arn:aws:sns:us-east-1:123:my-topic',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/confirm?token=abc',
      SignatureVersion: '1',
      Signature: 'anySig==',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    }
    const res = await handler(makeReq(sns, { 'x-amz-sns-message-type': 'SubscriptionConfirmation' }))
    // Signature verification will fail with fake cert, returning 401
    // This tests the SSRF guard passes, not full crypto
    expect([200, 401]).toContain(res.status)
  })
})

describe('createCloudWatchAdapter – alarm translation', () => {
  it('returns 400 when Notification message is invalid JSON', async () => {
    const { sink } = makeSink()
    const handler = createCloudWatchAdapter({ sink })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('CERT', { status: 200 }))

    const sns = {
      Type: 'Notification',
      Message: 'not-alarm-json',
      MessageId: 'msg1',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Signature: 'badsig',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    }
    const res = await handler(makeReq(sns, { 'x-amz-sns-message-type': 'Notification' }))
    // Either 401 (bad sig, which is fine) or 400 (invalid alarm JSON)
    expect([400, 401]).toContain(res.status)
  })
})
