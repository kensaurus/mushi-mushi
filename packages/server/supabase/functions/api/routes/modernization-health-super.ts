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
import { dbError, ownedProjectIds, userCanAccessProject } from '../shared.ts';
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
    const projectIds = await ownedProjectIds(db, userId);
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

  const INTEGRATION_KINDS = ['sentry', 'langfuse', 'github', 'anthropic', 'openai'] as const;
  type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

  app.post('/v1/admin/health/integration/:kind', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.param('kind') as IntegrationKind;
    if (!INTEGRATION_KINDS.includes(kind)) {
      return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400);
    }

    const db = getServiceClient();
    // Teams v1: any member can probe an integration in an org they belong
    // to. Pick the first accessible project (matches /v1/admin/health/history
    // semantics; integrations are wired per-project but health probes are
    // workspace-level so the precise pick doesn't matter).
    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404);
    const project = { id: accessibleIds[0] };

    const { data: settings } = await db
      .from('project_settings')
      .select(
        'sentry_org_slug, sentry_project_slug, sentry_auth_token_ref, sentry_dsn, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref',
      )
      .eq('project_id', project.id)
      .single();

    const startedAt = Date.now();
    let healthStatus: 'ok' | 'degraded' | 'down' | 'unknown' = 'unknown';
    let detail = '';
    let httpStatus = 0;

    try {
      if (kind === 'sentry') {
        const token = await dereferenceMaybeVault(db, settings?.sentry_auth_token_ref ?? null);
        const org = settings?.sentry_org_slug;
        if (!token || !org) {
          healthStatus = 'unknown';
          detail =
            'Set sentry_org_slug and sentry_auth_token in Integrations to enable health checks.';
        } else {
          const res = await fetch(
            `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(8_000),
            },
          );
          httpStatus = res.status;
          healthStatus = res.ok
            ? 'ok'
            : res.status === 401 || res.status === 403
              ? 'down'
              : 'degraded';
          if (!res.ok) detail = `HTTP ${res.status}`;
        }
      } else if (kind === 'langfuse') {
        const host =
          settings?.langfuse_host ||
          Deno.env.get('LANGFUSE_BASE_URL') ||
          'https://cloud.langfuse.com';
        const pub =
          (await dereferenceMaybeVault(db, settings?.langfuse_public_key_ref ?? null)) ||
          Deno.env.get('LANGFUSE_PUBLIC_KEY') ||
          '';
        const sec =
          (await dereferenceMaybeVault(db, settings?.langfuse_secret_key_ref ?? null)) ||
          Deno.env.get('LANGFUSE_SECRET_KEY') ||
          '';
        if (!pub || !sec) {
          healthStatus = 'unknown';
          detail = 'Add Langfuse public + secret keys (or set env vars on the host).';
        } else {
          const auth = btoa(`${pub}:${sec}`);
          const res = await fetch(`${host.replace(/\/$/, '')}/api/public/health`, {
            headers: { Authorization: `Basic ${auth}` },
            signal: AbortSignal.timeout(8_000),
          });
          httpStatus = res.status;
          healthStatus = res.ok ? 'ok' : res.status === 401 ? 'down' : 'degraded';
          if (!res.ok) detail = `HTTP ${res.status}`;
        }
      } else if (kind === 'anthropic') {
        // Minimal-cost 1-token probe against Anthropic Messages API. Uses
        // Haiku (cheapest available) with max_tokens=1 so a healthy round
        // trip costs well under $0.0001. Abort after 5s so a stuck upstream
        // can't block the health dashboard.
        const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
        if (!key) {
          healthStatus = 'unknown';
          detail = 'ANTHROPIC_API_KEY is not set on the server.';
        } else {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
            signal: AbortSignal.timeout(5_000),
          });
          httpStatus = res.status;
          healthStatus = res.ok
            ? 'ok'
            : res.status === 401 || res.status === 403
              ? 'down'
              : 'degraded';
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            detail = `HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}`;
          }
        }
      } else if (kind === 'openai') {
        // Chat-completion 1-token probe against OpenAI. We use the cheapest
        // current-generation model (gpt-5.4-mini) so this stays a rounding
        // error on the monthly bill.
        const key = Deno.env.get('OPENAI_API_KEY') ?? '';
        if (!key) {
          healthStatus = 'unknown';
          detail = 'OPENAI_API_KEY is not set on the server.';
        } else {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-5.4-mini',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }),
            signal: AbortSignal.timeout(5_000),
          });
          httpStatus = res.status;
          healthStatus = res.ok
            ? 'ok'
            : res.status === 401 || res.status === 403
              ? 'down'
              : 'degraded';
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            detail = `HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}`;
          }
        }
      } else if (kind === 'github') {
        const token =
          (await dereferenceMaybeVault(db, settings?.github_installation_token_ref ?? null)) ||
          Deno.env.get('GITHUB_TOKEN') ||
          '';
        const url = settings?.github_repo_url ?? '';
        // Repo names can contain dots (e.g. glot.it). Strip optional trailing
        // `.git` and capture everything up to the next `/` or end-of-string.
        const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
        if (!token || !match) {
          healthStatus = 'unknown';
          detail = 'Add github_repo_url and a GitHub App / PAT installation token.';
        } else {
          const [, owner, repo] = match;
          const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'mushi-mushi-health-probe/1.0',
            },
            signal: AbortSignal.timeout(8_000),
          });
          httpStatus = res.status;
          healthStatus = res.ok
            ? 'ok'
            : res.status === 401 || res.status === 403 || res.status === 404
              ? 'down'
              : 'degraded';
          if (!res.ok) detail = `HTTP ${res.status}`;
        }
      }
    } catch (err) {
      healthStatus = 'down';
      detail = String(err).slice(0, 200);
    }

    const latencyMs = Date.now() - startedAt;
    await db.from('integration_health_history').insert({
      project_id: project.id,
      kind,
      status: healthStatus,
      latency_ms: latencyMs,
      message: detail || (httpStatus ? `HTTP ${httpStatus}` : null),
      source: 'manual',
    });

    return c.json({
      ok: true,
      data: { kind, status: healthStatus, httpStatus, latencyMs, detail },
    });
  });

  app.get('/v1/admin/health/history', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    // Teams v1: show health history for every accessible project in one
    // stream — org members hitting Integrations → Health History should see
    // the workspace's probe ticks regardless of which org member triggered
    // them.
    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: true, data: { history: [] } });

    const { data } = await db
      .from('integration_health_history')
      .select('id, kind, status, latency_ms, message, source, checked_at')
      .in('project_id', accessibleIds)
      .order('checked_at', { ascending: false })
      .limit(200);

    return c.json({ ok: true, data: { history: data ?? [] } });
  });

  async function dereferenceMaybeVault(
    db: ReturnType<typeof getServiceClient>,
    ref: string | null,
  ): Promise<string | null> {
    if (!ref) return null;
    if (!ref.startsWith('vault://')) return ref;
    const id = ref.slice('vault://'.length);
    const { data, error } = await db.rpc('vault_get_secret', { secret_id: id });
    if (error) return null;
    return typeof data === 'string' ? data : null;
  }

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

    const flags = (entitlement.plan.feature_flags ?? {}) as Record<string, unknown>;

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
