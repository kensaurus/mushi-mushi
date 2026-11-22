/**
 * FILE: cloudwatch-webhook.ts
 * PURPOSE: The request handler behind webhooks-cloudwatch (ADR 0061), with
 *          its I/O injected so vitest drives every branch: SNS verification
 *          (`sns-verify.ts`), the subscription handshake, and alarm ingest
 *          (`cloudwatch-ingest.ts`).
 *
 * Answers:
 *   - SubscriptionConfirmation: verified, then GET SubscribeURL (same SNS
 *     host, Action=ConfirmSubscription, this TopicArn) → 200, or 502 when AWS
 *     did not answer 200.
 *   - UnsubscribeConfirmation: verified, recorded, 200. Never resubscribes.
 *   - Notification: a CloudWatch alarm → filed/deduped/annotated → 200; any
 *     other message on the topic (budget notice, test publish) → 200 ignored.
 *     Only a database failure answers 500, so SNS retries it.
 *   - A MessageId already accepted → 200 duplicate, so SNS stops retrying.
 *   - Bad or unverifiable signature → 401; unbound topic or untrusted cert or
 *     subscribe host → 403; not an SNS body → 400; over the rate limit → 429.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isTrustedSubscribeUrl, verifySnsDelivery } from './sns-verify.ts';
import { ingestCloudWatchAlarm, parseCloudWatchAlarm } from './cloudwatch-ingest.ts';

export type AuditOutcome = 'accepted' | 'error' | 'rejected_signature' | 'rejected_replay' | 'rejected_rate_limit';

export interface AuditHandle {
  id: string;
  resolve(outcome: AuditOutcome, status: number, durationMs: number, note?: string): Promise<void>;
  setProject(projectId: string): Promise<void>;
}

export interface CloudWatchWebhookDeps {
  db: SupabaseClient;
  /** Open the webhook_audit_log row (webhook-middleware `audit`). */
  audit: (rawBody: string, messageId: string | null) => Promise<AuditHandle>;
  /** Null when under the limit, else the reason (webhook-middleware `checkRateLimit`). */
  rateLimit: (sourceIp: string | null) => string | null;
  /** webhook-middleware `hasAcceptedDuplicate`. */
  hasAcceptedDuplicate: (auditRowId: string, key: { deliveryId: string; bodyHash: string }) => Promise<boolean>;
  fetchCertPem: (url: string) => Promise<string>;
  /** Used for the SubscribeURL GET only. */
  fetch: typeof fetch;
  now: () => Date;
  classify: (reportId: string, projectId: string) => Promise<void> | void;
  log?: { info: (m: string, d?: Record<string, unknown>) => void; warn: (m: string, d?: Record<string, unknown>) => void; error: (m: string, d?: Record<string, unknown>) => void };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The project bound to an SNS topic (project_settings.cloudwatch_sns_topic_arn), else null. Throws on a failed read. */
export async function projectForTopic(db: SupabaseClient, topicArn: string): Promise<string | null> {
  const { data, error } = await db.from('project_settings').select('project_id').eq('cloudwatch_sns_topic_arn', topicArn).maybeSingle();
  if (error) throw new Error(`topic lookup failed: ${error.message}`);
  return (data as { project_id?: string } | null)?.project_id ?? null;
}

