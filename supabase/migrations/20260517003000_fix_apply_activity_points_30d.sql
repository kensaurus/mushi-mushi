-- Fix: apply_activity_points trigger was not updating points_30d on conflict.
-- Only total_points and points_lifetime were incremented; points_30d was set
-- only on the initial INSERT row (correct) but stayed stale on subsequent
-- activity inserts for the same user.
CREATE OR REPLACE FUNCTION private.apply_activity_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.end_user_points
    (end_user_id, organization_id, total_points, points_30d, points_lifetime)
  VALUES
    (NEW.end_user_id, NEW.organization_id,
     GREATEST(0, NEW.points_awarded),
     GREATEST(0, NEW.points_awarded),
     GREATEST(0, NEW.points_awarded))
  ON CONFLICT (end_user_id) DO UPDATE
    SET total_points    = GREATEST(0, end_user_points.total_points + NEW.points_awarded),
        points_30d      = end_user_points.points_30d + GREATEST(0, NEW.points_awarded),
        points_lifetime = end_user_points.points_lifetime + GREATEST(0, NEW.points_awarded),
        updated_at      = now();

  UPDATE public.end_users
    SET last_seen_at = now(),
        updated_at   = now()
  WHERE id = NEW.end_user_id
    AND (last_seen_at IS NULL OR last_seen_at < now() - INTERVAL '5 minutes');

  RETURN NEW;
END;
$$;
