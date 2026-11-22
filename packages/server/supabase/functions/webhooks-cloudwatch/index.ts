/**
 * webhooks-cloudwatch — Supabase Edge Function (ADR 0061)
 *
 * Receives Amazon SNS HTTPS deliveries and files CloudWatch alarm state
 * changes as Mushi reports. The handler is `_shared/cloudwatch-webhook.ts`;
 * this file wires the real database, audit log, rate limit and fetch.
 *
 * Subscribe a topic with protocol HTTPS and this endpoint:
 *   https://<project-ref>.supabase.co/functions/v1/webhooks-cloudwatch
 * and bind the topic to a project: project_settings.cloudwatch_sns_topic_arn.
 * The topic picks the project; nothing in the request does.
 *
 * Auth: SNS calls without a Supabase JWT, so verify_jwt is false
 * (config.toml) and the SNS message signature is the auth
 * (`_shared/sns-verify.ts`): bound TopicArn, cert URL pinned to
 * sns.<topic region>.amazonaws.com, SignatureVersion 1/2 verified, fresh
 * Timestamp, MessageId not seen before. Every request goes through
 * `_shared/webhook-middleware.ts` (audit row, per-IP rate limit).
 */

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { queueReportClassification } from '../_shared/report-classification.ts'
import { createWebhookMiddleware, RateLimitError } from '../_shared/webhook-middleware.ts'
import { handleCloudWatchWebhook } from '../_shared/cloudwatch-webhook.ts'

const log = rootLog.child('webhooks-cloudwatch')

/** Same shim as webhooks-linear: the middleware reads a Hono-shaped context. */
function toWebhookContext(req: Request) {
  return {
    req: {
      header: (name: string) => req.headers.get(name) ?? undefined,
      method: req.method,
      url: req.url,
    },
  }
}

// SNS signs with a handful of long-lived certs; cache each by URL per isolate.
const certCache = new Map<string, Promise<string>>()
const CERT_CACHE_MAX = 16

function fetchCertPem(url: string): Promise<string> {
  const hit = certCache.get(url)
  if (hit) return hit
  const p = (async () => {
    // The URL was already pinned to https://sns.<region>.amazonaws.com/…pem.
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`cert HTTP ${res.status}`)
    const text = await res.text()
    if (text.length > 20_000 || !text.includes('-----BEGIN CERTIFICATE-----')) throw new Error('cert body is not a PEM certificate')
    return text
  })()
  certCache.set(url, p)
  p.catch(() => certCache.delete(url))
  if (certCache.size > CERT_CACHE_MAX) {
    const first = certCache.keys().next().value
    if (first !== undefined && first !== url) certCache.delete(first)
  }
  return p
}

Deno.serve((req: Request) => {
  const db = getServiceClient()
  const { audit, hasAcceptedDuplicate, checkRateLimit } = createWebhookMiddleware('cloudwatch')
  return handleCloudWatchWebhook(req, {
    db,
    audit: (rawBody, messageId) => audit(toWebhookContext(req) as never, rawBody, messageId),
    rateLimit: (ip) => {
      try {
        checkRateLimit(ip)
        return null
      } catch (err) {
        if (err instanceof RateLimitError) return err.message
        throw err
      }
    },
    hasAcceptedDuplicate,
    fetchCertPem,
    fetch,
    now: () => new Date(),
    classify: (reportId, projectId) => queueReportClassification(db, reportId, projectId),
    log,
  })
})
