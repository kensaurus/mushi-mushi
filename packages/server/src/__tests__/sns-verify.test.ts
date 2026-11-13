/**
 * FILE: sns-verify.test.ts
 * PURPOSE: Pin the Amazon SNS signature check behind webhooks-cloudwatch
 *          (ADR 0061). The canonical strings are pinned to the AWS docs'
 *          own examples, so a builder bug cannot hide behind a round trip
 *          that signs and verifies with the same builder. Signatures are made
 *          with a key and X.509 certificate generated in this run.
 */
import { describe, expect, it, vi } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { makeTestSigner, snsSign } from './fixtures/sns-test-cert'

const mod = await import('../../supabase/functions/_shared/sns-verify.ts')

const TOPIC = 'arn:aws:sns:us-east-1:590715976857:kensaurus-account-alerts'
const PROJECT = '84f3eba2-058f-48c9-97a1-43d20561e118'
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem'
const NOW = Date.parse('2026-11-13T10:00:30.000Z')
const signer = makeTestSigner()

function notification(over: Record<string, unknown> = {}, version: '1' | '2' = '1'): Record<string, unknown> {
  const m: Record<string, unknown> = {
    Type: 'Notification',
    MessageId: '22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324',
    TopicArn: TOPIC,
    Subject: 'ALARM: "kensaurus-e246-5xx-rate" in US East (N. Virginia)',
    Message: JSON.stringify({ AlarmName: 'kensaurus-e246-5xx-rate', NewStateValue: 'ALARM' }),
    Timestamp: '2026-11-13T10:00:00.000Z',
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    Signature: '',
    UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=x',
    ...over,
  }
  const env = mod.parseSnsBody(JSON.stringify(m))!
  m.Signature = snsSign(signer.privateKey, mod.snsStringToSign(env)!, version)
  return m
}

