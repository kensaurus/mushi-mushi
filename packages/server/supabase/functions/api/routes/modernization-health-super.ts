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
  INVENTORY_V2_DOGFOOD_EMAILS,
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
import {
  probeIntegration,
  ALL_INTEGRATION_KINDS,
  type IntegrationKind,
} from '../../_shared/integration-probes.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds, scopedOwnedProjectIds, userCanAccessProject, resolveOwnedProject } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerModernizationHealthSuperRoutes(app: Hono): void {
  // ============================================================
  // LIBRARY MODERNIZATION
  // ============================================================
  //
  // Read-only listing + dispatch/dismiss for findings produced by the weekly
  // library-modernizer cron. "Dispatch" simply forwards the synthetic report
  // (created at finding-time for major/security/deprecated severities) into
  // the existing fix_dispatch_jobs queue, so the entire fix pipeline stays
  // on one code path.

  app.get('/v1/admin/modernization', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const status = c.req.query('status') ?? 'pending';
    const db = getServiceClient();

    // Teams v1: include org-member projects so invited teammates see the
    // workspace's modernization findings (was project_members-only before).
    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { findings: [] } });

    let q = db
      .from('modernization_findings')
      .select(
        'id, project_id, repo_id, dep_name, current_version, suggested_version, manifest_path, summary, severity, changelog_url, related_report_id, status, detected_at',
      )
      .in('project_id', projectIds)
      .order('detected_at', { ascending: false })
      .limit(100);
    if (status !== 'all') q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { findings: data ?? [] } });
  });

  app.post('/v1/admin/modernization/:id/dispatch', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const findingId = c.req.param('id');
    const db = getServiceClient();

    const { data: finding } = await db
      .from('modernization_findings')
      .select('id, project_id, related_report_id, dep_name, status')
      .eq('id', findingId)
      .maybeSingle();
    if (!finding) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Teams v1: owner / org-member / project-member can act on findings.
    const access = await userCanAccessProject(db, userId, finding.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    if (!finding.related_report_id) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_REPORT',
            message:
              'This finding has no synthetic report attached (low-severity findings are info-only).',
          },
        },
        400,
      );
    }

    const { data: settings } = await db
      .from('project_settings')
      .select('autofix_enabled')
      .eq('project_id', finding.project_id)
      .maybeSingle();
    if (!settings?.autofix_enabled) {
      return c.json(
        {
          ok: false,
          error: { code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' },
        },
        400,
      );
    }

    const { data: existing } = await db
      .from('fix_dispatch_jobs')
      .select('id, status')
      .eq('project_id', finding.project_id)
      .eq('report_id', finding.related_report_id)
      .in('status', ['queued', 'running'])
      .limit(1);
    if (existing?.length) {
      return c.json({
        ok: true,
        data: { dispatchId: existing[0].id, status: existing[0].status, deduplicated: true },
      });
    }

    const { data: job, error: insertErr } = await db
      .from('fix_dispatch_jobs')
      .insert({
        project_id: finding.project_id,
        report_id: finding.related_report_id,
        requested_by: userId,
        status: 'queued',
      })
      .select('id, status, created_at')
      .single();
    if (insertErr || !job) {
      return c.json(
        {
          ok: false,
          error: { code: 'DISPATCH_FAILED', message: insertErr?.message ?? 'enqueue failed' },
        },
        500,
      );
    }

    await db.from('modernization_findings').update({ status: 'dispatched' }).eq('id', finding.id);

    invokeFixWorker(job.id).catch((err) => {
      console.warn('[modernization] worker invocation failed', {
        dispatchId: job.id,
        err: String(err),
      });
    });

    await logAudit(
      db,
      finding.project_id,
      userId,
      'fix.attempted',
      'modernization_finding',
      finding.id,
      { dep: finding.dep_name, dispatchId: job.id, source: 'modernization' },
    ).catch(() => {});
    return c.json({
      ok: true,
      data: { dispatchId: job.id, status: job.status, createdAt: job.created_at },
    });
  });

  app.post('/v1/admin/modernization/:id/dismiss', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const findingId = c.req.param('id');
    const db = getServiceClient();

    const { data: finding } = await db
      .from('modernization_findings')
      .select('project_id, dep_name')
      .eq('id', findingId)
      .maybeSingle();
    if (!finding) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    // Teams v1: owner / org-member / project-member can act on findings.
    const access = await userCanAccessProject(db, userId, finding.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const { error } = await db
      .from('modernization_findings')
      .update({ status: 'dismissed' })
      .eq('id', findingId);
    if (error) return dbError(c, error);

    await logAudit(
      db,
      finding.project_id,
      userId,
      'report.triaged',
      'modernization_finding',
      findingId,
      { dep: finding.dep_name, action: 'dismissed' },
    ).catch(() => {});
    return c.json({ ok: true });
  });

  // ============================================================
  // INTEGRATION HEALTH (V5.3 §2.18) — admin probe + history
  // ============================================================
  //
  // One endpoint per non-LLM integration. Each test does the smallest possible
  // authenticated request against the provider, records the result in
  // integration_health_history, and returns a structured payload for the UI.
  //
  // Why per-provider rather than a generic /v1/admin/health/:kind: every
  // provider has a different "is alive" call (Sentry needs the org slug,
  // Langfuse needs the public key as a basic-auth header, GitHub needs a
  // bearer token + repo). Generic adapters end up as a giant switch
  // statement anyway — keeping them named makes the code grep-friendly.

  app.post('/v1/admin/health/integration/:kind', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind') as IntegrationKind;
    if (!ALL_INTEGRATION_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }

    const db = getServiceClient();
    // Teams v1: any member can probe an integration in an org they belong to.
    // Health probes are workspace-level — the precise project pick doesn't matter.
    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404);
    const projectId = accessibleIds[0];

    const { data: settings } = await db
      .from('project_settings')
      .select(
        'sentry_org_slug, sentry_auth_token_ref, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref, claude_api_key_ref, cursor_api_key_ref',
      )
      .eq('project_id', projectId)
      .single();

    // For routing-provider probes, load the stored config from project_integrations.
    // Map kind → integration_type (github_issues is stored as 'github' in project_integrations).
    const routingType = kind === 'github_issues' ? 'github' : kind;
    const { data: routingRow } = await db
      .from('project_integrations')
      .select('config')
      .eq('project_id', projectId)
      .eq('integration_type', routingType)
      .eq('is_active', true)
      .maybeSingle();
    const routingConfig = (routingRow?.config ?? {}) as Record<string, unknown>;

    const probe = await probeIntegration(kind, db, settings ?? {}, routingConfig);

    await db.from('integration_health_history').insert({
      project_id: projectId,
      kind,
      status: probe.status,
      latency_ms: probe.latencyMs,
      message: probe.detail || (probe.httpStatus ? `HTTP ${probe.httpStatus}` : null),
      source: 'manual',
    });

    return c.json({
      ok: true,
      data: { kind, status: probe.status, httpStatus: probe.httpStatus, latencyMs: probe.latencyMs, detail: probe.detail },
    });
  });

  app.get('/v1/admin/health/history', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { history: [] } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const projectId = resolvedProject.project.id;

    const { data } = await db
      .from('integration_health_history')
      .select('id, kind, status, latency_ms, message, source, checked_at')
      .eq('project_id', projectId)
      .order('checked_at', { ascending: false })
      .limit(200);

    return c.json({ ok: true, data: { history: data ?? [] } });
  });

  // Single source of truth for "what can this caller do?". Used by every
  // admin-frontend gate so the UI stays in lockstep with the server-side
  // `requireFeature` middleware. Cheaper than `/v1/admin/billing` (no
  // Stripe round-trip), so the admin app fetches it on every page load
  // and uses it to render `UpgradePrompt` + show the super-admin nav.
  //
  // Shape:
  //   { planId: 'hobby'|'starter'|'pro'|'enterprise', planName: string,
  //     featureFlags: { sso, byok, plugins, intelligence_reports, ... },
  //     gatedRoutes: [{ prefix, flag, allowed }],
  //     isSuperAdmin: boolean }
  //
  // Returns 200 even for hobby callers — this endpoint is *introspection*
  // and must never 402. The 402 happens on the gated route itself.
  app.get('/v1/admin/entitlements', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const userEmail = c.get('userEmail') as string | undefined;
    const db = getServiceClient();

    const entitlement = await resolveActiveEntitlement(c);

    // No project yet → return a hobby-shaped response so the UI can render
    // the "create your first project" empty state without crashing.
    if (!entitlement) {
      return c.json({
        ok: true,
        data: {
          planId: 'hobby',
          planName: 'Hobby',
          featureFlags: {} as Record<FeatureFlag, boolean>,
          gatedRoutes: GATED_ROUTES.map((r) => ({ ...r, allowed: false })),
          isSuperAdmin: false,
          hasProject: false,
        },
      });
    }

    // Super-admin lookup. We piggyback on `auth.users.raw_app_meta_data.role`
    // because Supabase exposes that as a JWT claim — promoted by the
    // 20260427_super_admin_role.sql migration. Fail closed on any read
    // error so a transient outage can't accidentally elevate a caller.
    let isSuperAdmin = false;
    try {
      const { data: userRow } = await db.auth.admin.getUserById(userId);
      const role = (userRow?.user?.app_metadata as Record<string, unknown> | null)?.role;
      isSuperAdmin = role === 'super_admin';
    } catch (err) {
      log.warn('entitlements_super_admin_lookup_failed', {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const flags = { ...(entitlement.plan.feature_flags ?? {}) } as Record<string, unknown>;
    const em = (userEmail ?? '').toLowerCase();
    if (em && INVENTORY_V2_DOGFOOD_EMAILS.has(em)) {
      flags.inventory_v2 = true;
    }

    return c.json({
      ok: true,
      data: {
        planId: entitlement.plan.id,
        planName: entitlement.plan.display_name,
        projectId: entitlement.projectId,
        organizationId: entitlement.organizationId,
        featureFlags: flags,
        gatedRoutes: GATED_ROUTES.map((r) => ({
          ...r,
          allowed: flags[r.flag] === true,
        })),
        isSuperAdmin,
        hasProject: true,
        userEmail: userEmail ?? null,
      },
    });
  });

  // ============================================================
  // /v1/super-admin/* — operator-only directory + metrics.
  //
  // These endpoints expose cross-tenant rollups (every signup, every
  // active subscription, total MRR). The `requireSuperAdmin` middleware
  // gates on `auth.users.raw_app_meta_data.role === 'super_admin'` and
  // returns an opaque 404 to anyone else — including authenticated
  // non-operator users — so probing the surface looks the same as
  // hitting an unknown route.
  //
  // Reads come from the `super_admin_user_directory` and
  // `super_admin_metrics` views, which are owned by `service_role` and
  // REVOKE'd from `anon`/`authenticated`. The view does the joins so
  // we don't have to thread Postgres semantics into TypeScript.
  // ============================================================

  interface SuperAdminUserRow {
    user_id: string;
    email: string | null;
    signed_up_at: string;
    last_sign_in_at: string | null;
    signup_plan: string | null;
    role: string | null;
    project_count: number | null;
    current_plan: string | null;
    reports_last_30d: number | null;
    last_report_at: string | null;
  }

  // List signups with optional search + plan filter. Cursor-paginated by
  // `signed_up_at DESC` so we never miss new rows during paging — the
  // directory grows monotonically by signup time.
  app.get('/v1/super-admin/users', jwtAuth, requireSuperAdmin, async (c) => {
    const db = getServiceClient();
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
    const search = (c.req.query('search') ?? '').trim().toLowerCase();
    const planFilter = (c.req.query('plan') ?? '').trim();
    const cursor = c.req.query('cursor') ?? null;

    let query = db
      .from('super_admin_user_directory')
      .select(
        'user_id, email, signed_up_at, last_sign_in_at, signup_plan, role, project_count, current_plan, reports_last_30d, last_report_at',
      )
      .order('signed_up_at', { ascending: false })
      .limit(limit + 1);

    if (search) {
      query = query.ilike('email', `%${search}%`);
    }
    if (planFilter) {
      if (planFilter === 'paid') {
        query = query.not('current_plan', 'is', null).neq('current_plan', 'hobby');
      } else if (planFilter === 'hobby') {
        // Hobby = no active paid sub. The view stores `null` in that case.
        query = query.is('current_plan', null);
      } else {
        query = query.eq('current_plan', planFilter);
      }
    }
    if (cursor) {
      query = query.lt('signed_up_at', cursor);
    }

    const { data, error } = await query;
    if (error) {
      log.error('super_admin_users_list_failed', { err: error.message });
      return c.json(
        { ok: false, error: { code: 'INTERNAL', message: 'Failed to list users' } },
        500,
      );
    }

    const rows = (data ?? []) as SuperAdminUserRow[];
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1].signed_up_at : null;

    return c.json({
      ok: true,
      data: {
        users: trimmed,
        next_cursor: nextCursor,
        limit,
      },
    });
  });

  // Detail view for one signup: their projects + active subscriptions +
  // recent reports. Used by the row-click drawer in /admin/users.
  app.get('/v1/super-admin/users/:id', jwtAuth, requireSuperAdmin, async (c) => {
    const db = getServiceClient();
    const userId = c.req.param('id');

    const { data: directory, error: dirErr } = await db
      .from('super_admin_user_directory')
      .select(
        'user_id, email, signed_up_at, last_sign_in_at, signup_plan, role, project_count, current_plan, reports_last_30d, last_report_at',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (dirErr || !directory) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }

    const [{ data: projects }, { data: subs }, { data: recentReports }] = await Promise.all([
      db
        .from('projects')
        .select('id, name, slug, created_at, plan_tier, data_region')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false }),
      db
        .from('billing_subscriptions')
        .select(
          'id, project_id, plan_id, status, current_period_end, cancel_at_period_end, created_at',
        )
        .in(
          'project_id',
          // Subselect via inner SQL would be cheaper but the JS client
          // forces a 2-call pattern. Acceptable here — operator endpoint
          // hit at most a few times per day.
          (await db.from('projects').select('id').eq('owner_id', userId)).data?.map(
            (p: { id: string }) => p.id,
          ) ?? [],
        )
        .order('created_at', { ascending: false }),
      db
        .from('reports')
        .select('id, project_id, category, severity, status, created_at')
        .in(
          'project_id',
          (await db.from('projects').select('id').eq('owner_id', userId)).data?.map(
            (p: { id: string }) => p.id,
          ) ?? [],
        )
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    return c.json({
      ok: true,
      data: {
        user: directory,
        projects: projects ?? [],
        subscriptions: subs ?? [],
        recent_reports: recentReports ?? [],
      },
    });
  });

  // One-row aggregate of MRR + signup velocity + churn. Pulled from the
  // `super_admin_metrics` view so the SQL stays in one place.
  app.get('/v1/super-admin/metrics', jwtAuth, requireSuperAdmin, async (c) => {
    const db = getServiceClient();
    const { data, error } = await db.from('super_admin_metrics').select('*').maybeSingle();
    if (error) {
      log.error('super_admin_metrics_failed', { err: error.message });
      return c.json(
        { ok: false, error: { code: 'INTERNAL', message: 'Failed to load metrics' } },
        500,
      );
    }
    return c.json({
      ok: true,
      data: data ?? {
        total_users: 0,
        paid_users: 0,
        mrr_usd: 0,
        signups_last_7d: 0,
        signups_last_30d: 0,
        churn_last_30d: 0,
      },
    });
  });

  // Projects admin endpoints
  // Per-project billing summary for the admin /billing page.
  // Returns the resolved tier, current-period usage, included quota, overage
  // rate, and Stripe customer/subscription state — everything the BillingPage
  // + PdcaCockpit + QuotaBanner read from one call.
}
