/**
 * FILE: packages/server/supabase/functions/_shared/org-billing.ts
 * PURPOSE: A paid plan belongs to the team (organization), not to one app
 *          (VISION.md §2.2: apps, seats, diagnoses, overage and the spend cap
 *          are limits per team). This is the one place that answers "which
 *          plan is this team on?" and "how much has this team used?".
 *
 * Plan precedence (`planIdForOrganization`):
 *   1. A complimentary organization: its `organizations.plan_id`. Stripe is
 *      never consulted for these.
 *   2. The organization's newest live subscription (active, trialing or
 *      past_due), keyed on `billing_subscriptions.organization_id`.
 *   3. `organizations.plan_id`, which stripe-webhooks keeps in step with the
 *      subscription (and an operator may set by hand).
 *   4. Free.
 *
 * Every plan reader goes through here: the diagnosis and ingest gates
 * (quota.ts), feature gates (entitlements.ts), the app limit, the seat cap,
 * retention, the brand footer, billing pages, usage alerts.
 *
 * `billing_subscriptions.project_id` and `billing_customers.project_id` stay
 * as the app the plan was bought from (both columns are NOT NULL). They are
 * an anchor, never a scope: nothing looks a plan or a customer up by them.
 */
import type { getServiceClient } from './db.ts'
import { getPlan, type PricingPlan } from './plans.ts'

type Db = ReturnType<typeof getServiceClient>

/** Subscription states that keep the paid plan (past_due is the dunning grace). */
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const

const LIVE = new Set<string>(LIVE_SUBSCRIPTION_STATUSES)

export interface OrgSubscription {
  status: string
  plan_id: string | null
  current_period_end: string | null
  overage_subscription_item_id: string | null
  monthly_spend_cap_usd_override: number | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  cancel_at_period_end: boolean | null
}

export interface OrgBilling {
  /** Null only when the project row could not be found. */
  organizationId: string | null
  billingMode: 'stripe' | 'complimentary'
  /** `organizations.plan_id` as stored (null when unset or no organization). */
  orgPlanId: string | null
  plan: PricingPlan
  /** The newest live subscription of the organization, or null. */
  liveSub: OrgSubscription | null
  /** Every app in the organization; filled only when asked for. */
  projectIds: string[]
}

const SUB_COLUMNS =
  'status, plan_id, current_period_end, overage_subscription_item_id, monthly_spend_cap_usd_override, stripe_subscription_id, stripe_price_id, cancel_at_period_end'

/** Pure: the plan id in force for an organization. */
export function planIdForOrganization(input: {
  billingMode: string | null | undefined
  orgPlanId: string | null | undefined
  liveSub: { status?: string | null; plan_id?: string | null } | null | undefined
}): string {
  if (input.billingMode === 'complimentary') return input.orgPlanId ?? 'free_cloud'
  const sub = input.liveSub
  if (sub && sub.status && LIVE.has(sub.status)) return sub.plan_id ?? 'free_cloud'
  return input.orgPlanId ?? 'free_cloud'
}

/**
 * Pure: what stripe-webhooks writes to `organizations.plan_id` after a
 * subscription event. The organization's newest live subscription decides,
 * never the event alone: a late `deleted` for an old subscription must not
 * drop a team that already pays on a newer one.
 */
export function orgPlanIdFromLiveSubscription(
  liveSub: { status?: string | null; plan_id?: string | null } | null | undefined,
): string {
  if (liveSub && liveSub.status && LIVE.has(liveSub.status) && liveSub.plan_id) return liveSub.plan_id
  return 'free_cloud'
}

/** The newest live subscription of an organization. Throws on a read error. */
export async function liveOrgSubscription(db: Db, organizationId: string): Promise<OrgSubscription | null> {
  const { data, error } = await db
    .from('billing_subscriptions')
    .select(SUB_COLUMNS)
    .eq('organization_id', organizationId)
    .in('status', [...LIVE_SUBSCRIPTION_STATUSES])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`billing_subscriptions read failed: ${error.message}`)
  return (data as OrgSubscription | null) ?? null
}

