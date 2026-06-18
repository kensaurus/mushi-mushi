import type { Hono, Context } from 'npm:hono@4';
import type { Variables } from '../types.ts'
import { streamSSE } from 'npm:hono@4/streaming';

import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts';
import { AguiEmitter } from '../../_shared/agui.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reportError } from '../../_shared/sentry.ts';
import { apiKeyAuth, jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import {
  requireFeature,
  resolveActiveEntitlement,
  GATED_ROUTES,
  type FeatureFlag,
} from '../../_shared/entitlements.ts';
import { requireSuperAdmin } from '../../_shared/super-admin.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { currentRegion, lookupProjectRegion, regionEndpoint } from '../../_shared/region.ts';
import { createWebhookMiddleware, ReplayAttackError, RateLimitError } from '../../_shared/webhook-middleware.ts';
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { reportSubmissionSchema, discoveryEventSchema } from '../../_shared/schemas.ts';
import { checkAntiGaming } from '../../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../../_shared/telemetry.ts';
import { awardPoints, getReputation } from '../../_shared/reputation.ts';
import { createNotification, buildNotificationMessage } from '../../_shared/notifications.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { getActivePlugins, dispatchPluginEvent } from '../../_shared/plugins.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds, callerProjectIds } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';
import { registerReporterFeatureBoardRoutes } from './reporter-feature-board.ts';

// Upper bound for reporter-supplied notes that feed `mushi_apply_reporter_feedback`
// (these can seed a reopened child report's description). Keeps a hostile or
// runaway client from creating oversized reports through the public routes.
const REPORTER_NOTE_MAX = 2000;

