import type { Context } from 'npm:hono@4';

import { getServiceClient } from '../_shared/db.ts';
import { propagateRequestId } from '../_shared/internal-headers.ts';
import { log } from '../_shared/logger.ts';
import { checkIngestQuota } from '../_shared/quota.ts';
import { getStorageAdapter } from '../_shared/storage.ts';
import { reportSubmissionSchema } from '../_shared/schemas.ts';
import { checkAntiGaming } from '../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../_shared/telemetry.ts';
import { awardPoints, awardPointsForEndUser } from '../_shared/reputation.ts';
import { resolveEndUser } from '../_shared/end-user-resolver.ts';
import { verifyEndUserToken } from '../_shared/end-user-identity.ts';
import { createNotification, buildNotificationMessage } from '../_shared/notifications.ts';
import { dispatchPluginEvent } from '../_shared/plugins.ts';
import { dbError } from './shared.ts';
import { isUuid } from './migration-progress-helpers.ts';
import { childTraceparent } from '../_shared/trace.ts';
// SEC (Wave 5 Gap-A): PII is now scrubbed at ingest so the at-rest copy in
// Postgres is already redacted. Previously scrubReport() only ran in
// classify-report before the LLM call — meaning raw emails, IPs, JWTs, and
// API keys were stored unmasked and visible to MCP mcp:read clients and any
// future data export. Scrubbing at insert time closes that gap.
import { scrubPii } from '../_shared/pii-scrubber.ts';
import { sendBotMessage, sendSlackText } from '../_shared/slack.ts';
import { upsertProjectSdkObservationAsync } from '../_shared/sdk-observation.ts';

// Fixed namespace for deriving deterministic report ids from non-UUID client
// ids (RFC 4122 §4.3 name-based v5). Arbitrary but stable — it only has to be
// constant so the same client id always maps to the same uuid.
const REPORT_ID_NAMESPACE = '7b2f0e1a-2c4d-4e6b-9f81-1d5a6c8e0f93';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Deterministic RFC 4122 v5 (name-based, SHA-1) UUID from an arbitrary string.
 * Same input → same output, so an SDK retry that resends the same non-UUID
 * client id collapses onto the existing `reports` row via the PK (23505)
 * idempotency path instead of failing the uuid cast (22P02).
 */
