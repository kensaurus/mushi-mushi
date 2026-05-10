-- ============================================================
-- Super-admin role + read-only user directory view.
--
-- Why this exists: there's no way for the operator (kensaurus@gmail.com)
-- to see who has signed up, what plan they are on, or how active they
-- are. The admin console runs *inside* the customer's tenant — it shows
-- one project's data, never cross-tenant. This migration introduces a
-- single super-admin role stored in `auth.users.raw_app_meta_data.role`
-- and a corresponding read-only view that joins:
--
--   - auth.users           (signup info, last sign-in)
--   - public.projects      (project ownership)
--   - billing_subscriptions(active plan)
--   - public.reports       (last-30d activity)
--
-- Why a view (not RLS on each table): the per-row joins span
-- `auth.users`, which a plain authenticated JWT cannot read. The view
-- is owned by `postgres` and exposed only to the service role; the
-- `requireSuperAdmin` middleware in the gateway is the access boundary,
-- not RLS. We explicitly REVOKE from `anon` and `authenticated` so a
-- direct anon-key fetch of this view returns 0 rows.
--
-- Why not a SECURITY DEFINER function: views compose with PostgREST
-- pagination/filtering for free, while a function would force us to
-- re-implement search and filtering server-side. The trade-off is that
-- the view's query plan runs as the *invoker* (the service role here),
-- which is exactly what we want.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Promote the operator's account.
--
-- Using a CASE merge so we don't clobber any other app_metadata
-- the user already has (e.g. signup_plan).
-- ----------------------------------------------------------------
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('role', 'super_admin')
 where email = 'kensaurus@gmail.com';

-- ----------------------------------------------------------------
-- 2. Read-only directory view.
--
-- The four correlated sub-selects are all index-backed:
--   - projects(owner_id)              from owner_id index
--   - billing_subscriptions(project_id, status) from idx_billing_subs_project
--   - reports(project_id, created_at) from idx_reports_created
--
-- We do NOT use a CTE because the `current_plan` lookup needs the
-- per-row LIMIT 1 ordered by created_at — easier to reason about as a
-- correlated subquery than a window function with CTE materialization.
-- ----------------------------------------------------------------
create or replace view public.super_admin_user_directory as
  select u.id                                           as user_id,
         u.email,
         u.created_at                                   as signed_up_at,
         u.last_sign_in_at,
         u.raw_user_meta_data->>'signup_plan'           as signup_plan,
         coalesce(u.raw_app_meta_data->>'role', 'user') as role,
         (select count(*)::int
            from public.projects p
           where p.owner_id = u.id)                     as project_count,
         (select bs.plan_id
            from public.billing_subscriptions bs
            join public.projects p on p.id = bs.project_id
           where p.owner_id = u.id
             and bs.status in ('active','trialing','past_due')
           order by bs.created_at desc
           limit 1)                                     as current_plan,
         (select count(*)::int
            from public.reports r
            join public.projects p on p.id = r.project_id
           where p.owner_id = u.id
             and r.created_at > now() - interval '30 days') as reports_last_30d,
         (select max(r.created_at)
            from public.reports r
            join public.projects p on p.id = r.project_id
           where p.owner_id = u.id)                     as last_report_at
    from auth.users u;

-- ----------------------------------------------------------------
-- 3. Lock the view down. Service role is the only legitimate caller
--    (the gateway's `requireSuperAdmin` middleware uses the service
--    client). `anon` and `authenticated` can never read it.
-- ----------------------------------------------------------------
revoke all on public.super_admin_user_directory from anon, authenticated, public;
grant select on public.super_admin_user_directory to service_role;

comment on view public.super_admin_user_directory is
  'Read-only operator directory. Service-role only. Read via the gateway requireSuperAdmin middleware.';

-- ----------------------------------------------------------------
-- 4. Aggregate metrics view (called by GET /v1/super-admin/metrics).
--
-- Single-row view → cheap to query and idempotent. MRR is approximated
-- from `pricing_plans.monthly_price_usd` × paid subscriptions, which
-- matches what Stripe shows in dashboard for flat-fee plans. Usage
-- overages are NOT included here; pull from Stripe directly when you
-- need exact billed amounts.
-- ----------------------------------------------------------------
create or replace view public.super_admin_metrics as
  with
    sub_user_count as (
      select count(distinct p.owner_id)::int as paid_users,
             coalesce(sum(pp.monthly_price_usd), 0)::int as mrr_usd
        from public.billing_subscriptions bs
        join public.projects p          on p.id = bs.project_id
        join public.pricing_plans pp    on pp.id = bs.plan_id
       where bs.status in ('active','trialing','past_due')
         and pp.id <> 'hobby'
    ),
    user_counts as (
      select count(*)::int                                       as total_users,
             count(*) filter (where created_at > now() - interval '7 days')::int  as signups_last_7d,
             count(*) filter (where created_at > now() - interval '30 days')::int as signups_last_30d
        from auth.users
    ),
    churn as (
      select count(distinct project_id)::int as churn_last_30d
        from public.billing_subscriptions
       where status = 'canceled'
         and updated_at > now() - interval '30 days'
    )
  select uc.total_users,
         suc.paid_users,
         suc.mrr_usd,
         uc.signups_last_7d,
         uc.signups_last_30d,
         c.churn_last_30d
    from user_counts uc, sub_user_count suc, churn c;

revoke all on public.super_admin_metrics from anon, authenticated, public;
grant select on public.super_admin_metrics to service_role;

comment on view public.super_admin_metrics is
  'Aggregate operator metrics (MRR, signups, churn). Service-role only.';
