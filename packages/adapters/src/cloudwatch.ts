/**
 * AWS CloudWatch Alarms → Mushi adapter (via SNS push notifications).
 *
 * Auth method: SNS message signature. AWS SNS signs each push notification
 * with RSA-SHA1 (or SHA256 for `SignatureVersion: "2"`). The adapter:
 *   1. Validates `SigningCertURL` is an AWS SNS domain to prevent SSRF.
 *   2. Fetches the signing certificate over HTTPS.
 *   3. Builds the canonical string-to-sign per AWS SNS spec.
 *   4. Verifies the base64 `Signature` field.
 *
 * For `SubscriptionConfirmation` messages the adapter returns the
 * `SubscribeURL` in the response body so the caller can confirm it.
 *
 * Header: `x-amz-sns-message-type` — values: `SubscriptionConfirmation`,
 * `Notification`, `UnsubscribeConfirmation`.
 *
 * Events handled:
 *   - CloudWatch Alarm `NewStateValue: ALARM` → Mushi report
 *   - CloudWatch Alarm `NewStateValue: OK`    → resolve note (low severity)
 *
 * NOTE: Certificate fetching uses `fetch` (available in Node ≥ 20). Certificates
 * are not cached between requests — add an in-process LRU cache for high-traffic
 * endpoints.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html
 */
import { createVerify } from 'node:crypto'
import type { MushiCaptureEventInput } from '@mushi-mushi/core'
import type { MushiCaptureSink, WebhookResponse } from './types.js'

export interface SNSMessage {
  Type?: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation' | string
  MessageId?: string
  TopicArn?: string
  Subject?: string
  Message?: string
  Timestamp?: string
  SignatureVersion?: '1' | '2' | string
  Signature?: string
  SigningCertURL?: string
  SubscribeURL?: string
  Token?: string
  UnsubscribeURL?: string
}

export interface CloudWatchAlarmMessage {
  AlarmName?: string
  AlarmDescription?: string
  AWSAccountId?: string
  NewStateValue?: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA' | string
  NewStateReason?: string
  StateChangeTime?: string
  Region?: string
  OldStateValue?: string
  Trigger?: {
    MetricName?: string
    Namespace?: string
    Statistic?: string
    Dimensions?: Array<{ value?: string; name?: string }>
    Period?: number
    EvaluationPeriods?: number
    ComparisonOperator?: string
    Threshold?: number
  }
}

/**
 * Maps a parsed CloudWatch alarm message to a `MushiCaptureEventInput`.
 * Pure function — no side effects, safe to call in tests.
 */
