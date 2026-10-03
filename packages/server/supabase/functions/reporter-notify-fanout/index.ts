/**
 * FILE: reporter-notify-fanout/index.ts
 * PURPOSE: Email / push for a developer reply to a reporter (Plan 018 §3).
 *
 * Invoked by the report_comments trigger through
 * `mushi.edge_function_post('reporter-notify-fanout', {comment_id, report_id})`
 * (migration 20261002120200) after it has written the reporter's in-app row.
 * Delivery and the ledger live in `_shared/reporter-fanout.ts`.
 *
 * Digest mode: `{"digest": true}` (daily pg_cron, migration 20261002160100)
 * sends each reporter one email with the updates the frequency cap deferred
 * (`_shared/reporter-digest.ts`). With email not configured it answers 200
 * with `not_configured: true` and leaves every row deferred.
 *
 * Auth: requireServiceRoleAuth — the trigger's bearer is the internal caller
 * secret mirrored into mushi_runtime_config.service_role_key. `verify_jwt` is
 * off in config.toml so the gateway does not reject that bearer first.
 */

import { getServiceClient } from '../_shared/db.ts';
import { log } from '../_shared/logger.ts';
import { withSentry } from '../_shared/sentry.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { fanOutCommentNotification, parseFanoutBody } from '../_shared/reporter-fanout.ts';
import { sendReporterDigests } from '../_shared/reporter-digest.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const flog = log.child('reporter-notify-fanout');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function handler(req: Request): Promise<Response> {
  const unauthorized = requireServiceRoleAuth(req);
  if (unauthorized) return unauthorized;
  if (req.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, 405);

  const body = await req.json().catch(() => null);
  if ((body as { digest?: unknown } | null)?.digest === true) {
    const digest = await sendReporterDigests(getServiceClient());
    if (digest.not_configured) flog.warn('digest_email_not_configured', { ...digest });
    else flog.info('digest_done', { ...digest });
    return json({ ok: true, data: digest });
  }

  const parsed = parseFanoutBody(body);
  if (!parsed) return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'comment_id required' } }, 400);

  const outcome = await fanOutCommentNotification(getServiceClient(), parsed.commentId);
  if (!outcome.ok) {
    flog.error('fanout_failed', { commentId: parsed.commentId, code: outcome.code, message: outcome.message });
    return json({ ok: false, error: { code: outcome.code, message: outcome.message } }, outcome.code === 'COMMENT_NOT_FOUND' ? 404 : 500);
  }
  if (outcome.skipped) return json({ ok: true, data: { skipped: outcome.skipped } });
  return json({
    ok: true,
    data: {
      type: outcome.type,
      delivered: outcome.result.delivered,
      skipped: outcome.result.skipped,
      duplicate: outcome.result.duplicate,
      failed: outcome.result.failed,
    },
  });
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('reporter-notify-fanout', handler));
}
