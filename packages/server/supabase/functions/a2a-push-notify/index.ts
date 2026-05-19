// ============================================================================
// a2a-push-notify — fires when a fix_dispatch_jobs row's status flips and
//                   the row has a non-NULL push_notification_config.
// ============================================================================
//
// Wire: invoked exclusively by the Postgres trigger
// `trg_fix_dispatch_jobs_a2a_push` via pg_net. The trigger sends:
//
//   POST /functions/v1/a2a-push-notify
//   Authorization: Bearer <SERVICE_ROLE_KEY>
//   { "taskId": "<uuid>", "newStatus": "...", "previousStatus": "..." }
//
// Responsibilities:
//   1. Auth-check the inbound caller (must carry the service-role key).
//   2. Re-read the fix_dispatch_jobs row (avoids trusting trigger-supplied
//      data and gives us all task fields needed for the A2A envelope).
//   3. Build the A2A v1.0.0 Task envelope (mirrors api/routes/a2a-tasks.ts
//      `taskFromRow` output).
//   4. POST the envelope to push_notification_config.url with Standard
//      Webhooks signing headers (webhook-id / webhook-timestamp /
//      webhook-signature). Optional bearer token from the config is
//      forwarded as `Authorization: Bearer <token>`.
//   5. Log the attempt to a2a_push_deliveries so operators can debug.
//
// Why a separate function (vs. inlining in the trigger):
//   plpgsql cannot easily compute HMAC-SHA256 nor build the full A2A
//   envelope; pg_net is non-blocking which keeps the OLTP path fast.
//
// Notes:
//   - Standard Webhooks payload: `${webhook-id}.${webhook-timestamp}.${body}`
//   - Secret used to sign: derived from push_notification_config.token if
//     present, otherwise from a per-project A2A push secret stored in
//     Vault (vault://a2a/push/<project_id>). Without a secret we still
//     POST but emit only the unsigned headers — receivers MAY refuse.
//   - Replay safety: the trigger does not re-fire on identical status
//     transitions (`OLD.status IS NOT DISTINCT FROM NEW.status` short-
//     circuits), so dedup at the receiver is bounded to network retries.
// ============================================================================

import { getServiceClient } from '../_shared/db.ts';
import { log } from '../_shared/logger.ts';
import { withSentry } from '../_shared/sentry.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const plog = log.child('a2a-push-notify');

const A2A_PROTOCOL_VERSION = '1.0.0';
const DELIVERY_TIMEOUT_MS = 8_000;
const RESPONSE_EXCERPT_MAX = 512;

interface PushConfig {
  url: string;
  token?: string;
}

interface FixDispatchRow {
  id: string;
  project_id: string;
  report_id: string;
  status: string;
  skill: string | null;
  fix_attempt_id: string | null;
  pr_url: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  inventory_action_node_id: string | null;
  push_notification_config: PushConfig | null;
}

const STATUS_TO_STATE: Record<string, string> = {
  queued: 'submitted',
  running: 'working',
  completed: 'completed',
  failed: 'failed',
  skipped: 'completed',
  cancelled: 'canceled',
};

function buildTaskEnvelope(row: FixDispatchRow): Record<string, unknown> {
  const state = STATUS_TO_STATE[row.status] ?? 'unknown';
  const skill = row.skill ?? 'dispatch_fix';
  const artifacts: Array<Record<string, unknown>> = [];
  if (row.pr_url) {
    artifacts.push({ type: 'text', mimeType: 'text/uri-list', text: row.pr_url, url: row.pr_url });
  }
  return {
    id: row.id,
    type: 'task',
    state,
    skill,
    submittedAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.finished_at,
    error: row.error,
    artifacts,
    metadata: {
      projectId: row.project_id,
      reportId: row.report_id,
      fixAttemptId: row.fix_attempt_id,
      inventoryActionNodeId: row.inventory_action_node_id,
      mushiVersion: A2A_PROTOCOL_VERSION,
    },
  };
}