/** Every app in an organization. Throws on a read error. */
export async function orgProjectIds(db: Db, organizationId: string): Promise<string[]> {
  const { data, error } = await db.from('projects').select('id').eq('organization_id', organizationId)
  if (error) throw new Error(`projects read failed: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((p) => p.id)
}

async function billingFor(
  db: Db,
  organizationId: string,
  org: { billing_mode?: string | null; plan_id?: string | null } | null,
  includeProjectIds: boolean,
): Promise<OrgBilling> {
  const [liveSub, projectIds] = await Promise.all([
    liveOrgSubscription(db, organizationId),
    includeProjectIds ? orgProjectIds(db, organizationId) : Promise.resolve([] as string[]),
  ])
  const billingMode = org?.billing_mode === 'complimentary' ? 'complimentary' : 'stripe'
  const plan = await getPlan(planIdForOrganization({ billingMode, orgPlanId: org?.plan_id, liveSub }))
  // A complimentary team has no Stripe subscription that could bill it.
  return {
    organizationId,
    billingMode,
    orgPlanId: org?.plan_id ?? null,
    plan,
    liveSub: billingMode === 'complimentary' ? null : liveSub,
    projectIds,
  }
}

/** The plan and live subscription of an organization. Throws on a read error. */
export async function resolveOrgBilling(
  db: Db,
  organizationId: string,
  opts: { includeProjectIds?: boolean } = {},
): Promise<OrgBilling> {
  const { data: org, error } = await db
    .from('organizations')
    .select('billing_mode, plan_id')
    .eq('id', organizationId)
    .maybeSingle()
  if (error) throw new Error(`organizations read failed: ${error.message}`)
  return billingFor(db, organizationId, org as { billing_mode?: string | null; plan_id?: string | null } | null, opts.includeProjectIds ?? false)
}

/** The plan an organization is on. Throws on a read error. */
export async function resolveOrgPlan(db: Db, organizationId: string): Promise<PricingPlan> {
  return (await resolveOrgBilling(db, organizationId)).plan
}

/**
 * The billing of the team that owns a project: one read maps the app to its
 * organization (with the org row embedded), then the subscription. A project
 * that cannot be found is Free and pools only itself. Throws on a read error
 * so a caller never mistakes "could not read" for the free plan.
 */
export async function resolveProjectBilling(
  db: Db,
  projectId: string,
  opts: { includeProjectIds?: boolean } = {},
): Promise<OrgBilling> {
  const { data, error } = await db
    .from('projects')
    .select('organization_id, organizations(billing_mode, plan_id)')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`projects read failed: ${error.message}`)
  const row = data as {
    organization_id?: string | null
    organizations?: { billing_mode?: string | null; plan_id?: string | null } | null
  } | null
  const organizationId = row?.organization_id ?? null
  if (!organizationId) {
    return {
      organizationId: null,
      billingMode: 'stripe',
      orgPlanId: null,
      plan: await getPlan('free_cloud'),
      liveSub: null,
      projectIds: [projectId],
    }
  }
  return billingFor(db, organizationId, row?.organizations ?? null, opts.includeProjectIds ?? false)
}

/** The organization of a project, or null. Throws on a read error. */
export async function organizationIdForProject(db: Db, projectId: string): Promise<string | null> {
  const { data, error } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`projects read failed: ${error.message}`)
  return ((data as { organization_id?: string | null } | null)?.organization_id) ?? null
}

/**
 * The organization's Stripe customer (one per team). Newest row first, in
 * case two were written before the unique index on organization_id existed.
 */
export async function orgCustomer(
  db: Db,
  organizationId: string,
): Promise<{ project_id: string; stripe_customer_id: string; default_payment_ok: boolean | null; email: string | null } | null> {
  const { data, error } = await db
    .from('billing_customers')
    .select('project_id, stripe_customer_id, default_payment_ok, email')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`billing_customers read failed: ${error.message}`)
  return (data as { project_id: string; stripe_customer_id: string; default_payment_ok: boolean | null; email: string | null } | null) ?? null
}

/**
 * Exact count of one usage event across a team's apps in [start, end). With
 * `excludeShadow`, Phase-1 shadow rows are subtracted (all − shadow:true;
 * a `not.eq.true` filter would drop rows with no shadow key, since
 * NULL <> 'true' is NULL). Counted by project id because
 * `usage_events.organization_id` is not written on insert.
 */
export async function countOrgUsage(
  db: Db,
  projectIds: string[],
  eventName: string,
  window: { startIso: string; endIso?: string },
  opts: { excludeShadow?: boolean } = {},
): Promise<{ count: number; error: { message: string } | null }> {
  if (projectIds.length === 0) return { count: 0, error: null }
  const base = () => {
    const q = db
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .eq('event_name', eventName)
      .gte('occurred_at', window.startIso)
    return window.endIso ? q.lt('occurred_at', window.endIso) : q
  }
  if (!opts.excludeShadow) {
    const r = await base()
    return { count: r.count ?? 0, error: r.error ? { message: r.error.message } : null }
  }
  const [all, shadow] = await Promise.all([base(), base().eq('metadata->>shadow', 'true')])
  const error = all.error ?? shadow.error
  return {
    count: Math.max(0, (all.count ?? 0) - (shadow.count ?? 0)),
    error: error ? { message: error.message } : null,
  }
}

/**
 * Stripe-webhooks: write the team's plan to `organizations.plan_id` from its
 * newest live subscription (Free when none). Complimentary organizations are
 * never touched, checked both on read and in the UPDATE itself. Returns the
 * plan id written or kept, or null when the organization was skipped.
 */
export async function syncOrganizationPlan(db: Db, organizationId: string): Promise<string | null> {
  const { data: org, error } = await db
    .from('organizations')
    .select('billing_mode, plan_id')
    .eq('id', organizationId)
    .maybeSingle()
  if (error) throw new Error(`organizations read failed: ${error.message}`)
  const row = org as { billing_mode?: string | null; plan_id?: string | null } | null
  if (!row || row.billing_mode !== 'stripe') return null
  const planId = orgPlanIdFromLiveSubscription(await liveOrgSubscription(db, organizationId))
  if (row.plan_id === planId) return planId
  const { error: upErr } = await db
    .from('organizations')
    .update({ plan_id: planId, updated_at: new Date().toISOString() })
    .eq('id', organizationId)
    .eq('billing_mode', 'stripe')
  if (upErr) throw new Error(`organizations plan update failed: ${upErr.message}`)
  return planId
}

/**
 * Before an app is deleted: the team's subscription and customer rows name
 * the app they were bought from, and both cascade on delete. Move them to
 * another app in the team so the plan, the portal, invoices and overage
 * metering survive. Returns 'last_app_pays' when this is the team's last app
 * and the team still pays (the caller refuses the delete: cancel first).
 */
export async function moveBillingAnchors(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<'moved' | 'nothing_to_move' | 'last_app_pays'> {
  const [subsRes, custRes, otherRes] = await Promise.all([
    db.from('billing_subscriptions').select('status').eq('project_id', projectId),
    db.from('billing_customers').select('project_id').eq('project_id', projectId),
    db
      .from('projects')
      .select('id')
      .eq('organization_id', organizationId)
      .neq('id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  for (const r of [subsRes, custRes, otherRes]) {
    if (r.error) throw new Error(`billing anchor read failed: ${r.error.message}`)
  }
  const subs = (subsRes.data ?? []) as Array<{ status: string }>
  const customers = (custRes.data ?? []) as Array<{ project_id: string }>
  if (subs.length === 0 && customers.length === 0) return 'nothing_to_move'
  const otherId = (otherRes.data as { id?: string } | null)?.id ?? null
  if (!otherId) return subs.some((s) => LIVE.has(s.status)) ? 'last_app_pays' : 'nothing_to_move'
  if (subs.length > 0) {
    const { error } = await db
      .from('billing_subscriptions')
      .update({ project_id: otherId, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('organization_id', organizationId)
    if (error) throw new Error(`billing_subscriptions anchor move failed: ${error.message}`)
  }
  if (customers.length > 0) {
    const { error } = await db
      .from('billing_customers')
      .update({ project_id: otherId, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('organization_id', organizationId)
    if (error) throw new Error(`billing_customers anchor move failed: ${error.message}`)
  }
  return 'moved'
}
