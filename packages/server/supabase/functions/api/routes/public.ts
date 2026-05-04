import type { Hono, Context } from 'npm:hono@4';
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
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { reportSubmissionSchema } from '../../_shared/schemas.ts';
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
import { dbError, ownedProjectIds } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerPublicRoutes(app: Hono): void {
  // ============================================================
  // SDK ROUTES (API key auth)
  // ============================================================

  const SDK_WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  const SDK_WIDGET_THEMES = ['auto', 'light', 'dark'] as const;
  const SDK_SCREENSHOT_MODES = ['on-report', 'auto', 'off'] as const;
  const SDK_NATIVE_TRIGGER_MODES = ['shake', 'button', 'both', 'none'] as const;

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

  function normalizeSdkConfig(row?: SdkConfigRow | null) {
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
        Math.min(1000, Math.round(native.minDescriptionLength)),
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
          'sdk_capture_console, sdk_capture_network, sdk_capture_performance, sdk_capture_screenshot, ' +
          'sdk_capture_element_selector, sdk_native_trigger_mode, sdk_min_description_length, sdk_config_updated_at',
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
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON body required' } }, 400);
    }

    const route = typeof body.route === 'string' ? body.route : '';
    if (!route || route.length > 400 || !route.startsWith('/')) {
      return c.json({ ok: false, error: { code: 'INVALID_ROUTE', message: 'route must start with / and be ≤400 chars' } }, 422);
    }
    // Defence-in-depth: even if the client misbehaves and sends a
    // query/fragment, we drop it before persistence.
    const cleanRoute = route.replace(/[?#].*$/, '');

    const pageTitle = typeof body.page_title === 'string' ? body.page_title.slice(0, 300) : null;
    const domSummary = typeof body.dom_summary === 'string' ? body.dom_summary.slice(0, 240) : null;
    const testids = Array.isArray(body.testids)
      ? (body.testids as unknown[])
          .filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length < 120)
          .slice(0, 200)
      : [];
    const networkPaths = Array.isArray(body.network_paths)
      ? (body.network_paths as unknown[])
          .filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length < 200)
          .slice(0, 200)
      : [];
    const queryKeys = Array.isArray(body.query_param_keys)
      ? (body.query_param_keys as unknown[])
          .filter((q): q is string => typeof q === 'string' && q.length > 0 && q.length < 80)
          .slice(0, 50)
      : [];
    const userIdHash = typeof body.user_id_hash === 'string' && body.user_id_hash.length === 64
      ? body.user_id_hash
      : null;
    const sdkVersion = typeof body.sdk_version === 'string' ? body.sdk_version.slice(0, 40) : null;

    const db = getServiceClient();

    // Soft per-(project, route) throttle: drop if a row already exists
    // for this minute. Cheap because we have an index on (project_id,
    // observed_at desc) and we only fetch one column.
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent, error: recentErr } = await db
      .from('discovery_events')
      .select('id')
      .eq('project_id', projectId)
      .eq('route', cleanRoute)
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

    const insertPayload: Record<string, unknown> = {
      project_id: projectId,
      route: cleanRoute,
      page_title: pageTitle,
      dom_summary: domSummary,
      testids,
      network_paths: networkPaths,
      query_param_keys: queryKeys,
      user_id_hash: userIdHash,
      sdk_version: sdkVersion,
    };
    const { error: insErr } = await db.from('discovery_events').insert(insertPayload);
    if (insErr) {
      // Route through dbError so the failure ships pg_code-tagged Sentry
      // breadcrumbs + a canonical { code, ... } envelope, instead of echoing
      // the raw pg message back to the SDK (which may leak row hints).
      log.error('discovery insert failed', { err: insErr.message, projectId, route: cleanRoute });
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
    const signature = c.req.header('X-Sentry-Hook-Signature');
    const body = await c.req.text();

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const projectId = (payload?.data as Record<string, unknown>)?.project
      ? undefined
      : c.req.header('X-Mushi-Project');

    if (!projectId) {
      return c.json({ ok: false, error: 'Cannot determine project' }, 400);
    }

    const db = getServiceClient();

    const { data: settings } = await db
      .from('project_settings')
      .select('sentry_webhook_secret, sentry_consume_user_feedback')
      .eq('project_id', projectId)
      .single();

    if (!settings?.sentry_webhook_secret) {
      return c.json(
        { ok: false, error: 'Sentry webhook secret not configured for this project' },
        403,
      );
    }

    if (!signature) {
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
      return c.json({ ok: false, error: 'Invalid signature' }, 401);
    }

    const action = payload?.action;
    if (action === 'created' && payload?.data?.feedback) {
      const feedback = payload.data.feedback;
      const reportId = crypto.randomUUID();

      await db.from('reports').insert({
        id: reportId,
        project_id: projectId,
        description: feedback.message ?? '',
        user_category: 'other',
        category: 'other',
        status: 'new',
        reporter_token_hash: feedback.email ?? 'sentry-webhook',
        sentry_issue_url: payload.data.issue?.permalink,
        sentry_seer_analysis: payload.data.seer_analysis,
        custom_metadata: {
          source: 'sentry_webhook',
          sentryEventId: feedback.event_id,
          sentryIssueId: payload.data.issue?.id,
          userName: feedback.name,
          userEmail: feedback.email,
        },
        environment: {
          userAgent: 'sentry-webhook',
          platform: '',
          language: '',
          viewport: { width: 0, height: 0 },
          url: payload.data.issue?.permalink ?? '',
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
        },
        created_at: new Date().toISOString(),
      });

      triggerClassification(reportId, projectId);
      return c.json({ ok: true, data: { reportId } });
    }

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
    const event = c.req.header('X-GitHub-Event');
    const sig = c.req.header('X-Hub-Signature-256') ?? '';
    const body = await c.req.text();

    if (event !== 'check_run' && event !== 'check_suite') {
      return c.json({ ok: true, data: { event, action: 'ignored' } });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const repo = payload.repository as { full_name?: string } | undefined;
    const checkRun = (payload.check_run ?? payload.check_suite) as
      | { head_sha?: string; status?: string; conclusion?: string | null }
      | undefined;

    if (!repo?.full_name || !checkRun?.head_sha) {
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
    const reportId = c.req.param('id');
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
      .select('id, status, category, severity, summary, description, created_at, last_admin_reply_at, last_reporter_reply_at')
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
    const reportId = c.req.param('id');
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
      .select('id, author_kind, author_name, body, visible_to_reporter, created_at')
      .eq('report_id', reportId)
      .or(`visible_to_reporter.eq.true,reporter_token_hash.eq.${auth.tokenHash}`)
      .order('created_at', { ascending: true });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { comments: comments ?? [] } });
  });

  app.post('/v1/reporter/reports/:id/reply', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id');
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok)
      return c.json(
        { ok: false, error: { code: auth.code, message: auth.message } },
        auth.status as 400 | 401,
      );

    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) return c.json({ ok: false, error: { code: 'EMPTY_REPLY', message: 'Reply body is required' } }, 400);

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

    const { data: comment, error } = await db
      .from('report_comments')
      .insert({
        report_id: reportId,
        project_id: projectId,
        author_kind: 'reporter',
        reporter_token_hash: auth.tokenHash,
        author_name: 'Reporter',
        body: text.slice(0, 10000),
        visible_to_reporter: true,
      })
      .select('id, author_kind, author_name, body, visible_to_reporter, created_at')
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { comment } }, 201);
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

  app.post('/v1/notifications/:id/read', apiKeyAuth, async (c) => {
    const notifId = c.req.param('id');
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
}