export function translateCloudWatch(alarm: CloudWatchAlarmMessage, projectName?: string): MushiCaptureEventInput {
  const isAlarm = alarm.NewStateValue === 'ALARM'
  const description = alarm.AlarmDescription ?? alarm.AlarmName ?? 'CloudWatch alarm'
  const metricLabel = alarm.Trigger
    ? `${alarm.Trigger.Namespace ?? ''}/${alarm.Trigger.MetricName ?? ''}`.replace(/^\//, '')
    : undefined

  return {
    description: isAlarm ? description : `[RESOLVED] ${description}`,
    category: 'bug',
    severity: isAlarm ? 'high' : 'low',
    source: 'cloudwatch',
    component: projectName ?? alarm.AlarmName,
    metadata: {
      alarmName: alarm.AlarmName,
      newState: alarm.NewStateValue,
      oldState: alarm.OldStateValue,
      reason: alarm.NewStateReason,
      stateChangeTime: alarm.StateChangeTime,
      region: alarm.Region,
      accountId: alarm.AWSAccountId,
      metric: metricLabel,
    },
  }
}

export interface CloudWatchAdapterOptions {
  sink: MushiCaptureSink
  /**
   * If provided, rejects SNS notifications whose `TopicArn` does not match.
   * Useful as an extra layer of defense when multiple alarms post to the same
   * endpoint.
   */
  topicArn?: string
  /** Optional project name stored in `component` and metadata. */
  projectName?: string
}

/**
 * Creates a CloudWatch (SNS-delivered) webhook ingress handler.
 *
 * Validates the SNS message signature by downloading the signing certificate
 * from `SigningCertURL` (restricted to `*.amazonaws.com` hosts) and verifying
 * the RSA signature. Handles `SubscriptionConfirmation` and `Notification`
 * message types; maps CloudWatch alarm state changes to `MushiCaptureEventInput`.
 *
 * Header verified: `x-amz-sns-message-type`.
 */
export function createCloudWatchAdapter(opts: CloudWatchAdapterOptions) {
  return async (req: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookResponse> => {
    const msgType = extractHeader(req.headers, 'x-amz-sns-message-type')
    if (!msgType) {
      return { status: 400, body: { ok: false, error: 'MISSING_SNS_HEADER' } }
    }

    let sns: SNSMessage
    try { sns = JSON.parse(req.rawBody) as SNSMessage } catch { return { status: 400, body: { ok: false, error: 'INVALID_JSON' } } }

    // Validate TopicArn if configured
    if (opts.topicArn && sns.TopicArn !== opts.topicArn) {
      return { status: 403, body: { ok: false, error: 'TOPIC_ARN_MISMATCH' } }
    }

    // Verify the SNS signature
    const sigValid = await verifySnsSignature(sns)
    if (!sigValid) {
      return { status: 401, body: { ok: false, error: 'BAD_SNS_SIGNATURE' } }
    }

    if (msgType === 'SubscriptionConfirmation') {
      return { status: 200, body: { ok: true, subscribeUrl: sns.SubscribeURL } }
    }

    if (msgType !== 'Notification') {
      return { status: 200, body: { ok: true, note: 'ignored' } }
    }

    let alarm: CloudWatchAlarmMessage
    try { alarm = JSON.parse(sns.Message ?? '{}') as CloudWatchAlarmMessage } catch { return { status: 400, body: { ok: false, error: 'INVALID_ALARM_MESSAGE' } } }

    if (alarm.NewStateValue === 'INSUFFICIENT_DATA') {
      return { status: 200, body: { ok: true, note: 'insufficient_data_ignored' } }
    }

    const id = await opts.sink(translateCloudWatch(alarm, opts.projectName))
    return { status: 200, body: { ok: true, reportId: id } }
  }
}

/**
 * Verifies the RSA signature on an SNS message.
 * Returns false if the certificate URL is not an AWS SNS domain (SSRF guard).
 */
async function verifySnsSignature(sns: SNSMessage): Promise<boolean> {
  const { SigningCertURL, Signature, SignatureVersion } = sns
  if (!SigningCertURL || !Signature) return false

  // SSRF guard: only allow AWS SNS certificate URLs
  try {
    const certUrl = new URL(SigningCertURL)
    if (!certUrl.hostname.startsWith('sns.') || !certUrl.hostname.endsWith('.amazonaws.com')) {
      return false
    }
  } catch {
    return false
  }

  let pem: string
  try {
    const res = await fetch(SigningCertURL)
    if (!res.ok) return false
    pem = await res.text()
  } catch {
    return false
  }

  const strToSign = buildStringToSign(sns)
  const algo = SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1'

  try {
    const verifier = createVerify(algo)
    verifier.update(strToSign, 'utf8')
    return verifier.verify(pem, Signature, 'base64')
  } catch {
    return false
  }
}

/** Builds the canonical string-to-sign per AWS SNS spec. */
function buildStringToSign(sns: SNSMessage): string {
  const type = sns.Type ?? ''
  const fields: Array<keyof SNSMessage> =
    type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

  return fields
    .filter(k => sns[k] != null)
    .map(k => `${k}\n${sns[k] as string}\n`)
    .join('')
}

function extractHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}
