import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { callerProjectIds } from '../shared.ts';

export function registerBillingRoutes(app: Hono<{ Variables: Variables }>): void {
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

    const projectIdsForUser = await callerProjectIds(c, db, userId);
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

    const projectIdsForUser = await callerProjectIds(c, db, userId);
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

}
