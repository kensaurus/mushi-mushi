/**
 * FILE: packages/server/supabase/functions/api/routes/billing-change-plan.ts
 * PURPOSE: In-app plan change for a project that already pays: Indie ↔ Pro and
 *          monthly ↔ annual, prorated, through the Stripe Subscriptions API.
 *
 * WHY NOT THE CUSTOMER PORTAL: Stripe's portal can cancel, but not update, a
 * subscription that uses usage-based billing or more than one product
 * (docs.stripe.com/customer-management, "Limitations"). Every monthly Mushi
 * subscription carries the metered diagnoses item, so the portal's "switch
 * plan" can never apply to it. The portal stays for card, invoices and cancel.
 *
 * ROUTES
 *   POST /v1/admin/billing/change-plan/preview  — amount invoiced now, no change
 *   POST /v1/admin/billing/change-plan          — apply the change
 *   body: { project_id, plan_id: 'indie' | 'pro', billing_interval: 'monthly' | 'annual' }
 *
 * The `customer.subscription.updated` webhook persists the new plan, price and
 * overage item; this route does not write billing_subscriptions itself.
 */
import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { SUPPORT_EMAIL } from '../../_shared/support.ts';
import {
  applyPlanChange,
  migrateSubscriptionToFlexible,
  previewPlanChange,
  retrieveSubscription,
  stripeFromEnv,
  subscriptionBillingMode,
  type PlanChangeRequest,
} from '../../_shared/stripe.ts';
import {
  baseSubscriptionItem,
  intervalFromRecurring,
  isBillingInterval,
  planChangeItems,
  planChangeRefusal,
  selfServePlanPrices,
  type BillingInterval,
  type PlanChangeRefusal,
  type SelfServeChangePlan,
} from '../../_shared/billing-rules.ts';
import { assertTargetProjectAccess, dbError, ownedProjectIds, requireProjectAdmin } from '../shared.ts';

const clog = log.child('billing-change-plan');

type Ctx = Context<{ Variables: Variables }>;

const REFUSAL_COPY: Record<PlanChangeRefusal, { status: 400 | 404 | 409; message: string }> = {
  NO_SUBSCRIPTION: {
    status: 404,
    message: 'This project has no paid plan to change. Pick a plan to start one.',
  },
  SUBSCRIPTION_NOT_CHANGEABLE: {
    status: 409,
    message: 'This subscription has an unpaid invoice or is not active. Open Manage billing to settle it, then change the plan.',
  },
  PLAN_NOT_SELF_SERVE: {
    status: 400,
    message: `Only Indie and Pro can be changed here. For Enterprise, email ${SUPPORT_EMAIL}.`,
  },
  NO_CHANGE: {
    status: 400,
    message: 'The project is already on that plan and billing interval.',
  },
};

interface Resolved {
  request: PlanChangeRequest;
  fromPlanId: string | null;
  fromInterval: BillingInterval;
  toPlanId: SelfServeChangePlan;
  toInterval: BillingInterval;
  billingMode: string;
  projectId: string;
  organizationId: string | null;
}

/**
 * Auth, validation and the Stripe item diff shared by preview and apply.
 * Returns a Response when the request must stop.
 */
