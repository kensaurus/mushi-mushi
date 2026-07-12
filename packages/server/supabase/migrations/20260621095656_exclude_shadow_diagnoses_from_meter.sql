-- Migration: 20260621050000_exclude_shadow_diagnoses_from_meter.sql
-- PURPOSE: Keep Phase-1 shadow diagnoses rows (metadata.shadow=true) out of the
--   Stripe usage meter. classify-report writes a shadow `diagnoses` usage_event
--   on every completed Stage-2 classification so we can validate quota sizing on
--   real traffic before Phase-2 metered billing. Those shadow rows must NEVER be
--   billed, so the unsynced-usage summary the usage-aggregator reports to Stripe
--   filters them out.
--
-- This patches public.billing_usage_unsynced_summary (originally defined in
-- 20260418001800_billing.sql) to add the shadow filter. Idempotent via
-- CREATE OR REPLACE. Mirrors the same filter quota.ts applies when counting.
--
-- NOTE: this file reconciles a migration that was first applied directly to the
-- remote (project dxptnwrhwsqckaftyymj) so `supabase db reset` / fresh deploys
-- reproduce the exact remote definition.

CREATE OR REPLACE FUNCTION public.billing_usage_unsynced_summary(p_event_name text)
 RETURNS TABLE(project_id uuid, day_utc date, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT project_id,
         (occurred_at AT TIME ZONE 'UTC')::date AS day_utc,
         SUM(quantity)::bigint AS total
  FROM usage_events
  WHERE event_name = p_event_name
    AND meter_synced_at IS NULL
    -- Exclude Phase-1 shadow rows (diagnoses only; other event types never set this flag).
    AND COALESCE(metadata->>'shadow', 'false') != 'true'
  GROUP BY 1, 2
  ORDER BY 1, 2
$function$;
