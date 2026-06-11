import type { Hono, Context } from 'npm:hono@4';
import type { Variables } from '../types.ts'
import { streamSSE } from 'npm:hono@4/streaming';

import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts';
import { AguiEmitter } from '../../_shared/agui.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reportError, reportMessage } from '../../_shared/sentry.ts';
import { resolveSdkFreshnessStatus } from '../../_shared/sdk-version-compare.ts';
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
import { executeNaturalLanguageQuery, sanitizeSql } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds, resolveOwnedProject, userCanAccessProject } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerBillingProjectsQueueGraphRoutes(app: Hono<{ Variables: Variables }>): void {
  // =================================================================================
  // GET /v1/admin/billing/stats
  // Workspace health summary for billing banner + KPI strip (active project focus).
  // =================================================================================
  app.get('/v1/admin/billing/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIdHint =
      c.req.header('x-mushi-project-id') ?? c.req.header('X-Mushi-Project-Id') ?? null;

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      organizationId: null as string | null,
      billingMode: null as 'stripe' | 'complimentary' | null,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      subscriptionStatus: null as string | null,
      isComplimentary: false,
      hasStripeCustomer: false,
      paymentOk: false,
      cancelAtPeriodEnd: false,
      reportsUsed: 0,
      reportsLimit: null as number | null,
      usagePct: null as number | null,
      overQuota: false,
      approachingQuota: false,
      fixesAttempted: 0,
      fixesSucceeded: 0,
      llmCostUsdMonth: 0,
      periodEnd: null as string | null,
      projectCount: 0,
      freeLimitReports: 1000,
      pastDueProjects: 0,
      unpaidProjects: 0,
    };

    const projectIdsForUser = await ownedProjectIds(db, userId);
    if (projectIdsForUser.length === 0) {
      const plans = await listPlans();
      const hobby = plans.find((pl) => pl.id === 'hobby');
      return c.json({
        ok: true,
        data: {
          ...empty,
          freeLimitReports:
            hobby?.included_reports_per_month ??
            Number(Deno.env.get('MUSHI_FREE_REPORTS_PER_MONTH') ?? '1000'),
        },
      });
    }

    const { data: projects } = await db
      .from('projects')
      .select('id, name, organization_id')
      .in('id', projectIdsForUser)
      .order('created_at', { ascending: true });

    const projectRows = projects ?? [];
    const activeProject =
      projectIdHint && projectRows.some((p) => p.id === projectIdHint)
        ? projectRows.find((p) => p.id === projectIdHint)!
        : projectRows[0] ?? null;

    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    const projectIds = projectRows.map((p) => p.id);
    const orgIds = Array.from(
      new Set(projectRows.map((p) => p.organization_id).filter((x): x is string => Boolean(x))),
    );

    const [
      { data: subs },
      { data: customers },
      { data: usage },
      { data: llmCosts },
      { data: orgs },
      plans,
    ] = await Promise.all([
      db
        .from('billing_subscriptions')
        .select('project_id, status, plan_id, current_period_end, cancel_at_period_end')
        .in('project_id', projectIds),
      db
        .from('billing_customers')
        .select('project_id, stripe_customer_id, default_payment_ok')
        .in('project_id', projectIds),
      db
        .from('usage_events')
        .select('project_id, event_name, quantity')
        .in('project_id', projectIds)
        .gte('occurred_at', periodStart.toISOString()),
      activeProject
        ? db
          .from('llm_invocations')
          .select('cost_usd')
          .eq('project_id', activeProject.id)
          .gte('created_at', periodStart.toISOString())
          .not('cost_usd', 'is', null)
        : Promise.resolve({ data: [] as { cost_usd: number }[] }),
      orgIds.length > 0
        ? db.from('organizations').select('id, plan_id, billing_mode').in('id', orgIds)
        : Promise.resolve({ data: [] as { id: string; plan_id: string; billing_mode: string }[] }),
      listPlans(),
    ]);

    const orgById = new Map<string, { plan_id: string; billing_mode: string }>();
    for (const o of orgs ?? []) orgById.set(o.id, { plan_id: o.plan_id, billing_mode: o.billing_mode });

    let pastDueProjects = 0;
    let unpaidProjects = 0;
    const subByProject = new Map<string, { status: string; plan_id: string | null; current_period_end: string | null; cancel_at_period_end: boolean }>();
    for (const s of subs ?? []) {
      subByProject.set(s.project_id, s);
      if (s.status === 'past_due') pastDueProjects += 1;
      if (s.status === 'unpaid') unpaidProjects += 1;
    }
    const customerByProject = new Map<string, { stripe_customer_id?: string; default_payment_ok?: boolean }>();
    for (const cu of customers ?? []) customerByProject.set(cu.project_id, cu);

    const usageByProject = new Map<string, { reports: number; fixes: number; fixesSucceeded: number }>();
    for (const u of usage ?? []) {
      const cur = usageByProject.get(u.project_id) ?? { reports: 0, fixes: 0, fixesSucceeded: 0 };
      if (u.event_name === 'reports_ingested') cur.reports += Number(u.quantity);
      else if (u.event_name === 'fixes_attempted') cur.fixes += Number(u.quantity);
      else if (u.event_name === 'fixes_succeeded') cur.fixesSucceeded += Number(u.quantity);
      usageByProject.set(u.project_id, cur);
    }

    let llmCostUsdMonth = 0;
    const llmCostRows =
      llmCosts && typeof llmCosts === 'object' && 'data' in llmCosts
        ? ((llmCosts as { data: { cost_usd: number }[] | null }).data ?? [])
        : [];
    for (const row of llmCostRows) {
      llmCostUsdMonth += Number(row.cost_usd ?? 0);
    }
    llmCostUsdMonth = Math.round(llmCostUsdMonth * 10000) / 10000;

    const hobby = plans.find((pl) => pl.id === 'hobby');
    const freeLimitReports =
      hobby?.included_reports_per_month ??
      Number(Deno.env.get('MUSHI_FREE_REPORTS_PER_MONTH') ?? '1000');

    if (!activeProject) {
      return c.json({
        ok: true,
        data: { ...empty, projectCount: projectRows.length, freeLimitReports, pastDueProjects, unpaidProjects },
      });
    }

    const sub = subByProject.get(activeProject.id) ?? null;
    const cust = customerByProject.get(activeProject.id) ?? null;
    const u = usageByProject.get(activeProject.id) ?? { reports: 0, fixes: 0, fixesSucceeded: 0 };
    const orgInfo = activeProject.organization_id ? orgById.get(activeProject.organization_id) ?? null : null;
    const isComplimentary = orgInfo?.billing_mode === 'complimentary';
    const subPlanActive = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
    const planId = subPlanActive
      ? (sub!.plan_id ?? 'hobby')
      : isComplimentary
        ? orgInfo!.plan_id
        : 'hobby';
    const plan = await getPlan(planId);
    const limit = plan.included_reports_per_month;
    const usagePct = limit ? Math.round((u.reports / limit) * 100) : null;
    const overQuota =
      !isComplimentary &&
      limit !== null &&
      u.reports >= limit &&
      !plan.overage_price_lookup_key;
    const approachingQuota = usagePct != null && usagePct >= 80 && !overQuota;

    const subscriptionStatus = subPlanActive
      ? sub!.status
      : isComplimentary && plan.id !== 'hobby'
        ? 'active'
        : plan.id === 'hobby'
          ? 'free'
          : sub?.status ?? null;

    const periodEndIso = subPlanActive && sub?.current_period_end
      ? sub.current_period_end
      : periodEnd.toISOString();

    return c.json({
      ok: true,
      data: {
        projectId: activeProject.id,
        projectName: activeProject.name,
        organizationId: activeProject.organization_id ?? null,
        billingMode: (orgInfo?.billing_mode as 'stripe' | 'complimentary' | undefined) ?? 'stripe',
        planId: plan.id,
        planDisplayName: plan.display_name,
        subscriptionStatus,
        isComplimentary,
        hasStripeCustomer: Boolean(cust?.stripe_customer_id),
        paymentOk: Boolean(cust?.default_payment_ok),
        cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
        reportsUsed: u.reports,
        reportsLimit: limit,
        usagePct,
        overQuota,
        approachingQuota,
        fixesAttempted: u.fixes,
        fixesSucceeded: u.fixesSucceeded,
        llmCostUsdMonth,
        periodEnd: periodEndIso,
        projectCount: projectRows.length,
        freeLimitReports,
        pastDueProjects,
        unpaidProjects,
      },
    });
  });

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

    // 30-day rolling window for the per-project sparkline. Anchored at midnight
    // UTC of "today minus 29 days" so each rendered bucket is a complete UTC
    // calendar day and the array is always exactly 30 entries long. We pick 30
    // (rather than the calendar month) because the FE sparkline needs a stable
    // domain — month-bounded series collapse to two points on day 2 of a new
    // billing period, which makes the chart useless precisely when the user
    // most wants to verify "what did I do over the last few weeks?".
    const thirtyAgo = new Date();
    thirtyAgo.setUTCHours(0, 0, 0, 0);
    thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 29);

    const projectIds = projects.map((p) => p.id);
    const orgIds = Array.from(
      new Set(projects.map((p) => p.organization_id).filter((x): x is string => Boolean(x))),
    );
    const [
      { data: subs },
      { data: customers },
      { data: usage },
      { data: usageSeries },
      { data: llmCosts },
      { data: orgs },
    ] = await Promise.all([
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
      // 30-day daily rollup of `reports_ingested` per project — drives the
      // sparkline on each /billing card. Pre-aggregated server-side via the
      // `billing_reports_ingested_daily_rollup` RPC (migration
      // 20260508000100) so chatty projects don't ship tens of thousands of
      // raw rows just to produce 30 daily totals. Returns at most
      // `projectIds.length × 30` rows regardless of underlying volume.
      db.rpc('billing_reports_ingested_daily_rollup', {
        p_project_ids: projectIds,
        p_since: thirtyAgo.toISOString(),
      }) as unknown as Promise<{
        data:
          | { project_id: string; day_utc: string; total: number | string }[]
          | null
        error: { message: string } | null
      }>,
      // §2: real LLM cost (COGS) for the current billing month so the
      // Billing page can show "$ spent on LLM this month" alongside report
      // quota. Reads the persisted cost_usd column written by telemetry.ts.
      db
        .from('llm_invocations')
        .select('project_id, cost_usd')
        .in('project_id', projectIds)
        .gte('created_at', periodStart.toISOString())
        .not('cost_usd', 'is', null),
      // Pull org-level billing posture so projects whose org is on a
      // complimentary plan (Mushi staff, sponsored, beta) render the right
      // tier without a Stripe subscription row. The fallback hierarchy is:
      // billing_subscriptions → org.plan_id (when complimentary) → 'hobby'.
      orgIds.length > 0
        ? db
            .from('organizations')
            .select('id, plan_id, billing_mode')
            .in('id', orgIds)
        : Promise.resolve({ data: [] as { id: string; plan_id: string; billing_mode: string }[] }),
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

    // org_id → { plan_id, billing_mode } so the per-project loop can decide
    // whether to honour the org-level complimentary tier.
    const orgById = new Map<string, { plan_id: string; billing_mode: string }>();
    for (const o of orgs ?? []) orgById.set(o.id, { plan_id: o.plan_id, billing_mode: o.billing_mode });

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

    // Materialise the 30-day reports series per project. We pre-seed every
    // project with a zero-filled 30-entry array (oldest → newest) so the FE
    // can always render a stable sparkline domain — missing days become
    // explicit zero columns rather than gaps that distort the trend line.
    //
    // The wire shape from `billing_reports_ingested_daily_rollup` is
    // already pre-aggregated server-side: one row per (project_id, day_utc)
    // with SUM(quantity) as `total`. So this loop is a flat O(n_rolled_rows)
    // join, capped at projectIds.length × 30, regardless of how chatty the
    // underlying projects are. Pre-RPC this loop iterated every raw event.
    const dayKeys: string[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyAgo);
      d.setUTCDate(thirtyAgo.getUTCDate() + i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const seriesByProject = new Map<string, Map<string, number>>();
    for (const pid of projectIds) {
      const m = new Map<string, number>();
      for (const k of dayKeys) m.set(k, 0);
      seriesByProject.set(pid, m);
    }
    for (const row of usageSeries ?? []) {
      const bucket = seriesByProject.get(row.project_id);
      if (!bucket) continue;
      // `day_utc` is a Postgres `date` cast. supabase-js serialises it as
      // 'YYYY-MM-DD' which already matches our pre-seeded `dayKeys`. We
      // still .slice(0, 10) defensively so a future driver upgrade that
      // returns 'YYYY-MM-DDT00:00:00+00:00' doesn't silently miss every
      // bucket.
      const dayKey = String(row.day_utc).slice(0, 10);
      // Defensive: a stray row from an earlier rollover (timezone edge,
      // long-tail event near the boundary) gets dropped instead of
      // crashing the loop. Bucket only the 30 known keys.
      const cur = bucket.get(dayKey);
      if (cur === undefined) continue;
      bucket.set(dayKey, cur + Number(row.total));
    }

    // Synthetic period end for complimentary orgs — line up with the calendar
    // month the rest of the billing UI uses so "Period ends in 3 weeks"
    // reads sanely without ever referencing a Stripe period.
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    const periodEndIso = periodEnd.toISOString();

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
        const orgInfo = p.organization_id ? orgById.get(p.organization_id) ?? null : null;
        const isComplimentary = orgInfo?.billing_mode === 'complimentary';

        // Resolution order:
        //   1. real Stripe subscription (active/trialing/past_due)
        //   2. complimentary org → org.plan_id wins (no Stripe needed)
        //   3. fallback hobby
        const subPlanActive = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
        const planId = subPlanActive
          ? sub.plan_id
          : isComplimentary
            ? orgInfo!.plan_id
            : 'hobby';
        const plan = await getPlan(planId);
        const limit = plan.included_reports_per_month;

        // For complimentary orgs without a real Stripe subscription, synthesize
        // a subscription view so the FE shows "Pro · active" (or whichever
        // tier the org is comp'd at) with a coherent period window. The
        // synthetic sub deliberately lacks Stripe ids so callers can detect
        // it and skip Stripe API calls.
        const effectiveSub = subPlanActive
          ? sub
          : isComplimentary && plan.id !== 'hobby'
            ? {
                project_id: p.id,
                organization_id: p.organization_id ?? null,
                status: 'active',
                plan_id: plan.id,
                stripe_price_id: null,
                stripe_subscription_id: null,
                current_period_start: periodStart.toISOString(),
                current_period_end: periodEndIso,
                cancel_at_period_end: false,
                overage_subscription_item_id: null,
                synthetic: true,
              }
            : sub;

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
          subscription: effectiveSub,
          customer: cust,
          // Surfaces the org-level posture so the FE can render the
          // "Complimentary account" badge and hide checkout/manage CTAs.
          billing_mode: orgInfo?.billing_mode ?? 'stripe',
          period_start: periodStart.toISOString(),
          usage: u,
          // Last 30 daily buckets of `reports_ingested` for this project,
          // oldest → newest. Drives the sparkline + "X reports / Y active days"
          // caption in the FE so the user can sanity-check a surprising
          // headline number ("why am I at 60k?") against the actual time
          // distribution. Always exactly 30 entries; days with no events
          // appear as `reports: 0` rather than gaps.
          usage_series: {
            days: dayKeys.map((day) => ({
              day,
              reports: seriesByProject.get(p.id)?.get(day) ?? 0,
            })),
          },
          // §2: actual LLM dollars spent this billing month, summed from
          // the persisted `llm_invocations.cost_usd` column. Rounded to four
          // decimals so a $0.0001 Haiku call is still visible.
          llm_cost_usd_this_month: Math.round((llmCostByProject.get(p.id) ?? 0) * 10000) / 10000,
          limit_reports: limit,
          // Complimentary orgs never get rejected — they're paid for by Mushi
          // even when they exceed quota. We still surface usage_pct so the FE
          // can render the warn/danger UI; the gateway just stops issuing 402s.
          over_quota:
            !isComplimentary &&
            limit !== null &&
            u.reports >= limit &&
            !plan.overage_price_lookup_key,
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
  // GET /v1/admin/onboarding/stats
  // Focused setup posture for the active (or first accessible) project.
  // =================================================================================
  app.get('/v1/admin/onboarding/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      requiredComplete: 0,
      requiredTotal: 4,
      stepsComplete: 0,
      stepsTotal: 8,
      optionalComplete: 0,
      optionalTotal: 4,
      setupDone: false,
      nextStepId: 'project_created' as string | null,
      nextStepLabel: 'Create your first project' as string | null,
      sdkInstalled: false,
      sdkHostMismatch: false,
      adminEndpointHost: adminHost,
      sdkEndpointHost: null as string | null,
      hasApiKey: false,
      reportCount: 0,
      fixCount: 0,
      mergedFixCount: 0,
    };

    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { ...empty, hasAnyProject: true } }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;
    const pid = project.id;

    const [keysRes, settingsRes, reportsRes, fixesRes, reposRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select(
          'project_id, is_active, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
        )
        .eq('project_id', pid)
        .eq('is_active', true),
      db
        .from('project_settings')
        .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref')
        .eq('project_id', pid)
        .maybeSingle(),
      db
        .from('reports')
        .select('id, environment, created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(100),
      db.from('fix_attempts').select('id, merged_at').eq('project_id', pid).limit(200),
      db.from('project_repos').select('project_id').eq('project_id', pid).limit(1),
    ]);

    const hasKey = (keysRes.data ?? []).length > 0;
    let heartbeat: {
      last_seen_at: string;
      last_seen_endpoint_host: string | null;
    } | null = null;
    for (const k of keysRes.data ?? []) {
      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null;
      if (!seenAt) continue;
      if (heartbeat && heartbeat.last_seen_at >= seenAt) continue;
      heartbeat = {
        last_seen_at: seenAt,
        last_seen_endpoint_host:
          (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null,
      };
    }

    let sdkReportSignal = false;
    const reports = reportsRes.data ?? [];
    for (const r of reports) {
      const env = (r.environment ?? {}) as Record<string, unknown>;
      const platform = typeof env.platform === 'string' ? env.platform : '';
      if (platform && platform !== 'mushi-admin') sdkReportSignal = true;
    }

    const hasSdk = Boolean(heartbeat) || sdkReportSignal;
    const sdkEndpointHost = heartbeat?.last_seen_endpoint_host ?? null;
    const sdkHostMismatch = Boolean(
      adminHost && sdkEndpointHost && sdkEndpointHost !== adminHost && hasSdk,
    );

    const settings = settingsRes.data;
    const hasGithub = Boolean(settings?.github_repo_url) || (reposRes.data ?? []).length > 0;
    const hasSentry = Boolean(settings?.sentry_org_slug);
    const hasByok = Boolean(settings?.byok_anthropic_key_ref);
    const reportCount = reports.length;
    const fixes = fixesRes.data ?? [];
    const fixCount = fixes.length;
    const mergedFixCount = fixes.filter((f) => f.merged_at).length;

    type StepDef = { id: string; label: string; complete: boolean; required: boolean };
    const steps: StepDef[] = [
      { id: 'project_created', label: 'Create your first project', complete: true, required: true },
      { id: 'api_key_generated', label: 'Generate an API key', complete: hasKey, required: true },
      { id: 'sdk_installed', label: 'Install the SDK in your app', complete: hasSdk, required: true },
      {
        id: 'first_report_received',
        label: 'Receive your first bug report',
        complete: reportCount > 0,
        required: true,
      },
      { id: 'github_connected', label: 'Connect GitHub', complete: hasGithub, required: false },
      { id: 'sentry_connected', label: 'Connect Sentry (optional)', complete: hasSentry, required: false },
      { id: 'byok_anthropic', label: 'Add your Anthropic key (optional)', complete: hasByok, required: false },
      {
        id: 'first_fix_dispatched',
        label: 'Dispatch your first auto-fix',
        complete: fixCount > 0,
        required: false,
      },
    ];

    const requiredSteps = steps.filter((s) => s.required);
    const optionalSteps = steps.filter((s) => !s.required);
    const requiredComplete = requiredSteps.filter((s) => s.complete).length;
    const setupDone = requiredComplete === requiredSteps.length;
    const nextRequired = requiredSteps.find((s) => !s.complete) ?? null;

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: project.name,
        requiredComplete,
        requiredTotal: requiredSteps.length,
        stepsComplete: steps.filter((s) => s.complete).length,
        stepsTotal: steps.length,
        optionalComplete: optionalSteps.filter((s) => s.complete).length,
        optionalTotal: optionalSteps.length,
        setupDone,
        nextStepId: nextRequired?.id ?? null,
        nextStepLabel: nextRequired?.label ?? null,
        sdkInstalled: hasSdk,
        sdkHostMismatch,
        adminEndpointHost: adminHost,
        sdkEndpointHost,
        hasApiKey: hasKey,
        reportCount,
        fixCount,
        mergedFixCount,
      },
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

    // Setup wizard lists every accessible project so org members can see
    // and resume an existing onboarding (Teams v1).
    const accessibleIds = await ownedProjectIds(db, userId);
    const { data: projects } = accessibleIds.length
      ? await db
          .from('projects')
          .select('id, name, slug, created_at')
          .in('id', accessibleIds)
          .order('created_at', { ascending: true })
      : { data: [] as Array<{ id: string; name: string; slug: string; created_at: string }> };

    if (!projects || projects.length === 0) {
      return c.json({
        ok: true,
        data: {
          admin_endpoint_host: (() => {
            try {
              return new URL(c.req.url).host || null;
            } catch {
              return null;
            }
          })(),
          has_any_project: false,
          projects: [],
        },
      });
    }

    const projectIds = projects.map((p) => p.id);

    // Pull every signal in parallel; we project narrow column lists to keep this
    // cheap even when the user owns dozens of projects. We also pull each key's
    // SDK heartbeat (`last_seen_*`) so the dashboard can prove the SDK has
    // reached THIS backend without waiting for a real user-triggered report —
    // see migration 20260505000000_project_api_keys_last_seen.sql for rationale.
    const [keysRes, settingsRes, reportsRes, fixesRes, reposRes, codebaseFilesRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select(
          'project_id, is_active, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
        )
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
      // Pull only project_id so we can count indexed files per project without
      // transferring payload. Used by ExplorePage to determine the "not indexed
      // yet" empty state.
      db.from('project_codebase_files').select('project_id').in('project_id', projectIds),
    ]);

    const keyByProject = new Set<string>();
    interface SdkHeartbeat {
      last_seen_at: string;
      last_seen_origin: string | null;
      last_seen_user_agent: string | null;
      last_seen_endpoint_host: string | null;
    }
    const heartbeatByProject = new Map<string, SdkHeartbeat>();
    for (const k of keysRes.data ?? []) {
      keyByProject.add(k.project_id);
      const seenAt = (k as { last_seen_at?: string | null }).last_seen_at ?? null;
      if (!seenAt) continue;
      const existing = heartbeatByProject.get(k.project_id);
      // Multiple keys per project are common (rotation, scoped keys); keep the
      // freshest heartbeat so the UI shows the most recent SDK activity.
      if (existing && existing.last_seen_at >= seenAt) continue;
      heartbeatByProject.set(k.project_id, {
        last_seen_at: seenAt,
        last_seen_origin: (k as { last_seen_origin?: string | null }).last_seen_origin ?? null,
        last_seen_user_agent: (k as { last_seen_user_agent?: string | null }).last_seen_user_agent ?? null,
        last_seen_endpoint_host:
          (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null,
      });
    }

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

    const indexedFileCountByProject = new Map<string, number>();
    for (const f of codebaseFilesRes.data ?? []) {
      indexedFileCountByProject.set(f.project_id, (indexedFileCountByProject.get(f.project_id) ?? 0) + 1);
    }

    // Legacy fallback signal: at least one report whose `environment.platform`
    // is a real platform (not the admin-only `mushi-admin` synthetic the
    // "send test report" button emits). This used to be the SOLE check, but
    // it falsely flagged correctly-installed SDKs as missing whenever no real
    // user had triggered a bug yet, AND it gave operators no diagnostic when
    // the SDK was talking to a different backend than the admin. The
    // heartbeat above is now the primary signal; we keep this as a fallback
    // so projects whose SDKs predate the heartbeat migration stay green.
    const sdkReportSignalByProject = new Set<string>();
    const reportsByProject = new Map<string, { count: number; firstAt: string | null }>();
    for (const r of reportsRes.data ?? []) {
      const cur = reportsByProject.get(r.project_id) ?? { count: 0, firstAt: null };
      cur.count += 1;
      cur.firstAt = r.created_at;
      reportsByProject.set(r.project_id, cur);
      const env = (r.environment ?? {}) as Record<string, unknown>;
      const platform = typeof env.platform === 'string' ? env.platform : '';
      if (platform && platform !== 'mushi-admin') sdkReportSignalByProject.add(r.project_id);
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
      | 'first_fix_dispatched'
      | 'slack_connected'
      | 'first_qa_story_passing';

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
      /**
       * Optional diagnostic the FE renders inline on the row. Populated for
       * `sdk_installed` so operators can debug "installed but checklist still
       * red" without grepping logs (e.g. when the SDK and admin point at
       * different backends — the host this admin is reading from is shown
       * next to where the SDK was last seen, making the mismatch obvious).
       */
      diagnostic?: {
        last_sdk_seen_at: string | null;
        last_sdk_origin: string | null;
        last_sdk_user_agent: string | null;
        last_sdk_endpoint_host: string | null;
      };
    }

    // The hostname of THIS admin's edge function, captured once per request,
    // so the FE can compare it to last_sdk_endpoint_host on each project and
    // show "your SDK is talking to a different backend" when they diverge.
    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    const enriched = projects.map((p) => {
      const hasKey = keyByProject.has(p.id);
      const settings = settingsByProject.get(p.id);
      const heartbeat = heartbeatByProject.get(p.id) ?? null;
      // Heartbeat (SDK reached this backend) is the canonical signal.
      // Legacy report-based fallback covers projects whose SDKs predate the
      // heartbeat columns or where keys were rotated and only old reports
      // remain — keeps already-green checklists green after the migration.
      const hasSdk = Boolean(heartbeat) || sdkReportSignalByProject.has(p.id);
      const reportInfo = reportsByProject.get(p.id) ?? { count: 0, firstAt: null };
      const hasGithub = Boolean(settings?.github_repo_url) || reposByProject.has(p.id);
      const hasSentry = Boolean(settings?.sentry_org_slug);
      const hasByok = Boolean(settings?.byok_anthropic_key_ref);
      const hasSlack = Boolean(settings?.slack_channel_id) || Boolean(settings?.slack_webhook_url);
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
          diagnostic: {
            last_sdk_seen_at: heartbeat?.last_seen_at ?? null,
            last_sdk_origin: heartbeat?.last_seen_origin ?? null,
            last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
            last_sdk_endpoint_host: heartbeat?.last_seen_endpoint_host ?? null,
          },
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
        {
          id: 'slack_connected',
          label: 'Connect Slack (optional)',
          description: 'Get instant Slack alerts when a QA story fails or a new report is classified.',
          complete: hasSlack,
          required: false,
          cta_to: '/integrations',
          cta_label: 'Add to Slack',
        },
        {
          id: 'first_qa_story_passing',
          label: 'Set up a QA story (optional)',
          description: 'Write a plain-English test that runs on a schedule — catch regressions before your users do.',
          complete: false, // Live signal: query qa_stories with last_run_status='passed' in a future pass
          required: false,
          cta_to: '/qa-coverage',
          cta_label: 'Create QA story',
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
        indexed_file_count: indexedFileCountByProject.get(p.id) ?? 0,
      };
    });

    return c.json({
      ok: true,
      data: {
        // Surfaced so the FE can compare each project's last SDK endpoint host
        // against the host the admin is actually reading from. When they
        // differ the dashboard renders an explicit "your SDK is talking to a
        // different backend" warning instead of leaving the user wondering
        // why a working SDK never ticks the checklist green.
        admin_endpoint_host: adminHost,
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
        // `plan_tier` and `data_residency_region` are surfaced so the FE
        // can render plan / region badges next to each project — both are
        // already stored on the row but were never plumbed through, so
        // ProjectsPage had no way to show "this project is on Pro, EU".
        // Boost shipped 2026-05-07 along with the repo + codebase joins
        // below.
        .select('id, name, slug, created_at, organization_id, plan_tier, data_residency_region')
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
      plan_tier: (p as { plan_tier?: string | null }).plan_tier ?? null,
      data_residency_region:
        (p as { data_residency_region?: string | null }).data_residency_region ?? null,
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

    // 30-day rollup window for the severity breakdown surfaced on the
    // projects list. A month is enough to outweigh a single
    // late-night spike but short enough to reflect "the current state of
    // this project". Reusing this constant rather than re-deriving it
    // inline so the FE help-copy ("last 30 days") and the SQL filter
    // can never drift.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [
      reportCounts,
      allKeys,
      members,
      latestReports,
      planBacklogs,
      doFlights,
      checkPending,
      repos,
      codebaseFileRows,
      severityRows,
    ] = await Promise.all([
        db
          .from('reports')
          .select('project_id', { count: 'exact', head: false })
          .in('project_id', projectIds),
        // Pull `last_seen_*` per-key alongside the existing identity columns so
        // ProjectsPage's SdkHealthSummary can render per-key connectivity
        // status without a second round-trip. The same heartbeat columns power
        // the dashboard onboarding checklist (see the dashboard route's
        // setup_steps[id=sdk_installed].diagnostic). Missing on /projects was a
        // discovery gap surfaced by the 2026-05-07 SDK integration audit:
        // "I generated a key 4 days ago, why am I seeing 0 reports?" — the
        // answer (`last_seen_at IS NULL`, key never connected) was already in
        // the row, just never exposed where users look.
        db
          .from('project_api_keys')
          .select(
            'id, project_id, key_prefix, created_at, is_active, scopes, label, last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host',
          )
          .in('project_id', projectIds)
          .order('created_at', { ascending: false }),
        db.from('project_members').select('project_id, user_id, role').in('project_id', projectIds),
        Promise.all(
          projectIds.map((pid) =>
            db
              .from('reports')
              // Pull the SDK identity columns alongside `created_at` so the FE
              // can compare the project's most-recently-observed SDK version
              // against the latest published version (joined below) and
              // surface "outdated" / "deprecated" badges per row. Without
              // this the ProjectsPage SDK install card had no way to tell
              // a project was running 0.7 against a 0.9 catalog except by
              // making the operator open the report and read the metadata
              // by hand.
              .select('created_at, sdk_package, sdk_version')
              .eq('project_id', pid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
              .then((r) => ({
                project_id: pid,
                created_at: r.data?.created_at ?? null,
                sdk_package: (r.data as { sdk_package?: string | null } | null)?.sdk_package ?? null,
                sdk_version: (r.data as { sdk_version?: string | null } | null)?.sdk_version ?? null,
              })),
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
        // Repo connections for the "About this project" surface on
        // ProjectsPage. We pull every connected repo (a project can
        // legitimately wire up multiple) but the FE picks the primary
        // one for the row chip and shows the full list in the
        // configurator. `last_index_*` columns drive the freshness
        // badge so users notice when their codebase index has gone
        // stale (e.g. the OpenAI rate-limit case observed on glot-it
        // 2026-05-07: indexing failed and there was no surface that
        // told them).
        db
          .from('project_repos')
          .select(
            'id, project_id, repo_url, role, default_branch, is_primary, indexing_enabled, last_indexed_at, last_index_attempt_at, last_index_error, github_app_installation_id, created_at',
          )
          .in('project_id', projectIds)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: true }),
        // Codebase index footprint per project. Counts of indexed files
        // are a real "is this thing wired up" signal — a project with
        // an attached repo but zero indexed files is a project where
        // codebase-aware features (RAG-augmented triage, fix
        // suggestions, ontology mapping) silently degrade. We pull only
        // the project_id column so the row count stays cheap; the
        // aggregation happens in JS below.
        db
          .from('project_codebase_files')
          .select('project_id')
          .in('project_id', projectIds),
        // Severity breakdown over the last 30 days, plus signal data
        // for the new ProjectsPage chips: 7-day report trend (this
        // 7d vs prior 7d) and "Sentry connected" detection (≥1
        // report in 30d carries a Sentry trace id). All bucketed in
        // JS — Postgres-side `group by` would need a fresh RPC and
        // these series are tiny (≤ project_count × 30d × few KB).
        db
          .from('reports')
          .select('project_id, severity, created_at, sentry_trace_id')
          .in('project_id', projectIds)
          .gte('created_at', thirtyDaysAgo),
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
        // Heartbeat columns — the SDK populates these on every authenticated
        // request via apiKeyAuth. `null` on an active key === created but
        // never used; a stale timestamp + a `last_seen_endpoint_host` that
        // doesn't match this admin's host === SDK pointed at a different
        // backend. Both diagnostics are rendered by SdkHealthSummary.
        last_seen_at: (k as { last_seen_at?: string | null }).last_seen_at ?? null,
        last_seen_origin: (k as { last_seen_origin?: string | null }).last_seen_origin ?? null,
        last_seen_user_agent:
          (k as { last_seen_user_agent?: string | null }).last_seen_user_agent ?? null,
        last_seen_endpoint_host:
          (k as { last_seen_endpoint_host?: string | null }).last_seen_endpoint_host ?? null,
      });
    }

    const memberMap: Record<string, Array<{ user_id: string; role: string }>> = {};
    for (const m of members.data ?? []) {
      if (!memberMap[m.project_id]) memberMap[m.project_id] = [];
      memberMap[m.project_id].push({ user_id: m.user_id, role: m.role });
    }

    const lastReportMap: Record<string, string> = {};
    // Per-project most-recently-observed SDK identity, drawn from the same
    // single-row `latestReports` query as `lastReportMap`. We keep these as
    // sibling maps (instead of nesting them on a single tuple) because the
    // FE consumes them independently — `last_report_at` is a freshness
    // signal, while `(sdk_package, sdk_version)` drives the outdated-SDK
    // badge below.
    const lastSdkPackageMap: Record<string, string | null> = {};
    const lastSdkVersionMap: Record<string, string | null> = {};
    for (const r of latestReports) {
      if (r.created_at) lastReportMap[r.project_id] = r.created_at;
      if (r.sdk_package) lastSdkPackageMap[r.project_id] = r.sdk_package;
      if (r.sdk_version) lastSdkVersionMap[r.project_id] = r.sdk_version;
    }

    // Latest published version per @mushi-mushi/* package. Sourced from the
    // `sdk_versions` catalogue (populated by the publish workflow — see
    // `20260429000000_sdk_versions.sql`). One row per package, picking the
    // most recently released version. The FE compares each project's
    // last-seen `sdk_version` against this map to render "Up to date /
    // Outdated / Deprecated" feedback in the project row.
    //
    // Done as a single query (not per-project) because the catalogue is
    // tiny (one row per package) and shared across every row — a project
    // running @mushi-mushi/web@0.7 is "outdated" the same way regardless of
    // which org owns it.
    const { data: sdkCatalogRows } = await db
      .from('sdk_versions')
      .select('package, version, deprecated, deprecation_message, released_at')
      .order('released_at', { ascending: false });

    interface LatestSdk {
      version: string;
      deprecated: boolean;
      deprecation_message: string | null;
      released_at: string;
    }
    const latestSdkVersions: Record<string, LatestSdk> = {};
    for (const row of sdkCatalogRows ?? []) {
      // First row per package wins (we ordered DESC by released_at). A
      // newer release of the same package displaces the older entry only
      // implicitly via this guard, so we never need a separate "is latest"
      // flag in the catalogue.
      if (!latestSdkVersions[row.package]) {
        latestSdkVersions[row.package] = {
          version: row.version,
          deprecated: !!row.deprecated,
          deprecation_message:
            (row as { deprecation_message?: string | null }).deprecation_message ?? null,
          released_at: row.released_at,
        };
      }
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

    // Repo rollups. The first row per project is the "primary" repo
    // (Postgres ordering guarantees `is_primary DESC, created_at ASC`).
    // Everything else is exposed as the `repos[]` list so the FE can
    // surface "+2 more" without a second round-trip when a project has
    // a monorepo + sister repos.
    interface RepoRow {
      id: string;
      project_id: string;
      repo_url: string | null;
      role: string | null;
      default_branch: string | null;
      is_primary: boolean | null;
      indexing_enabled: boolean | null;
      last_indexed_at: string | null;
      last_index_attempt_at: string | null;
      last_index_error: string | null;
      github_app_installation_id: number | null;
      created_at: string;
    }
    const reposByProject: Record<string, RepoRow[]> = {};
    for (const r of (repos.data ?? []) as RepoRow[]) {
      if (!reposByProject[r.project_id]) reposByProject[r.project_id] = [];
      reposByProject[r.project_id].push(r);
    }

    const codebaseFileCount: Record<string, number> = {};
    for (const row of codebaseFileRows.data ?? []) {
      codebaseFileCount[row.project_id] = (codebaseFileCount[row.project_id] ?? 0) + 1;
    }

    // Severity breakdown over `thirtyDaysAgo`. We accept any string for
    // `severity` since the column is plain text — the FE collapses
    // unknown values into an "other" bucket so a misclassified report
    // never breaks the chip row.
    //
    // Same loop folds in two adjacent signals so we don't pay for
    // re-iteration on a list that can carry 5–10K rows on a busy
    // project: (a) Sentry-connected detection — true when ≥1 report
    // in 30d carries a `sentry_trace_id`; (b) 7-day vs prior-7-day
    // count for the trend arrow on the project row.
    interface SeverityRow {
      project_id: string;
      severity: string | null;
      created_at?: string | null;
      sentry_trace_id?: string | null;
    }
    const severityByProject: Record<string, Record<string, number>> = {};
    const sentryConnectedCount: Record<string, number> = {};
    const last7Count: Record<string, number> = {};
    const prev7Count: Record<string, number> = {};
    const sevenDaysAgoMs = Date.now() - 7 * 86_400_000;
    const fourteenDaysAgoMs = Date.now() - 14 * 86_400_000;
    for (const r of (severityRows.data ?? []) as SeverityRow[]) {
      const sev = (r.severity ?? 'unknown').toLowerCase();
      if (!severityByProject[r.project_id]) severityByProject[r.project_id] = {};
      severityByProject[r.project_id][sev] =
        (severityByProject[r.project_id][sev] ?? 0) + 1;
      if (r.sentry_trace_id) {
        sentryConnectedCount[r.project_id] =
          (sentryConnectedCount[r.project_id] ?? 0) + 1;
      }
      if (r.created_at) {
        const tsMs = new Date(r.created_at).getTime();
        if (tsMs >= sevenDaysAgoMs) {
          last7Count[r.project_id] = (last7Count[r.project_id] ?? 0) + 1;
        } else if (tsMs >= fourteenDaysAgoMs) {
          prev7Count[r.project_id] = (prev7Count[r.project_id] ?? 0) + 1;
        }
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
      // SDK freshness — only meaningful when at least one report has
      // landed (otherwise we have no version to compare against). The FE
      // treats `sdk_status: 'unknown'` as "no data yet, don't paint a
      // badge" so projects in their first 60 seconds don't blink red
      // before the first ingest arrives.
      const sdkPackage = lastSdkPackageMap[p.id] ?? null;
      const sdkVersion = lastSdkVersionMap[p.id] ?? null;
      const latestForPackage = sdkPackage ? latestSdkVersions[sdkPackage] ?? null : null;
      const sdkStatus = resolveSdkFreshnessStatus({
        sdkPackage,
        sdkVersion,
        catalogVersion: latestForPackage?.version ?? null,
        catalogDeprecated: !!latestForPackage?.deprecated,
      });
      // Repos for "About this project" surface. Primary first, others
      // trailing. We expose `github_app_connected` as a boolean rather
      // than the installation id so the FE can render a "Connected via
      // GitHub App" badge without leaking the integer (which is mostly
      // identifying for the install but not useful in the row chip).
      const projectRepos = reposByProject[p.id] ?? [];
      const repos = projectRepos.map((r) => ({
        id: r.id,
        repo_url: r.repo_url,
        role: r.role,
        default_branch: r.default_branch,
        is_primary: !!r.is_primary,
        indexing_enabled: !!r.indexing_enabled,
        last_indexed_at: r.last_indexed_at,
        last_index_attempt_at: r.last_index_attempt_at,
        last_index_error: r.last_index_error,
        github_app_connected: r.github_app_installation_id != null,
      }));
      const primaryRepo = repos[0] ?? null;

      const indexedFileCount = codebaseFileCount[p.id] ?? 0;

      // Severity buckets — rolled up to the four canonical buckets
      // we use everywhere else (critical / major / minor / trivial)
      // plus an `other` catch-all so misclassified rows don't get
      // dropped silently.
      const sevRaw = severityByProject[p.id] ?? {};
      const severity_breakdown_30d = {
        critical: sevRaw['critical'] ?? 0,
        major: sevRaw['major'] ?? 0,
        minor: sevRaw['minor'] ?? 0,
        trivial: sevRaw['trivial'] ?? 0,
        other:
          Object.entries(sevRaw)
            .filter(([k]) => !['critical', 'major', 'minor', 'trivial'].includes(k))
            .reduce((acc, [, v]) => acc + v, 0),
        total: Object.values(sevRaw).reduce((acc, v) => acc + v, 0),
      };

      const last7d = last7Count[p.id] ?? 0;
      const prev7d = prev7Count[p.id] ?? 0;
      // Trend: relative delta in count from last 7d vs the prior 7d.
      // We expose direction + magnitude separately so the FE can pick
      // a chip style without re-deriving thresholds. `flat` covers the
      // small-noise case where both counts are tiny (≤1 each) — the
      // signal isn't meaningful below that floor.
      const trendDelta = last7d - prev7d;
      let trendDirection: 'up' | 'down' | 'flat' = 'flat';
      if (last7d <= 1 && prev7d <= 1) {
        trendDirection = 'flat';
      } else if (trendDelta > 0) {
        trendDirection = 'up';
      } else if (trendDelta < 0) {
        trendDirection = 'down';
      }
      const sentryReports = sentryConnectedCount[p.id] ?? 0;
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
        sdk_package: sdkPackage,
        sdk_version: sdkVersion,
        sdk_latest_version: latestForPackage?.version ?? null,
        sdk_deprecation_message: latestForPackage?.deprecation_message ?? null,
        sdk_status: sdkStatus,
        primary_repo: primaryRepo,
        repos,
        indexed_file_count: indexedFileCount,
        severity_breakdown_30d,
        // 2026-05-07 SDK observability boost — surfaced on the projects
        // list so the user can see "Sentry is wired up" + "trend is
        // accelerating" without opening a single project.
        sentry_connected: sentryReports > 0,
        sentry_connected_reports_30d: sentryReports,
        trend_7d: {
          last7d,
          prev7d,
          delta: trendDelta,
          direction: trendDirection,
        },
      };
    });

    // The host that *this* admin response was served from. The frontend
    // compares it to each key's `last_seen_endpoint_host` to detect the
    // common mis-config "SDK is talking to a different backend" — usually
    // a stale `NEXT_PUBLIC_MUSHI_API_ENDPOINT` left over from local dev,
    // or a CI build that baked in a staging endpoint. Mirrors the dashboard
    // route's adminHost capture (~line 513).
    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null;
      } catch {
        return null;
      }
    })();

    // Surface the latest-known SDK version per package alongside the
    // enriched projects so the FE can render outdated-SDK feedback even
    // for project rows that haven't ingested a report yet (the "install
    // snippet" already shows a version — let the badge agree with the
    // catalog instead of the SDK's own bundled metadata).
    return c.json({
      ok: true,
      data: { projects: enriched, admin_host: adminHost, latest_sdk_versions: latestSdkVersions },
    });
  });

  app.get('/v1/admin/projects/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const accessibleIds = await ownedProjectIds(db, userId);
    const activeProjectHint =
      c.req.header('x-mushi-project-id') ?? c.req.header('X-Mushi-Project-Id') ?? null;

    const empty = {
      projectCount: 0,
      activeKeyCount: 0,
      projectsWithReports: 0,
      sdkConnectedCount: 0,
      neverIngestedCount: 0,
      reportsLast24h: 0,
      reportsLast30d: 0,
      activeProjectId: activeProjectHint,
      activeProjectName: null as string | null,
      activeProjectHasReports: false,
      activeProjectSdkConnected: false,
      staleKeyCount: 0,
      topPriority: 'no_projects' as
        | 'no_projects'
        | 'never_ingested'
        | 'no_sdk_heartbeat'
        | 'partial_ingest'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    if (accessibleIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: keyRows, error: keyErr },
      { data: reportProjectRows, error: reportProjErr },
      { count: reports24h, error: r24Err },
      { count: reports30d, error: r30Err },
      { data: activeProjectRow },
    ] = await Promise.all([
      db
        .from('project_api_keys')
        .select('project_id, is_active, last_seen_at')
        .in('project_id', accessibleIds),
      db.from('reports').select('project_id').in('project_id', accessibleIds),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', accessibleIds)
        .gte('created_at', since24h),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', accessibleIds)
        .gte('created_at', since30d),
      activeProjectHint && accessibleIds.includes(activeProjectHint)
        ? db.from('projects').select('name').eq('id', activeProjectHint).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (keyErr) return dbError(c, keyErr);
    if (reportProjErr) return dbError(c, reportProjErr);
    if (r24Err) return dbError(c, r24Err);
    if (r30Err) return dbError(c, r30Err);

    const activeKeyCount = (keyRows ?? []).filter((k) => k.is_active !== false).length;
    const sdkConnectedProjects = new Set<string>();
    let staleKeyCount = 0;
    for (const k of keyRows ?? []) {
      const lastSeen = (k as { last_seen_at?: string | null }).last_seen_at;
      if (lastSeen) {
        sdkConnectedProjects.add(k.project_id as string);
      } else if (k.is_active !== false) {
        staleKeyCount += 1;
      }
    }
    const projectsWithReportsSet = new Set<string>();
    for (const r of reportProjectRows ?? []) {
      projectsWithReportsSet.add(r.project_id as string);
    }

    const projectCount = accessibleIds.length;
    const projectsWithReports = projectsWithReportsSet.size;
    const sdkConnectedCount = sdkConnectedProjects.size;
    const neverIngestedCount = Math.max(0, projectCount - projectsWithReports);

    const activeProjectId =
      activeProjectHint && accessibleIds.includes(activeProjectHint) ? activeProjectHint : null;
    const activeProjectName = (activeProjectRow as { name?: string } | null)?.name ?? null;
    const activeProjectHasReports = activeProjectId
      ? projectsWithReportsSet.has(activeProjectId)
      : false;
    const activeProjectSdkConnected = activeProjectId
      ? sdkConnectedProjects.has(activeProjectId)
      : false;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (projectCount === 0) {
      topPriority = 'no_projects';
      topPriorityLabel = 'Create a project, mint an API key, and send a test report to prove ingest.';
      topPriorityTo = '/projects?tab=create';
    } else if (projectsWithReports === 0) {
      topPriority = 'never_ingested';
      topPriorityLabel = `${projectCount} project${projectCount === 1 ? '' : 's'} exist but none have ingested a report — mint a key and use Test report on a project card.`;
      topPriorityTo = '/projects?tab=list';
    } else if (sdkConnectedCount === 0) {
      topPriority = 'no_sdk_heartbeat';
      topPriorityLabel = 'Reports are landing but no API key shows a SDK heartbeat — expand a project card and compare endpoint host vs this admin.';
      topPriorityTo = '/projects?tab=list';
    } else if (neverIngestedCount > 0) {
      topPriority = 'partial_ingest';
      topPriorityLabel = `${neverIngestedCount} project${neverIngestedCount === 1 ? '' : 's'} never ingested · ${projectsWithReports}/${projectCount} receiving reports · ${sdkConnectedCount} with SDK heartbeat.`;
      topPriorityTo = '/projects?tab=list';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${projectCount} project${projectCount === 1 ? '' : 's'} ingesting · ${activeKeyCount} active key${activeKeyCount === 1 ? '' : 's'} · ${reports24h ?? 0} report${(reports24h ?? 0) === 1 ? '' : 's'} in 24h.`;
      topPriorityTo = '/reports';
    }

    return c.json({
      ok: true,
      data: {
        projectCount,
        activeKeyCount,
        projectsWithReports,
        sdkConnectedCount,
        neverIngestedCount,
        reportsLast24h: reports24h ?? 0,
        reportsLast30d: reports30d ?? 0,
        activeProjectId,
        activeProjectName,
        activeProjectHasReports,
        activeProjectSdkConnected,
        staleKeyCount,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
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

    // Lazy bootstrap: a brand-new signup may have arrived before the
    // `on_auth_user_created_personal_org` trigger could materialise
    // their personal workspace (or the trigger may have failed — the
    // 20260520300000_personal_org_on_signup migration intentionally
    // swallows exceptions so a bad trigger run never blocks signup).
    // Rather than dead-end the user on "NO_ORGANIZATION" with no
    // recovery path in the UI, materialise the personal org on the
    // fly via the same idempotent helper the trigger uses, then
    // continue. Only triggers when (a) the caller didn't pass an
    // explicit org hint AND (b) they have zero writable memberships
    // — never silently widens scope of an explicit choice.
    if (!organizationId && !orgIdHint) {
      // The factory lives in `private.bootstrap_personal_org` (same
      // convention as touch_org_member_activity / has_org_role etc),
      // but PostgREST only exposes schemas listed in `api.schemas`
      // (default: public, graphql_public). To avoid widening the
      // PostgREST allowlist just for this one call, we ship a thin
      // SECURITY DEFINER wrapper at `public.bootstrap_personal_org`
      // (migration 20260520310000_personal_org_public_wrapper) that
      // delegates to the private function. The wrapper is service-role
      // only so an authenticated user can never call it with someone
      // else's user id.
      const { data: personalOrgId, error: bootstrapErr } = await db
        .rpc('bootstrap_personal_org', { p_user_id: userId });
      if (!bootstrapErr && typeof personalOrgId === 'string') {
        organizationId = personalOrgId;
      } else if (bootstrapErr) {
        // Surface the DB error so it shows up in Sentry / postgres logs
        // — the user still sees the friendlier NO_ORGANIZATION below.
        try {
          reportMessage(
            `admin.projects.create.bootstrap_personal_org failed: ${bootstrapErr.message}`,
            'warning',
          );
        } catch {
          // Sentry init can race on cold-start of the edge function.
          // We must never let a telemetry failure prevent the user
          // from seeing the actionable error message below.
        }
      }
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

    // Slug derivation:
    //   1. Lowercase, collapse non-alphanumerics to '-', trim leading /
    //      trailing dashes — the historical shape.
    //   2. If the user typed something like "!!!" or all-emoji that
    //      reduces to an empty string, fall back to a short random tail
    //      so we never write an empty slug. Empty slugs broke the slug
    //      UNIQUE constraint as soon as a second emoji-named project
    //      landed AND surfaced in the URL as `/projects//settings`,
    //      which the React Router stopped resolving cleanly.
    //   3. Cap the length at 48 chars so the slug fits in the URL bar
    //      and in the audit log without truncation. Random suffixes
    //      append AFTER the trim so a long-name + collision retry
    //      below stays under the column cap.
    let slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    if (!slug) {
      slug = `project-${crypto.randomUUID().slice(0, 8)}`;
    }
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

  // Rename a project. Owner and admin in the project's org can change the
  // display name; legacy ownerless-org projects fall back to `owner_id`.
  // Slug is NOT mutable here on purpose — it shows up in shareable Reports
  // / Settings deep-links, in the X-API-Key auth flow's audit trail, and
  // in the type-the-slug delete confirmation. A cosmetic rename should
  // never break those. If we ever need slug edits, ship a separate
  // explicit "Change project handle" flow that owners only can use.
  app.patch('/v1/admin/projects/:id', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 120) {
      return c.json(
        { ok: false, error: { code: 'BAD_NAME', message: 'Name must be 1-120 characters.' } },
        400,
      );
    }

    const { data: project, error: projectErr } = await db
      .from('projects')
      .select('id, name, slug, organization_id, owner_id')
      .eq('id', projectId)
      .maybeSingle();
    if (projectErr) return dbError(c, projectErr);
    if (!project) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    // Same authz tiers as DELETE: org owner/admin OR legacy direct owner.
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
            message: 'Only org owners or admins can rename a project',
          },
        },
        403,
      );
    }

    const { data: updated, error: updateErr } = await db
      .from('projects')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .select('id, name, slug')
      .single();
    if (updateErr || !updated) {
      return dbError(c, updateErr ?? { message: 'project_update_failed' });
    }

    await logAudit(db, projectId, userId, 'settings.updated', 'project', projectId, {
      previousName: project.name,
      name,
    }).catch(() => {});

    return c.json({ ok: true, data: { project: updated } });
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
    const projectId = c.req.param('id')!;
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
      log.info('project.deleted', {
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

  // ============================================================
  // POST /v1/admin/auth/register
  //
  // OAuth 2.0 RFC 7591 Dynamic Client Registration.
  //
  // Allows orchestrators (LangGraph, OpenAI Agents, CrewAI, etc.) to
  // self-onboard by presenting an "initial access token" (any existing
  // project API key with `mcp:write` scope) and receiving a new
  // `client_id` / `client_secret` pair scoped for the operation the
  // orchestrator needs. The returned `client_secret` is the raw Mushi
  // API key; store it securely.
  //
  // Request body (RFC 7591 §3.1 metadata):
  //   {
  //     client_name: "my-langraph-agent",   // human-readable
  //     grant_types: ["client_credentials"], // must be client_credentials
  //     scope: "mcp:read mcp:write",         // space-separated Mushi scopes
  //     contacts: ["ops@example.com"]        // optional
  //   }
  //
  // Response (RFC 7591 §3.2):
  //   {
  //     client_id:                   "<uuid>",
  //     client_secret:               "mushi_...",
  //     client_secret_expires_at:    0,          // 0 = never expires
  //     client_id_issued_at:         <unix-secs>,
  //     client_name:                 "...",
  //     grant_types:                 ["client_credentials"],
  //     token_endpoint_auth_method:  "client_secret_post",
  //     scope:                       "mcp:read mcp:write"
  //   }
  // ============================================================
  app.post('/v1/admin/auth/register', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const apiKeyProjectId = c.get('projectId') as string | undefined;
    const db = getServiceClient();

    // Resolve the project: orchestrators using an API key get the key's
    // project; JWT users must pass projectId in the body.
    let resolvedProjectId: string | undefined = apiKeyProjectId
    const body = (await c.req.json().catch(() => ({}))) as {
      client_name?: unknown;
      grant_types?: unknown;
      scope?: unknown;
      contacts?: unknown;
      projectId?: unknown;
    };

    if (!resolvedProjectId) {
      if (typeof body.projectId !== 'string') {
        return c.json({
          error: 'invalid_client_metadata',
          error_description: 'projectId is required for JWT-authenticated registrations.',
        }, 400);
      }
      const access = await userCanAccessProject(db, userId, body.projectId as string);
      if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
        return c.json({ error: 'access_denied', error_description: 'Owner or admin required.' }, 403);
      }
      resolvedProjectId = body.projectId as string;
    }

    // Validate grant_types
    const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['client_credentials'];
    if (!grantTypes.every((g) => g === 'client_credentials')) {
      return c.json({
        error: 'invalid_client_metadata',
        error_description: 'Only grant_types=["client_credentials"] is supported.',
      }, 400);
    }

    // Parse requested scopes (space-separated, RFC 7591 §2)
    const scopeStr = typeof body.scope === 'string' ? body.scope : 'mcp:read';
    const requestedScopes = scopeStr.split(/\s+/).filter(Boolean);
    const scopes = normaliseScopes(requestedScopes);
    if ('error' in scopes) {
      return c.json({
        error: 'invalid_client_metadata',
        error_description: scopes.error,
      }, 400);
    }

    // client_name validation
    const clientName =
      typeof body.client_name === 'string' && body.client_name.trim().length > 0
        ? body.client_name.trim().slice(0, 64)
        : 'orchestrator';

    // Mint a new API key (same pattern as /v1/admin/projects/:id/keys).
    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`;
    const prefix = rawKey.slice(0, 12);
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const clientId = crypto.randomUUID();

    const { error: insertErr } = await db.from('project_api_keys').insert({
      id: clientId,
      project_id: resolvedProjectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label: `dcr:${clientName}`,
      scopes,
      is_active: true,
    });
    if (insertErr) {
      return c.json({ error: 'server_error', error_description: insertErr.message }, 500);
    }

    // Audit trail for DCR is critical: this is the only path where an
    // existing API key can mint another API key. If the initial-access
    // token leaks, owners need to see every minted client to revoke.
    // Failure here must not block the registration response — the key is
    // already persisted and the operator needs the secret returned.
    db.from('audit_logs')
      .insert({
        project_id: resolvedProjectId,
        actor_id: userId ?? '00000000-0000-0000-0000-000000000000',
        actor_type: apiKeyProjectId ? 'api_key' : 'user',
        action: 'api_key.created',
        resource_type: 'project_api_key',
        resource_id: clientId,
        metadata: {
          source: 'oauth_dcr',
          client_name: clientName,
          scopes,
          key_prefix: prefix,
          ip_address: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
          user_agent: c.req.header('user-agent') ?? null,
        },
      })
      .then(({ error: auditErr }) => {
        if (auditErr) console.warn('[dcr] audit_logs insert failed (non-fatal):', auditErr.message);
      });

    const issuedAt = Math.floor(Date.now() / 1000);
    // RFC 7591 §3.2 response
    return c.json({
      client_id: clientId,
      client_secret: rawKey,
      client_secret_expires_at: 0,
      client_id_issued_at: issuedAt,
      client_name: clientName,
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: scopes.join(' '),
      // Non-standard: Mushi-specific fields for convenience.
      mushi_project_id: resolvedProjectId,
      mushi_key_prefix: prefix,
    }, 201);
  });

  app.post('/v1/admin/projects/:id/keys', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const body = (await c.req.json().catch(() => ({}))) as { scopes?: unknown; label?: string };
    const scopes = normaliseScopes(body.scopes);
    if ('error' in scopes) {
      return c.json({ ok: false, error: { code: 'INVALID_SCOPES', message: scopes.error } }, 400);
    }

    // Minting API keys is owner/admin-only (Teams v1: org owner/admin or
    // legacy direct project owner; viewers and members can't issue tokens).
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

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
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Rotating an API key is owner/admin-only.
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
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
    const projectId = c.req.param('id')!;
    const keyId = c.req.param('keyId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Revoking an API key is owner/admin-only.
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

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

  // ---------------------------------------------------------------------------
  // Dispatch preflight — GET /v1/admin/projects/:id/preflight
  //
  // Returns a consolidated "is this project ready to dispatch an auto-fix?"
  // summary consumed by:
  //   - DispatchFixPreflight popover on every report row (ReportsPage)
  //   - DispatchPreflightBanner at the top of ReportsPage
  //   - The GitHub integration card's Autofix toggle (IntegrationsPage)
  //
  // Checks: github (repo configured) | codebase (index enabled) |
  //         anthropic (BYOK key present) | autofix (feature flag on)
  //
  // Auth: adminOrApiKey({ scope: 'mcp:read' }) — JWT admins and mcp:read API
  // keys. An API key grants preflight reads on every project its owner can
  // access (userCanAccessProject), not only the key's bound project — same
  // owner-wide semantics as other adminOrApiKey routes.
  // ---------------------------------------------------------------------------
  app.get('/v1/admin/projects/:id/preflight', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const [settingsRes, reposRes] = await Promise.all([
      db
        .from('project_settings')
        .select(
          'github_repo_url, byok_anthropic_key_ref, codebase_index_enabled, autofix_enabled, codebase_repo_url',
        )
        .eq('project_id', projectId)
        .maybeSingle(),
      db.from('project_repos').select('repo_url').eq('project_id', projectId).limit(1),
    ]);

    const settings = settingsRes.data;
    const repos = reposRes.data ?? [];

    const repoUrl =
      settings?.github_repo_url ??
      settings?.codebase_repo_url ??
      (repos.length > 0 ? (repos[0] as { repo_url?: string | null }).repo_url ?? null : null);

    const hasGithub = Boolean(settings?.github_repo_url) || repos.length > 0;
    const hasByok = Boolean(settings?.byok_anthropic_key_ref);
    const hasCodebase = Boolean(settings?.codebase_index_enabled);
    const hasAutofix = Boolean(settings?.autofix_enabled);

    type Check = {
      key: 'github' | 'codebase' | 'anthropic' | 'autofix';
      ready: boolean;
      label: string;
      hint: string;
      fixHref: string;
    };

    const checks: Check[] = [
      {
        key: 'github',
        ready: hasGithub,
        label: 'GitHub repo connected',
        hint: 'Connect a GitHub repository so the fix worker can open pull requests.',
        fixHref: '/integrations/config?tab=github',
      },
      {
        key: 'codebase',
        ready: hasCodebase,
        label: 'Codebase indexed',
        hint: 'Enable codebase indexing so the AI can read your source files.',
        fixHref: '/integrations/config?tab=codebase',
      },
      {
        key: 'anthropic',
        ready: hasByok,
        label: 'Anthropic API key set',
        hint: 'Add your Anthropic API key (BYOK) to power the fix-generation model.',
        fixHref: '/settings?tab=byok',
      },
      {
        key: 'autofix',
        ready: hasAutofix,
        label: 'Autofix enabled',
        hint: 'Turn on Autofix in Project Settings to allow the worker to open PRs.',
        fixHref: '/settings?tab=autofix',
      },
    ];

    const ready = checks.every((c) => c.ready);

    return c.json({ ok: true, data: { ready, checks, repoUrl } });
  });

  // ---------------------------------------------------------------------------
  // Autofix flag — GET /v1/admin/projects/:id/autofix
  //
  // Returns the current autofix_enabled flag for the project. Consumed by
  // CodebaseIndexCard (IntegrationsPage) so the autofix toggle can reflect
  // the live state without requiring a full settings reload.
  // ---------------------------------------------------------------------------
  app.get('/v1/admin/projects/:id/autofix', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const { data, error } = await db
      .from('project_settings')
      .select('autofix_enabled')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { autofix_enabled: Boolean(data?.autofix_enabled) } });
  });

  // ---------------------------------------------------------------------------
  // Autofix toggle — POST /v1/admin/projects/:id/autofix/toggle
  //
  // Flips the autofix_enabled flag on project_settings. Accepts { enabled: boolean }.
  // Returns the updated flag so the caller can sync its local state.
  // ---------------------------------------------------------------------------
  app.post('/v1/admin/projects/:id/autofix/toggle', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      );
    }

    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const enabled = Boolean(body.enabled);

    const { error } = await db
      .from('project_settings')
      .upsert(
        { project_id: projectId, autofix_enabled: enabled },
        { onConflict: 'project_id' },
      );

    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { autofix_enabled: enabled } });
  });

  // Admin pipeline diagnostic. Exists so the admin console's "Send test report"
  // buttons (DashboardPage.GettingStartedEmpty, SettingsPage.QuickTestSection)
  // can verify the ingest path without copy-pasting an API key — the admin is
  // already JWT-authenticated and owns the project. Goes through ingestReport()
  // so it really exercises schema validation, queue insert, circuit breaker, and
  // classification trigger. Tagged with metadata.source so admins can filter
  // these out of the inbox.
  app.post('/v1/admin/projects/:id/test-report', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Test reports verify the ingest path — anyone with project access can
    // do this (matches what an end-user reporter could do anyway).
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }
    const { data: project } = await db
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
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
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Enabling codebase indexing wires GitHub webhooks + secrets — restrict
    // to owner/admin (Teams v1 includes org owner/admin).
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      );
    }

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
    const projectId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Read-only stats — any role on the project (Teams v1 includes
    // org-members) can view.
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );
    }

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

  // ── Codebase Explorer ────────────────────────────────────────────────────
  //
  // GET  /v1/admin/projects/:id/codebase/explore
  //   Returns { nodes, edges, layers, total_files } — the full graph payload
  //   the ExplorePage visualises. Nodes are project_codebase_files rows
  //   (files or symbols); edges are derived by regex-scanning content_preview
  //   for relative import paths.
  //
  // POST /v1/admin/projects/:id/codebase/search
  //   Accepts { query, k? } and returns top-k semantically similar files via
  //   the match_codebase_files Postgres RPC.

  type ExploreLayer = 'ui' | 'lib' | 'backend' | 'test' | 'config' | 'other'

  function detectExploreLayer(filePath: string): ExploreLayer {
    const p = filePath.toLowerCase().replace(/\\/g, '/')
    // Anchored to handle both root-relative paths (no leading /) and nested paths
    if (/(^|\/)(tests?|__tests?__|spec|e2e|cypress|playwright)\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p)) return 'test'
    if (/(^|\/)(server|api|edge-function|supabase\/functions|backend|routes?)\//.test(p)) return 'backend'
    if (/(^|\/)(app|pages?|screens?|views?|components?|layouts?|ui)\//u.test(p) || /\.(tsx|jsx)$/u.test(p)) return 'ui'
    if (/(^|\/)(lib|libs?|utils?|helpers?|hooks?|contexts?|shared|common|core)\//u.test(p)) return 'lib'
    if (/(^|\/)(config|configs?|tooling|scripts?|deploy|\.github|build)\//u.test(p) || /\.(json|yaml|yml|toml|mjs|cjs)$/u.test(p) || /^(vite|next|tailwind|tsconfig|package|turbo)/.test(p.split('/').pop() ?? '')) return 'config'
    return 'other'
  }

  const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g

  function extractRelativeImports(content: string): string[] {
    const imports: string[] = []
    let m: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const p = m[1] ?? m[2]
      if (p && p.startsWith('.')) imports.push(p)
    }
    return imports
  }

  /** Resolve a relative import path against its source file's directory. */
  function resolveRelative(fromPath: string, importPath: string): string {
    const dir = fromPath.split('/').slice(0, -1).join('/')
    const segments = [...(dir ? dir.split('/') : []), ...importPath.split('/')]
    const resolved: string[] = []
    for (const seg of segments) {
      if (seg === '..') resolved.pop()
      else if (seg !== '.') resolved.push(seg)
    }
    return resolved.join('/')
  }

  // GET /v1/admin/explore/stats — codebase atlas posture (banner + EXPLORE SNAPSHOT).
  // Must be registered BEFORE /v1/admin/projects/:id/codebase/explore so "stats"
  // is never swallowed as a project id.
  app.get('/v1/admin/explore/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const emptyLayers = { ui: 0, lib: 0, backend: 0, test: 0, config: 0, other: 0 }
    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      codebaseIndexEnabled: false,
      indexingEnabled: null as boolean | null,
      repoUrl: null as string | null,
      hasWebhookSecret: false,
      indexedFiles: 0,
      symbolCount: 0,
      withEmbeddings: 0,
      layers: emptyLayers,
      topLanguages: [] as string[],
      lastIndexedAt: null as string | null,
      lastIndexAttemptAt: null as string | null,
      lastIndexError: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'not_enabled'
        | 'indexing'
        | 'error'
        | 'empty'
        | 'ready'
        | 'stale',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await ownedProjectIds(db, userId)
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty })
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    const [
      settingsRes,
      primaryRepoRes,
      filesCountRes,
      symbolsCountRes,
      embeddingsCountRes,
      fileSampleRes,
    ] = await Promise.all([
      db
        .from('project_settings')
        .select('codebase_index_enabled, codebase_repo_url, github_webhook_secret')
        .eq('project_id', pid)
        .maybeSingle(),
      db
        .from('project_repos')
        .select(
          'repo_url, default_branch, last_indexed_at, last_index_error, last_index_attempt_at, indexing_enabled',
        )
        .eq('project_id', pid)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .is('symbol_name', null),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .not('symbol_name', 'is', null),
      db
        .from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .not('embedding', 'is', null),
      db
        .from('project_codebase_files')
        .select('file_path, language')
        .eq('project_id', pid)
        .is('tombstoned_at', null)
        .is('symbol_name', null)
        .limit(5000),
    ])

    const settings = settingsRes.data
    const primaryRepo = primaryRepoRes.data
    const indexedFiles = filesCountRes.count ?? 0
    const symbolCount = symbolsCountRes.count ?? 0
    const withEmbeddings = embeddingsCountRes.count ?? 0
    const codebaseIndexEnabled = !!settings?.codebase_index_enabled
    const indexingEnabled = primaryRepo?.indexing_enabled ?? null
    const repoUrl = primaryRepo?.repo_url ?? settings?.codebase_repo_url ?? null
    const lastIndexedAt = primaryRepo?.last_indexed_at ?? null
    const lastIndexAttemptAt = primaryRepo?.last_index_attempt_at ?? null
    const lastIndexError = primaryRepo?.last_index_error ?? null

    const layers = { ...emptyLayers }
    const langCounts = new Map<string, number>()
    for (const row of fileSampleRes.data ?? []) {
      const layer = detectExploreLayer(String(row.file_path ?? ''))
      layers[layer] = (layers[layer] ?? 0) + 1
      const lang = row.language ? String(row.language) : null
      if (lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
    }
    const topLanguages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang]) => lang)

    let topPriority: typeof empty.topPriority = 'ready'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (!codebaseIndexEnabled && indexedFiles === 0) {
      topPriority = 'not_enabled'
      topPriorityLabel = 'Codebase indexing is off — enable in Settings or run mushi index'
      topPriorityTo = '/explore?tab=index'
    } else if (lastIndexError) {
      topPriority = 'error'
      topPriorityLabel = `Last index error — ${lastIndexError.slice(0, 120)}${lastIndexError.length > 120 ? '…' : ''}`
      topPriorityTo = '/explore?tab=index'
    } else if (indexedFiles === 0 && lastIndexAttemptAt && !lastIndexedAt) {
      topPriority = 'indexing'
      topPriorityLabel = 'Indexer is running — files should appear within ~90s'
      topPriorityTo = '/explore?tab=index'
    } else if (indexedFiles === 0) {
      topPriority = 'empty'
      topPriorityLabel = 'No files indexed yet — connect a repo or run mushi index'
      topPriorityTo = '/settings'
    } else if (
      lastIndexedAt &&
      Date.now() - new Date(lastIndexedAt).getTime() > 7 * 24 * 60 * 60 * 1000
    ) {
      topPriority = 'stale'
      topPriorityLabel = `${indexedFiles.toLocaleString()} files · index may be stale (>7d)`
      topPriorityTo = '/explore?tab=graph'
    } else {
      topPriority = 'ready'
      topPriorityLabel = `${indexedFiles.toLocaleString()} files · ${withEmbeddings} embedded for search`
      topPriorityTo = '/explore?tab=graph'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        codebaseIndexEnabled,
        indexingEnabled,
        repoUrl,
        hasWebhookSecret: !!settings?.github_webhook_secret,
        indexedFiles,
        symbolCount,
        withEmbeddings,
        layers,
        topLanguages,
        lastIndexedAt,
        lastIndexAttemptAt,
        lastIndexError,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/projects/:id/codebase/explore', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    const includeSymbols = c.req.query('symbols') === '1'

    let query = db
      .from('project_codebase_files')
      // Include last_modified so the frontend can show file freshness.
      .select('id, file_path, symbol_name, signature, line_start, line_end, language, content_preview, last_modified')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .order('file_path')
      .limit(5000)

    if (!includeSymbols) {
      query = query.is('symbol_name', null)
    }

    const { data: rows, error: dbErr } = await query
    if (dbErr) return dbError(c, dbErr)

    const fileRows = rows ?? []

    // Build nodes — set node_type based on whether the row represents a symbol
    // or a file so the frontend can apply different styling per type.
    const nodes = fileRows.map((r) => {
      const layer = detectExploreLayer(r.file_path)
      const label = r.symbol_name
        ? `${r.file_path.split('/').pop()} · ${r.symbol_name}`
        : (r.file_path.split('/').pop() ?? r.file_path)
      return {
        id: r.id,
        node_type: (r.symbol_name ? 'code_symbol' : 'code_file') as 'code_symbol' | 'code_file',
        label,
        metadata: {
          file_path: r.file_path,
          symbol_name: r.symbol_name ?? null,
          signature: r.signature ?? null,
          line_start: r.line_start ?? null,
          line_end: r.line_end ?? null,
          language: r.language ?? null,
          layer,
          content_preview: r.content_preview ?? null,
          last_modified: r.last_modified ?? null,
        },
      }
    })

    // Derive import edges from content_preview.
    // In symbols mode, key nodeByPath by (file_path + symbol_name) so that
    // multiple symbols in the same file don't collide and overwrite each other.
    const edges: { id: string; source_node_id: string; target_node_id: string; edge_type: string; weight: number }[] = []
    const seenEdges = new Set<string>()
    // For edge resolution we only want file-level nodes (not symbols), so build
    // the path → id map from file rows only.
    const nodeByPath = new Map(
      fileRows
        .filter((r) => !r.symbol_name)
        .map((r) => [r.file_path, r.id]),
    )

    for (const row of fileRows) {
      if (!row.content_preview) continue
      for (const imp of extractRelativeImports(row.content_preview)) {
        const resolved = resolveRelative(row.file_path, imp)
        // Try exact match first, then common extensions
        const targetId =
          nodeByPath.get(resolved) ??
          nodeByPath.get(resolved + '.ts') ??
          nodeByPath.get(resolved + '.tsx') ??
          nodeByPath.get(resolved + '.js') ??
          nodeByPath.get(resolved + '/index.ts') ??
          nodeByPath.get(resolved + '/index.tsx')
        if (!targetId || targetId === row.id) continue
        const edgeKey = `${row.id}→${targetId}`
        if (seenEdges.has(edgeKey) || edges.length >= 2000) continue
        seenEdges.add(edgeKey)
        edges.push({
          id: edgeKey,
          source_node_id: row.id,
          target_node_id: targetId,
          edge_type: 'imports',
          weight: 1,
        })
      }
    }

    // Layer summary counts
    const layerCounts: Record<string, number> = {}
    for (const n of nodes) {
      const l = n.metadata.layer
      layerCounts[l] = (layerCounts[l] ?? 0) + 1
    }

    // Total distinct files (not symbols)
    const { count: totalFiles } = await db
      .from('project_codebase_files')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .is('symbol_name', null)

    return c.json({
      ok: true,
      data: {
        nodes,
        edges,
        layers: layerCounts,
        total_files: totalFiles ?? fileRows.filter((r) => !r.symbol_name).length,
      },
    })
  })

  app.post('/v1/admin/projects/:id/codebase/search', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    let body: { query?: string; k?: number }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } }, 400)
    }
    if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
      return c.json({ ok: false, error: { code: 'MISSING_QUERY', message: 'query is required' } }, 400)
    }

    const k = Math.min(20, Math.max(1, Number(body.k ?? 8)))
    const { createEmbedding } = await import('../../_shared/embeddings.ts')
    const embedding = await createEmbedding(body.query.trim(), { projectId })

    const { data: hits, error: rpcErr } = await db.rpc('match_codebase_files', {
      query_embedding: embedding,
      match_project: projectId,
      match_count: k,
    })
    if (rpcErr) return dbError(c, rpcErr)

    // Return all fields the frontend ExploreSearchHit type expects:
    // id, file_path, symbol_name, signature, line_start, line_end, language,
    // content_preview, similarity, layer.
    const results = (hits ?? []).map((h: Record<string, unknown>) => ({
      id: String(h.id ?? ''),
      file_path: String(h.file_path ?? ''),
      symbol_name: h.symbol_name ? String(h.symbol_name) : null,
      signature: h.signature ? String(h.signature) : null,
      line_start: h.line_start != null ? Number(h.line_start) : null,
      line_end: h.line_end != null ? Number(h.line_end) : null,
      language: h.language ? String(h.language) : null,
      similarity: Number(h.similarity ?? 0),
      content_preview: h.content_preview != null ? String(h.content_preview) : null,
      layer: detectExploreLayer(String(h.file_path ?? '')),
    }))

    return c.json({ ok: true, data: { results, query: body.query.trim() } })
  })

  // DLQ admin endpoints

  // GET /v1/admin/queue/stats — QueueStatusBanner posture data.
  app.get('/v1/admin/queue/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      deadLetter: 0,
      reportsQueued: 0,
      strandedReports: 0,
      oldestPendingMinutes: null as number | null,
      topStage: null as string | null,
      topStageDeadLetter: 0,
      todayCreated: 0,
      todayCompleted: 0,
      todayFailed: 0,
      topPriority: 'no_project' as
        | 'no_project' | 'dead_letter' | 'failed' | 'circuit_breaker' | 'stalled' | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await ownedProjectIds(db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    const projectRes = await db
      .from('projects')
      .select('id, project_name')
      .in('id', projectIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const pid = projectRes.data?.id ?? projectIds[0]
    const projectName = projectRes.data?.project_name ?? null

    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [queueRes, reportsQueuedRes] = await Promise.all([
      db.from('process_queue')
        .select('id, status, stage, created_at, started_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(500),
      db.from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .eq('status', 'queued'),
    ])

    const items = queueRes.data ?? []
    const pending = items.filter((i) => i.status === 'pending').length
    const running = items.filter((i) => i.status === 'running').length
    const completed = items.filter((i) => i.status === 'completed').length
    const failed = items.filter((i) => i.status === 'failed').length
    const deadLetter = items.filter((i) => i.status === 'dead_letter').length
    const reportsQueued = reportsQueuedRes.count ?? 0

    const todayItems = items.filter((i) => i.created_at >= todayStart.toISOString())
    const todayCreated = todayItems.length
    const todayCompleted = todayItems.filter((i) => i.status === 'completed').length
    const todayFailed = todayItems.filter((i) => i.status === 'failed').length

    const oldestPendingItem = items.filter((i) => i.status === 'pending').at(-1)
    const oldestPendingMinutes = oldestPendingItem
      ? Math.floor((Date.now() - new Date(oldestPendingItem.created_at).getTime()) / 60000)
      : null

    const stageCounts = new Map<string, number>()
    for (const i of items.filter((it) => it.status === 'dead_letter')) {
      const s = i.stage ?? 'unknown'
      stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1)
    }
    const topEntry = [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]

    let topPriority: typeof empty.topPriority = 'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (deadLetter > 0) {
      topPriority = 'dead_letter'
      topPriorityLabel = `${deadLetter} dead-letter job${deadLetter === 1 ? '' : 's'} — inspect and republish.`
      topPriorityTo = '/queue?status=dead_letter'
    } else if (failed > 0) {
      topPriority = 'failed'
      topPriorityLabel = `${failed} job${failed === 1 ? '' : 's'} failed — retry or quarantine.`
      topPriorityTo = '/queue?status=failed'
    } else if (reportsQueued > 0) {
      topPriority = 'circuit_breaker'
      topPriorityLabel = `${reportsQueued} report${reportsQueued === 1 ? '' : 's'} queued behind circuit breaker — flush when ready.`
      topPriorityTo = '/queue'
    } else if (oldestPendingMinutes !== null && oldestPendingMinutes > 15) {
      topPriority = 'stalled'
      topPriorityLabel = `Oldest pending job is ${oldestPendingMinutes}m old — possible stall.`
      topPriorityTo = '/queue?status=pending'
    } else {
      topPriorityLabel = `${running} running · ${pending} pending — pipeline nominal.`
      topPriorityTo = '/queue'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName,
        projectCount: projectIds.length,
        pending,
        running,
        completed,
        failed,
        deadLetter,
        reportsQueued,
        strandedReports: 0,
        oldestPendingMinutes,
        topStage: topEntry?.[0] ?? null,
        topStageDeadLetter: topEntry?.[1] ?? 0,
        todayCreated,
        todayCompleted,
        todayFailed,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

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
    const queueId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);

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
      .select('id, project_id, status')
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

  app.get('/v1/admin/graph/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasIngest: false,
      nodeCount: 0,
      edgeCount: 0,
      reportNodes: 0,
      inventoryNodes: 0,
      fragileComponents: 0,
      regressionEdges: 0,
      duplicateEdges: 0,
      fixVerifiedEdges: 0,
      lastNodeAt: null as string | null,
      graphBackend: 'sql_only' as string,
      ageAvailable: false,
      unsyncedNodes: 0,
      unsyncedEdges: 0,
      topPriority: 'waiting_ingest' as
        | 'waiting_ingest'
        | 'empty'
        | 'fragile'
        | 'regressions'
        | 'clear',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const activeProject = resolvedProject.project;
    const pid = activeProject.id;

    const INVENTORY_NODE_TYPES = [
      'app',
      'page_v2',
      'element',
      'action',
      'api_dep',
      'db_dep',
      'test',
      'user_story',
    ];

    const [
      reportCountRes,
      nodesRes,
      edgesRes,
      settingsRes,
      ageAvailRes,
      unsyncedNodesRes,
      unsyncedEdgesRes,
      latestNodeRes,
    ] = await Promise.all([
      db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', pid),
      db
        .from('graph_nodes')
        .select('id, node_type, created_at')
        .eq('project_id', pid)
        .limit(500),
      db
        .from('graph_edges')
        .select('id, edge_type, source_node_id, target_node_id')
        .eq('project_id', pid)
        .limit(1000),
      db.from('project_settings').select('graph_backend').eq('project_id', pid).maybeSingle(),
      db.rpc('mushi_age_available'),
      db
        .from('graph_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('age_synced_at', null),
      db
        .from('graph_edges')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('age_synced_at', null),
      db
        .from('graph_nodes')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const nodes = nodesRes.data ?? [];
    const edges = edgesRes.data ?? [];
    const nodeCount = nodes.length;
    const edgeCount = edges.length;
    const hasIngest = (reportCountRes.count ?? 0) > 0;
    const reportNodes = nodes.filter((n) => n.node_type === 'report_group').length;
    const inventoryNodes = nodes.filter((n) => INVENTORY_NODE_TYPES.includes(String(n.node_type))).length;

    const componentIds = new Set(
      nodes.filter((n) => n.node_type === 'component').map((n) => n.id),
    );
    const incomingAffects = new Map<string, number>();
    let regressionEdges = 0;
    let duplicateEdges = 0;
    let fixVerifiedEdges = 0;
    for (const e of edges) {
      const et = String(e.edge_type ?? '');
      if (et === 'regression_of') regressionEdges += 1;
      else if (et === 'duplicate_of') duplicateEdges += 1;
      else if (et === 'fix_verified') fixVerifiedEdges += 1;
      else if (et === 'affects' && componentIds.has(String(e.target_node_id))) {
        incomingAffects.set(
          String(e.target_node_id),
          (incomingAffects.get(String(e.target_node_id)) ?? 0) + 1,
        );
      }
    }
    let fragileComponents = 0;
    for (const count of incomingAffects.values()) {
      if (count >= 3) fragileComponents += 1;
    }

    let topPriority: typeof empty.topPriority = 'waiting_ingest';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!hasIngest) {
      topPriority = 'waiting_ingest';
      topPriorityLabel = 'No reports ingested — graph seeds from classified bug reports';
      topPriorityTo = '/onboarding?tab=verify';
    } else if (nodeCount === 0) {
      topPriority = 'empty';
      topPriorityLabel = 'Reports ingested but graph empty — classifier may still be indexing';
      topPriorityTo = '/reports?tab=queue';
    } else if (fragileComponents > 0) {
      topPriority = 'fragile';
      topPriorityLabel = `${fragileComponents} fragile component${fragileComponents === 1 ? '' : 's'} (≥3 incoming affects edges)`;
      topPriorityTo = '/graph?view=fragile';
    } else if (regressionEdges > 0) {
      topPriority = 'regressions';
      topPriorityLabel = `${regressionEdges} regression edge${regressionEdges === 1 ? '' : 's'} — bugs that came back after a fix`;
      topPriorityTo = '/graph?view=regressions';
    } else {
      topPriority = 'clear';
      topPriorityLabel = `${nodeCount} nodes · ${edgeCount} edges — map is current`;
      topPriorityTo = '/graph';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        hasIngest,
        nodeCount,
        edgeCount,
        reportNodes,
        inventoryNodes,
        fragileComponents,
        regressionEdges,
        duplicateEdges,
        fixVerifiedEdges,
        lastNodeAt: latestNodeRes.data?.created_at ?? null,
        graphBackend: settingsRes.data?.graph_backend ?? 'sql_only',
        ageAvailable: ageAvailRes.data === true,
        unsyncedNodes: unsyncedNodesRes.count ?? 0,
        unsyncedEdges: unsyncedEdgesRes.count ?? 0,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/graph/nodes', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
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
    const projectIds = await ownedProjectIds(db, userId);

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
    const projectIds = await ownedProjectIds(db, userId);
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
    const edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }> = [];
    let frontier = [seedNode.id];

    for (let d = 0; d < depth && frontier.length && visitedNodes.size < 500; d++) {
      const { data: nextEdges } = await db
        .from('graph_edges')
        .select('source_node_id, target_node_id, edge_type')
        .in('project_id', projectIds)
        .or(`source_node_id.in.(${frontier.join(',')}),target_node_id.in.(${frontier.join(',')})`)
        .limit(500);

      const nextIds = new Set<string>();
      for (const e of nextEdges ?? []) {
        edges.push(e);
        if (!visitedNodes.has(e.source_node_id)) nextIds.add(e.source_node_id);
        if (!visitedNodes.has(e.target_node_id)) nextIds.add(e.target_node_id);
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

  /**
   * Single graph node (metadata includes v2 inventory `status` on Action nodes).
   * Used by MCP `graph_node_status` and agents that need one row without listing 200.
   */
  app.get('/v1/admin/graph/node/:nodeId', adminOrApiKey(), async (c) => {
    const nodeId = c.req.param('nodeId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    const { data: node, error } = await db
      .from('graph_nodes')
      .select('id, project_id, node_type, label, metadata, last_traversed_at, created_at')
      .eq('id', nodeId)
      .in('project_id', projectIds)
      .maybeSingle();
    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
    if (!node)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404);
    return c.json({ ok: true, data: { node } });
  });

  app.get('/v1/admin/graph/blast-radius/:nodeId', adminOrApiKey(), async (c) => {
    const nodeId = c.req.param('nodeId')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
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
    // Teams v1: any accessible project anchors the ontology read.
    const accessibleIds = await ownedProjectIds(db, userId);
    if (accessibleIds.length === 0) return c.json({ ok: true, data: { tags: [] } });
    const project = { id: accessibleIds[0] };

    const tags = await getAvailableTags(db, project.id);
    return c.json({ ok: true, data: { tags } });
  });

  app.post('/v1/admin/ontology', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    // Teams v1: any accessible project anchors the ontology write.
    const accessibleIds = await ownedProjectIds(db, userId);
    const project = accessibleIds.length ? { id: accessibleIds[0] } : null;
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

    const projectIds = await ownedProjectIds(db, userId);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Raw SQL query — authenticated admin sends explicit SQL instead of a
  // natural-language question. Skips the LLM plan + summary steps (no AI
  // cost); everything else is identical to the NL path: same rate limit,
  // same sanitization pipeline (DANGEROUS_PATTERNS + FORBIDDEN_SCHEMAS +
  // SELECT/WITH gate + $1 scoping + comment stripping), same Postgres RPC,
  // same audit trail. Extra guards specific to raw SQL mode:
  //   - Table allowlist: only approved analytics tables (no nl_query_history,
  //     audit_logs, byok_audit_log, etc.)
  //   - LIMIT auto-append: if the user forgets LIMIT, append LIMIT 100
  //   - Input length cap: max 4 000 chars
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/v1/admin/query/raw', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as { sql?: string };
    const rawSql = body.sql?.trim() ?? '';
    if (!rawSql) {
      return c.json(
        { ok: false, error: { code: 'MISSING_SQL', message: 'sql is required' } },
        400,
      );
    }

    const db = getServiceClient();

    // Reuse the same per-user hourly rate limit as the NL endpoint. Raw SQL
    // is cheaper (no LLM) but still hits the Postgres RPC and could be abused
    // for data exfiltration if unlimited.
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
              message: 'Query rate limit reached (60 queries/hour). Try again next hour.',
            },
          },
          429,
        );
      }
      console.warn('[raw-query] rate limit RPC failed:', msg);
    }

    const projectIds = await ownedProjectIds(db, userId);
    if (!projectIds.length) {
      return c.json({ ok: true, data: { sql: rawSql, results: [], rowCount: 0 } });
    }

    let cleanedSql: string;
    try {
      cleanedSql = sanitizeSql(rawSql, { tableAllowlist: true, requireProjectIdParam: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'INVALID_SQL', message } }, 400);
    }

    const startedAt = Date.now();
    const results: unknown[] = [];
    for (const projectId of projectIds) {
      const { data, error } = await db.rpc('execute_readonly_query', {
        query_text: cleanedSql,
        project_id_param: projectId,
      });
      if (error) {
        const message = `Query execution failed: ${error.message}`;
        const latencyMs = Date.now() - startedAt;
        db.from('nl_query_history')
          .insert({
            project_id: projectIds[0] ?? null,
            user_id: userId,
            prompt: rawSql,
            sql: cleanedSql,
            error: message,
            latency_ms: latencyMs,
            mode: 'raw',
          })
          .then(({ error: e }) => {
            if (e) console.warn('[raw_query_history] insert failed:', e.message);
          });
        return c.json({ ok: false, error: { code: 'QUERY_ERROR', message } }, 400);
      }
      if (data) results.push(...(Array.isArray(data) ? data : [data]));
      if (results.length >= 100) break;
    }

    const latencyMs = Date.now() - startedAt;
    db.from('nl_query_history')
      .insert({
        project_id: projectIds[0] ?? null,
        user_id: userId,
        prompt: rawSql,
        sql: cleanedSql,
        row_count: results.length,
        latency_ms: latencyMs,
        mode: 'raw',
      })
      .then(({ error: e }) => {
        if (e) console.warn('[raw_query_history] insert failed:', e.message);
      });

    return c.json({
      ok: true,
      data: { sql: cleanedSql, results: results.slice(0, 100), rowCount: results.length, latencyMs },
    });
  });
}
