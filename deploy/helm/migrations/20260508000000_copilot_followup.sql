-- ============================================================
-- Copilot review follow-up — May 7 wave.
--
-- Bundles three tightly-related fixes called out by the Copilot
-- review on PR #91 against migrations 20260507000000 /
-- 20260507000200 / 20260507120000 (already applied to prod, so
-- amending them in place would create drift across environments
-- that have already migrated). Bundling them into one tail
-- migration keeps the PR's review surface small while leaving an
-- audit trail of *why* each fix landed late.
--
--  (1) `set_support_tickets_updated_at()` did not stamp
--      `admin_responded_at` when an operator wrote `admin_response`,
--      so the customer-facing "replied · 2h ago" timestamp would
--      stay NULL unless every code path remembered to set the
--      column manually. Operators were also able to clear an
--      admin response, in which case the timestamp would be
--      stale. Trigger now mirrors `cancelled_at`/`resolved_at`:
--      stamps on transition (NULL → set or text changed),
--      clears on transition (set → NULL).
--
--  (2) Schema cache reload — three structural migrations
--      shipped on 2026-05-07 (organizations.billing_mode,
--      support_tickets columns, reports SDK observability
--      columns). The supabase-js layer reads the new columns
--      immediately, so PostgREST's per-instance schema cache can
--      serve "column does not exist" 400s for the first request
--      window after a fresh self-host migration run. We follow
--      the repo convention (cf. 20260429000000_sdk_versions.sql,
--      20260430000000_two_way_reply.sql) of issuing
--      `NOTIFY pgrst, 'reload schema|config'` on every
--      schema-shape change so PostgREST drops its cache the
--      moment the migration commits.
--
--  (3) (Documentation only) The header of
--      20260507120000_sdk_observability_columns.sql claimed its
--      indexes were "CONCURRENTLY-friendly via CREATE INDEX
--      IF NOT EXISTS". That's misleading — `CREATE INDEX
--      CONCURRENTLY` can't run inside the migration transaction
--      Supabase wraps DDL in, and `IF NOT EXISTS` doesn't lift
--      the table-write-lock. We don't repair the comment in
--      the applied file (would only churn replay output for
--      self-hosters who already ran it); future migrations that
--      need true concurrent index builds will use a separate
--      out-of-transaction migration following the standard
--      Postgres pattern.
-- ============================================================

CREATE OR REPLACE FUNCTION set_support_tickets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();

  -- Stamp resolved_at on first transition into a closed status.
  IF NEW.status IN ('resolved', 'closed')
     AND OLD.status NOT IN ('resolved', 'closed')
     AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at = now();
  END IF;

  -- Stamp cancelled_at on first transition into 'cancelled'.
  IF NEW.status = 'cancelled'
     AND OLD.status <> 'cancelled'
     AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at = now();
  END IF;

  -- Stamp admin_responded_at whenever admin_response is *added* or
  -- *changed*. Mirrors the cancelled_at / resolved_at pattern: we
  -- write IS DISTINCT FROM (rather than `<>`) so a NULL → text
  -- transition (the most common case — first-time reply) and a
  -- text → text edit both refresh the timestamp. We don't refresh
  -- on no-op writes where the response text is byte-identical.
  --
  -- When admin_response is *cleared* (text → NULL), we also clear
  -- admin_responded_at so the customer UI doesn't render a "replied
  -- · 2h ago" pill pointing at a now-empty response. UPDATE … SET
  -- admin_response = NULL is the only path that should produce that
  -- state and it's vanishingly rare in practice.
  IF NEW.admin_response IS DISTINCT FROM OLD.admin_response THEN
    IF NEW.admin_response IS NULL THEN
      NEW.admin_responded_at = NULL;
    ELSE
      NEW.admin_responded_at = now();
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- Schema cache reload (PostgREST). Idempotent — running twice is a
-- no-op aside from a few wasted bytes on the wire.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