async function signHmacBase64(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    // Block obvious internal targets — push targets must be reachable from
    // the public internet; localhost/RFC-1918 hostnames are almost always
    // misconfiguration and would expose the trigger to SSRF in self-hosted
    // deployments. We still allow them when MUSHI_ALLOW_INTERNAL_PUSH=1
    // (used by integration tests).
    if (Deno.env.get('MUSHI_ALLOW_INTERNAL_PUSH') === '1') return true;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function loadProjectPushSecret(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<string | null> {
  const { data } = await db.rpc('vault_lookup', { secret_name: `a2a/push/${projectId}` });
  return typeof data === 'string' ? data : null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authError = requireServiceRoleAuth(req);
  if (authError) return authError;

  const body = (await req.json().catch(() => null)) as {
    taskId?: string;
    newStatus?: string;
  } | null;
  const taskId = body?.taskId;
  if (!taskId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return new Response(JSON.stringify({ error: 'invalid taskId' }), { status: 400 });
  }

  const db = getServiceClient();

  const { data: row, error } = await db
    .from('fix_dispatch_jobs')
    .select(
      'id, project_id, report_id, status, skill, fix_attempt_id, pr_url, error, created_at, started_at, finished_at, inventory_action_node_id, push_notification_config',
    )
    .eq('id', taskId)
    .single();

  if (error || !row) {
    plog.warn('Task not found', { taskId, error: error?.message });
    return new Response(JSON.stringify({ ok: false, error: 'task_not_found' }), { status: 404 });
  }

  const job = row as FixDispatchRow;
  const config = job.push_notification_config;

  if (!config?.url) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no_config' }), { status: 200 });
  }

  if (!isHttpsUrl(config.url)) {
    plog.warn('Refusing push to non-HTTPS or internal URL', { taskId, url: config.url });
    await db.from('a2a_push_deliveries').insert({
      task_id: job.id,
      project_id: job.project_id,
      delivery_id: crypto.randomUUID(),
      callback_url: config.url,
      task_state: STATUS_TO_STATE[job.status] ?? 'unknown',
      status: 'skipped',
      response_excerpt: 'non-https or internal URL',
    });
    return new Response(JSON.stringify({ ok: false, skipped: 'invalid_url' }), { status: 200 });
  }

  const envelope = buildTaskEnvelope(job);
  const rawBody = JSON.stringify(envelope);
  const deliveryId = crypto.randomUUID();
  const stdTimestamp = String(Math.floor(Date.now() / 1000));
  const signingSecret = config.token ?? (await loadProjectPushSecret(db, job.project_id));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'webhook-id': deliveryId,
    'webhook-timestamp': stdTimestamp,
    'X-Mushi-Event': `a2a.task.${envelope.state}`,
    'X-Mushi-Delivery': deliveryId,
    'X-Mushi-Project': job.project_id,
    'X-Mushi-Schema': `a2a/v${A2A_PROTOCOL_VERSION}/task`,
  };

  if (signingSecret) {
    const stdSig = await signHmacBase64(signingSecret, `${deliveryId}.${stdTimestamp}.${rawBody}`);
    headers['webhook-signature'] = `v1,${stdSig}`;
  }
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let status: 'ok' | 'error' | 'timeout' = 'error';
  let excerpt = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = res.status;
    const text = await res.text().catch(() => '');
    excerpt = text.slice(0, RESPONSE_EXCERPT_MAX);
    status = res.ok ? 'ok' : 'error';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') status = 'timeout';
    excerpt = String(err).slice(0, RESPONSE_EXCERPT_MAX);
  }
  const durationMs = Date.now() - startedAt;

  try {
    await db.from('a2a_push_deliveries').insert({
      task_id: job.id,
      project_id: job.project_id,
      delivery_id: deliveryId,
      callback_url: config.url,
      task_state: envelope.state as string,
      http_status: httpStatus,
      duration_ms: durationMs,
      status,
      response_excerpt: excerpt || null,
    });
  } catch (err) {
    plog.warn('Failed to log a2a push delivery', { err: String(err) });
  }

  return new Response(JSON.stringify({ ok: status === 'ok', status, httpStatus, durationMs }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(withSentry('a2a-push-notify', handle));