export function registerPublicRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // SDK ROUTES (API key auth)
  // ============================================================

  const SDK_WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  const SDK_WIDGET_THEMES = ['auto', 'light', 'dark'] as const;
  const SDK_SCREENSHOT_MODES = ['on-report', 'auto', 'off'] as const;
  const SDK_NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const;
  const SDK_WIDGET_LAUNCHERS = ['auto', 'banner', 'edge-tab', 'manual', 'hidden'] as const;
  const SDK_BANNER_VARIANTS = ['neon', 'brand', 'subtle'] as const;
  const SDK_BANNER_POSITIONS_LOCAL = ['top', 'bottom'] as const;

  type SdkWidgetPosition = (typeof SDK_WIDGET_POSITIONS)[number];
  type SdkWidgetTheme = (typeof SDK_WIDGET_THEMES)[number];
  type SdkScreenshotMode = (typeof SDK_SCREENSHOT_MODES)[number];
  type SdkNativeTriggerMode = (typeof SDK_NATIVE_TRIGGER_MODES)[number];

  interface SdkConfigRow {
    project_id?: string;
    sdk_config_enabled?: boolean | null;
    sdk_widget_position?: string | null;
    sdk_widget_theme?: string | null;
    sdk_widget_trigger_text?: string | null;
    sdk_widget_launcher?: string | null;
    sdk_banner_variant?: string | null;
    sdk_banner_position?: string | null;
    sdk_banner_bug_cta?: string | null;
    sdk_banner_feature_cta?: boolean | null;
    sdk_banner_message?: string | null;
    sdk_banner_label?: string | null;
    sdk_capture_console?: boolean | null;
    sdk_capture_network?: boolean | null;
    sdk_capture_performance?: boolean | null;
    sdk_capture_screenshot?: string | null;
    sdk_capture_element_selector?: boolean | null;
    sdk_native_trigger_mode?: string | null;
    sdk_min_description_length?: number | null;
    sdk_config_updated_at?: string | null;
    // Workstream E — page-aware assistant.
    assistant_enabled?: boolean | null;
    assistant_label?: string | null;
    assistant_greeting?: string | null;
    assistant_suggestions?: unknown;
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

  function normalizeSdkConfig(row?: SdkConfigRow | null) {
    return {
      enabled: row?.sdk_config_enabled ?? true,
      version: row?.sdk_config_updated_at ?? null,
      widget: {
        position: oneOf(row?.sdk_widget_position, SDK_WIDGET_POSITIONS, 'bottom-right'),
        theme: oneOf(row?.sdk_widget_theme, SDK_WIDGET_THEMES, 'auto'),
        triggerText: row?.sdk_widget_trigger_text ?? null,
        launcher: oneOf(row?.sdk_widget_launcher, SDK_WIDGET_LAUNCHERS, 'auto'),
        bannerVariant: oneOf(row?.sdk_banner_variant, SDK_BANNER_VARIANTS, 'brand'),
        bannerPosition: oneOf(row?.sdk_banner_position, SDK_BANNER_POSITIONS_LOCAL, 'top'),
        bannerBugCta: row?.sdk_banner_bug_cta ?? null,
        bannerFeatureCta: row?.sdk_banner_feature_cta ?? true,
        bannerMessage: row?.sdk_banner_message ?? null,
        bannerLabel: row?.sdk_banner_label ?? null,
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
      // Workstream E — page-aware assistant. `enabled` gates the "Ask" tab in the
      // widget; greeting/suggestions are display-only. The knowledge corpus and
      // LLM keys never leave the server (POST /v1/sdk/assistant).
      assistant: {
        enabled: row?.assistant_enabled ?? false,
        label: (typeof row?.assistant_label === 'string' && row.assistant_label.trim())
          ? row.assistant_label.trim().slice(0, 24)
          : 'Ask',
        greeting: typeof row?.assistant_greeting === 'string' ? row.assistant_greeting.slice(0, 400) : null,
        suggestions: Array.isArray(row?.assistant_suggestions)
          ? (row.assistant_suggestions as unknown[])
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .map((s) => s.trim().slice(0, 120))
              .slice(0, 6)
          : [],
      },
    };
  }

  function coerceSdkConfigUpdate(body: Record<string, unknown>): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    const widget = isRecord(body.widget) ? body.widget : {};
    const capture = isRecord(body.capture) ? body.capture : {};
    const native = isRecord(body.native) ? body.native : {};

    if (typeof body.enabled === 'boolean') updates.sdk_config_enabled = body.enabled;
    if (isOneOf(widget.position, SDK_WIDGET_POSITIONS))
      updates.sdk_widget_position = widget.position;
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
        Math.min(1000, Math.round(native.minDescriptionLength as number)),
      );
    }
    updates.sdk_config_updated_at = new Date().toISOString();
    return updates;
  }

  async function canManageProjectSdkConfig(
    db: ReturnType<typeof getServiceClient>,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    // Mirrors api/helpers.ts canManageProjectSdkConfig — kept as a private
    // copy here because public.ts mounts on the public path and avoids
    // importing from the admin barrel. Three paths to allowed: direct
    // project owner, org owner/admin (Teams v1), or legacy
    // project_members owner/admin.
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

  app.get('/v1/sdk/latest-version', async (c) => {
    const packageName = c.req.query('package')?.trim();
    if (!packageName) {
      return c.json(
        { ok: false, error: { code: 'MISSING_PACKAGE', message: 'package query parameter is required' } },
        400,
      );
    }

    const db = getServiceClient();
    const { data, error } = await db
      .from('sdk_versions')
      .select('package, version, deprecated, deprecation_message, released_at')
      .eq('package', packageName)
      .order('released_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return dbError(c, error);
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return c.json({
      ok: true,
      data: {
        package: packageName,
        latest: data?.version ?? null,
        deprecated: data?.deprecated ?? false,
        deprecationMessage: data?.deprecation_message ?? null,
        releasedAt: data?.released_at ?? null,
      },
    });
  });

  app.get('/v1/sdk/config', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const db = getServiceClient();
    const { data, error } = await db
      .from('project_settings')
      .select(
        'sdk_config_enabled, sdk_widget_position, sdk_widget_theme, sdk_widget_trigger_text, ' +
          'sdk_widget_launcher, sdk_banner_variant, sdk_banner_position, sdk_banner_bug_cta, sdk_banner_feature_cta, sdk_banner_message, sdk_banner_label, ' +
          'sdk_capture_console, sdk_capture_network, sdk_capture_performance, sdk_capture_screenshot, ' +
          'sdk_capture_element_selector, sdk_native_trigger_mode, sdk_min_description_length, sdk_config_updated_at, ' +
          'assistant_enabled, assistant_label, assistant_greeting, assistant_suggestions',
      )
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) return dbError(c, error);
    c.header('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    c.header('Vary', 'Origin, X-Mushi-Project, X-Mushi-Api-Key');
    return c.json({ ok: true, data: normalizeSdkConfig(data as SdkConfigRow | null) });
  });

  // ============================================================
  // POST /v1/sdk/discovery — Mushi v2.1 passive inventory discovery
  //
  // SDK clients with `discoverInventory: true` POST one event per
  // navigation (throttled per route to ≤1/min client-side). The
  // server validates with a tight Zod schema, soft-throttles per
  // (project, route) to ≤1/min, and inserts into discovery_events
  // for the proposer to consume.
  //
  // No quota gating: discovery events are 1-2 KB each, the table
  // self-prunes via pg_cron after 30 days, and gating them would
  // bias the proposer toward customers who happen to be on the
  // higher-priced plan.
  //
  // Privacy:
  //   - Reject anything where `dom_summary` exceeds 240 chars
  //   - Reject testid/api arrays larger than 200 entries each
  //   - Strip query strings and fragments from `route` on the way in
  // ============================================================
  app.post('/v1/sdk/discovery', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON body required' } }, 400);
    }

    // Single Zod gate replaces the per-field manual coercion we used to do
    // inline. The schema lives in `_shared/schemas.ts` so it can be unit-
    // tested, kept greppable, and shared with any future MCP tool that
    // wants to ingest discovery events.
    const parsed = discoveryEventSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_DISCOVERY_EVENT',
            message: parsed.error.issues[0]?.message ?? 'discovery event failed validation',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
        422,
      );
    }
    const event = parsed.data;

    const db = getServiceClient();

    // Soft per-(project, route) throttle: drop if a row already exists
    // for this minute. Cheap because we have an index on (project_id,
    // observed_at desc) and we only fetch one column.
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent, error: recentErr } = await db
      .from('discovery_events')
      .select('id')
      .eq('project_id', projectId)
      .eq('route', event.route)
      .gte('observed_at', minuteAgo)
      .limit(1)
      .maybeSingle();
    if (recentErr) {
      log.warn('discovery throttle check failed', { err: recentErr.message });
    }
    if (recent) {
      // Idempotent acceptance — the client should not retry.
      return c.json({ ok: true, data: { accepted: false, reason: 'throttled' } });
    }

    const { error: insErr } = await db.from('discovery_events').insert({
      project_id: projectId,
      route: event.route,
      page_title: event.page_title,
      dom_summary: event.dom_summary,
      testids: event.testids,
      network_paths: event.network_paths,
      query_param_keys: event.query_param_keys,
      user_id_hash: event.user_id_hash,
      sdk_version: event.sdk_version,
    });
    if (insErr) {
      // Route through dbError so the failure ships pg_code-tagged Sentry
      // breadcrumbs + a canonical { code, ... } envelope, instead of echoing
      // the raw pg message back to the SDK (which may leak row hints).
      log.error('discovery insert failed', { err: insErr.message, projectId, route: event.route });
      return dbError(c, insErr);
    }
    return c.json({ ok: true, data: { accepted: true } });
  });

  app.post('/v1/reports', apiKeyAuth, async (c) => {
    try {
      const projectId = c.get('projectId') as string;
      const body = await c.req.json();
      const db = getServiceClient();
      const ipAddress =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
      const userAgent = c.req.header('user-agent');

      // Per-project burst rate limit: default 120 reports/minute.
      // Reads the configurable cap from project_settings.report_ingest_max_per_minute
      // (null = use the default). Raises P0001 on breach.
      try {
        const { data: burstCap } = await db
          .from('project_settings')
          .select('report_ingest_max_per_minute')
          .eq('project_id', projectId)
          .maybeSingle();
        const cap = (burstCap as { report_ingest_max_per_minute?: number | null } | null)
          ?.report_ingest_max_per_minute ?? 120;
        await db.rpc('report_ingest_rate_limit_claim', {
          p_project_id: projectId,
          p_max_per_minute: cap,
        });
      } catch (rateErr) {
        const msg = (rateErr instanceof Error ? rateErr.message : String(rateErr));
        if (msg.includes('rate_limit_exceeded')) {
          c.header('Retry-After', '60');
          return c.json(
            { ok: false, error: { code: 'RATE_LIMITED', message: 'Report ingest rate limit exceeded. Retry in 60 seconds.' } },
            429,
          );
        }
        // Non-rate-limit errors from the RPC (e.g. function missing during migration)
        // are non-fatal: log and continue so SDK ingestion is not blocked by a
        // missing migration window.
        log.warn('report_ingest_rate_limit_claim failed (non-fatal)', { err: msg });
      }

      const quota = await checkIngestQuota(db, projectId);
      if (!quota.allowed) {
        c.header('Retry-After', String(quota.retryAfterSeconds ?? 3600));
        return c.json(
          {
            ok: false,
            error: {
              code: 'QUOTA_EXCEEDED',
              message: `${quota.plan.display_name} plan quota of ${quota.limit?.toLocaleString() ?? 'n/a'} reports/month exceeded. Upgrade or wait until ${quota.periodResetsAt}.`,
              used: quota.used,
              limit: quota.limit,
              plan: quota.plan,
              reason: quota.reason,
              periodResetsAt: quota.periodResetsAt,
            },
          },
          402,
        );
      }

      const result = await ingestReport(db, projectId, body, { ipAddress, userAgent });
      if (!result.ok) {
        return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400);
      }
      if (result.deduplicated) {
        return c.json(
          {
            ok: true,
            data: { reportId: result.reportId, status: 'deduplicated', deduplicated: true },
          },
          200,
        );
      }
      return c.json({ ok: true, data: { reportId: result.reportId, status: 'submitted' } }, 201);
    } catch (err) {
      log.error('Unhandled report submission error', { err: String(err) });
      return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }, 500);
    }
  });

  app.post('/v1/reports/batch', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const { reports } = (await c.req.json()) as { reports: Record<string, any>[] };

    if (!Array.isArray(reports) || reports.length === 0) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'reports array required' } },
        400,
      );
    }

    const batch = reports.slice(0, 10);
    const db = getServiceClient();
    const ipAddress =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    const quota = await checkIngestQuota(db, projectId);
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.retryAfterSeconds ?? 3600));
      return c.json(
        {
          ok: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: `${quota.plan.display_name} plan quota of ${quota.limit?.toLocaleString() ?? 'n/a'} reports/month exceeded. Upgrade or wait until ${quota.periodResetsAt}.`,
            used: quota.used,
            limit: quota.limit,
            plan: quota.plan,
            reason: quota.reason,
            periodResetsAt: quota.periodResetsAt,
          },
        },
        402,
      );
    }

    const results: Array<{ reportId?: string; ok: boolean; error?: string }> = [];

    const settled = await Promise.allSettled(
      batch.map((report) => ingestReport(db, projectId, report, { ipAddress, userAgent })),
    );
    for (const r of settled) {
      results.push(
        r.status === 'fulfilled'
          ? r.value
          : { ok: false, error: String((r as PromiseRejectedResult).reason) },
      );
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return c.json({ ok: true, data: { sent, failed, results } }, 201);
  });

  // ============================================================
  // SENTRY WEBHOOK
  // ============================================================

  app.post('/v1/webhooks/sentry', async (c) => {
    const t0 = Date.now();
    const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('sentry');
    const signature = c.req.header('X-Sentry-Hook-Signature');
    const body = await c.req.text();
    const deliveryId = c.req.header('Sentry-Hook-Resource-Id') ?? null;
    const sourceIp = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;

    const auditRow = await audit(c as never, body, deliveryId);
    try {
      checkRateLimit(sourceIp);
      await checkReplay(auditRow.id, deliveryId);
    } catch (err) {
      if (err instanceof RateLimitError) {
        await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message);
        return c.json({ ok: false, error: err.message }, 429);
      }
      if (err instanceof ReplayAttackError) {
        await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message);
        return c.json({ ok: false, error: 'Duplicate delivery' }, 409);
      }
      throw err;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      await auditRow.resolve('error', 400, Date.now() - t0, 'Invalid JSON body');
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const projectId = (payload?.data as Record<string, unknown>)?.project
      ? undefined
      : c.req.header('X-Mushi-Project');

    if (!projectId) {
      await auditRow.resolve('error', 400, Date.now() - t0, 'Cannot determine project');
      return c.json({ ok: false, error: 'Cannot determine project' }, 400);
    }

    const db = getServiceClient();

    const { data: settings } = await db
      .from('project_settings')
      .select('sentry_webhook_secret, sentry_consume_user_feedback')
      .eq('project_id', projectId)
      .single();

    if (!settings?.sentry_webhook_secret) {
      // Resolve the audit row before bailing — otherwise this row is stuck in
      // 'pending' forever, polluting webhook_audit_log dashboards. The outcome
      // is 'error' (config), not 'rejected_signature' (which implies the
      // request was signed but the secret didn't match).
      await auditRow.resolve('error', 403, Date.now() - t0, 'Sentry webhook secret not configured');
      return c.json(
        { ok: false, error: 'Sentry webhook secret not configured for this project' },
        403,
      );
    }

    if (!signature) {
      await auditRow.resolve('rejected_signature', 401, Date.now() - t0, 'Missing signature');
      return c.json({ ok: false, error: 'Missing signature' }, 401);
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(settings.sentry_webhook_secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // SEC (Wave S1 / D-19): constant-time compare to prevent timing side-channel.
    // Same bookkeeping pattern as verifyGithubSignature below.
    let diff = expected.length ^ signature.length;
    for (let i = 0, n = Math.max(expected.length, signature.length); i < n; i++) {
      diff |= (expected.charCodeAt(i) || 0) ^ (signature.charCodeAt(i) || 0);
    }
    if (diff !== 0) {
      await auditRow.resolve('rejected_signature', 401, Date.now() - t0, 'HMAC mismatch');
      return c.json({ ok: false, error: 'Invalid signature' }, 401);
    }

    const action = payload?.action;
    const pd = payload?.data as { feedback?: Record<string, unknown>; issue?: Record<string, unknown>; seer_analysis?: unknown } | undefined;
    if (action === 'created' && pd?.feedback) {
      const feedback = pd.feedback;
      const reportId = crypto.randomUUID();

      await db.from('reports').insert({
        id: reportId,
        project_id: projectId,
        description: (feedback.message as string) ?? '',
        user_category: 'other',
        category: 'other',
        status: 'new',
        reporter_token_hash: (feedback.email as string) ?? 'sentry-webhook',
        sentry_issue_url: (pd.issue as Record<string, unknown> | undefined)?.permalink as string | undefined,
        sentry_seer_analysis: pd.seer_analysis,
        custom_metadata: {
          source: 'sentry_webhook',
          sentryEventId: feedback.event_id,
          sentryIssueId: (pd.issue as Record<string, unknown> | undefined)?.id,
          userName: feedback.name,
          userEmail: feedback.email,
        },
        environment: {
          userAgent: 'sentry-webhook',
          platform: '',
          language: '',
          viewport: { width: 0, height: 0 },
          url: ((pd.issue as Record<string, unknown> | undefined)?.permalink as string) ?? '',
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
        },
        created_at: new Date().toISOString(),
      });

      triggerClassification(reportId, projectId);
      await auditRow.resolve('accepted', 200, Date.now() - t0);
      return c.json({ ok: true, data: { reportId } });
    }

    await auditRow.resolve('accepted', 200, Date.now() - t0);
    return c.json({ ok: true, data: { action: 'ignored' } });
  });

  // ============================================================
  // SENTRY SEER WEBHOOK
  // ============================================================
  //
  // Configure in Sentry: Settings → Developer Settings → Internal Integration
  //   Webhook URL:   <api>/v1/webhooks/sentry/seer?projectId=<mushi-project-id>
  //   Webhook secret: same value as project_settings.sentry_webhook_secret
  //   Resources:     Issue (for seer-fixability changes)
  //
  // Auth: HMAC-SHA256 hex digest of the *raw* body, sent in
  // `Sentry-Hook-Signature`. We must verify before parsing JSON to avoid
  // re-encoding altering bytes. Project is identified via querystring
  // because Sentry doesn't propagate custom headers to internal integrations.

  app.post('/v1/webhooks/sentry/seer', async (c) => {
    const {
      verifySentryHookSignature,
      parseIssueWebhookBody,
      parseSeerAutofixBody,
      applySeerAnalysis,
    } = await import('../_shared/seer.ts');

    const projectId = c.req.query('projectId') ?? c.req.header('X-Mushi-Project') ?? '';
    if (!projectId) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'MISSING_PROJECT',
            message: 'projectId query param or X-Mushi-Project header is required',
          },
        },
        400,
      );
    }

    const rawBody = await c.req.text();
    const signature =
      c.req.header('Sentry-Hook-Signature') ?? c.req.header('X-Sentry-Hook-Signature');

    const db = getServiceClient();
    const { data: settings } = await db
      .from('project_settings')
      .select('sentry_webhook_secret, sentry_seer_enabled')
      .eq('project_id', projectId)
      .maybeSingle();

    if (!settings?.sentry_webhook_secret) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_SECRET',
            message: 'Sentry webhook secret not configured for this project',
          },
        },
        403,
      );
    }
    if (!settings.sentry_seer_enabled) {
      return c.json({ ok: true, data: { ignored: 'seer_disabled' } }, 202);
    }

    const valid = await verifySentryHookSignature(
      rawBody,
      signature ?? null,
      settings.sentry_webhook_secret,
    );
    if (!valid) {
      return c.json(
        { ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid HMAC signature' } },
        401,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_JSON' } }, 400);
    }

    const issue = parseIssueWebhookBody(body);
    if (!issue) {
      return c.json({ ok: true, data: { ignored: 'no_issue_in_payload' } }, 202);
    }

    // Sentry sends two flavours of seer payload: (a) issue-event with the
    // analysis embedded under data.seer_analysis or data.autofix, (b) thin
    // notification with just the issue id, expecting us to pull. We try
    // (a) first to avoid an extra round-trip; fall back to (b) if missing.
    const dataObj = (body as Record<string, unknown>).data as Record<string, unknown> | undefined;
    let parsed = parseSeerAutofixBody(
      dataObj?.autofix ? dataObj : { autofix: dataObj?.seer_analysis },
    );
    if (!parsed && dataObj?.seer_analysis) {
      const sa = dataObj.seer_analysis as Record<string, unknown>;
      parsed = {
        rootCause: sa.rootCause ?? sa.root_cause ?? null,
        fixSuggestion: sa.fixSuggestion ?? sa.fix_suggestion ?? sa.solution ?? null,
      };
    }

    if (!parsed) {
      // Thin notification: enqueue a one-shot fetch via the existing poll fn.
      // Cheap fire-and-forget — if it fails the next 15-min cron will still
      // catch it. We don't await so the webhook response stays under Sentry's
      // 10s timeout budget.
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && serviceRoleKey) {
        void fetch(`${supabaseUrl}/functions/v1/sentry-seer-poll`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
          signal: AbortSignal.timeout(2_000),
        }).catch(() => {
          /* best-effort */
        });
      }
      return c.json({ ok: true, data: { issueId: issue.id, deferred: true } }, 202);
    }

    const result = await applySeerAnalysis(db, projectId, {
      issueId: issue.id,
      shortId: issue.shortId,
      permalink: issue.permalink,
      rootCause: parsed.rootCause,
      fixSuggestion: parsed.fixSuggestion,
      fixabilityScore: issue.seerFixability?.fixabilityScore ?? null,
      fetchedAt: new Date().toISOString(),
      source: 'webhook',
    });

    return c.json({ ok: true, data: { issueId: issue.id, ...result } });
  });

  // ============================================================
  // GITHUB CHECK-RUN WEBHOOK (V5.3 §2.10 — closes the PDCA loop)
  // ============================================================
  // Configure in GitHub: Settings → Webhooks → Add webhook
  //   Payload URL: <api>/v1/webhooks/github
  //   Content type: application/json
  //   Secret: same value as project_settings.github_webhook_secret
  //   Events: "Check runs" + "Check suites"

  app.post('/v1/webhooks/github', async (c) => {
    const t0 = Date.now();
    const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('github');
    const event = c.req.header('X-GitHub-Event');
    const sig = c.req.header('X-Hub-Signature-256') ?? '';
    const deliveryId = c.req.header('X-GitHub-Delivery') ?? null;
    const body = await c.req.text();
    const sourceIp = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;

    const auditRow = await audit(c as never, body, deliveryId);
    try {
      checkRateLimit(sourceIp);
      await checkReplay(auditRow.id, deliveryId);
    } catch (err) {
      if (err instanceof RateLimitError) {
        await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message);
        return c.json({ ok: false, error: err.message }, 429);
      }
      if (err instanceof ReplayAttackError) {
        await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message);
        return c.json({ ok: false, error: 'Duplicate delivery' }, 409);
      }
      throw err;
    }

    if (event !== 'check_run' && event !== 'check_suite') {
      await auditRow.resolve('accepted', 200, Date.now() - t0);
      return c.json({ ok: true, data: { event, action: 'ignored' } });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      await auditRow.resolve('error', 400, Date.now() - t0, 'Invalid JSON body');
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const repo = payload.repository as { full_name?: string } | undefined;
    const checkRun = (payload.check_run ?? payload.check_suite) as
      | { head_sha?: string; status?: string; conclusion?: string | null }
      | undefined;

    if (!repo?.full_name || !checkRun?.head_sha) {
      // The webhook is well-formed JSON but missing fields we need; treat as
      // accepted-but-ignored so the audit log reflects the no-op outcome
      // rather than an orphan 'pending' row.
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'missing repo or sha');
      return c.json({ ok: true, data: { reason: 'missing repo or sha' } });
    }

    const db = getServiceClient();

    // Match by commit_sha — the fix-worker persists this on PR creation.
    const { data: candidates } = await db
      .from('fix_attempts')
      .select('id, project_id')
      .eq('commit_sha', checkRun.head_sha)
      .limit(5);

    if (!candidates || candidates.length === 0) {
      await auditRow.resolve('accepted', 200, Date.now() - t0, 'no matching fix_attempt');
      return c.json({ ok: true, data: { reason: 'no matching fix_attempt' } });
    }

    // SEC (Wave S1 / D-11): verify against any matched project's secret.
    //
    // The previous behaviour accepted unverified events "as a dev fallback"
    // when no project had a secret configured, which let an attacker who
    // guessed a commit_sha in fix_attempts forge check-run status updates and
    // steer our dashboards (appearing to pass required CI). The correct
    // posture is FAIL CLOSED: if we can't verify the signature, we refuse the
    // write entirely. Operators must either configure a github_webhook_secret
    // per project or stop sending the webhook.
    let verified = false;
    let verifiedProjectId: string | null = null;
    for (const cand of candidates) {
      const { data: settings } = await db
        .from('project_settings')
        .select('github_webhook_secret')
        .eq('project_id', cand.project_id)
        .single();
      const secret = settings?.github_webhook_secret as string | undefined;
      if (!secret) continue;
      if (await verifyGithubSignature(sig, body, secret)) {
        verified = true;
        verifiedProjectId = cand.project_id;
        break;
      }
    }

    if (!verified) {
      await auditRow.resolve('rejected_signature', 401, Date.now() - t0, 'No matching github_webhook_secret');
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message:
              'Webhook signature did not match any configured github_webhook_secret for the matched fix_attempts. Configure project_settings.github_webhook_secret per project.',
          },
        },
        401,
      );
    }

    const updates = {
      check_run_status: checkRun.status ?? null,
      check_run_conclusion: checkRun.conclusion ?? null,
      check_run_updated_at: new Date().toISOString(),
    };

    const targetIds = verifiedProjectId
      ? candidates.filter((x) => x.project_id === verifiedProjectId).map((x) => x.id)
      : candidates.map((x) => x.id);

    await db.from('fix_attempts').update(updates).in('id', targetIds);

    await auditRow.resolve('accepted', 200, Date.now() - t0);
    return c.json({ ok: true, data: { updated: targetIds.length, verified } });
  });

  async function verifyGithubSignature(
    headerSig: string,
    body: string,
    secret: string,
  ): Promise<boolean> {
    const expected = headerSig.startsWith('sha256=') ? headerSig.slice('sha256='.length) : '';
    if (!expected) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (computed.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++)
      diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  // ============================================================
  // SDK STATUS
  // ============================================================

  app.get('/v1/reports/:id/status', apiKeyAuth, async (c) => {
    const reportId = c.req.param('id')!;
    const projectId = c.get('projectId') as string;
    const db = getServiceClient();

    const { data, error } = await db
      .from('reports')
      .select('status, category, severity, summary')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .single();

    if (error || !data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }
    return c.json({ ok: true, data });
  });

  /**
   * Wave G1 — bidirectional Sentry correlation endpoint.
   *
   * Exchanges a W3C trace id / Sentry trace id for the Mushi reports that
   * share it. Lets Sentry → Mushi deep-linking work (click "See user bug
   * reports for this event" and land on the right report) without exposing
   * the whole `reports` table. Auth is via the project api-key, so other
   * tenants can't enumerate a neighbour's traces.
   *
   * Query params:
   *   - traceId       W3C trace id (32-hex)
   *   - sentryTraceId Sentry trace id (32-hex)
   * One of the two must be provided.
   */
  app.get('/v1/reports/by-trace', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const traceId = c.req.query('traceId')?.toLowerCase();
    const sentryTraceId = c.req.query('sentryTraceId')?.toLowerCase();
    if (!traceId && !sentryTraceId) {
      return c.json(
        {
          ok: false,
          error: { code: 'MISSING_TRACE', message: 'traceId or sentryTraceId required' },
        },
        400,
      );
    }
    const hexRe = /^[0-9a-f]{32}$/;
    if ((traceId && !hexRe.test(traceId)) || (sentryTraceId && !hexRe.test(sentryTraceId))) {
      return c.json(
        { ok: false, error: { code: 'INVALID_TRACE', message: 'Trace id must be 32-char hex' } },
        400,
      );
    }

    const db = getServiceClient();
    let query = db
      .from('reports')
      .select('id, status, category, severity, summary, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(25);

    if (traceId)
      query = query
        .filter('environment->>traceContext', 'neq', null)
        .filter('environment->traceContext->>traceId', 'eq', traceId);
    if (sentryTraceId)
      query = query.filter('environment->traceContext->>sentryTraceId', 'eq', sentryTraceId);

    const { data, error } = await query;
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { reports: data ?? [] } });
  });

  // Reporter reputation
  app.get('/v1/reputation', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reporterToken = c.req.query('reporterToken');
    if (!reporterToken)
      return c.json(
        { ok: false, error: { code: 'MISSING_TOKEN', message: 'reporterToken query required' } },
        400,
      );

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(reporterToken));
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const db = getServiceClient();
    const rep = await getReputation(db, projectId, tokenHash);
    return c.json({ ok: true, data: rep });
  });

  // Reporter notifications
  //
  // Auth model: two flows are accepted, in priority order:
  //
  //   (A) HMAC-signed (preferred). The SDK proves possession of the reporter
  //       token without sending it on the wire:
  //
  //         X-Reporter-Token-Hash: <sha256(token) hex>
  //         X-Reporter-Ts:         <unix ms>
  //         X-Reporter-Hmac:       hex(HMAC-SHA256(
  //                                  secret = projectApiKey,
  //                                  msg    = `${projectId}.${ts}.${tokenHash}`))
  //
  //       Server enforces `|now - ts| < 5 min` to defeat replay, then recomputes
  //       the HMAC against the API key already validated by apiKeyAuth.
  //
  //   (B) Legacy raw-token. Accepted for backwards compatibility but logged as a
  //       deprecation warning by the SDK. Token can be passed as
  //       `X-Reporter-Token` header (preferred over query so it doesn't leak
  //       into proxy logs) or `?reporterToken=...`.
  //
  // Both flows resolve to a stable `reporter_token_hash` for table lookup.
  async function resolveReporterTokenHash(
    c: Context,
    projectId: string,
  ): Promise<
    { ok: true; tokenHash: string } | { ok: false; status: number; code: string; message: string }
  > {
    const headerHash = c.req.header('X-Reporter-Token-Hash');
    const ts = c.req.header('X-Reporter-Ts');
    const sig = c.req.header('X-Reporter-Hmac');
    const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project');

    if (headerHash && ts && sig && apiKey) {
      // Belt-and-suspenders: even though the HMAC is computed over the lowercase
      // hash and a tampered value would fail signature verification, we also
      // refuse anything that doesn't look like a SHA-256 hex digest before it
      // ever flows into PostgREST `or()` filter strings downstream.
      if (!/^[0-9a-f]{64}$/i.test(headerHash)) {
        return {
          ok: false,
          status: 400,
          code: 'BAD_TOKEN_HASH',
          message: 'X-Reporter-Token-Hash must be a 64-char hex SHA-256 digest',
        };
      }
      const parsedTs = Number(ts);
      if (!Number.isFinite(parsedTs)) {
        return {
          ok: false,
          status: 400,
          code: 'BAD_TIMESTAMP',
          message: 'X-Reporter-Ts must be a unix-ms integer',
        };
      }
      const skewMs = Math.abs(Date.now() - parsedTs);
      if (skewMs > 5 * 60 * 1000) {
        return {
          ok: false,
          status: 401,
          code: 'STALE_REQUEST',
          message: 'X-Reporter-Ts outside 5-minute window',
        };
      }
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(apiKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const expected = await crypto.subtle.sign(
        'HMAC',
        key,
        enc.encode(`${projectId}.${parsedTs}.${headerHash.toLowerCase()}`),
      );
      const expectedHex = Array.from(new Uint8Array(expected))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (!constantTimeEqualHex(expectedHex, sig)) {
        return {
          ok: false,
          status: 401,
          code: 'INVALID_HMAC',
          message: 'X-Reporter-Hmac signature mismatch',
        };
      }
      return { ok: true, tokenHash: headerHash.toLowerCase() };
    }

    const rawToken = c.req.header('X-Reporter-Token') ?? c.req.query('reporterToken') ?? null;
    if (!rawToken) {
      return {
        ok: false,
        status: 400,
        code: 'MISSING_TOKEN',
        message:
          'Pass X-Reporter-Token-Hash + X-Reporter-Hmac (preferred) or X-Reporter-Token / ?reporterToken=',
      };
    }
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(rawToken));
    const tokenHash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { ok: true, tokenHash };
  }

  function constantTimeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  app.get('/v1/reporter/reports', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const db = getServiceClient();
    const { data: reports, error } = await db
      .from('reports')
      .select('id, status, category, severity, summary, description, created_at, last_admin_reply_at, last_reporter_reply_at, parent_report_id, verified_at, reopened_at, regression_count')
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) return dbError(c, error);

    const reportIds = (reports ?? []).map((r) => r.id);
    const unreadByReport = new Map<string, number>();
    if (reportIds.length > 0) {
      const { data: unread } = await db
        .from('reporter_notifications')
        .select('report_id')
        .eq('project_id', projectId)
        .eq('reporter_token_hash', auth.tokenHash)
        .is('read_at', null)
        .in('report_id', reportIds);
      for (const row of unread ?? []) {
        unreadByReport.set(row.report_id, (unreadByReport.get(row.report_id) ?? 0) + 1);
      }
    }

    return c.json({
      ok: true,
      data: {
        reports: (reports ?? []).map((r) => ({
          ...r,
          unread_count: unreadByReport.get(r.id) ?? 0,
        })),
      },
    });
  });

  app.get('/v1/reporter/reports/:id/comments', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const db = getServiceClient();
    const { data: report, error: reportError } = await db
      .from('reports')
      .select('id')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .maybeSingle();
    if (reportError) return dbError(c, reportError);
    if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    const { data: comments, error } = await db
      .from('report_comments')
      .select('id, author_kind, author_name, body, visible_to_reporter, feedback_signal, created_at')
      .eq('report_id', reportId)
      .or(`visible_to_reporter.eq.true,reporter_token_hash.eq.${auth.tokenHash}`)
      .order('created_at', { ascending: true });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { comments: comments ?? [] } });
  });

  app.post('/v1/reporter/reports/:id/reply', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    // Loop-closure (deferred-4): the reporter SDK widget can attach a
    // structured chip via `feedback_signal`. Either field can be present
    // on its own — a chip-only reaction with no text is a valid 1-click
    // signal ("confirms"); a text-only reply is the legacy path. The DB
    // CHECK constraint enforces the enum; we additionally validate it
    // here so the API rejects obvious garbage with a 400 instead of
    // bouncing through Postgres for the error message.
    const FEEDBACK_SIGNALS = new Set([
      'confirms',
      'wrong_target',
      'agent_fixed_wrong_thing',
      'already_fixed',
      'noise',
      'not_fixed',
    ]);
    const rawSignal = typeof body.feedback_signal === 'string' ? body.feedback_signal : null;
    if (rawSignal && !FEEDBACK_SIGNALS.has(rawSignal)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_FEEDBACK_SIGNAL',
            message: `feedback_signal must be one of: ${[...FEEDBACK_SIGNALS].join(', ')}`,
          },
        },
        400,
      );
    }
    if (!text && !rawSignal) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'EMPTY_REPLY',
            message: 'Reply must include a body, a feedback_signal chip, or both.',
          },
        },
        400,
      );
    }

    const db = getServiceClient();
    const { data: report, error: reportError } = await db
      .from('reports')
      .select('id')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .maybeSingle();
    if (reportError) return dbError(c, reportError);
    if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    let feedbackOutcome: Record<string, unknown> | null = null;
    if (rawSignal) {
      const { data: outcome, error: rpcErr } = await db.rpc('mushi_apply_reporter_feedback', {
        p_report_id: reportId,
        p_signal: rawSignal,
        p_reporter_token_hash: auth.tokenHash,
        // `p_note` can seed a reopened child report's description. Cap it so a
        // huge reply body can't create an oversized report through this public
        // route (the comment body is capped separately at 10k below).
        p_note: text ? text.slice(0, REPORTER_NOTE_MAX) : null,
      });
      if (rpcErr) {
        log.warn('reporter_feedback_rpc_failed', { reportId, error: rpcErr.message });
      } else if (outcome && typeof outcome === 'object') {
        feedbackOutcome = outcome as Record<string, unknown>;
        const code = typeof feedbackOutcome.code === 'string' ? feedbackOutcome.code : '';
        if (code === 'VERIFIED') {
          await createNotification(db, projectId, reportId, auth.tokenHash, 'verified', {
            message: buildNotificationMessage('verified', {}),
            reportId,
          });
        } else if (code === 'REOPENED') {
          const childId = typeof feedbackOutcome.child_report_id === 'string'
            ? feedbackOutcome.child_report_id
            : reportId;
          await createNotification(db, projectId, childId, auth.tokenHash, 'reopened', {
            message: buildNotificationMessage('reopened', {}),
            reportId: childId,
          });
        }
      }
    }

    const { data: comment, error } = await db
      .from('report_comments')
      .insert({
        report_id: reportId,
        project_id: projectId,
        author_kind: 'reporter',
        reporter_token_hash: auth.tokenHash,
        author_name: 'Reporter',
        // Chip-only replies still need a body for the audit trail —
        // synthesise a human-readable phrase from the signal so the
        // admin UI doesn't render an empty bubble.
        body: (text || (rawSignal ? `[${rawSignal}]` : '')).slice(0, 10000),
        visible_to_reporter: true,
        feedback_signal: rawSignal,
      })
      .select(
        'id, author_kind, author_name, body, visible_to_reporter, feedback_signal, created_at',
      )
      .single();
    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { comment, feedback: feedbackOutcome } }, 201);
  });

  app.post('/v1/reporter/reports/:id/reopen', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) {
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    // Cap the note: it can become the reopened child report's description, so
    // an unbounded body would let this public route create oversized reports.
    const note = (typeof body.note === 'string' ? body.note.trim() : '').slice(0, REPORTER_NOTE_MAX);

    const db = getServiceClient();
    const { data: report, error: reportError } = await db
      .from('reports')
      .select('id, status')
      .eq('id', reportId)
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .maybeSingle();
    if (reportError) return dbError(c, reportError);
    if (!report) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }

    const { data: outcome, error: rpcErr } = await db.rpc('mushi_apply_reporter_feedback', {
      p_report_id: reportId,
      p_signal: 'not_fixed',
      p_reporter_token_hash: auth.tokenHash,
      p_note: note || 'Reporter reopened this report',
    });
    if (rpcErr) return dbError(c, rpcErr);

    const parsed = (outcome ?? {}) as Record<string, unknown>;
    const code = typeof parsed.code === 'string' ? parsed.code : '';

    // The RPC only spawns/links a reopen when the report is in a terminal
    // (fixed/resolved/verified) state. Any other code (e.g. SIGNAL_RECORDED)
    // means nothing was reopened — surface a 409 instead of silently claiming
    // success and firing a misleading "reopened" notification.
    if (code !== 'REOPENED' && code !== 'ALREADY_APPLIED') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NOT_REOPENABLE',
            message: 'This report is not in a state that can be reopened.',
          },
        },
        409,
      );
    }

    const childId = typeof parsed.child_report_id === 'string' ? parsed.child_report_id : reportId;
    // Notify only on a fresh reopen. ALREADY_APPLIED means the child already
    // exists and was notified on the first reopen; createNotification is
    // idempotent per (report, type, channel), but gating avoids the redundant
    // write entirely.
    if (code === 'REOPENED') {
      await createNotification(db, projectId, childId, auth.tokenHash, 'reopened', {
        message: buildNotificationMessage('reopened', {}),
        reportId: childId,
      });
    }

    return c.json({ ok: true, data: { outcome: parsed } }, 201);
  });

  app.get('/v1/notifications', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const sinceParam = c.req.query('since');
    const since =
      sinceParam && !Number.isNaN(Date.parse(sinceParam))
        ? new Date(sinceParam).toISOString()
        : null;
    const includeRead = c.req.query('includeRead') === '1';
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '20'), 1), 100);

    const db = getServiceClient();
    let query = db
      .from('reporter_notifications')
      .select('id, notification_type, payload, read_at, created_at')
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!includeRead) query = query.is('read_at', null);
    if (since) query = query.gt('created_at', since);

    const { data: notifications, error } = await query;
    if (error) {
      return dbError(c, error);
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      data: {
        notifications: notifications ?? [],
        server_time: new Date().toISOString(),
      },
    });
  });

  // ── GitHub App installation OAuth callback (public — GitHub redirects here) ─
  // After a user clicks "Install" on the GitHub App, GitHub redirects to this
  // URL with ?installation_id=<id>&setup_action=install&state=<projectId>.
  // We store the installation ID on the repo and enable codebase indexing,
  // then redirect back to the console integrations page.
  app.get('/v1/webhooks/github/app-installation', async (c) => {
    const installationId = Number(c.req.query('installation_id'))
    const setupAction = c.req.query('setup_action') // 'install' | 'update' | 'request'
    const stateRaw = c.req.query('state') ?? ''
    const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? ''

    if (!installationId || !Number.isFinite(installationId) || installationId <= 0) {
      return c.redirect(`${adminBase}/integrations/config?github_error=missing_installation_id`, 302)
    }

    // State is the projectId (passed when building the install URL in GitHubAppInstallButton)
    const projectId = stateRaw.trim()
    if (!projectId || projectId.length < 10) {
      // No project context — log the installation and redirect to the dashboard root
      log.info('installation received without project context', {
        scope: 'github-app-callback',
        installationId,
        setupAction,
      })
      return c.redirect(`${adminBase}/?github_installed=1`, 302)
    }

    const db = getServiceClient()

    // Find the primary repo for this project and link the installation ID
    const { data: repos } = await db
      .from('repos')
      .select('id, github_app_installation_id, repo_url')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle()

    if (repos) {
      await db.from('repos').update({
        github_app_installation_id: installationId,
        indexing_enabled: true,
      }).eq('id', repos.id)
      log.info('linked installation to repo', {
        scope: 'github-app-callback',
        installationId,
        repoId: repos.id,
        projectId,
      })
    } else {
      // No primary repo yet — store on project_settings for pickup when user adds a repo
      await db.from('project_settings').upsert({
        project_id: projectId,
        github_app_installation_id_pending: installationId,
      } as Record<string, unknown>, { onConflict: 'project_id' })
      log.info('no primary repo — stored pending installation', {
        scope: 'github-app-callback',
        installationId,
        projectId,
      })
    }

    // Auto-register the webhook on the repo using the installation token
    // (best-effort; skip if GitHub_APP credentials are not available server-side)
    const appId = Deno.env.get('GITHUB_APP_ID')
    const privateKeyPem = Deno.env.get('GITHUB_APP_PRIVATE_KEY_PEM')
    if (appId && privateKeyPem && repos?.repo_url) {
      void autoRegisterWebhook({ appId, privateKeyPem, installationId, repoUrl: repos.repo_url, adminBase })
        .catch((err: unknown) => log.warn('webhook auto-register failed (non-fatal)', {
          scope: 'github-app-callback',
          err: String(err),
        }))
    }

    return c.redirect(`${adminBase}/integrations/config?github_connected=1&installation_id=${installationId}`, 302)
  })

  app.post('/v1/notifications/:id/read', apiKeyAuth, async (c) => {
    const notifId = c.req.param('id')!;
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const db = getServiceClient();
    const { error } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notifId)
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });

  registerReporterFeatureBoardRoutes(app, resolveReporterTokenHash);

  // ══════════════════════════════════════════════════════════════════════════
  // POST /v1/ingest/spans — OTel trace-context span ingest (Phase 4)
  //
  // Called by the mushi Node SDK middleware to store backend spans keyed by
  // the W3C trace_id propagated from the web SDK.  The admin console uses
  // these to correlate a bug-report's failed network entry ("500 from /api/foo")
  // with the backend span that handled that request.
  //
  // Auth: SDK API key (same key as POST /v1/reports).
  // Rate: hard-capped at 500 spans/minute per project; individual span objects
  //       must not exceed 8 KB.
  // PII: span_json is scrubbed of known PII fields before storage.
  // ══════════════════════════════════════════════════════════════════════════

  app.post('/v1/ingest/spans', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const db = getServiceClient();

    // Burst cap: 500 spans/minute per project.
    try {
      await db.rpc('report_ingest_rate_limit_claim', {
        p_project_id: projectId,
        p_max_per_minute: 500,
      });
    } catch (rateErr) {
      const msg = rateErr instanceof Error ? rateErr.message : String(rateErr);
      if (msg.includes('rate_limit_exceeded')) {
        c.header('Retry-After', '60');
        return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Span ingest rate limit exceeded.' } }, 429);
      }
      log.warn('span ingest rate limit check failed (non-fatal)', { err: msg });
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be valid JSON' } }, 400);
    }

    const spans = Array.isArray(body.spans) ? body.spans : [body];
    if (!spans.length || spans.length > 100) {
      return c.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'spans must be an array of 1–100 entries' } }, 400);
    }

    // Scrub common PII fields before storing.
    const PII_KEYS = ['password', 'token', 'authorization', 'cookie', 'email', 'phone', 'ssn'];
    function scrubSpan(span: Record<string, unknown>): Record<string, unknown> {
      const out = { ...span };
      if (out.attributes && typeof out.attributes === 'object') {
        const attrs = { ...(out.attributes as Record<string, unknown>) };
        for (const key of Object.keys(attrs)) {
          if (PII_KEYS.some((p) => key.toLowerCase().includes(p))) {
            attrs[key] = '[redacted]';
          }
        }
        out.attributes = attrs;
      }
      return out;
    }

    let inserted = 0;
    for (const raw of spans) {
      const span = scrubSpan(raw as Record<string, unknown>);
      const traceId = typeof span.traceId === 'string' ? span.traceId : null;
      if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) continue;

      const sessionId = typeof span.sessionId === 'string' ? span.sessionId : null;
      const { error } = await db.from('backend_spans').insert({
        project_id: projectId,
        trace_id: traceId.toLowerCase(),
        session_id: sessionId,
        span_json: span,
      });
      if (!error) inserted++;
    }

    return c.json({ ok: true, data: { inserted, total: spans.length } }, 201);
  });

  // ── POST /v1/ingest/metrics — Code-health CI ingest ───────────────────────
  //
  // Called from host-app CI pipelines (e.g. yen-yen bundle-budget.yml) to push
  // bundle-size time-series data and god-file / bundle-regression findings.
  //
  // Auth: API key (same as all other SDK ingest endpoints).
  // Rate: 60 calls/minute per project — generous for CI but prevents abuse.
  // Storage:
  //   • metrics[] → metric_series rows (project_id, metric_name, dimension, value, ts)
  //   • findings[] → one gate_runs row (gate='code_health') + gate_findings rows
  //
  // The endpoint is intentionally append-only: each CI push creates a new
  // gate_run row. The admin console's /code-health page shows the latest run.
  app.post('/v1/ingest/metrics', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const db = getServiceClient();

    // Burst cap: 60 calls/minute per project.
    // supabase-js returns { data, error } and does NOT throw on PostgREST errors
    // unless .throwOnError() is used — so we check { error } directly.
    const { error: rateErr } = await db.rpc('report_ingest_rate_limit_claim', {
      p_project_id: projectId,
      p_max_per_minute: 60,
    });
    if (rateErr) {
      if (rateErr.message.includes('rate_limit_exceeded')) {
        c.header('Retry-After', '60');
        return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Metric ingest rate limit exceeded. Retry in 60 seconds.' } }, 429);
      }
      log.warn('metric ingest rate limit check failed (non-fatal)', { err: rateErr.message });
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be valid JSON' } }, 400);
    }

    // Runtime Zod validation (imported lazily to keep module parse time down).
    const { codeHealthIngestSchema } = await import('../../_shared/schemas.ts');
    const parsed = codeHealthIngestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid payload',
        },
      }, 400);
    }

    const { metrics = [], findings = [] } = parsed.data;
    const now = new Date().toISOString();

    // ── 1. Insert metric_series rows ─────────────────────────────────────────
    let metricsInserted = 0;
    if (metrics.length > 0) {
      const rows = metrics.map((m) => ({
        project_id: projectId,
        metric_name: m.metric_name,
        dimension: m.dimension ?? null,
        value: m.value,
        ts: m.ts ?? now,
      }));
      const { error: metricErr } = await db.from('metric_series').insert(rows);
      if (metricErr) {
        log.warn('metric_series insert error (non-fatal)', { err: metricErr.message });
      } else {
        metricsInserted = rows.length;
      }
    }

    // ── 2. Insert gate_run + gate_findings ────────────────────────────────────
    let findingsInserted = 0;
    let gateRunId: string | null = null;

    if (findings.length > 0) {
      // Derive gate_run status from the worst severity present.
      const hasError = findings.some((f) => f.severity === 'error');
      const hasWarn = findings.some((f) => f.severity === 'warn');
      const gateStatus = hasError ? 'fail' : hasWarn ? 'warn' : 'pass';

      const { data: runRow, error: runErr } = await db
        .from('gate_runs')
        .insert({
          project_id: projectId,
          gate: 'code_health',
          status: gateStatus,
          started_at: now,
          completed_at: now,
          findings_count: findings.length,
          triggered_by: 'ci_push',
        })
        .select('id')
        .single();

      if (runErr || !runRow) {
        log.warn('gate_runs insert error (non-fatal)', { err: runErr?.message });
      } else {
        gateRunId = runRow.id as string;

        const findingRows = findings.map((f) => ({
          gate_run_id: gateRunId,
          project_id: projectId,
          rule_id: f.rule_id,
          severity: f.severity,
          file_path: f.file_path ?? null,
          line: f.line ?? null,
          message: f.message,
          suggested_fix: f.suggested_fix ?? null,
        }));

        const { error: findErr } = await db.from('gate_findings').insert(findingRows);
        if (findErr) {
          log.warn('gate_findings insert error (non-fatal)', { err: findErr.message });
        } else {
          findingsInserted = findingRows.length;
        }
      }
    }

    return c.json({
      ok: true,
      data: { metrics_inserted: metricsInserted, findings_inserted: findingsInserted, gate_run_id: gateRunId },
    }, 201);
  });
}

