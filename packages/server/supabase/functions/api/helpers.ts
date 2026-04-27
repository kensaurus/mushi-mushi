import type { Context } from 'npm:hono@4';

import { getServiceClient } from '../_shared/db.ts';
import { log } from '../_shared/logger.ts';
import { checkIngestQuota } from '../_shared/quota.ts';
import { getStorageAdapter } from '../_shared/storage.ts';
import { reportSubmissionSchema } from '../_shared/schemas.ts';
import { checkAntiGaming } from '../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../_shared/telemetry.ts';
import { awardPoints } from '../_shared/reputation.ts';
import { createNotification, buildNotificationMessage } from '../_shared/notifications.ts';
import { dbError } from './shared.ts';

const SDK_WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const SDK_WIDGET_THEMES = ['auto', 'light', 'dark'] as const;
const SDK_SCREENSHOT_MODES = ['on-report', 'auto', 'off'] as const;
const SDK_NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const;

export interface SdkConfigRow {
  project_id?: string;
  sdk_config_enabled?: boolean | null;
  sdk_widget_position?: string | null;
  sdk_widget_theme?: string | null;
  sdk_widget_trigger_text?: string | null;
  sdk_capture_console?: boolean | null;
  sdk_capture_network?: boolean | null;
  sdk_capture_performance?: boolean | null;
  sdk_capture_screenshot?: string | null;
  sdk_capture_element_selector?: boolean | null;
  sdk_native_trigger_mode?: string | null;
  sdk_min_description_length?: number | null;
  sdk_config_updated_at?: string | null;
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return isOneOf(value, allowed) ? (value as T[number]) : fallback;
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSdkConfig(row?: SdkConfigRow | null) {
  return {
    enabled: row?.sdk_config_enabled ?? true,
    version: row?.sdk_config_updated_at ?? null,
    widget: {
      position: oneOf(row?.sdk_widget_position, SDK_WIDGET_POSITIONS, 'bottom-right'),
      theme: oneOf(row?.sdk_widget_theme, SDK_WIDGET_THEMES, 'auto'),
      triggerText: row?.sdk_widget_trigger_text ?? null,
    },
    capture: {
      console: row?.sdk_capture_console ?? true,
      network: row?.sdk_capture_network ?? true,
      performance: row?.sdk_capture_performance ?? false,
      screenshot: oneOf(row?.sdk_capture_screenshot, SDK_SCREENSHOT_MODES, 'on-report'),
      elementSelector: row?.sdk_capture_element_selector ?? false,
    },
    native: {
      triggerMode: oneOf(row?.sdk_native_trigger_mode, SDK_NATIVE_TRIGGER_MODES, 'both'),
      minDescriptionLength: Math.max(0, Math.min(1000, row?.sdk_min_description_length ?? 20)),
    },
  };
}

export function coerceSdkConfigUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const widget = isRecord(body.widget) ? body.widget : {};
  const capture = isRecord(body.capture) ? body.capture : {};
  const native = isRecord(body.native) ? body.native : {};

  if (typeof body.enabled === 'boolean') updates.sdk_config_enabled = body.enabled;
  if (isOneOf(widget.position, SDK_WIDGET_POSITIONS)) updates.sdk_widget_position = widget.position;
  if (isOneOf(widget.theme, SDK_WIDGET_THEMES)) updates.sdk_widget_theme = widget.theme;
  if (typeof widget.triggerText === 'string') {
    const trimmed = widget.triggerText.trim();
    updates.sdk_widget_trigger_text = trimmed ? widget.triggerText.slice(0, 24) : null;
  } else if (widget.triggerText === null) {
    updates.sdk_widget_trigger_text = null;
  }
  if (typeof capture.console === 'boolean') updates.sdk_capture_console = capture.console;
  if (typeof capture.network === 'boolean') updates.sdk_capture_network = capture.network;
  if (typeof capture.performance === 'boolean')
    updates.sdk_capture_performance = capture.performance;
  if (isOneOf(capture.screenshot, SDK_SCREENSHOT_MODES))
    updates.sdk_capture_screenshot = capture.screenshot;
  if (typeof capture.elementSelector === 'boolean')
    updates.sdk_capture_element_selector = capture.elementSelector;
  if (isOneOf(native.triggerMode, SDK_NATIVE_TRIGGER_MODES))
    updates.sdk_native_trigger_mode = native.triggerMode;
  if (Number.isFinite(native.minDescriptionLength)) {
    updates.sdk_min_description_length = Math.max(
      0,
      Math.min(1000, Math.round(native.minDescriptionLength)),
    );
  }
  updates.sdk_config_updated_at = new Date().toISOString();
  return updates;
}

export async function canManageProjectSdkConfig(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) return false;
  if ((project as { owner_id?: string | null }).owner_id === userId) return true;

  const { data: member } = await db
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .maybeSingle();

  return Boolean(member);
}