export async function handleCloudWatchWebhook(req: Request, deps: CloudWatchWebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  const t0 = Date.now();
  // SNS sends Content-Type text/plain; the body is JSON regardless.
  const rawBody = await req.text();
  let messageIdHint: string | null = null;
  try {
    const peek = JSON.parse(rawBody) as { MessageId?: unknown };
    if (typeof peek?.MessageId === 'string') messageIdHint = peek.MessageId.slice(0, 200);
  } catch {
    /* rejected by verification below */
  }
  const auditRow = await deps.audit(rawBody, messageIdHint);
  const done = async (res: Response, outcome: AuditOutcome, note?: string): Promise<Response> => {
    await auditRow.resolve(outcome, res.status, Date.now() - t0, note).catch(() => {});
    return res;
  };

  const sourceIp = req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;
  const limited = deps.rateLimit(sourceIp);
  if (limited) return done(json({ ok: false, error: 'RATE_LIMITED' }, 429), 'rejected_rate_limit', limited);

  let verdict: Awaited<ReturnType<typeof verifySnsDelivery>>;
  try {
    verdict = await verifySnsDelivery(
      { body: rawBody, nowMs: deps.now().getTime() },
      {
        projectForTopic: (arn) => projectForTopic(deps.db, arn),
        fetchCertPem: deps.fetchCertPem,
        isReplay: async (messageId) => deps.hasAcceptedDuplicate(auditRow.id, { deliveryId: messageId, bodyHash: await sha256Hex(rawBody) }),
      },
    );
  } catch (err) {
    deps.log?.error('SNS verification could not run', { err: String(err).slice(0, 300) });
    return done(json({ ok: false, error: 'VERIFY_FAILED' }, 500), 'error', String(err).slice(0, 300));
  }

  if (!verdict.ok) {
    if (verdict.projectId) await auditRow.setProject(verdict.projectId).catch(() => {});
    if (verdict.code === 'DUPLICATE') {
      // SNS retries until it sees a 2xx; the first copy was already applied.
      return done(json({ ok: true, data: { action: 'duplicate' } }), 'rejected_replay', verdict.message);
    }
    deps.log?.warn('SNS delivery rejected', { code: verdict.code, messageId: verdict.messageId ?? null });
    return done(json({ ok: false, error: verdict.code }, verdict.status), verdict.auditOutcome, verdict.message);
  }

  const { message: msg, projectId, region } = verdict;
  await auditRow.setProject(projectId).catch(() => {});

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!msg.SubscribeURL || !isTrustedSubscribeUrl(msg.SubscribeURL, region, msg.TopicArn)) {
      return done(json({ ok: false, error: 'UNTRUSTED_SUBSCRIBE_URL' }, 403), 'rejected_signature', 'SubscribeURL is not this topic on the SNS host');
    }
    try {
      const res = await deps.fetch(msg.SubscribeURL, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) {
        deps.log?.warn('SNS subscription confirm was refused', { status: res.status, topicArn: msg.TopicArn });
        return done(json({ ok: false, error: 'CONFIRM_REFUSED', status: res.status }, 502), 'error', `ConfirmSubscription HTTP ${res.status}`);
      }
    } catch (err) {
      return done(json({ ok: false, error: 'CONFIRM_FAILED' }, 502), 'error', String(err).slice(0, 300));
    }
    deps.log?.info('SNS subscription confirmed', { topicArn: msg.TopicArn, projectId });
    return done(json({ ok: true, data: { action: 'subscription_confirmed' } }), 'accepted');
  }

  if (msg.Type === 'UnsubscribeConfirmation') {
    deps.log?.warn('SNS topic unsubscribed this endpoint', { topicArn: msg.TopicArn, projectId });
    return done(json({ ok: true, data: { action: 'unsubscribe_recorded' } }), 'accepted');
  }

  const alarm = parseCloudWatchAlarm(msg.Message);
  if (!alarm) return done(json({ ok: true, data: { action: 'ignored', reason: 'not_a_cloudwatch_alarm' } }), 'accepted');
  try {
    const result = await ingestCloudWatchAlarm(deps.db, {
      projectId,
      alarm,
      topicArn: msg.TopicArn,
      messageId: msg.MessageId,
      now: deps.now(),
      classify: deps.classify,
    });
    deps.log?.info('CloudWatch alarm ingested', {
      alarm: alarm.AlarmName,
      state: alarm.NewStateValue,
      outcome: result.outcome,
      reportId: result.reportId ?? null,
    });
    return done(json({ ok: true, data: { action: result.outcome, reportId: result.reportId ?? null } }), 'accepted');
  } catch (err) {
    deps.log?.error('CloudWatch ingest failed', { alarm: alarm.AlarmName, err: String(err).slice(0, 300) });
    return done(json({ ok: false, error: 'INGEST_FAILED' }, 500), 'error', String(err).slice(0, 300));
  }
}