// ── GitHub App: auto-register repo webhook via installation token ────────────
// Called best-effort after the app-installation OAuth callback. Fetches a
// short-lived installation access token (JWT → token exchange) and uses it to
// create a webhook on the repository so check-run events flow back without
// requiring the user to manually add the webhook in GitHub settings.
async function autoRegisterWebhook(opts: {
  appId: string
  privateKeyPem: string
  installationId: number
  repoUrl: string
  adminBase: string
}): Promise<void> {
  // Parse owner/repo from the URL
  const match = opts.repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) throw new Error(`Unrecognisable repo URL: ${opts.repoUrl}`)
  const [, owner, repo] = match

  // Create a GitHub App JWT (RS256, 10-minute validity)
  const jwt = await createGitHubAppJwt(opts.appId, opts.privateKeyPem)

  // Exchange for an installation token
  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' } },
  )
  if (!tokenRes.ok) throw new Error(`Installation token exchange failed: ${tokenRes.status}`)
  const { token } = await tokenRes.json() as { token: string }

  // Create the webhook (idempotent — GitHub returns 422 if already exists; we ignore it)
  const hookUrl = `${opts.adminBase}/api/v1/webhooks/github`
  const hookRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['check_run', 'check_suite', 'push'],
      config: { url: hookUrl, content_type: 'json', insecure_ssl: '0' },
    }),
  })
  if (hookRes.status === 422) {
    log.info('webhook already exists on repo', { scope: 'autoRegisterWebhook', owner, repo })
    return
  }
  if (!hookRes.ok) throw new Error(`Create webhook failed: ${hookRes.status}`)
  log.info('webhook registered', { scope: 'autoRegisterWebhook', owner, repo, hookUrl })
}

async function createGitHubAppJwt(appId: string, pemKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 600, iss: appId }

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const signingInput = `${encode(header)}.${encode(payload)}`

  // Import the PEM private key
  const pemBody = pemKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${signingInput}.${sigB64}`
}