async function uuidV5FromName(name: string): Promise<string> {
  const ns = uuidToBytes(REPORT_ID_NAMESPACE);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Resolve the canonical `reports.id` (a Postgres `uuid`) from the client's
 * supplied report id. Valid UUIDs pass through unchanged. Legacy/native SDKs
 * that mint ad-hoc ids — React Native `rn-<ts>-<rand>`, the web insecure-
 * context `mushi_<hex>` fallback, or any non-TS SDK — are mapped
 * deterministically so the insert never throws 22P02 and drops the report
 * (Sentry MUSHI-MUSHI-SERVER-D). Absent ids get a fresh random uuid.
 */
async function resolveReportId(rawId: unknown): Promise<string> {
  if (typeof rawId === 'string' && rawId.length > 0) {
    return isUuid(rawId) ? rawId : await uuidV5FromName(rawId);
  }
  return crypto.randomUUID();
}

/** Window for collapsing identical rapid resubmits (double-click / SDK retry). */
const INGEST_CONTENT_DEDUP_WINDOW_MS = 60_000;

/**
 * Content-hash dedup: the SDK mints a fresh UUID per submit, so PK-only
 * idempotency (23505) never fires on double-click. Same reporter + same
 * scrubbed description + category within the window → return the existing row.
 */
async function findRecentDuplicateReport(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  tokenHash: string,
  description: string,
  category: string,
): Promise<string | null> {
  const since = new Date(Date.now() - INGEST_CONTENT_DEDUP_WINDOW_MS).toISOString();
  const { data } = await db
    .from('reports')
    .select('id')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .eq('description', description)
    .eq('user_category', category)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

const SDK_WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const SDK_WIDGET_THEMES = ['auto', 'light', 'dark'] as const;
const SDK_SCREENSHOT_MODES = ['on-report', 'auto', 'off'] as const;
const SDK_NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const;
const SDK_WIDGET_LAUNCHERS = ['auto', 'banner', 'edge-tab', 'manual', 'hidden'] as const;
const SDK_BANNER_VARIANTS = ['neon', 'brand', 'subtle'] as const;
const SDK_BANNER_POSITIONS = ['top', 'bottom'] as const;

export interface SdkConfigRow {
  project_id?: string;
  sdk_config_enabled?: boolean | null;
  sdk_widget_position?: string | null;
  sdk_widget_theme?: string | null;
  sdk_widget_trigger_text?: string | null;
  /** Launcher mode: 'auto' (FAB), 'banner', 'edge-tab', 'manual', 'hidden'. */
  sdk_widget_launcher?: string | null;
  /** Banner strip variant when launcher is 'banner'. */
  sdk_banner_variant?: string | null;
  /** Banner strip position. */
  sdk_banner_position?: string | null;
  /** Banner bug CTA label override. */
  sdk_banner_bug_cta?: string | null;
  /** Whether to show the feature-request CTA in the banner. */
  sdk_banner_feature_cta?: boolean | null;
  /** Rich banner body copy (Beta announcement line). */
  sdk_banner_message?: string | null;
  /** Rich banner pill label (e.g. Beta). */
  sdk_banner_label?: string | null;
  /**
   * Screenshot privacy caption control. NULL = use the SDK default caption,
   * '' (empty) = hide the caption (maps to `false`), any other string = custom
   * caption copy. Surfaces in the widget block as `screenshotSensitiveHint`.
   */
  sdk_screenshot_sensitive_hint?: string | null;
  sdk_capture_console?: boolean | null;
  sdk_capture_network?: boolean | null;
  sdk_capture_performance?: boolean | null;
  sdk_capture_screenshot?: string | null;
  sdk_capture_element_selector?: boolean | null;
  sdk_native_trigger_mode?: string | null;
  sdk_min_description_length?: number | null;
  sdk_config_updated_at?: string | null;
  reporter_notifications_enabled?: boolean | null;
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
      launcher: oneOf(row?.sdk_widget_launcher, SDK_WIDGET_LAUNCHERS, 'auto'),
      bannerVariant: oneOf(row?.sdk_banner_variant, SDK_BANNER_VARIANTS, 'brand'),
      bannerPosition: oneOf(row?.sdk_banner_position, SDK_BANNER_POSITIONS, 'top'),
      bannerBugCta: row?.sdk_banner_bug_cta ?? null,
      bannerFeatureCta: row?.sdk_banner_feature_cta ?? true,
      bannerMessage: row?.sdk_banner_message ?? null,
      bannerLabel: row?.sdk_banner_label ?? null,
      // Only surface the hint when the console has set it (non-null), so an
      // unset column never overrides a host-configured value. '' → false
      // (hide caption); any other string → custom caption.
      ...(row?.sdk_screenshot_sensitive_hint != null
        ? {
            screenshotSensitiveHint:
              row.sdk_screenshot_sensitive_hint === '' ? false : row.sdk_screenshot_sensitive_hint,
          }
        : {}),
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
    reporterNotificationsEnabled: row?.reporter_notifications_enabled !== false,
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
  if (isOneOf(widget.launcher, SDK_WIDGET_LAUNCHERS)) updates.sdk_widget_launcher = widget.launcher;
  if (isOneOf(widget.bannerVariant, SDK_BANNER_VARIANTS)) updates.sdk_banner_variant = widget.bannerVariant;
  if (isOneOf(widget.bannerPosition, SDK_BANNER_POSITIONS)) updates.sdk_banner_position = widget.bannerPosition;
  if (typeof widget.bannerBugCta === 'string') {
    const trimmed = widget.bannerBugCta.trim();
    updates.sdk_banner_bug_cta = trimmed ? widget.bannerBugCta.slice(0, 60) : null;
  }
  if (typeof widget.bannerFeatureCta === 'boolean') updates.sdk_banner_feature_cta = widget.bannerFeatureCta;
  if (typeof widget.bannerMessage === 'string') {
    const trimmed = widget.bannerMessage.trim();
    updates.sdk_banner_message = trimmed ? trimmed.slice(0, 240) : null;
  } else if (widget.bannerMessage === null) {
    updates.sdk_banner_message = null;
  }
  if (typeof widget.bannerLabel === 'string') {
    const trimmed = widget.bannerLabel.trim();
    updates.sdk_banner_label = trimmed ? trimmed.slice(0, 24) : null;
  } else if (widget.bannerLabel === null) {
    updates.sdk_banner_label = null;
  }
  // screenshotSensitiveHint: boolean | string | null.
  //   true  → NULL  (use the SDK's localized default caption)
  //   false → ''    (hide the caption; normalizeSdkConfig maps '' back to false)
  //   string → custom caption (empty/whitespace falls back to NULL = default)
  //   null  → NULL  (clear the override)
  if (typeof widget.screenshotSensitiveHint === 'boolean') {
    updates.sdk_screenshot_sensitive_hint = widget.screenshotSensitiveHint ? null : '';
  } else if (typeof widget.screenshotSensitiveHint === 'string') {
    const trimmed = widget.screenshotSensitiveHint.trim();
    updates.sdk_screenshot_sensitive_hint = trimmed ? trimmed.slice(0, 200) : null;
  } else if (widget.screenshotSensitiveHint === null) {
    updates.sdk_screenshot_sensitive_hint = null;
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
      Math.min(1000, Math.round(Number(native.minDescriptionLength))),
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
  // Write gate for SDK config. Three paths to "yes":
  //   1. Direct project owner.
  //   2. Org owner/admin (Teams v1) — they implicitly own all projects.
  //   3. Per-project owner/admin (legacy project_members rows).
  // Member/viewer roles intentionally excluded — they can read but not
  // mutate the SDK config.
  const { data: project } = await db
    .from('projects')
    .select('owner_id, organization_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return false;

  if ((project as { owner_id?: string | null }).owner_id === userId) return true;

  if ((project as { organization_id?: string | null }).organization_id) {
    const { data: orgMember } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', (project as { organization_id: string }).organization_id)
      .eq('user_id', userId)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    if (orgMember) return true;
  }

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
/**
 * Reporter identity supplied by the host app via `Mushi.identify()`.
 * The web SDK nests it as `metadata.user = { id, email, name, provider }`.
 * Older / divergent SDK builds (e.g. React Native <= 0.16) flattened it to
 * `metadata.userId / userEmail / userName / userProvider`. Sentry's scope
 * `user` is a third source. We read all three so a real signed-in user is
 * never dropped to an anonymous token hash on the report detail page.
 */
export function resolveReporterIdentity(
  metadata: Record<string, unknown> | undefined,
  sentryUser?: { id?: string; email?: string; name?: string } | undefined,
): { id?: string; email?: string; name?: string; provider?: string } {
  const meta = metadata ?? {};
  const nested = (meta.user as { id?: string; email?: string; name?: string; provider?: string } | undefined) ?? undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  return {
    id: nested?.id ?? str(meta.userId) ?? sentryUser?.id,
    email: nested?.email ?? str(meta.userEmail) ?? sentryUser?.email,
    name: nested?.name ?? str(meta.userName) ?? sentryUser?.name,
    provider: nested?.provider ?? str(meta.userProvider),
  };
}

export async function ingestReport(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  body: Record<string, any>,
  options?: {
    ipAddress?: string
    userAgent?: string
    /** Mushi Bounties: link the ingested report back to the tester and submission row. */
    testerId?: string
    testerSubmissionId?: string
    /**
     * Signed identity JWT from the SDK's X-Mushi-User-Token header.
     * When present and the project has an identity secret configured the JWT is
     * verified and the report is linked to a verified end_user row
     * (jwt_verified_at set). Fail-open: a missing secret or invalid token
     * falls back to unsigned resolveEndUser without blocking ingest.
     */
    userToken?: string
  },
): Promise<{ ok: boolean; reportId?: string; error?: string; deduplicated?: boolean }> {
  const normalizedBody = { ...body };
  if (typeof normalizedBody.description === 'string') {
    const trimmed = normalizedBody.description.trim();
    if (trimmed.length > 0 && trimmed.length < 20) {
      const annotated = `${trimmed} — SDK自動記録`;
      // Pad to schema minimum (20 chars) in case trimmed was very short
      normalizedBody.description = annotated.length >= 20 ? annotated : annotated.padEnd(20, ' ');
    }
  }

  const parsed = reportSubmissionSchema.safeParse(normalizedBody);
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
  let replayPath: string | null = null;

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

  const replayEvents = (report as { replayEvents?: unknown[] }).replayEvents;
  const replayMeta: Record<string, unknown> = {};
  if (Array.isArray(replayEvents) && replayEvents.length > 0) {
    // Enforce the per-project replay-capture gate server-side. Replay events can
    // carry DOM/PII, so never persist them unless the project explicitly opted in
    // via `project_settings.sdk_capture_replay` — even if a stale or tampered SDK
    // attaches them to the payload.
    const { data: replaySetting } = await db
      .from('project_settings')
      .select('sdk_capture_replay')
      .eq('project_id', projectId)
      .maybeSingle();
    if (replaySetting?.sdk_capture_replay === true) {
      replayMeta.replayEventCount = replayEvents.length;
      // Keep a capped inline copy for console playback when object storage is unavailable.
      if (replayEvents.length <= 120) {
        replayMeta.replayEvents = replayEvents;
      }
      try {
        const json = JSON.stringify(replayEvents);
        const bytes = new TextEncoder().encode(json);
        if (bytes.byteLength <= 1_500_000) {
          const key = `${projectId}/replays/${crypto.randomUUID()}.json`;
          const adapter = await getStorageAdapter(projectId);
          const result = await adapter.upload({
            key,
            body: bytes,
            contentType: 'application/json',
          });
          replayPath = result.storagePath;
        }
      } catch (err) {
        log.error('Replay upload failed', { err: String(err) });
      }
    }
  }

  const reportId = await resolveReportId(report.id);

  // Strip null bytes (`\u0000`) from user-supplied TEXT fields: Postgres
  // TEXT columns reject them with 22P05 (invalid_text_representation → 400),
  // which is the most plausible root-cause of the rare `reports` insert 400s
  // we see when clients paste HTML/binary-ish content into the description
  // (Sentry scrubs the server-side error, so we also rename the log field
  // from `error` → `errMsg` below so it survives default scrubbers).
  const sanitizeText = (s: string | undefined | null): string | null =>
    typeof s === 'string' ? s.replace(/\u0000/g, '') : (s ?? null);

  // 2026-05-07 SDK boost: breadcrumbs / tags / sentryContext arrived as
  // top-level fields on the report shape. As of migration
  // `20260507120000_sdk_observability_columns` they get promoted to
  // first-class jsonb / text columns so the admin /reports UI can
  // filter "tags @> '{feature: checkout-v2}'" via the GIN index and
  // correlate to Sentry distributed traces by `sentry_trace_id`.
  //
  // We ALSO keep them inside `custom_metadata` for ~1 release cycle so
  // older API consumers (scripts, MCP tools) that haven't been updated
  // to read the dedicated columns don't suddenly stop seeing the data.
  // After GA we'll drop the duplicate write.
  const richSentryContext = (report as { sentryContext?: Record<string, unknown> }).sentryContext;
  const sentryEventId =
    sanitizeText(report.sentryEventId) ??
    (typeof richSentryContext?.eventId === 'string' ? richSentryContext.eventId : null);
  const sentryReplayId =
    sanitizeText(report.sentryReplayId) ??
    (typeof richSentryContext?.replayId === 'string' ? richSentryContext.replayId : null);
  const sentryTraceId =
    typeof richSentryContext?.traceId === 'string' ? richSentryContext.traceId : null;
  const sentryRelease =
    typeof richSentryContext?.release === 'string' ? richSentryContext.release : null;
  const sentryEnvironment =
    typeof richSentryContext?.environment === 'string' ? richSentryContext.environment : null;

  const rawBreadcrumbs = (report as { breadcrumbs?: unknown }).breadcrumbs;
  const rawTags = (report as { tags?: unknown }).tags;
  const breadcrumbsCol = Array.isArray(rawBreadcrumbs) ? rawBreadcrumbs : null;
  const tagsCol =
    rawTags && typeof rawTags === 'object' && !Array.isArray(rawTags)
      ? (rawTags as Record<string, unknown>)
      : null;
  const enrichedMetadata: Record<string, unknown> = {
    ...(report.metadata ?? {}),
    ...(breadcrumbsCol ? { breadcrumbs: breadcrumbsCol } : {}),
    ...(tagsCol ? { tags: tagsCol } : {}),
    ...(richSentryContext ? { sentry: richSentryContext } : {}),
    ...(replayPath ? { replayPath, ...replayMeta } : replayMeta),
  };

  // Normalise reporter identity across SDK shapes (nested metadata.user, flat
  // metadata.userId/*, or Sentry scope) so the same logic drives both the
  // reports.reporter_user_id column and the end_users linkage below.
  const reporterIdentity = resolveReporterIdentity(
    report.metadata as Record<string, unknown> | undefined,
    richSentryContext?.user as { id?: string; email?: string; name?: string } | undefined,
  );

  // If the SDK included a W3C traceparent (either from the page's APM or
  // self-generated by the SDK), mint a child span and store it so downstream
  // Edge Functions (classify-report, fix-worker) can propagate it forward.
  const inboundTraceparent =
    typeof (report.metadata as Record<string, unknown> | undefined)?.traceparent === 'string'
      ? (report.metadata as Record<string, unknown>).traceparent as string
      : null
  const reportTraceparent = childTraceparent(inboundTraceparent)
  enrichedMetadata.traceparent = reportTraceparent

  // SEC (Wave 5 Gap-G): validate screenshot_url at ingest so hostile URLs never
  // reach the DB. The allowlist mirrors the same logic in classify-report
  // (isAllowedScreenshotUrl) — both gates must agree; the ingest gate is the
  // primary defence, classify-report is defence-in-depth.
  const safeScreenshotUrl = screenshotUrl ? validateScreenshotUrlIngest(screenshotUrl) : null;

  // SEC (Wave 5 Gap-A): scrub PII from text fields before writing to Postgres.
  // This ensures the at-rest copy is already redacted — not just the pre-LLM copy.
  const safeDescription = scrubPii(sanitizeText(report.description) ?? '');
  const safeUserIntent = scrubPii(sanitizeText(report.userIntent) ?? '') || null;

  const recentDuplicateId = await findRecentDuplicateReport(
    db,
    projectId,
    tokenHash,
    safeDescription,
    report.userCategory ?? report.category ?? 'other',
  );
  if (recentDuplicateId) {
    log.info('Content-deduped report ingest', {
      reportId: recentDuplicateId,
      projectId,
      windowMs: INGEST_CONTENT_DEDUP_WINDOW_MS,
    });
    return { ok: true, reportId: recentDuplicateId, deduplicated: true };
  }
  const safeConsoleLogs = Array.isArray(report.consoleLogs)
    ? report.consoleLogs.map((entry: Record<string, unknown>) => ({
        ...entry,
        message: typeof entry.message === 'string' ? scrubPii(entry.message) : entry.message,
      }))
    : report.consoleLogs;
  const safeNetworkLogs = Array.isArray(report.networkLogs)
    ? report.networkLogs.map((entry: Record<string, unknown>) => {
        const scrubHeaders = (raw: unknown): unknown => {
          if (!raw || typeof raw !== 'object') return raw;
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            // Always redact Authorization / Cookie headers — they carry bearer tokens.
            const lower = k.toLowerCase();
            if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') {
              out[k] = '[redacted]';
            } else {
              out[k] = typeof v === 'string' ? scrubPii(v) : v;
            }
          }
          return out;
        };
        if (typeof entry.url !== 'string') return {
          ...entry,
          requestHeaders: scrubHeaders(entry.requestHeaders),
          responseHeaders: scrubHeaders(entry.responseHeaders),
        };
        try {
          const u = new URL(entry.url);
          u.searchParams.forEach((_v: string, k: string) => {
            u.searchParams.set(k, scrubPii(u.searchParams.get(k)!));
          });
          return {
            ...entry,
            url: scrubPii(u.toString()),
            requestHeaders: scrubHeaders(entry.requestHeaders),
            responseHeaders: scrubHeaders(entry.responseHeaders),
          };
        } catch {
          return {
            ...entry,
            requestHeaders: scrubHeaders(entry.requestHeaders),
            responseHeaders: scrubHeaders(entry.responseHeaders),
          };
        }
      })
    : report.networkLogs;

  const { error: insertError } = await db.from('reports').insert({
    id: reportId,
    project_id: projectId,
    description: safeDescription,
    user_category: report.userCategory ?? report.category,
    user_intent: safeUserIntent,
    screenshot_url: safeScreenshotUrl,
    screenshot_path: screenshotPath,
    environment: report.environment ?? {},
    console_logs: safeConsoleLogs,
    network_logs: safeNetworkLogs,
    performance_metrics: report.performanceMetrics,
    repro_timeline: report.timeline,
    selected_element: report.selectedElement,
    custom_metadata: Object.keys(enrichedMetadata).length > 0 ? enrichedMetadata : null,
    breadcrumbs: breadcrumbsCol,
    tags: tagsCol,
    sentry_trace_id: sentryTraceId,
    sentry_release: sentryRelease,
    sentry_environment: sentryEnvironment,
    proactive_trigger: sanitizeText(report.proactiveTrigger),
    category: report.category ?? 'other',
    status: 'new',
    reporter_token_hash: tokenHash,
    reporter_user_id: reporterIdentity.id,
    session_id: sanitizeText(report.sessionId),
    app_version: sanitizeText(
      report.appVersion ??
        (typeof (report.metadata as Record<string, unknown> | undefined)?.appVersion === 'string'
          ? ((report.metadata as Record<string, unknown>).appVersion as string)
          : null),
    ),
    sdk_package: sanitizeText(report.sdkPackage),
    sdk_version: sanitizeText(report.sdkVersion),
    sentry_event_id: sentryEventId,
    sentry_replay_id: sentryReplayId,
    queued_at: report.queuedAt,
    synced_at: new Date().toISOString(),
    created_at: report.createdAt,
    // Mushi Bounties tester linkage (Wave 6)
    ...(options?.testerId ? { tester_id: options.testerId } : {}),
    ...(options?.testerSubmissionId ? { tester_submission_id: options.testerSubmissionId } : {}),
  });

  if (insertError) {
    const errCode = (insertError as { code?: string }).code;
    // 23505 = unique_violation on the PK (reports.id). The SDK sends a stable
    // UUID per logical attempt and retries on network failure — so a 23505 means
    // the report was already stored on a previous attempt. Treat it as success
    // (idempotent semantics) and return the existing reportId to the SDK so it
    // stops retrying. Before returning, ensure the processing_queue row exists:
    // the first attempt may have crashed after the reports insert but before
    // the queue insert, leaving the report permanently un-classified.
    if (errCode === '23505') {
      log.info('Duplicate report id — already stored, returning existing', { reportId });
      const { count: qCount } = await db
        .from('processing_queue')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('stage', 'stage1')
        .in('status', ['pending', 'processing']);
      if ((qCount ?? 0) === 0) {
        // Queue row missing — re-insert to unblock classification on the retry.
        const { error: reQueueErr } = await db.from('processing_queue').insert({
          report_id: reportId,
          project_id: projectId,
          stage: 'stage1',
          status: 'pending',
        });
        if (reQueueErr && (reQueueErr as { code?: string }).code !== '23505') {
          log.warn('Re-queue after duplicate report failed', { reportId, errMsg: reQueueErr.message });
        }
      }
      return { ok: true, reportId };
    }
    log.error('Report insert failed', {
      reportId,
      // Renamed from `error` → `errMsg` so Sentry's default data scrubbers
      // don't mask the actual Postgres failure. Without this we only see
      // `"[Filtered]"` in Sentry and can't triage the root cause.
      errMsg: insertError.message,
      errCode,
      errDetails: (insertError as { details?: string }).details,
      errHint: (insertError as { hint?: string }).hint,
    });
    return { ok: false, error: 'Failed to store report' };
  }

  if (report.sdkPackage && report.sdkVersion) {
    upsertProjectSdkObservationAsync(db, {
      projectId,
      sdkPackage: report.sdkPackage,
      sdkVersion: report.sdkVersion,
      source: 'report',
      observedAt: report.createdAt ?? new Date().toISOString(),
    });
  }

  // Link the report to an end_user. Two paths:
  //
  // 1. Verified path (preferred): when the SDK forwards X-Mushi-User-Token and
  //    the project has an identity secret, verifyEndUserToken() authenticates the
  //    JWT and upserts an end_users row with jwt_verified_at set. The verified
  //    external_user_id / display_name / email_hash take precedence over the
  //    unsigned identify() metadata.
  //
  // 2. Unsigned path (fallback): unsigned identify() metadata from the report
  //    payload is resolved via resolveEndUser as before. jwt_verified_at stays
  //    null. Used when no token is present or verification fails.
  //
  // Both paths are fire-and-forget — linkage must never block ingest.
  void (async () => {
    try {
      // Attempt verified path first.
      if (options?.userToken) {
        const verified = await verifyEndUserToken(db, projectId, options.userToken).catch(
          (err: unknown) => {
            log.warn('verifyEndUserToken threw (fail-open)', { reportId, err: String(err) });
            return null;
          },
        );
        if (verified?.endUserId) {
          await db
            .from('reports')
            .update({ end_user_id: verified.endUserId, reporter_user_id: verified.externalUserId })
            .eq('id', reportId);
          log.info('Report linked to verified end_user', {
            reportId,
            endUserId: verified.endUserId,
            externalUserId: verified.externalUserId,
          });
          await awardPointsForEndUser(db, {
            projectId,
            organizationId: verified.organizationId,
            endUserId: verified.endUserId,
            action: 'report.submitted',
            reporterTokenHash: tokenHash,
            reportId,
            metadata: { source: 'sdk_report_verified' },
          }).catch((err: unknown) =>
            log.warn('report.submitted award failed (verified)', { reportId, err: String(err) }),
          );
          return; // Verified path done — skip unsigned fallback.
        }
      }

      // Unsigned fallback: use identity from the report payload's metadata.
      const reporterUserId = reporterIdentity.id ? reporterIdentity : undefined;
      if (!reporterUserId?.id) return;
      const { data: proj } = await db
        .from('projects')
        .select('organization_id')
        .eq('id', projectId)
        .single();
      const organizationId = proj?.organization_id;
      if (!organizationId) return;
      const endUser = await resolveEndUser(db, {
        organizationId,
        externalUserId: reporterUserId.id!,
        traits: {
          email: reporterUserId.email ?? null,
          name: reporterUserId.name ?? null,
          provider: reporterUserId.provider ?? null,
        },
        reporterTokenHash: tokenHash,
      });
      if (endUser?.id) {
        await db
          .from('reports')
          .update({ end_user_id: endUser.id })
          .eq('id', reportId);
        log.info('Report linked to end_user (unsigned)', { reportId, endUserId: endUser.id });

        // D1: award report.submitted points.
        await awardPointsForEndUser(db, {
          projectId,
          organizationId,
          endUserId: endUser.id,
          action: 'report.submitted',
          reporterTokenHash: tokenHash,
          reportId,
          metadata: { source: 'sdk_report' },
        }).catch((err: unknown) =>
          log.warn('report.submitted award failed', { reportId, err: String(err) }),
        );
      }
    } catch (err) {
      log.warn('end_user linkage failed', { reportId, err: String(err) });
    }
  })();

  // Insert into processing queue. Uses upsert with ignoreDuplicates so
  // a retry (after a crash between the reports insert and this line) doesn't
  // create a duplicate stage1 entry. The unique constraint on (report_id, stage)
  // enforces idempotency; if neither the DB constraint nor the ignoreDuplicates
  // flag exist yet (legacy schema), the 23505 error is logged as a warning so
  // the duplicate entry is visible but doesn't fail the ingest.
  const { error: queueError } = await db.from('processing_queue').upsert(
    { report_id: reportId, project_id: projectId, stage: 'stage1', status: 'pending' },
    { onConflict: 'report_id,stage', ignoreDuplicates: true },
  );
  if (queueError) {
    const qErrCode = (queueError as { code?: string }).code;
    if (qErrCode === '23505') {
      // Duplicate queue entry — report was already queued on a prior attempt; safe to ignore.
      log.info('Queue entry already exists (idempotent retry)', { reportId });
    } else {
      // Real failure: the report is stored but will not be classified unless the
      // scheduled reconciler picks it up. Elevated to error so monitoring alerts fire.
      log.error('Queue insert failed — report stored but not queued for classification', {
        reportId,
        errMsg: queueError.message,
        errCode: qErrCode,
      });
    }
  }

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
  // try/catch guards against synchronous throws (e.g. ReferenceError during a
  // deploy gap) that would otherwise escape through the async call chain and
  // surface as a 500 on the ingest endpoint even though the report was saved.
  try {
    void dispatchPluginEvent(db, projectId, 'report.created', {
      report: {
        id: reportId,
        status: 'new',
        category: report.category,
        title: report.description?.slice(0, 80),
      },
      source: (report.metadata as Record<string, unknown> | undefined)?.source ?? null,
    }).then(undefined, (err: unknown) =>
      log.warn('Plugin dispatch failed', { event: 'report.created', err: String(err) }),
    );
  } catch (err) {
    log.warn('Plugin dispatch failed (sync)', { event: 'report.created', err: String(err) });
  }

  // Check circuit breaker before invoking classification
  const shouldProcess = await checkCircuitBreaker(db);

  if (shouldProcess) {
    triggerClassification(reportId, projectId);
  } else {
    await db.from('reports').update({ status: 'queued' }).eq('id', reportId);
    log.warn('Circuit breaker open — report queued', { reportId });
    // Notify Slack so a queued-but-unclassified report is never silent.
    // Fire-and-forget; channel/webhook fetched from project_settings.
    void (async () => {
      try {
        const { data: ps } = await db
          .from('project_settings')
          .select('slack_webhook_url, slack_channel_id, slack_bot_token_ref')
          .eq('project_id', projectId)
          .maybeSingle();
        const text = `⚠️ New report queued (classification paused — circuit breaker open)\n• Report: \`${reportId}\`\n• Category: ${report?.category ?? 'unknown'}\nCheck the Mushi console to re-enable classification.`;
        if (ps?.slack_webhook_url) {
          await sendSlackText(ps.slack_webhook_url, text);
        } else if (ps?.slack_channel_id) {
          await sendBotMessage({ channel: ps.slack_channel_id, text, db, projectId });
        }
      } catch (err) {
        log.warn('Circuit-breaker Slack notify failed', { reportId, err: String(err) });
      }
    })();
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

export function triggerClassification(reportId: string, projectId: string, requestId?: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const classifyPromise = fetch(`${supabaseUrl}/functions/v1/fast-filter`, {
      method: 'POST',
      headers: propagateRequestId(
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        requestId,
      ),
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

    if (typeof (globalThis as unknown as Record<string, unknown>).EdgeRuntime !== 'undefined') {
      (globalThis as unknown as Record<string, unknown> & { EdgeRuntime: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime.waitUntil(classifyPromise);
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

export async function invokeFixWorker(dispatchId: string, requestId?: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;

  // Local dev: the functions endpoint sits on localhost:54321/functions/v1.
  // Production: <project>.supabase.co/functions/v1. SUPABASE_URL is the
  // base of either. We never await this — the worker reports back via the
  // fix_dispatch_jobs row that the SSE endpoint subscribes to.
  await fetch(`${supabaseUrl}/functions/v1/fix-worker`, {
    method: 'POST',
    headers: propagateRequestId(
      {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      requestId,
    ),
    body: JSON.stringify({ dispatchId }),
    // Don't block the dispatch response on the worker booting.
    signal: AbortSignal.timeout(2_000),
  }).catch(() => {
    /* worker is fire-and-forget */
  });
}

/**
 * SEC (Wave 5 Gap-G): validate a screenshot URL at ingest time so hostile URLs
 * never reach Postgres. Returns null when the URL is invalid or blocked.
 *
 * This mirrors the isAllowedScreenshotUrl() check in classify-report (which
 * guards the Anthropic vision call). Both gates must agree; this one is the
 * primary defence — classify-report is defence-in-depth.
 *
 * Allowlist defaults to *.supabase.co / *.supabase.in / *.supabase.red.
 * Extendable via MUSHI_SCREENSHOT_HOST_ALLOWLIST (comma-separated suffixes).
 */
function validateScreenshotUrlIngest(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log.warn('screenshot_url rejected at ingest: invalid URL', { raw: raw.slice(0, 80) });
    return null;
  }

  if (url.protocol !== 'https:') {
    log.warn('screenshot_url rejected at ingest: non-https scheme', { protocol: url.protocol });
    return null;
  }

  const host = url.hostname.toLowerCase();
  // Block SSRF targets / private ranges (IPv4 + IPv6).
  if (
    host === 'localhost' ||
    /^127\./.test(host) ||          // 127.0.0.0/8 loopback
    host === '::1' ||               // IPv6 loopback
    host.startsWith('::ffff:') ||   // IPv4-mapped IPv6
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('169.254.') ||  // link-local IPv4
    /^fe80:/i.test(host) ||         // link-local IPv6
    /^f[cd]/i.test(host) ||         // ULA fc00::/7 (fd00::, fc00::)
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    log.warn('screenshot_url rejected at ingest: private/metadata host', { host });
    return null;
  }

  const defaultAllow = ['.supabase.co', '.supabase.in', '.supabase.red'];
  const envExtras = (Deno.env.get('MUSHI_SCREENSHOT_HOST_ALLOWLIST') ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const allowlist = [...defaultAllow, ...envExtras];

  const allowed = allowlist.some((suffix: string) => host === suffix.replace(/^\./, '') || host.endsWith(suffix));
  if (!allowed) {
    log.warn('screenshot_url rejected at ingest: host not in allowlist', { host });
    return null;
  }

  return raw;
}