function confirmation(over: Record<string, unknown> = {}): Record<string, unknown> {
  const m: Record<string, unknown> = {
    Type: 'SubscriptionConfirmation',
    MessageId: '165545c9-2a5c-472c-8df2-7ff2be2b3b1b',
    Token: 'test-subscription-token-not-a-secret',
    TopicArn: TOPIC,
    Message: `You have chosen to subscribe to the topic ${TOPIC}.\nTo confirm the subscription, visit the SubscribeURL included in this message.`,
    SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}&Token=test-subscription-token-not-a-secret`,
    Timestamp: '2026-11-13T10:00:00.000Z',
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
    Signature: '',
    ...over,
  }
  const env = mod.parseSnsBody(JSON.stringify(m))!
  m.Signature = snsSign(signer.privateKey, mod.snsStringToSign(env)!, m.SignatureVersion as '1' | '2')
  return m
}

function deps(over: Partial<Parameters<typeof mod.verifySnsDelivery>[1]> = {}) {
  return {
    projectForTopic: vi.fn(async (arn: string) => (arn === TOPIC ? PROJECT : null)),
    fetchCertPem: vi.fn(async () => signer.certPem),
    isReplay: vi.fn(async () => false),
    ...over,
  }
}

const verify = (body: unknown, d = deps(), nowMs = NOW) =>
  mod.verifySnsDelivery({ body: typeof body === 'string' ? body : JSON.stringify(body), nowMs }, d)

describe('snsStringToSign (AWS docs examples, verbatim)', () => {
  it('Notification: Message, MessageId, Subject, Timestamp, TopicArn, Type, one trailing newline', () => {
    const s = mod.snsStringToSign({
      Type: 'Notification',
      Message: 'My Test Message',
      MessageId: '4d4dc071-ddbf-465d-bba8-08f81c89da64',
      Subject: 'My subject',
      Timestamp: '2019-01-31T04:37:04.321Z',
      TopicArn: 'arn:aws:sns:us-east-2:123456789012:s4-MySNSTopic-1G1WEFCOXTC0P',
      SignatureVersion: '1',
      Signature: '',
      SigningCertURL: '',
    })
    expect(s).toBe(
      'Message\nMy Test Message\nMessageId\n4d4dc071-ddbf-465d-bba8-08f81c89da64\nSubject\nMy subject\n' +
        'Timestamp\n2019-01-31T04:37:04.321Z\nTopicArn\narn:aws:sns:us-east-2:123456789012:s4-MySNSTopic-1G1WEFCOXTC0P\nType\nNotification\n',
    )
  })

  it('SubscriptionConfirmation: Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type', () => {
    const s = mod.snsStringToSign({
      Type: 'SubscriptionConfirmation',
      Message: 'Please confirm your subscription',
      MessageId: '3d891288-136d-417f-bc05-901c108273ee',
      SubscribeURL: 'https://sns.us-east-2.amazonaws.com/...',
      Timestamp: '2024-01-01T00:00:00.000Z',
      Token: 'abc123...',
      TopicArn: 'arn:aws:sns:us-east-2:123456789012:MyTopic',
      SignatureVersion: '2',
      Signature: '',
      SigningCertURL: '',
    })
    expect(s).toBe(
      'Message\nPlease confirm your subscription\nMessageId\n3d891288-136d-417f-bc05-901c108273ee\n' +
        'SubscribeURL\nhttps://sns.us-east-2.amazonaws.com/...\nTimestamp\n2024-01-01T00:00:00.000Z\n' +
        'Token\nabc123...\nTopicArn\narn:aws:sns:us-east-2:123456789012:MyTopic\nType\nSubscriptionConfirmation\n',
    )
  })

  it('leaves Subject out when it is absent or JSON null, and never signs UnsubscribeURL', () => {
    const body = notification({ Subject: null })
    const env = mod.parseSnsBody(JSON.stringify(body))!
    expect(env.Subject).toBeUndefined()
    const s = mod.snsStringToSign(env)!
    expect(s).not.toContain('Subject')
    expect(s).not.toContain('UnsubscribeURL')
    expect(s.startsWith('Message\n')).toBe(true)
    expect(s.endsWith('Type\nNotification\n')).toBe(true)
  })
})

describe('spkiFromCertificatePem', () => {
  it('reads the same public key that Node X509Certificate reads from the test cert', () => {
    const x = new X509Certificate(signer.certPem)
    const nodeSpki = x.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
    expect(Buffer.from(mod.spkiFromCertificatePem(signer.certPem)).equals(nodeSpki)).toBe(true)
    expect(nodeSpki.equals(signer.spkiDer)).toBe(true)
  })

  it('throws on something that is not a certificate', () => {
    expect(() => mod.spkiFromCertificatePem('<html>nope</html>')).toThrow()
  })
})

describe('verifySnsDelivery', () => {
  it('accepts a valid SignatureVersion 1 (SHA1) notification', async () => {
    const v = await verify(notification({}, '1'))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.projectId).toBe(PROJECT)
      expect(v.region).toBe('us-east-1')
      expect(v.message.Type).toBe('Notification')
    }
  })

  it('accepts a valid SignatureVersion 2 (SHA256) notification', async () => {
    expect((await verify(notification({}, '2'))).ok).toBe(true)
  })

  it('accepts a notification with no Subject', async () => {
    const m = notification({ Subject: undefined })
    expect((await verify(m)).ok).toBe(true)
  })

  it('rejects a tampered Message with 401 BAD_SIGNATURE', async () => {
    const m = notification()
    m.Message = JSON.stringify({ AlarmName: 'kensaurus-e246-5xx-rate', NewStateValue: 'OK' })
    const v = await verify(m)
    expect(v).toMatchObject({ ok: false, status: 401, code: 'BAD_SIGNATURE' })
  })

  it('rejects a v1-signed message relabelled as v2', async () => {
    const m = notification({}, '1')
    m.SignatureVersion = '2'
    expect(await verify(m)).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' })
  })

  it('rejects a message signed by a different key, even from the right host', async () => {
    const other = makeTestSigner()
    const v = await verify(notification(), deps({ fetchCertPem: vi.fn(async () => other.certPem) }))
    expect(v).toMatchObject({ ok: false, status: 401, code: 'BAD_SIGNATURE' })
  })

  it.each([
    'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-abc.pem',
    'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem',
    'https://sns.us-east-1.amazonaws.com.evil.example/SimpleNotificationService-abc.pem',
    'https://evil.example/sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem',
    'https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-abc.pem',
    'https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem',
    'https://sns.us-east-1.amazonaws.com/other.pem',
    'https://s3.amazonaws.com/SimpleNotificationService-abc.pem',
  ])('rejects cert URL %s with 403 and never fetches it', async (url) => {
    const d = deps()
    const v = await verify(notification({ SigningCertURL: url }), d)
    expect(v).toMatchObject({ ok: false, status: 403, code: 'UNTRUSTED_CERT_URL' })
    expect(d.fetchCertPem).not.toHaveBeenCalled()
  })

  it('rejects a TopicArn that is not bound to a project with 403, before any fetch', async () => {
    const d = deps()
    const v = await verify(notification({ TopicArn: 'arn:aws:sns:us-east-1:111111111111:someone-else' }), d)
    expect(v).toMatchObject({ ok: false, status: 403, code: 'UNKNOWN_TOPIC' })
    expect(d.fetchCertPem).not.toHaveBeenCalled()
  })

  it('rejects SignatureVersion 3', async () => {
    const m = notification()
    m.SignatureVersion = '3'
    expect(await verify(m)).toMatchObject({ ok: false, status: 401, code: 'BAD_SIGNATURE_VERSION' })
  })

  it('rejects a cert that cannot be fetched with 401, not a throw', async () => {
    const v = await verify(notification(), deps({ fetchCertPem: vi.fn(async () => { throw new Error('cert HTTP 404') }) }))
    expect(v).toMatchObject({ ok: false, status: 401, code: 'CERT_UNAVAILABLE' })
  })

  it('rejects a stale or future Timestamp', async () => {
    expect(await verify(notification(), deps(), Date.parse('2026-11-13T12:00:00.000Z'))).toMatchObject({ code: 'STALE' })
    expect(await verify(notification(), deps(), Date.parse('2026-11-13T09:40:00.000Z'))).toMatchObject({ code: 'STALE' })
  })

  it('reports an already-accepted MessageId as DUPLICATE', async () => {
    const v = await verify(notification(), deps({ isReplay: vi.fn(async () => true) }))
    expect(v).toMatchObject({ ok: false, status: 409, code: 'DUPLICATE', projectId: PROJECT })
  })

  it('rejects a body that is not an SNS envelope with 400', async () => {
    expect(await verify('not json')).toMatchObject({ ok: false, status: 400, code: 'NOT_SNS' })
    expect(await verify({ Type: 'Notification' })).toMatchObject({ code: 'NOT_SNS' })
    expect(await verify({ ...notification(), Type: 'Bogus' })).toMatchObject({ code: 'NOT_SNS' })
  })

  it('accepts a signed SubscriptionConfirmation and pins its SubscribeURL', async () => {
    const m = confirmation()
    const v = await verify(m)
    expect(v.ok).toBe(true)
    expect(mod.isTrustedSubscribeUrl(m.SubscribeURL as string, 'us-east-1', TOPIC)).toBe(true)
  })

  it('rejects a SubscriptionConfirmation whose Token was changed', async () => {
    const m = confirmation()
    m.Token = 'attacker-token'
    expect(await verify(m)).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' })
  })
})

describe('isTrustedSubscribeUrl', () => {
  it.each([
    [`https://evil.example/?Action=ConfirmSubscription&TopicArn=${TOPIC}`, false],
    [`https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}`, false],
    [`https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&TopicArn=${TOPIC}`, false],
    ['https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:111111111111:other', false],
    [`http://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}`, false],
    [`https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${TOPIC}&Token=abc`, true],
  ])('%s → %s', (url, ok) => {
    expect(mod.isTrustedSubscribeUrl(url, 'us-east-1', TOPIC)).toBe(ok)
  })
})

describe('parseTopicArn', () => {
  it('reads region, account and name', () => {
    expect(mod.parseTopicArn(TOPIC)).toEqual({ region: 'us-east-1', account: '590715976857', name: 'kensaurus-account-alerts' })
    expect(mod.parseTopicArn('arn:aws:sns:us-east-1:5907:x')).toBeNull()
    expect(mod.parseTopicArn('arn:aws:sqs:us-east-1:590715976857:x')).toBeNull()
  })
})
