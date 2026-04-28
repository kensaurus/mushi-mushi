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

export function registerBillingProjectsQueueGraphRoutes(app: Hono): void {
  app.get('/v1/admin/billing', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIdsForUser = await ownedProjectIds(db, userId);
    const { data: projects } =
      projectIdsForUser.length > 0
        ? await db
            .from('projects')
            .select('id, name, organization_id')
            .in('id', projectIdsForUser)
            .order('created_at', { ascending: true })
        : { data: [] };

    // Always send the plan catalog so the FE can render the upgrade modal
    // without a second round-trip — even when the user owns 0 projects.
    const plans = await listPlans();

    if (!projects || projects.length === 0) {
      return c.json({ ok: true, data: { projects: [], plans } });
    }

    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);

    const projectIds = projects.map((p) => p.id);
    const [{ data: subs }, { data: customers }, { data: usage }, { data: llmCosts }] =
      await Promise.all([
        db
          .from('billing_subscriptions')
          .select(
            'project_id, organization_id, status, plan_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end, overage_subscription_item_id',
          )
          .in('project_id', projectIds),
        db
          .from('billing_customers')
          .select('project_id, organization_id, stripe_customer_id, default_payment_ok, email')
          .in('project_id', projectIds),
        db
          .from('usage_events')
          .select('project_id, event_name, quantity, occurred_at')
          .in('project_id', projectIds)
          .gte('occurred_at', periodStart.toISOString()),
        // §2: real LLM cost (COGS) for the current billing month so the
        // Billing page can show "$ spent on LLM this month" alongside report
        // quota. Reads the persisted cost_usd column written by telemetry.ts.
        db
          .from('llm_invocations')
          .select('project_id, cost_usd')
          .in('project_id', projectIds)
          .gte('created_at', periodStart.toISOString())
          .not('cost_usd', 'is', null),
      ]);

    // Pick the most recent active sub per project (a project may have a
    // canceled sub + a fresh active one; we always render the active one).
    const subByProject = new Map<string, any>();
    for (const s of subs ?? []) {
      const cur = subByProject.get(s.project_id);
      const isMoreRecent =
        !cur || new Date(s.current_period_end ?? 0) > new Date(cur.current_period_end ?? 0);
      if (isMoreRecent) subByProject.set(s.project_id, s);
    }
    const customerByProject = new Map<string, any>();
    for (const cu of customers ?? []) customerByProject.set(cu.project_id, cu);

    const usageByProject = new Map<
      string,
      { reports: number; fixes: number; fixesSucceeded: number; tokens: number }
    >();
    for (const u of usage ?? []) {
      const cur = usageByProject.get(u.project_id) ?? {
        reports: 0,
        fixes: 0,
        fixesSucceeded: 0,
        tokens: 0,
      };
      if (u.event_name === 'reports_ingested') cur.reports += Number(u.quantity);
      else if (u.event_name === 'fixes_attempted') cur.fixes += Number(u.quantity);
      else if (u.event_name === 'fixes_succeeded') cur.fixesSucceeded += Number(u.quantity);
      else if (u.event_name === 'classifier_tokens') cur.tokens += Number(u.quantity);
      usageByProject.set(u.project_id, cur);
    }

    const llmCostByProject = new Map<string, number>();
    for (const c of llmCosts ?? []) {
      const cur = llmCostByProject.get(c.project_id) ?? 0;
      llmCostByProject.set(c.project_id, cur + Number(c.cost_usd));
    }

    const items = await Promise.all(
      projects.map(async (p) => {
        const sub = subByProject.get(p.id) ?? null;
        const cust = customerByProject.get(p.id) ?? null;
        const u = usageByProject.get(p.id) ?? {
          reports: 0,
          fixes: 0,
          fixesSucceeded: 0,
          tokens: 0,
        };
        const planId =
          sub && ['active', 'trialing', 'past_due'].includes(sub.status) ? sub.plan_id : 'hobby';
        const plan = await getPlan(planId);
        const limit = plan.included_reports_per_month;
        return {
          project_id: p.id,
          organization_id: p.organization_id ?? null,
          project_name: p.name,
          // Both kept for FE backwards-compat: legacy `plan: 'free' | <price-id>` and the new tier object.
          plan: plan.id === 'hobby' ? 'free' : (sub?.stripe_price_id ?? plan.id),
          tier: {
            id: plan.id,
            display_name: plan.display_name,
            monthly_price_usd: plan.monthly_price_usd,
            included_reports_per_month: plan.included_reports_per_month,
            overage_unit_amount_decimal: plan.overage_unit_amount_decimal,
            retention_days: plan.retention_days,
            feature_flags: plan.feature_flags,
          },
          subscription: sub,
          customer: cust,
          period_start: periodStart.toISOString(),
          usage: u,
          // §2: actual LLM dollars spent this billing month, summed from
          // the persisted `llm_invocations.cost_usd` column. Rounded to four
          // decimals so a $0.0001 Haiku call is still visible.
          llm_cost_usd_this_month: Math.round((llmCostByProject.get(p.id) ?? 0) * 10000) / 10000,
          limit_reports: limit,
          over_quota: limit !== null && u.reports >= limit && !plan.overage_price_lookup_key,
          // Used by the QuotaBanner to render at >=80% / >=100%.
          usage_pct: limit ? Math.round((u.reports / limit) * 100) : null,
        };
      }),
    );

    // Hobby quota for the legacy `free_limit_reports_per_month` key still used
    // by older FE builds. Pick the catalog value, fall back to env.
    const hobby = plans.find((pl) => pl.id === 'hobby');
    const freeLimit =
      hobby?.included_reports_per_month ??
      Number(Deno.env.get('MUSHI_FREE_REPORTS_PER_MONTH') ?? '1000');

    return c.json({
      ok: true,
      data: { projects: items, plans, free_limit_reports_per_month: freeLimit },
    });
  });

  // =================================================================================
  // GET /v1/admin/setup
  // ---------------------------------------------------------------------------------
  // Aggregates the seven onboarding signals per owned project. Single source of truth
  // for the dashboard `SetupChecklist` banner, the full `/onboarding` wizard, and
  // every contextual EmptyState nudge across the app. Reads live DB state instead of
  // the legacy `localStorage.mushi:onboarding_completed` flag so progress survives
  // across devices/browsers and reflects the actual pipeline.
  // =================================================================================
  app.get('/v1/admin/setup', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: projects } = await db
      .from('projects')
      .select('id, name, slug, created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true });

    if (!projects || projects.length === 0) {
      return c.json({
        ok: true,
        data: {
          has_any_project: false,
          projects: [],
        },
      });
    }

    const projectIds = projects.map((p) => p.id);

    // Pull every signal in parallel; we project narrow column lists to keep this
    // cheap even when the user owns dozens of projects.
    const [keysRes, settingsRes, reportsRes, fixesRes, reposRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select('project_id, is_active')
        .in('project_id', projectIds)
        .eq('is_active', true),
      db
        .from('project_settings')
        .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref')
        .in('project_id', projectIds),
      db
        .from('reports')
        .select('project_id, environment, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('fix_attempts')
        .select('project_id, merged_at')
        .in('project_id', projectIds)
        .limit(1000),
      db.from('project_repos').select('project_id').in('project_id', projectIds),
    ]);

    const keyByProject = new Set<string>();
    for (const k of keysRes.data ?? []) keyByProject.add(k.project_id);

    const settingsByProject = new Map<
      string,
      {
        github_repo_url: string | null;
        sentry_org_slug: string | null;
        byok_anthropic_key_ref: string | null;
      }
    >();
    for (const s of settingsRes.data ?? []) settingsByProject.set(s.project_id, s as never);

    const reposByProject = new Set<string>();
    for (const r of reposRes.data ?? []) reposByProject.add(r.project_id);

    // SDK installed = at least one report whose `environment.userAgent` is a real
    // browser (not the admin-only `mushi-admin` synthetic), and whose `environment`
    // contains the `viewport` key the SDK always emits.
    const sdkByProject = new Set<string>();
    const reportsByProject = new Map<string, { count: number; firstAt: string | null }>();
    for (const r of reportsRes.data ?? []) {
      const cur = reportsByProject.get(r.project_id) ?? { count: 0, firstAt: null };
      cur.count += 1;
      cur.firstAt = r.created_at;
      reportsByProject.set(r.project_id, cur);
      const env = (r.environment ?? {}) as Record<string, unknown>;
      const platform = typeof env.platform === 'string' ? env.platform : '';
      if (platform && platform !== 'mushi-admin') sdkByProject.add(r.project_id);
    }

    // Track BOTH "any fix dispatched" (drives the Check stage transition into
    // 'active') and "fix merged" (drives Check → 'done'). Without the merged
    // count the dashboard's PDCA loop card flips straight from 'next' to
    // 'done' and falsely claims "Loop closed" the moment a draft PR opens.
    const fixesByProject = new Map<string, number>();
    const mergedFixesByProject = new Map<string, number>();
    for (const f of fixesRes.data ?? []) {
      fixesByProject.set(f.project_id, (fixesByProject.get(f.project_id) ?? 0) + 1);
      if (f.merged_at) {
        mergedFixesByProject.set(f.project_id, (mergedFixesByProject.get(f.project_id) ?? 0) + 1);
      }
    }

    type StepId =
      | 'project_created'
      | 'api_key_generated'
      | 'sdk_installed'
      | 'first_report_received'
      | 'github_connected'
      | 'sentry_connected'
      | 'byok_anthropic'
      | 'first_fix_dispatched';

    interface Step {
      id: StepId;
      label: string;
      description: string;
      complete: boolean;
      /** True when this step is required for the basic pipeline to work. */
      required: boolean;
      /** Admin-console link the wizard / nudge should jump to. */
      cta_to: string;
      cta_label: string;
    }

    const enriched = projects.map((p) => {
      const hasKey = keyByProject.has(p.id);
      const settings = settingsByProject.get(p.id);
      const hasSdk = sdkByProject.has(p.id);
      const reportInfo = reportsByProject.get(p.id) ?? { count: 0, firstAt: null };
      const hasGithub = Boolean(settings?.github_repo_url) || reposByProject.has(p.id);
      const hasSentry = Boolean(settings?.sentry_org_slug);
      const hasByok = Boolean(settings?.byok_anthropic_key_ref);
      const fixCount = fixesByProject.get(p.id) ?? 0;
      const mergedFixCount = mergedFixesByProject.get(p.id) ?? 0;

      const steps: Step[] = [
        {
          id: 'project_created',
          label: 'Create your first project',
          description: 'A project groups all bug reports from one application.',
          complete: true,
          required: true,
          cta_to: '/projects',
          cta_label: 'Manage projects',
        },
        {
          id: 'api_key_generated',
          label: 'Generate an API key',
          description: 'Your SDK uses this key to authenticate report submissions.',
          complete: hasKey,
          required: true,
          cta_to: '/projects',
          cta_label: 'Generate key',
        },
        {
          id: 'sdk_installed',
          label: 'Install the SDK in your app',
          description: 'Drop the Mushi widget into your app so users can submit reports.',
          complete: hasSdk,
          required: true,
          cta_to: '/onboarding',
          cta_label: 'View setup guide',
        },
        {
          id: 'first_report_received',
          label: 'Receive your first bug report',
          description: 'Send a test report or wait for a real user submission.',
          complete: reportInfo.count > 0,
          required: true,
          cta_to: '/onboarding',
          cta_label: 'Send test report',
        },
        {
          id: 'github_connected',
          label: 'Connect GitHub',
          description: 'Required for auto-fix PRs and code grounding.',
          complete: hasGithub,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Connect GitHub',
        },
        {
          id: 'sentry_connected',
          label: 'Connect Sentry (optional)',
          description: 'Pull Sentry issues + Seer root-cause into Mushi reports.',
          complete: hasSentry,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Connect Sentry',
        },
        {
          id: 'byok_anthropic',
          label: 'Add your Anthropic key (optional)',
          description: 'BYOK avoids platform quotas and sends usage to your own bill.',
          complete: hasByok,
          required: false,
          cta_to: '/settings',
          cta_label: 'Add API key',
        },
        {
          id: 'first_fix_dispatched',
          label: 'Dispatch your first auto-fix',
          description: 'Open a report, click "Dispatch fix", and watch the LLM agent.',
          complete: fixCount > 0,
          required: false,
          cta_to: '/reports',
          cta_label: 'Open Reports',
        },
      ];

      const requiredSteps = steps.filter((s) => s.required);
      const completeRequired = requiredSteps.filter((s) => s.complete).length;
      const completeAll = steps.filter((s) => s.complete).length;

      return {
        project_id: p.id,
        project_name: p.name,
        project_slug: p.slug,
        created_at: p.created_at,
        steps,
        required_total: requiredSteps.length,
        required_complete: completeRequired,
        total: steps.length,
        complete: completeAll,
        done: completeRequired === requiredSteps.length,
        report_count: reportInfo.count,
        fix_count: fixCount,
        merged_fix_count: mergedFixCount,
      };
    });

    return c.json({
      ok: true,
      data: {
        has_any_project: true,
        projects: enriched,
      },
    });
  });

  // Lenient UUID matcher (any 8-4-4-4-12 hex). The strict v1–v5 form in
  // shared.ts rejects seed/test rows like `a0000000-0000-0000-0000-000000000001`
  // because the version nibble is `0`. We need to delete those, so be
  // permissive at the boundary and let the DB enforce key shape.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get('/v1/admin/projects', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Teams v1: a user can see every project in any organization they're a
    // member of, plus any legacy project they directly own (covers
    // pre-org-backfill rows). The previous `.eq('owner_id', userId)` filter
    // showed "0 projects" to every team member who wasn't also the owner —
    // so an invited collaborator hit /onboarding and couldn't reach the org's
    // real projects (verified in production: kensaurus@gmail.com saw 0 of
    // 3 projects despite being a confirmed member of test@mushimushi.dev's
    // org). `accessibleProjectIds` is the canonical helper already used by
    // /v1/admin/billing/* and the entitlements layer; the projects list is
    // the only owner-only filter that hadn't been migrated.
    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: true, data: { projects: [] } });

    // Pull the projects + the user's role in each project's org so the FE can
    // gate destructive actions (delete project, manage members) on org role
    // without a second round-trip per row.
    const [{ data: projectRows }, { data: memberships }] = await Promise.all([
      db
        .from('projects')
        .select('id, name, slug, created_at, organization_id')
        .in('id', accessibleIds)
        .order('created_at', { ascending: false }),
      db
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', userId),
    ]);

    const roleByOrg = new Map<string, string>();
    for (const m of memberships ?? []) roleByOrg.set(m.organization_id, m.role);

    const projects = (projectRows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      created_at: p.created_at,
      organization_id: p.organization_id,
      // null for legacy owned-but-not-in-org rows; FE treats that as 'owner'.
      organization_role: p.organization_id ? roleByOrg.get(p.organization_id) ?? null : null,
    }));

    const projectIds = projects.map((p) => p.id);

    // `latestReports` is one query per project so each project gets its true
    // most-recent report. The previous single-query approach with a global
    // `limit(projectIds.length * 2)` would silently report `last_report_at: null`
    // for any project whose newest report was older than the top N rows of a
    // sibling project — see UX audit: glot.it showed "last report never" despite
    // having 31 reports because mushi-mushi (sister project) had pushed it past
    // the limit window.
    // PDCA bottleneck rollup is computed per-project so the projects list can
    // show "where this project is stuck" inline. previously
    // the only signal was last_report_at, which doesn't tell the user whether
    // they need to triage, ship a fix, or wire integrations.
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();

    const [reportCounts, allKeys, members, latestReports, planBacklogs, doFlights, checkPending] =
      await Promise.all([
        db
          .from('reports')
          .select('project_id', { count: 'exact', head: false })
          .in('project_id', projectIds),
        db
          .from('project_api_keys')
          .select('id, project_id, key_prefix, created_at, is_active, scopes, label')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false }),
        db.from('project_members').select('project_id, user_id, role').in('project_id', projectIds),
        Promise.all(
          projectIds.map((pid) =>
            db
              .from('reports')
              .select('created_at')
              .eq('project_id', pid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
              .then((r) => ({ project_id: pid, created_at: r.data?.created_at ?? null })),
          ),
        ),
        db
          .from('reports')
          .select('project_id')
          .in('project_id', projectIds)
          .eq('status', 'new')
          .lt('created_at', oneHourAgo),
        db
          .from('fix_attempts')
          .select('project_id, status')
          .in('project_id', projectIds)
          .in('status', ['pending', 'running', 'pr_open', 'failed']),
        db
          .from('classification_evaluations')
          .select('report_id, project_id, classification_agreed, created_at')
          .in('project_id', projectIds)
          .gte('created_at', fourteenDaysAgo),
      ]);

    const countMap: Record<string, number> = {};
    for (const r of reportCounts.data ?? [])
      countMap[r.project_id] = (countMap[r.project_id] ?? 0) + 1;

    const keyMap: Record<string, Array<Record<string, unknown>>> = {};
    for (const k of allKeys.data ?? []) {
      if (!keyMap[k.project_id]) keyMap[k.project_id] = [];
      keyMap[k.project_id].push({
        id: k.id,
        key_prefix: k.key_prefix,
        created_at: k.created_at,
        is_active: k.is_active,
        revoked: !k.is_active,
        scopes: (k as any).scopes ?? [],
        label: (k as any).label ?? null,
      });
    }

    const memberMap: Record<string, Array<{ user_id: string; role: string }>> = {};
    for (const m of members.data ?? []) {
      if (!memberMap[m.project_id]) memberMap[m.project_id] = [];
      memberMap[m.project_id].push({ user_id: m.user_id, role: m.role });
    }

    const lastReportMap: Record<string, string> = {};
    for (const r of latestReports) {
      if (r.created_at) lastReportMap[r.project_id] = r.created_at;
    }

    const planBacklogMap: Record<string, number> = {};
    for (const r of planBacklogs.data ?? []) {
      planBacklogMap[r.project_id] = (planBacklogMap[r.project_id] ?? 0) + 1;
    }

    const fixInflightMap: Record<string, number> = {};
    const fixFailedMap: Record<string, number> = {};
    for (const f of doFlights.data ?? []) {
      if (f.status === 'failed') {
        fixFailedMap[f.project_id] = (fixFailedMap[f.project_id] ?? 0) + 1;
      } else {
        fixInflightMap[f.project_id] = (fixInflightMap[f.project_id] ?? 0) + 1;
      }
    }

    const checkDisagreeMap: Record<string, number> = {};
    for (const e of checkPending.data ?? []) {
      if (e.classification_agreed === false) {
        checkDisagreeMap[e.project_id] = (checkDisagreeMap[e.project_id] ?? 0) + 1;
      }
    }

    const enriched = (projects ?? []).map((p) => {
      const keys = keyMap[p.id] ?? [];
      const planCount = planBacklogMap[p.id] ?? 0;
      const doInflight = fixInflightMap[p.id] ?? 0;
      const doFailed = fixFailedMap[p.id] ?? 0;
      const disagreements = checkDisagreeMap[p.id] ?? 0;
      // Pick the single most-urgent stage so the FE can render one bottleneck
      // pill per row without a chart. Mirrors the dashboard focusStage logic
      // but scoped per-project.
      let bottleneckStage: 'plan' | 'do' | 'check' | 'act' | null = null;
      let bottleneckLabel: string | null = null;
      if (doFailed > 0) {
        bottleneckStage = 'do';
        bottleneckLabel = `${doFailed} ${doFailed === 1 ? 'fix needs' : 'fixes need'} retry`;
      } else if (planCount > 5) {
        bottleneckStage = 'plan';
        bottleneckLabel = `${planCount} reports waiting > 1h to triage`;
      } else if (disagreements > 3) {
        bottleneckStage = 'check';
        bottleneckLabel = `${disagreements} judge ${disagreements === 1 ? 'disagrees' : 'disagree'} with classifier`;
      } else if (doInflight > 0) {
        bottleneckStage = 'do';
        bottleneckLabel = `${doInflight} ${doInflight === 1 ? 'fix in flight' : 'fixes in flight'}`;
      } else if (planCount > 0) {
        bottleneckStage = 'plan';
        bottleneckLabel = `${planCount} ${planCount === 1 ? 'report waiting' : 'reports waiting'} > 1h`;
      }
      return {
        ...p,
        report_count: countMap[p.id] ?? 0,
        api_keys: keys,
        active_key_count: keys.filter((k) => k.is_active).length,
        member_count: (memberMap[p.id] ?? []).length,
        members: memberMap[p.id] ?? [],
        last_report_at: lastReportMap[p.id] ?? null,
        pdca_bottleneck: bottleneckStage,
        pdca_bottleneck_label: bottleneckLabel,
      };
    });

    return c.json({ ok: true, data: { projects: enriched } });
  });

  app.post('/v1/admin/projects', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const { name } = (await c.req.json()) as { name: string };
    const db = getServiceClient();

    if (!name?.trim()) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Name required' } },
        400,
      );
    }

    // Teams v1 added a NOT NULL `organization_id` to `projects`, but this
    // POST kept inserting with only `owner_id`. Result: every "Create
    // project" call returned 500 in production (verified 2026-04-28: kept
    // logging `code 23502 — null value in column "organization_id"`).
    // Resolve the active org from the same `X-Mushi-Org-Id` header the FE
    // already sends for every other org-scoped call. Fall back to the
    // user's first org membership (oldest first, owner roles preferred)
    // when no header is set so that legacy SDK calls keep working.
    const orgIdHint = c.req.header('x-mushi-org-id') ?? c.req.header('X-Mushi-Org-Id') ?? null;
    if (orgIdHint && !UUID_RE.test(orgIdHint)) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_ORGANIZATION_ID', message: 'X-Mushi-Org-Id must be a UUID' },
        },
        400,
      );
    }

    const { data: memberships } = await db
      .from('organization_members')
      .select('organization_id, role, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    const memberOrgs = memberships ?? [];
    let organizationId: string | null = null;
    if (orgIdHint) {
      const match = memberOrgs.find((m) => m.organization_id === orgIdHint);
      if (!match) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You are not a member of the requested organization',
            },
          },
          403,
        );
      }
      // Only owners and admins can create projects in an org. Members and
      // viewers get a clear 403 instead of a confusing DB error.
      if (match.role !== 'owner' && match.role !== 'admin') {
        return c.json(
          {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Only org owners or admins can create projects',
            },
          },
          403,
        );
      }
      organizationId = match.organization_id;
    } else {
      // No hint: pick the user's oldest org where they're owner/admin so
      // the new project lands somewhere they can manage.
      const writable = memberOrgs.find((m) => m.role === 'owner' || m.role === 'admin');
      organizationId = writable?.organization_id ?? null;
    }

    if (!organizationId) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_ORGANIZATION',
            message: 'You need to be an owner or admin of an organization to create a project',
          },
        },
        400,
      );
    }

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const { data, error } = await db
      .from('projects')
      .insert({
        name: name.trim(),
        slug,
        owner_id: userId,
        organization_id: organizationId,
      })
      .select('id')
      .single();

    if (error) return dbError(c, error);

    await db.from('project_settings').insert({ project_id: data.id });
    // Membership is the source-of-truth for "can this user dispatch fixes /
    // see traces / etc". Without this row the owner can read via owner_id but
    // member-gated endpoints (fixes/dispatch) reject them. Always seed.
    await db
      .from('project_members')
      .upsert(
        { project_id: data.id, user_id: userId, role: 'owner' },
        { onConflict: 'project_id,user_id' },
      );

    return c.json({ ok: true, data: { id: data.id, slug } }, 201);
  });

  // Permanently deletes a project. All FKs to `projects.id` use ON DELETE
  // CASCADE so this single statement removes reports, comments, fix_attempts,
  // api_keys, settings, members, integrations, billing_subscriptions, etc.
  // (54 cascading tables as of 2026-04-28). This is irreversible.
  //
  // Authz: only an org `owner` or `admin` can delete a project. `member`
  // and `viewer` get a 403. Solo accounts (legacy `owner_id` rows with no
  // org row) fall back to `owner_id == userId`.
  //
  // UX defense: the FE ships a type-the-slug-to-confirm modal. The backend
  // also accepts an optional `{ confirm_slug }` body and rejects mismatches
  // so a stolen JWT or a broken FE can't blow away a project with a single
  // verb-only request.
  //
  // Audit: `audit_logs` cascades with the project, so a row written there
  // would die with the data it documents. Log the deletion event to Sentry
  // (`category=project.deleted`) so monitoring keeps the receipt.
  app.delete('/v1/admin/projects/:id', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { confirm_slug?: string };

    const { data: project, error: projectErr } = await db
      .from('projects')
      .select('id, name, slug, organization_id, owner_id')
      .eq('id', projectId)
      .maybeSingle();
    if (projectErr) return dbError(c, projectErr);
    if (!project) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    // Belt-and-suspenders: if FE sent a confirm_slug it MUST match. Treat
    // a mismatch as a hard 400, never silently delete.
    if (body.confirm_slug !== undefined && body.confirm_slug !== project.slug) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SLUG_MISMATCH',
            message: `confirm_slug must equal "${project.slug}"`,
          },
        },
        400,
      );
    }

    // Resolve the caller's role in this project's org. Two-tier authz:
    //   • Org-backed project (the new normal) → require role in
    //     {owner, admin}.
    //   • Legacy ownerless-org project → fall back to owner_id match.
    let allowed = false;
    if (project.organization_id) {
      const { data: membership } = await db
        .from('organization_members')
        .select('role')
        .eq('organization_id', project.organization_id)
        .eq('user_id', userId)
        .maybeSingle();
      const role = membership?.role ?? null;
      allowed = role === 'owner' || role === 'admin';
    } else if (project.owner_id === userId) {
      allowed = true;
    }

    if (!allowed) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only org owners or admins can delete a project',
          },
        },
        403,
      );
    }

    const { error: deleteErr } = await db.from('projects').delete().eq('id', projectId);
    if (deleteErr) return dbError(c, deleteErr);

    // Sentry breadcrumb-style log. Real monitoring hook: filter by
    // `category:project.deleted` to spot accidental mass-deletions.
    try {
      log('project.deleted', {
        project_id: project.id,
        project_slug: project.slug,
        project_name: project.name,
        organization_id: project.organization_id,
        deleted_by: userId,
      });
    } catch {
      // Logger failures must never block the delete from succeeding.
    }

    return c.json({
      ok: true,
      data: { id: project.id, slug: project.slug, name: project.name },
    });
  });

  // Scopes vocabulary is enforced at the DB level (CHECK constraint from
  // migration 20260421003000_api_key_scopes.sql). We echo it here so the API
  // rejects bad input with a 400 and a helpful message, rather than letting
  // Postgres surface a noisy `23514` error.
  const ALLOWED_KEY_SCOPES = ['report:write', 'mcp:read', 'mcp:write'] as const;
  type AllowedScope = (typeof ALLOWED_KEY_SCOPES)[number];

  function normaliseScopes(input: unknown): AllowedScope[] | { error: string } {
    if (input === undefined || input === null) return ['report:write'];
    if (!Array.isArray(input) || input.length === 0) {
      return { error: 'scopes must be a non-empty array' };
    }
    const unique = Array.from(new Set(input.map(String)));
    const invalid = unique.filter((s) => !(ALLOWED_KEY_SCOPES as readonly string[]).includes(s));
    if (invalid.length > 0) {
      return {
        error: `Unknown scope(s): ${invalid.join(', ')}. Allowed: ${ALLOWED_KEY_SCOPES.join(', ')}`,
      };
    }
    return unique as AllowedScope[];
  }

  app.post('/v1/admin/projects/:id/keys', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const body = (await c.req.json().catch(() => ({}))) as { scopes?: unknown; label?: string };
    const scopes = normaliseScopes(body.scopes);
    if ('error' in scopes) {
      return c.json({ ok: false, error: { code: 'INVALID_SCOPES', message: scopes.error } }, 400);
    }

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .single();
    if (!project)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const label =
      typeof body.label === 'string' && body.label.trim().length > 0
        ? body.label.trim().slice(0, 64)
        : scopes.includes('mcp:write')
          ? 'mcp-readwrite'
          : scopes.includes('mcp:read')
            ? 'mcp-readonly'
            : 'default';

    const { error } = await db.from('project_api_keys').insert({
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label,
      scopes,
      is_active: true,
    });

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { key: rawKey, prefix, scopes, label } }, 201);
  });

  // Rotation endpoint advertised by the auth manifest.: previously a
  // 404 because no Hono route existed despite being listed under
  // `mushi-api-key.rotation_endpoint`. Atomic-ish rotate-then-issue:
  //
  //   1. Mark every active key on the project as revoked (soft-delete, audit
  //      log keeps the prefix for forensics).
  //   2. Mint a fresh key with the same crypto pattern as POST /keys.
  //   3. Return only the new key once — same one-shot semantics as initial
  //      generation so callers know to copy immediately.
  //
  // "Atomic-ish" because Supabase Edge Functions don't expose transactions; in
  // the worst case (network blip between the revoke and the insert) the project
  // is keyless until the second call retries. That is strictly safer than the
  // inverse — leaking a window where both the old and new keys are valid would
  // silently extend the rotated key's effective lifetime.
  app.post('/v1/admin/projects/:id/keys/rotate', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .single();
    if (!project) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const { data: existing, error: fetchError } = await db
      .from('project_api_keys')
      .select('id, key_prefix')
      .eq('project_id', projectId)
      .eq('is_active', true);
    if (fetchError) return dbError(c, fetchError);

    const revokedAt = new Date().toISOString();
    if (existing && existing.length > 0) {
      const { error: revokeError } = await db
        .from('project_api_keys')
        .update({ is_active: false, revoked_at: revokedAt })
        .eq('project_id', projectId)
        .eq('is_active', true);
      if (revokeError) return dbError(c, revokeError);
    }

    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const { data: newRow, error: insertError } = await db
      .from('project_api_keys')
      .insert({
        project_id: projectId,
        key_hash: keyHash,
        key_prefix: prefix,
        label: 'rotated',
        is_active: true,
      })
      .select('id')
      .single();
    if (insertError) return dbError(c, insertError);

    const userEmail = c.get('userEmail') as string | undefined;
    await logAudit(
      db,
      projectId,
      userId,
      'api_key.created',
      'api_key',
      newRow?.id,
      {
        rotated: true,
        revoked_count: existing?.length ?? 0,
        revoked_prefixes: (existing ?? []).map((row: { key_prefix: string }) => row.key_prefix),
      },
      { email: userEmail },
    );

    return c.json(
      {
        ok: true,
        data: {
          key: rawKey,
          prefix,
          revoked: existing?.length ?? 0,
          rotated_at: revokedAt,
        },
      },
      201,
    );
  });

  app.delete('/v1/admin/projects/:id/keys/:keyId', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const keyId = c.req.param('keyId');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .single();
    if (!project)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);

    await db
      .from('project_api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', keyId)
      .eq('project_id', projectId);

    return c.json({ ok: true });
  });

  // Admin pipeline diagnostic. Exists so the admin console's "Send test report"
  // buttons (DashboardPage.GettingStartedEmpty, SettingsPage.QuickTestSection)
  // can verify the ingest path without copy-pasting an API key — the admin is
  // already JWT-authenticated and owns the project. Goes through ingestReport()
  // so it really exercises schema validation, queue insert, circuit breaker, and
  // classification trigger. Tagged with metadata.source so admins can filter
  // these out of the inbox.
  app.post('/v1/admin/projects/:id/test-report', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .single();
    if (!project)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);

    const ipAddress =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent') ?? 'mushi-admin';
    const now = new Date().toISOString();

    const syntheticBody = {
      projectId, // schema-required; ingestReport actually uses the auth-context projectId
      category: 'other' as const,
      description:
        'Admin pipeline test — verifying ingest, validation, queue, and classification end-to-end.',
      environment: {
        userAgent,
        platform: 'mushi-admin',
        language: 'en',
        viewport: { width: 0, height: 0 },
        url: 'admin://test-report',
        referrer: '',
        timestamp: now,
        timezone: 'UTC',
      },
      reporterToken: `admin-test-${userId}`,
      metadata: { source: 'admin_test_report', userId },
      createdAt: now,
    };

    const result = await ingestReport(db, projectId, syntheticBody, { ipAddress, userAgent });
    if (!result.ok) {
      return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400);
    }

    return c.json(
      {
        ok: true,
        data: { reportId: result.reportId, projectName: project.name },
      },
      201,
    );
  });

  // ---------------------------------------------------------------------------
  // Codebase indexing (Phase 3 of the PDCA unblock).
  //
  // POST /v1/admin/projects/:id/codebase/enable
  //   - Upserts a `project_repos` row for the primary repo.
  //   - Flips `project_settings.codebase_index_enabled = true`, seeds
  //     `codebase_repo_url` + (if missing) a GitHub webhook secret.
  //   - Kicks an immediate `mode=sweep` invocation on webhooks-github-indexer
  //     so the user doesn't have to wait for the hourly `mushi-repo-indexer-hourly`
  //     cron to see indexed files show up.
  //
  // GET /v1/admin/projects/:id/codebase/stats
  //   - Returns `indexed_files`, `last_indexed_at`, `last_index_error`,
  //     `codebase_index_enabled`, `repo_url`, and `has_webhook_secret` so the
  //     IntegrationsPage card can render live state. Cheap — one count +
  //     two single-row reads.
  // ---------------------------------------------------------------------------

  const GITHUB_URL_RE =
    /^https?:\/\/(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s#?]+?)(?:\.git)?\/?$/i;

  function parseGithubRepoUrl(
    url: string | null | undefined,
  ): { owner: string; repo: string } | null {
    if (!url) return null;
    const match = GITHUB_URL_RE.exec(url.trim());
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  async function generateWebhookSecret(): Promise<string> {
    // GitHub recommends at least 32 bytes of entropy for webhook secrets; we
    // emit 48 random bytes base64url-encoded → 64 chars of URL-safe ASCII,
    // well over the floor and friendly to copy-paste into the GitHub UI.
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function kickCodebaseSweep(projectId: string): Promise<void> {
    // Fire-and-forget — the sweep writes to project_codebase_files and
    // updates project_repos.last_indexed_at / last_index_error, so the
    // caller doesn't need to block. A short AbortSignal prevents a slow
    // sweep from holding the enable response hostage.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const internalSecret =
      Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !internalSecret) return;
    await fetch(`${supabaseUrl}/functions/v1/webhooks-github-indexer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'sweep', project_id: projectId }),
      signal: AbortSignal.timeout(2_000),
    }).catch(() => {
      /* worker is fire-and-forget */
    });
  }

  app.post('/v1/admin/projects/:id/codebase/enable', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: membership } = await db
      .from('project_members')
      .select('role')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!membership)
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );

    let body: {
      repo_url?: string;
      default_branch?: string;
      installation_id?: string | number | null;
      path_globs?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } },
        400,
      );
    }

    const parsed = parseGithubRepoUrl(body.repo_url);
    if (!parsed) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_REPO_URL',
            message: 'repo_url must look like https://github.com/<owner>/<repo>',
          },
        },
        400,
      );
    }
    const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    const defaultBranch = (body.default_branch ?? 'main').trim() || 'main';
    const installationId =
      body.installation_id != null && String(body.installation_id).trim() !== ''
        ? Number(body.installation_id)
        : null;
    if (installationId !== null && (!Number.isFinite(installationId) || installationId <= 0)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_INSTALLATION_ID',
            message: 'installation_id must be a positive integer from the GitHub App install URL',
          },
        },
        400,
      );
    }
    const pathGlobs = Array.isArray(body.path_globs)
      ? body.path_globs.filter((g) => typeof g === 'string')
      : [];

    const { data: existingRepo } = await db
      .from('project_repos')
      .select('id')
      .eq('project_id', projectId)
      .eq('repo_url', repoUrl)
      .maybeSingle();

    const repoRow = {
      project_id: projectId,
      repo_url: repoUrl,
      role: 'monorepo',
      default_branch: defaultBranch,
      path_globs: pathGlobs,
      github_app_installation_id: installationId,
      is_primary: true,
      indexing_enabled: true,
      updated_at: new Date().toISOString(),
    };
    const { error: repoErr } = existingRepo
      ? await db.from('project_repos').update(repoRow).eq('id', existingRepo.id)
      : await db.from('project_repos').insert(repoRow);
    if (repoErr) return dbError(c, repoErr);

    const { data: currentSettings } = await db
      .from('project_settings')
      .select('github_webhook_secret')
      .eq('project_id', projectId)
      .maybeSingle();

    const webhookSecret = currentSettings?.github_webhook_secret ?? (await generateWebhookSecret());
    const { error: settingsErr } = await db
      .from('project_settings')
      .update({
        codebase_index_enabled: true,
        codebase_repo_url: repoUrl,
        github_webhook_secret: webhookSecret,
      })
      .eq('project_id', projectId);
    if (settingsErr) return dbError(c, settingsErr);

    void kickCodebaseSweep(projectId);

    await logAudit(db, projectId, userId, 'settings.updated', 'codebase_index', projectId, {
      repo_url: repoUrl,
      default_branch: defaultBranch,
      installation_id: installationId,
      issued_webhook_secret: !currentSettings?.github_webhook_secret,
    }).catch(() => {});

    return c.json({
      ok: true,
      data: {
        repo_url: repoUrl,
        default_branch: defaultBranch,
        webhook_secret: webhookSecret,
        webhook_secret_issued: !currentSettings?.github_webhook_secret,
        indexed_files_eta_seconds: 90,
      },
    });
  });

  app.get('/v1/admin/projects/:id/codebase/stats', jwtAuth, async (c) => {
    const projectId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: membership } = await db
      .from('project_members')
      .select('role')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!membership)
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );

    const [{ data: settings }, { data: primaryRepo }, { count: indexedFiles }] = await Promise.all([
      db
        .from('project_settings')
        .select('codebase_index_enabled, codebase_repo_url, github_webhook_secret')
        .eq('project_id', projectId)
        .maybeSingle(),
      db
        .from('project_repos')
        .select(
          'repo_url, default_branch, last_indexed_at, last_index_error, last_index_attempt_at, github_app_installation_id, indexing_enabled',
        )
        .eq('project_id', projectId)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('project_codebase_files')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('tombstoned_at', null),
    ]);

    return c.json({
      ok: true,
      data: {
        codebase_index_enabled: !!settings?.codebase_index_enabled,
        repo_url: primaryRepo?.repo_url ?? settings?.codebase_repo_url ?? null,
        default_branch: primaryRepo?.default_branch ?? null,
        installation_id: primaryRepo?.github_app_installation_id ?? null,
        indexing_enabled: primaryRepo?.indexing_enabled ?? null,
        indexed_files: indexedFiles ?? 0,
        last_indexed_at: primaryRepo?.last_indexed_at ?? null,
        last_index_attempt_at: primaryRepo?.last_index_attempt_at ?? null,
        last_index_error: primaryRepo?.last_index_error ?? null,
        has_webhook_secret: !!settings?.github_webhook_secret,
      },
    });
  });

  // DLQ admin endpoints
  app.get('/v1/admin/queue', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 50 } });
    }

    const status = c.req.query('status') ?? 'dead_letter';
    const stage = c.req.query('stage');
    const page = Math.max(1, Number(c.req.query('page') ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(c.req.query('pageSize') ?? 25)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db
      .from('processing_queue')
      .select('*, reports(description, user_category, created_at)', { count: 'exact' })
      .in('project_id', projectIds)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (stage) query = query.eq('stage', stage);

    const { data: items, count } = await query;
    return c.json({
      ok: true,
      data: { items: items ?? [], total: count ?? 0, page, pageSize },
    });
  });

  // Counts per stage/status so the queue page can show "where is the
  // backlog" at a glance without paginating through everything.
  app.get('/v1/admin/queue/summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { byStatus: {}, byStage: {}, stages: [] } });
    }
    const { data } = await db
      .from('processing_queue')
      .select('stage, status')
      .in('project_id', projectIds)
      .limit(5000);
    const byStatus: Record<string, number> = {};
    const byStage: Record<string, Record<string, number>> = {};
    for (const r of data ?? []) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byStage[r.stage] ??= {};
      byStage[r.stage][r.status] = (byStage[r.stage][r.status] ?? 0) + 1;
    }
    return c.json({
      ok: true,
      data: { byStatus, byStage, stages: Object.keys(byStage).sort() },
    });
  });

  // 14-day daily throughput across all stages — Pending/Completed/Failed.
  // Drives the sparkline at the top of the queue page.
  app.get('/v1/admin/queue/throughput', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { days: [] } });
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const { data } = await db
      .from('processing_queue')
      .select('status, created_at, completed_at')
      .in('project_id', projectIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(5000);
    const days: { day: string; created: number; completed: number; failed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push({ day: d.toISOString().slice(0, 10), created: 0, completed: 0, failed: 0 });
    }
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const r of data ?? []) {
      const k = String(r.created_at).slice(0, 10);
      const bucket = byDay.get(k);
      if (!bucket) continue;
      bucket.created++;
      if (r.status === 'completed') bucket.completed++;
      if (r.status === 'failed' || r.status === 'dead_letter') bucket.failed++;
    }
    return c.json({ ok: true, data: { days } });
  });

  app.post('/v1/admin/queue/:id/retry', jwtAuth, async (c) => {
    const queueId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

    const { data: item } = await db
      .from('processing_queue')
      .select(
        'id, report_id, project_id, stage, status, attempts, max_attempts, last_error, scheduled_at, started_at, completed_at, created_at',
      )
      .eq('id', queueId)
      .in('project_id', projectIds)
      .single();

    if (!item)
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Queue item not found' } },
        404,
      );

    await db
      .from('processing_queue')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null,
        scheduled_at: new Date().toISOString(),
      })
      .eq('id', queueId);

    triggerClassification(item.report_id, item.project_id);
    return c.json({ ok: true });
  });

  // v2.2: bulk flush for circuit-breaker queued reports.
  // When `checkCircuitBreaker` trips, ingestReport sets `reports.status='queued'`
  // and skips the per-report fast-filter invoke. Once the breaker clears, those
  // reports stay queued until manually rerun. This endpoint replays them in a
  // single click. Bounded at 50/call to avoid runaway invocations.
  app.post('/v1/admin/queue/flush-queued', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { flushed: 0, scanned: 0 } });
    }

    const { data: queued, error } = await db
      .from('reports')
      .select('id, project_id')
      .in('project_id', projectIds)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      return dbError(c, error);
    }

    const items = queued ?? [];
    for (const r of items) {
      await db.from('reports').update({ status: 'new' }).eq('id', r.id);
      triggerClassification(r.id, r.project_id);
    }

    for (const projectId of [...new Set(items.map((i) => i.project_id))]) {
      await logAudit(db, projectId, userId, 'settings.updated', 'queue', undefined, {
        kind: 'flush_queued',
        flushed: items.filter((i) => i.project_id === projectId).length,
      }).catch(() => {});
    }

    return c.json({ ok: true, data: { flushed: items.length, scanned: items.length } });
  });

  // Pipeline recovery: broader scope than flush-queued. Re-fires fast-filter
  // for `status IN ('new','queued')` reports older than 5min that never got
  // past stage1, plus pending queue items past their SLA, plus failed queue
  // items with attempts left. Mirrors what the `mushi-pipeline-recovery-5m`
  // pg_cron does, but scoped to the requesting admin's projects.
  app.post('/v1/admin/queue/recover', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { reports: 0, queue: 0, reconciled: 0 } });
    }

    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: stranded } = await db
      .from('reports')
      .select('id, project_id')
      .in('project_id', projectIds)
      .in('status', ['new', 'queued'])
      .lt('created_at', cutoff)
      .lt('processing_attempts', 3)
      .order('created_at', { ascending: true })
      .limit(50);

    const items = stranded ?? [];
    for (const r of items) {
      if (r.status === 'queued') {
        await db.from('reports').update({ status: 'new' }).eq('id', r.id);
      }
      triggerClassification(r.id, r.project_id);
    }

    const { data: failed } = await db
      .from('processing_queue')
      .select('id, report_id, project_id, attempts, max_attempts')
      .in('project_id', projectIds)
      .eq('status', 'failed')
      .order('created_at', { ascending: true })
      .limit(50);

    const retryable = (failed ?? []).filter((f) => (f.attempts ?? 0) < (f.max_attempts ?? 3));
    for (const q of retryable) {
      await db
        .from('processing_queue')
        .update({
          status: 'pending',
          scheduled_at: new Date().toISOString(),
        })
        .eq('id', q.id);
      triggerClassification(q.report_id, q.project_id);
    }

    const { data: stale } = await db
      .from('processing_queue')
      .select('id, reports!inner(status)')
      .in('project_id', projectIds)
      .eq('status', 'pending')
      .in('reports.status', ['classified', 'dispatched', 'completed'])
      .limit(100);

    const reconcileIds = (stale ?? []).map((s) => s.id);
    if (reconcileIds.length > 0) {
      await db
        .from('processing_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .in('id', reconcileIds);
    }

    for (const projectId of [...new Set(items.map((i) => i.project_id))]) {
      await logAudit(db, projectId, userId, 'settings.updated', 'queue', undefined, {
        kind: 'recover_stranded',
        reports: items.filter((i) => i.project_id === projectId).length,
        queue: retryable.length,
      }).catch(() => {});
    }

    return c.json({
      ok: true,
      data: {
        reports: items.length,
        queue: retryable.length,
        reconciled: reconcileIds.length,
      },
    });
  });

  // ============================================================
  // PHASE 2: KNOWLEDGE GRAPH
  // ============================================================

  app.get('/v1/admin/graph/nodes', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    if (projectIds.length === 0) return c.json({ ok: true, data: { nodes: [] } });

    const nodeType = c.req.query('type');
    let query = db
      .from('graph_nodes')
      .select('id, project_id, node_type, label, metadata, last_traversed_at, created_at')
      .in('project_id', projectIds)
      .limit(200);
    if (nodeType) query = query.eq('node_type', nodeType);

    const { data: nodes } = await query.order('created_at', { ascending: false });
    if (!nodes || nodes.length === 0) return c.json({ ok: true, data: { nodes: [] } });

    // Compute occurrence_count for component / page nodes by joining against
    // reports. Done in JS to avoid an N+1 — single SELECT, in-memory bucketing.
    // The graph page uses this to size and rank nodes.
    const componentLabels = nodes.filter((n) => n.node_type === 'component').map((n) => n.label);
    const pageLabels = nodes.filter((n) => n.node_type === 'page').map((n) => n.label);

    const counts = new Map<string, number>();
    if (componentLabels.length > 0 || pageLabels.length > 0) {
      const { data: reportRows } = await db
        .from('reports')
        .select('component, url, project_id')
        .in('project_id', projectIds);
      for (const r of reportRows ?? []) {
        if (r.component)
          counts.set(`component:${r.component}`, (counts.get(`component:${r.component}`) ?? 0) + 1);
        if (r.url) {
          try {
            const path = new URL(r.url).pathname;
            counts.set(`page:${path}`, (counts.get(`page:${path}`) ?? 0) + 1);
          } catch {
            // url may be relative; just use it as-is
            counts.set(`page:${r.url}`, (counts.get(`page:${r.url}`) ?? 0) + 1);
          }
        }
      }
    }

    const enriched = nodes.map((n) => {
      const occ = counts.get(`${n.node_type}:${n.label}`) ?? 0;
      const meta =
        n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata)
          ? { ...(n.metadata as Record<string, unknown>), occurrence_count: occ }
          : { occurrence_count: occ };
      return { ...n, metadata: meta };
    });

    return c.json({ ok: true, data: { nodes: enriched } });
  });

  app.get('/v1/admin/graph/edges', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

    const edgeType = c.req.query('type');
    let query = db
      .from('graph_edges')
      .select('id, project_id, source_node_id, target_node_id, edge_type, weight, created_at')
      .in('project_id', projectIds)
      .limit(500);
    if (edgeType) query = query.eq('edge_type', edgeType);

    const { data } = await query;
    return c.json({ ok: true, data: { edges: data ?? [] } });
  });

  /**
   * Wave G2 — graph traversal for the MCP `get_knowledge_graph` tool and any
   * caller that wants more than blast-radius. Returns nodes + edges within a
   * BFS depth budget, starting from a node id OR a label match. Capped at
   * depth=4 and 500 nodes so an LLM can't blow up the response budget.
   */
  app.get('/v1/admin/graph/traverse', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const seed = (c.req.query('seed') ?? '').trim();
    const depth = Math.max(1, Math.min(Number(c.req.query('depth') ?? 2), 4));
    if (!seed)
      return c.json(
        { ok: false, error: { code: 'MISSING_SEED', message: 'seed is required' } },
        400,
      );

    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    if (!projectIds.length) return c.json({ ok: true, data: { nodes: [], edges: [] } });

    const { data: seedNode } = await db
      .from('graph_nodes')
      .select('id, node_type, label, project_id')
      .in('project_id', projectIds)
      .or(`id.eq.${seed.replace(/[^a-f0-9-]/gi, '')},label.ilike.${seed.replace(/[%,]/g, '')}`)
      .limit(1)
      .maybeSingle();
    if (!seedNode) return c.json({ ok: false, error: { code: 'SEED_NOT_FOUND' } }, 404);

    const visitedNodes = new Map<string, { id: string; node_type: string; label: string }>();
    visitedNodes.set(seedNode.id, {
      id: seedNode.id,
      node_type: seedNode.node_type,
      label: seedNode.label,
    });
    const edges: Array<{ from_node_id: string; to_node_id: string; edge_type: string }> = [];
    let frontier = [seedNode.id];

    for (let d = 0; d < depth && frontier.length && visitedNodes.size < 500; d++) {
      const { data: nextEdges } = await db
        .from('graph_edges')
        .select('from_node_id, to_node_id, edge_type')
        .in('project_id', projectIds)
        .or(`from_node_id.in.(${frontier.join(',')}),to_node_id.in.(${frontier.join(',')})`)
        .limit(500);

      const nextIds = new Set<string>();
      for (const e of nextEdges ?? []) {
        edges.push(e);
        if (!visitedNodes.has(e.from_node_id)) nextIds.add(e.from_node_id);
        if (!visitedNodes.has(e.to_node_id)) nextIds.add(e.to_node_id);
      }
      if (nextIds.size === 0) break;

      const { data: newNodes } = await db
        .from('graph_nodes')
        .select('id, node_type, label')
        .in('id', Array.from(nextIds).slice(0, 500 - visitedNodes.size));
      for (const n of newNodes ?? []) visitedNodes.set(n.id, n);
      frontier = newNodes?.map((n) => n.id) ?? [];
    }

    return c.json({ ok: true, data: { nodes: Array.from(visitedNodes.values()), edges } });
  });

  app.get('/v1/admin/graph/blast-radius/:nodeId', adminOrApiKey(), async (c) => {
    const nodeId = c.req.param('nodeId');
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    const { data: node } = await db
      .from('graph_nodes')
      .select('id')
      .eq('id', nodeId)
      .in('project_id', projectIds)
      .single();
    if (!node)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404);
    const affected = await getBlastRadius(db, nodeId);
    return c.json({ ok: true, data: { affected } });
  });

  // ============================================================
  // PHASE 2: BUG ONTOLOGY
  // ============================================================

  app.get('/v1/admin/ontology', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
      .single();
    if (!project) return c.json({ ok: true, data: { tags: [] } });

    const tags = await getAvailableTags(db, project.id);
    return c.json({ ok: true, data: { tags } });
  });

  app.post('/v1/admin/ontology', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
      .single();
    if (!project)
      return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404);

    const { error } = await db.from('bug_ontology').insert({
      project_id: project.id,
      tag: body.tag,
      parent_tag: body.parentTag ?? null,
      description: body.description ?? null,
    });

    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    return c.json({ ok: true });
  });

  // ============================================================
  // PHASE 2: NATURAL LANGUAGE QUERY
  // ============================================================

  app.post('/v1/admin/query', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const { question } = await c.req.json();
    if (!question)
      return c.json(
        { ok: false, error: { code: 'MISSING_QUESTION', message: 'question is required' } },
        400,
      );

    const db = getServiceClient();

    // SEC (Wave S1 / S-3): per-user hourly rate limit. The NL endpoint fans
    // out to an LLM, a SECURITY DEFINER SQL RPC, and a summariser LLM —
    // easily the most expensive path in the API. An atomic UPSERT inside
    // nl_query_rate_limit_claim either increments the counter or raises
    // `rate_limit_exceeded` (P0001). We surface a 429 so SDKs back off.
    const { error: rateErr } = await db.rpc('nl_query_rate_limit_claim', {
      p_user_id: userId,
      p_max_per_hour: 60,
    });
    if (rateErr) {
      const msg = rateErr.message ?? '';
      if (msg.includes('rate_limit_exceeded')) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message:
                'NL-query rate limit reached (60 queries/hour). Try again next hour or contact support for a higher cap.',
            },
          },
          429,
        );
      }
      // Unknown RPC failure — fall through rather than block the user; log.
      console.warn('[nl-query] rate limit RPC failed:', msg);
    }

    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
    if (!projectIds.length)
      return c.json({ ok: true, data: { results: [], summary: 'No projects found.' } });

    const startedAt = Date.now();
    try {
      const result = await executeNaturalLanguageQuery(db, projectIds, question);
      const latencyMs = Date.now() - startedAt;
      // Persist on success — best-effort; if the insert fails we still return
      // the answer so the user isn't blocked on telemetry.
      db.from('nl_query_history')
        .insert({
          project_id: projectIds[0] ?? null,
          user_id: userId,
          prompt: question,
          sql: result.sql,
          summary: result.summary,
          explanation: result.explanation,
          row_count: Array.isArray(result.results) ? result.results.length : 0,
          latency_ms: latencyMs,
        })
        .then(({ error }) => {
          if (error) console.warn('[nl_query_history] insert failed:', error.message);
        });

      return c.json({ ok: true, data: { ...result, latencyMs } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const latencyMs = Date.now() - startedAt;
      db.from('nl_query_history')
        .insert({
          project_id: projectIds[0] ?? null,
          user_id: userId,
          prompt: question,
          error: message,
          latency_ms: latencyMs,
        })
        .then(({ error }) => {
          if (error) console.warn('[nl_query_history] insert failed:', error.message);
        });
      return c.json({ ok: false, error: { code: 'QUERY_ERROR', message } }, 400);
    }
  });
}
