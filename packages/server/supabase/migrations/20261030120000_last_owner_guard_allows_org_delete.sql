-- The last-owner guard blocked deleting a whole organization.
--
-- Deleting an organization cascades to organization_members, and the guard
-- refused to remove its last owner ("cannot_remove_last_owner"), so the
-- delete failed. The synthetic-account sweep (retention-sweep,
-- _shared/fresh-eyes-cleanup.ts) could therefore delete an expired test
-- account's projects but never its organization or the account itself:
-- every expired account stayed (live, 2026-10-30, 9 failures in one sweep).
--
-- The guard still stops a member row from leaving an organization with no
-- owner. It steps aside only when the organization itself is gone, which is
-- what a cascade from deleting it looks like by the time its member rows go.

CREATE OR REPLACE FUNCTION public.guard_last_organization_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_owner_count int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
    OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN
    -- The organization is being deleted: its members go with it.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    SELECT count(*)
      INTO v_owner_count
    FROM public.organization_members
    WHERE organization_id = OLD.organization_id
      AND role = 'owner';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner' USING errcode = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