async function resolveChange(c: Ctx): Promise<Resolved | Response> {
  const userId = c.get('userId') as string;
  const body = (await c.req.json().catch(() => null)) as {
    project_id?: string;
    plan_id?: string;
    billing_interval?: string;
  } | null;
  if (!body?.project_id || !body.plan_id || !isBillingInterval(body.billing_interval)) {
    return c.json({ ok: false, error: { code: 'INVALID_BODY', message: 'Pick a plan and a billing interval, then try again.' } }, 400);
  }
  const db = getServiceClient();
  const owned = await ownedProjectIds(db, userId);
  if (!owned.includes(body.project_id)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the people who own this project can change its plan.' } }, 403);
  }
  // Same role as checkout and the portal: a plan change moves money.
  const access = await assertTargetProjectAccess(c, db, userId, body.project_id);
  if (!access.ok) return access.response;
  const forbidden = requireProjectAdmin(
    c,
    { organization_role: access.role },
    'Only organization owners and admins can change this project’s plan.',
  );
  if (forbidden) return forbidden;

  const cfg = stripeFromEnv();
  if (!cfg.secretKey) {
    return c.json({ ok: false, error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Payments are not set up on this Mushi server yet.' } }, 503);
  }

  const { data: subRow, error: subErr } = await db
    .from('billing_subscriptions')
    .select('stripe_subscription_id, status, plan_id, organization_id')
    .eq('project_id', body.project_id)
    .in('status', ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subErr) return dbError(c, subErr);
  const { data: customerRow, error: custErr } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('project_id', body.project_id)
    .maybeSingle();
  if (custErr) return dbError(c, custErr);

  const refuseEarly = !subRow?.stripe_subscription_id || !customerRow?.stripe_customer_id;
  if (refuseEarly) {
    const r = REFUSAL_COPY.NO_SUBSCRIPTION;
    return c.json({ ok: false, error: { code: 'NO_SUBSCRIPTION', message: r.message } }, r.status);
  }

  // Stripe is the source of truth for the items and their intervals.
  let sub: Awaited<ReturnType<typeof retrieveSubscription>>;
  try {
    sub = await retrieveSubscription(cfg, subRow.stripe_subscription_id);
  } catch (err) {
    return stripeFailure(c, err, 'retrieve');
  }
  const base = baseSubscriptionItem(sub.items?.data ?? []);
  const fromInterval = intervalFromRecurring(base?.price?.recurring);

  const refusal = planChangeRefusal({
    status: sub.status,
    currentPlanId: subRow.plan_id,
    currentInterval: fromInterval,
    targetPlanId: body.plan_id,
    targetInterval: body.billing_interval,
  });
  if (refusal) {
    const r = REFUSAL_COPY[refusal];
    return c.json({ ok: false, error: { code: refusal, message: r.message } }, r.status);
  }
  const toPlanId = body.plan_id as SelfServeChangePlan;
  const prices = selfServePlanPrices(toPlanId, body.billing_interval, (k) => Deno.env.get(k));
  if (!prices.base || (body.billing_interval === 'monthly' && !prices.overage)) {
    return c.json({ ok: false, error: { code: 'PLAN_NOT_CONFIGURED', message: `The ${toPlanId} ${body.billing_interval} price is not configured on this server.` } }, 503);
  }

  const change = planChangeItems({
    items: sub.items.data,
    targetBasePriceId: prices.base,
    targetOveragePriceId: prices.overage ?? null,
    targetInterval: body.billing_interval,
  });

  return {
    request: {
      subscriptionId: sub.id,
      customerId: customerRow.stripe_customer_id,
      items: change.items,
      resetBillingAnchor: change.resetBillingAnchor,
      planId: toPlanId,
    },
    fromPlanId: subRow.plan_id ?? null,
    fromInterval,
    toPlanId,
    toInterval: body.billing_interval,
    billingMode: subscriptionBillingMode(sub),
    projectId: body.project_id,
    organizationId: (subRow.organization_id as string | null) ?? null,
  };
}

function stripeFailure(c: Ctx, err: unknown, step: string) {
  const msg = err instanceof Error ? err.message : String(err);
  // error_if_incomplete → Stripe answers 402 when the proration invoice
  // cannot be paid; nothing changed on the subscription.
  if (/-> 402/.test(msg)) {
    return c.json({ ok: false, error: { code: 'PAYMENT_FAILED', message: 'Your card was declined for the prorated charge, so the plan did not change. Update the card in Manage billing and try again.' } }, 402);
  }
  clog.error('stripe_failed', { step, err: msg.slice(0, 300) });
  return c.json({ ok: false, error: { code: 'PLAN_CHANGE_UNAVAILABLE', message: `Stripe could not change the plan. Nothing was changed or charged. Try again in a minute, or email ${SUPPORT_EMAIL}.` } }, 502);
}

export function registerBillingChangePlanRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/billing/change-plan/preview', jwtAuth, async (c) => {
    const resolved = await resolveChange(c);
    if (resolved instanceof Response) return resolved;
    try {
      const preview = await previewPlanChange(stripeFromEnv(), resolved.request, Math.floor(Date.now() / 1000));
      return c.json({
        ok: true,
        data: {
          from: { plan_id: resolved.fromPlanId, billing_interval: resolved.fromInterval },
          to: { plan_id: resolved.toPlanId, billing_interval: resolved.toInterval },
          amount_due: preview.amount_due,
          total: preview.total,
          currency: preview.currency,
          resets_billing_date: resolved.request.resetBillingAnchor,
          // Annual plans stop at the included diagnoses each month.
          overage_billed: resolved.toInterval === 'monthly',
          lines: (preview.lines?.data ?? []).map((l) => ({ description: l.description, amount: l.amount })),
        },
      });
    } catch (err) {
      return stripeFailure(c, err, 'preview');
    }
  });

  app.post('/v1/admin/billing/change-plan', jwtAuth, async (c) => {
    return withIdempotency(c, async () => {
      const resolved = await resolveChange(c);
      if (resolved instanceof Response) return resolved;
      const cfg = stripeFromEnv();
      try {
        // Classic mode drops a removed metered item's unbilled usage; flexible
        // invoices it. Migrate first so a monthly → annual move bills usage.
        if (resolved.billingMode !== 'flexible') {
          await migrateSubscriptionToFlexible(cfg, resolved.request.subscriptionId);
        }
        await applyPlanChange(cfg, resolved.request);
      } catch (err) {
        return stripeFailure(c, err, 'apply');
      }

      const userId = c.get('userId') as string;
      await logAudit(getServiceClient(), resolved.projectId, userId, 'billing.plan_changed', 'project', resolved.projectId, {
        stripe_subscription_id: resolved.request.subscriptionId,
        organization_id: resolved.organizationId,
        from_plan_id: resolved.fromPlanId,
        from_interval: resolved.fromInterval,
        to_plan_id: resolved.toPlanId,
        to_interval: resolved.toInterval,
        migrated_to_flexible: resolved.billingMode !== 'flexible',
      });
      return c.json({
        ok: true,
        data: {
          plan_id: resolved.toPlanId,
          billing_interval: resolved.toInterval,
        },
      });
    });
  });
}
