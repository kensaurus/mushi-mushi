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
//   3. Build the A2A 1.0 push callback body — a `StreamResponse` carrying
//      exactly one `statusUpdate` (TaskStatusUpdateEvent):
//        { statusUpdate: { taskId, contextId, status: { state, timestamp,
//          message? }, final, metadata } }
//      (A2A 1.0 §push notifications; 0.3 sent a bare Mushi task envelope.)
//   4. POST it to push_notification_config.url with
//      `Content-Type: application/a2a+json`, `Authorization: {scheme}
//      {credentials}` from the stored 1.0 `authentication` (or `Bearer
//      <token>` for the 0.3 `token` field), plus Standard Webhooks signing
//      headers (webhook-id / webhook-timestamp / webhook-signature) and the
//      X-Mushi-* headers — unchanged so existing receivers keep verifying.
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

export const A2A_PROTOCOL_VERSION = '1.0.0';
export const A2A_PUSH_CONTENT_TYPE = 'application/a2a+json';
const DELIVERY_TIMEOUT_MS = 8_000;
const RESPONSE_EXCERPT_MAX = 512;

export interface PushConfig {
  url: string;
  /** 0.3 bearer token (still honoured). */
  token?: string;
  id?: string;
  /** 1.0 `authentication: { scheme, credentials? }`. */
  authentication?: { scheme?: string; credentials?: string } | null;
}

export interface FixDispatchRow {
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

/** fix_dispatch_jobs.status → A2A 1.0 TaskState enum name. */
export const STATUS_TO_TASK_STATE: Record<string, string> = {
  queued: 'TASK_STATE_SUBMITTED',
  running: 'TASK_STATE_WORKING',
  completed: 'TASK_STATE_COMPLETED',
  completed_no_pr: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  skipped: 'TASK_STATE_COMPLETED',
  skipped_no_sandbox: 'TASK_STATE_COMPLETED',
  cancelled: 'TASK_STATE_CANCELED',
};

/** Lower-case 0.3 spelling, kept for a2a_push_deliveries.task_state + X-Mushi-Event. */
const STATUS_TO_LEGACY_STATE: Record<string, string> = {
  queued: 'submitted',
  running: 'working',
  completed: 'completed',
  completed_no_pr: 'completed',
  failed: 'failed',
  skipped: 'completed',
  skipped_no_sandbox: 'completed',
  cancelled: 'canceled',
};

const FINAL_STATES = new Set(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED']);

export function taskStateFor(status: string): string {
  return STATUS_TO_TASK_STATE[status] ?? 'TASK_STATE_UNKNOWN';
}

export function legacyStateFor(status: string): string {
  return STATUS_TO_LEGACY_STATE[status] ?? 'unknown';
}

/**
 * A2A 1.0 push body: `StreamResponse` with exactly one of
 * { task | message | statusUpdate | artifactUpdate } — we always send
 * `statusUpdate`. `contextId` groups every task about the same report.
 * The PR URL (when present) rides in `status.message` parts and in
 * `metadata`, so a phone-side consumer needs no second round-trip.
 */
export function buildStreamResponse(row: FixDispatchRow, nowIso = new Date().toISOString()): Record<string, unknown> {
  const state = taskStateFor(row.status);
  const skill = row.skill ?? 'dispatch_fix';
  const final = FINAL_STATES.has(state);
  const parts: Array<Record<string, unknown>> = [];
  if (row.pr_url) parts.push({ text: `Pull request: ${row.pr_url}` });
  if (row.error) parts.push({ text: `Error: ${row.error.slice(0, 500)}` });
  if (parts.length === 0) parts.push({ text: `${skill} is ${legacyStateFor(row.status)}` });

  return {
    statusUpdate: {
      taskId: row.id,
      contextId: row.report_id,
      status: {
        state,
        timestamp: row.finished_at ?? row.started_at ?? nowIso,
        message: {
          messageId: `${row.id}:${row.status}`,
          role: 'ROLE_AGENT',
          taskId: row.id,
          contextId: row.report_id,
          parts,
        },
      },
      final,
      metadata: {
        skill,
        projectId: row.project_id,
        reportId: row.report_id,
        fixAttemptId: row.fix_attempt_id,
        inventoryActionNodeId: row.inventory_action_node_id,
        prUrl: row.pr_url,
        error: row.error,
        submittedAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.finished_at,
        mushiStatus: row.status,
        mushiVersion: A2A_PROTOCOL_VERSION,
      },
    },
  };
}

/** `Authorization` value from the stored config: 1.0 authentication wins, 0.3 token is `Bearer`. */
export function authorizationHeaderFor(config: PushConfig): string | null {
  const scheme = config.authentication?.scheme?.trim();
  if (scheme) {
    const credentials = config.authentication?.credentials ?? config.token ?? '';
    return credentials ? `${scheme} ${credentials}` : scheme;
  }
  if (config.token) return `Bearer ${config.token}`;
  return null;
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

export interface PushHeadersInput {
  config: PushConfig;
  projectId: string;
  legacyState: string;
  deliveryId: string;
  stdTimestamp: string;
  rawBody: string;
  signingSecret: string | null;
}

export async function buildPushHeaders(input: PushHeadersInput): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': A2A_PUSH_CONTENT_TYPE,
    'A2A-Version': '1.0',
    'webhook-id': input.deliveryId,
    'webhook-timestamp': input.stdTimestamp,
    'X-Mushi-Event': `a2a.task.${input.legacyState}`,
    'X-Mushi-Delivery': input.deliveryId,
    'X-Mushi-Project': input.projectId,
    'X-Mushi-Schema': `a2a/v${A2A_PROTOCOL_VERSION}/status-update`,
  };
  if (input.signingSecret) {
    const stdSig = await signHmacBase64(
      input.signingSecret,
      `${input.deliveryId}.${input.stdTimestamp}.${input.rawBody}`,
    );
    headers['webhook-signature'] = `v1,${stdSig}`;
  }
  const authorization = authorizationHeaderFor(input.config);
  if (authorization) headers['Authorization'] = authorization;
  return headers;
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

export async function handle(req: Request): Promise<Response> {
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

  const legacyState = legacyStateFor(job.status);

  if (!isHttpsUrl(config.url)) {
    plog.warn('Refusing push to non-HTTPS or internal URL', { taskId, url: config.url });
    await db.from('a2a_push_deliveries').insert({
      task_id: job.id,
      project_id: job.project_id,
      delivery_id: crypto.randomUUID(),
      callback_url: config.url,
      task_state: legacyState,
      status: 'skipped',
      response_excerpt: 'non-https or internal URL',
    });
    return new Response(JSON.stringify({ ok: false, skipped: 'invalid_url' }), { status: 200 });
  }

  const envelope = buildStreamResponse(job);
  const rawBody = JSON.stringify(envelope);
  const deliveryId = crypto.randomUUID();
  const stdTimestamp = String(Math.floor(Date.now() / 1000));
  // Signing secret: the 0.3 `token` doubled as the HMAC secret; a 1.0
  // `authentication.credentials` plays the same role. Otherwise the
  // per-project vault secret. Never sign with nothing.
  const signingSecret =
    config.authentication?.credentials ??
    config.token ??
    (await loadProjectPushSecret(db, job.project_id));

  const headers = await buildPushHeaders({
    config,
    projectId: job.project_id,
    legacyState,
    deliveryId,
    stdTimestamp,
    rawBody,
    signingSecret,
  });

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
      task_state: legacyState,
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

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('a2a-push-notify', handle));
}