// ============================================================
// Shared: ingest a single report and trigger pipeline
// ============================================================
export async function ingestReport(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  body: Record<string, any>,
  options?: { ipAddress?: string; userAgent?: string },
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const parsed = reportSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' };
  }

  const report = parsed.data;

  const encoder = new TextEncoder();
  const tokenData = encoder.encode(report.reporterToken);
  const tokenHashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Build a weak device fingerprint from IP + User-Agent. This is intentionally
  // coarse: it is meant to surface the obvious case of the same browser on the
  // same network registering many reporter tokens. A stronger fingerprint would
  // need to come from the SDK (e.g. FingerprintJS) and be added to the schema.
  let deviceFingerprint: string | null = null;
  if (options?.ipAddress || options?.userAgent) {
    const fpInput = encoder.encode(`${options?.ipAddress ?? ''}|${options?.userAgent ?? ''}`);
    const fpBuffer = await crypto.subtle.digest('SHA-256', fpInput);
    deviceFingerprint = Array.from(new Uint8Array(fpBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const antiGaming = await checkAntiGaming(
    db,
    projectId,
    tokenHash,
    deviceFingerprint || report.fingerprintHash
      ? {
          // Synthesize a placeholder when only the SDK hash is available so the
          // legacy multi-account/velocity checks still have something to key on.
          fingerprint: deviceFingerprint ?? `sdk:${report.fingerprintHash}`,
          ipAddress: options?.ipAddress,
          fingerprintHash: report.fingerprintHash,
        }
      : null,
  );
  if (antiGaming.flagged) {
    log.warn('Anti-gaming flagged report', { reporterToken: tokenHash, reason: antiGaming.reason });
    const eventType = antiGaming.reason?.toLowerCase().startsWith('velocity')
      ? ('velocity_anomaly' as const)
      : ('multi_account' as const);
    await logAntiGamingEvent(db, {
      projectId,
      reporterTokenHash: tokenHash,
      deviceFingerprint,
      ipAddress: options?.ipAddress ?? null,
      userAgent: options?.userAgent ?? null,
      eventType,
      reason: antiGaming.reason ?? null,
    });
  }

  let screenshotUrl: string | null = null;
  let screenshotPath: string | null = null;

  if (report.screenshotDataUrl) {
    try {
      const base64Data = report.screenshotDataUrl.split(',')[1];
      if (base64Data) {
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const mimeMatch = report.screenshotDataUrl.match(/data:([^;]+);/);
        const contentType = mimeMatch?.[1] ?? 'image/jpeg';
        const ext = contentType === 'image/png' ? 'png' : 'jpg';
        const key = `${projectId}/${crypto.randomUUID()}.${ext}`;

        // C8: route through BYO storage adapter so customer-pinned
        // S3/R2/GCS/MinIO buckets receive screenshots directly. Falls back
        // to the cluster default Supabase bucket on misconfiguration.
        const adapter = await getStorageAdapter(projectId);
        const result = await adapter.upload({ key, body: bytes, contentType });
        screenshotPath = result.storagePath;
        screenshotUrl = result.url;
      }
    } catch (err) {
      log.error('Screenshot upload failed', { err: String(err) });
    }
  }

  const reportId = report.id || crypto.randomUUID();

  // Strip null bytes (`\u0000`) from user-supplied TEXT fields: Postgres
  // TEXT columns reject them with 22P05 (invalid_text_representation → 400),
  // which is the most plausible root-cause of the rare `reports` insert 400s
  // we see when clients paste HTML/binary-ish content into the description
  // (Sentry scrubs the server-side error, so we also rename the log field
  // from `error` → `errMsg` below so it survives default scrubbers).
  const sanitizeText = (s: string | undefined | null): string | null =>
    typeof s === 'string' ? s.replace(/\u0000/g, '') : (s ?? null);

  const { error: insertError } = await db.from('reports').insert({
    id: reportId,
    project_id: projectId,
    description: sanitizeText(report.description) ?? '',
    user_category: report.category,
    user_intent: sanitizeText(report.userIntent),
    screenshot_url: screenshotUrl,
    screenshot_path: screenshotPath,
    environment: report.environment ?? {},
    console_logs: report.consoleLogs,
    network_logs: report.networkLogs,
    performance_metrics: report.performanceMetrics,
    selected_element: report.selectedElement,
    custom_metadata: report.metadata,
    proactive_trigger: sanitizeText(report.proactiveTrigger),
    category: report.category ?? 'other',
    status: 'new',
    reporter_token_hash: tokenHash,
    reporter_user_id: (report.metadata as any)?.user?.id,
    session_id: sanitizeText(report.sessionId),
    app_version: sanitizeText(report.appVersion),
    queued_at: report.queuedAt,
    synced_at: new Date().toISOString(),
    created_at: report.createdAt,
  });

  if (insertError) {
    log.error('Report insert failed', {
      reportId,
      // Renamed from `error` → `errMsg` so Sentry's default data scrubbers
      // don't mask the actual Postgres failure. Without this we only see
      // `"[Filtered]"` in Sentry and can't triage the root cause.
      errMsg: insertError.message,
      errCode: (insertError as { code?: string }).code,
      errDetails: (insertError as { details?: string }).details,
      errHint: (insertError as { hint?: string }).hint,
    });
    return { ok: false, error: 'Failed to store report' };
  }

  // Insert into processing queue
  const { error: queueError } = await db.from('processing_queue').insert({
    report_id: reportId,
    project_id: projectId,
    stage: 'stage1',
    status: 'pending',
  });
  if (queueError) log.error('Queue insert failed', { reportId, error: queueError.message });

  // D5: meter the ingest. Fire-and-forget — billing must never
  // block ingest. The hourly `usage-aggregator` cron rolls these up and
  // pushes a Stripe Meter Event per (project, day_utc).
  void db
    .from('usage_events')
    .insert({
      project_id: projectId,
      event_name: 'reports_ingested',
      quantity: 1,
      metadata: { report_id: reportId },
    })
    .then(({ error }) => {
      if (error) log.warn('Usage event insert failed', { reportId, error: error.message });
    });

  // D1: fire `report.created` to all webhook plugins. Fully async —
  // plugin failures must not impact ingest latency or block the pipeline.
  void dispatchPluginEvent(db, projectId, 'report.created', {
    report: {
      id: reportId,
      status: 'new',
      category: report.category,
      title: report.description?.slice(0, 80),
    },
    source: (report.metadata as Record<string, unknown> | undefined)?.source ?? null,
  }).catch((err) =>
    log.warn('Plugin dispatch failed', { event: 'report.created', err: String(err) }),
  );

  // Check circuit breaker before invoking classification
  const shouldProcess = await checkCircuitBreaker(db);

  if (shouldProcess) {
    triggerClassification(reportId, projectId);
  } else {
    await db.from('reports').update({ status: 'queued' }).eq('id', reportId);
    log.warn('Circuit breaker open — report queued', { reportId });
  }

  return { ok: true, reportId };
}

async function checkCircuitBreaker(db: ReturnType<typeof getServiceClient>): Promise<boolean> {
  try {
    const { count: failedCount } = await db
      .from('processing_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('completed_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

    const { count: totalCount } = await db
      .from('processing_queue')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

    if (!totalCount || totalCount < 5) return true;
    return (failedCount ?? 0) / totalCount < 0.5;
  } catch {
    return true;
  }
}

export function triggerClassification(reportId: string, projectId: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const classifyPromise = fetch(`${supabaseUrl}/functions/v1/fast-filter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ reportId, projectId }),
    })
      .then(async (res) => {
        const db = getServiceClient();
        if (res.ok) {
          await db
            .from('processing_queue')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('report_id', reportId)
            .eq('status', 'pending');
        } else {
          const body = await res.text();
          await handleQueueFailure(db, reportId, `Stage 1 failed: ${res.status} ${body}`);
        }
      })
      .catch(async (err) => {
        const db = getServiceClient();
        await handleQueueFailure(db, reportId, String(err));
      });

    if (typeof globalThis.EdgeRuntime !== 'undefined') {
      (globalThis as any).EdgeRuntime.waitUntil(classifyPromise);
    }
  } catch (err) {
    log.error('Failed to invoke fast-filter', { reportId, err: String(err) });
  }
}

async function handleQueueFailure(
  db: ReturnType<typeof getServiceClient>,
  reportId: string,
  error: string,
) {
  const { data: item } = await db
    .from('processing_queue')
    .select('id, attempts, max_attempts')
    .eq('report_id', reportId)
    .eq('status', 'pending')
    .single();

  if (!item) return;

  const attempts = (item.attempts ?? 0) + 1;
  const isDead = attempts >= (item.max_attempts ?? 3);

  await db
    .from('processing_queue')
    .update({
      attempts,
      last_error: error,
      status: isDead ? 'dead_letter' : 'failed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id);

  if (isDead) {
    log.error('Report moved to dead letter queue', { reportId, attempts });
  }
}

export async function invokeFixWorker(dispatchId: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;

  // Local dev: the functions endpoint sits on localhost:54321/functions/v1.
  // Production: <project>.supabase.co/functions/v1. SUPABASE_URL is the
  // base of either. We never await this — the worker reports back via the
  // fix_dispatch_jobs row that the SSE endpoint subscribes to.
  await fetch(`${supabaseUrl}/functions/v1/fix-worker`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dispatchId }),
    // Don't block the dispatch response on the worker booting.
    signal: AbortSignal.timeout(2_000),
  }).catch(() => {
    /* worker is fire-and-forget */
  });
}
