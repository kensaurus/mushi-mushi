-- New personal workspaces start on the active free plan.
--
-- private.bootstrap_personal_org inserted plan_id 'hobby', a retired plan
-- (pricing_plans.active = false) with the same limits as 'free_cloud', the
-- column default and the plan the pricing page sells. A new account then read
-- "Hobby is solo-only" on Team. Same body; only the plan id changes.

CREATE OR REPLACE FUNCTION private.bootstrap_personal_org(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing uuid;
  v_org_id   uuid;
  v_slug     text;
  v_attempt  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_personal_org: user_id required'
      USING errcode = 'P0001';
  END IF;

  SELECT id INTO v_existing
  FROM public.organizations
  WHERE owner_id = p_user_id
    AND is_personal = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    INSERT INTO public.organization_members(
      organization_id, user_id, role, joined_via, last_active_at
    )
    VALUES (v_existing, p_user_id, 'owner', 'personal_backfill', now())
    ON CONFLICT (organization_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();
    RETURN v_existing;
  END IF;

  v_slug := 'personal-' || substr(p_user_id::text, 1, 8);

  LOOP
    BEGIN
      INSERT INTO public.organizations (slug, name, owner_id, plan_id, is_personal)
      VALUES (v_slug, 'Personal workspace', p_user_id, 'free_cloud', true)
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        IF v_attempt > 5 THEN
          RAISE EXCEPTION 'bootstrap_personal_org: slug allocation failed for %', p_user_id
            USING errcode = 'P0001';
        END IF;
        v_slug := 'personal-' || substr(p_user_id::text, 1, 8) || '-'
                  || lpad(to_hex((random() * 65535)::int), 4, '0');
    END;
  END LOOP;

  INSERT INTO public.organization_members (
    organization_id, user_id, role, joined_via, last_active_at
  )
  VALUES (v_org_id, p_user_id, 'owner', 'personal_backfill', now())
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = 'owner', updated_at = now();

  RETURN v_org_id;
END;
$function$;
