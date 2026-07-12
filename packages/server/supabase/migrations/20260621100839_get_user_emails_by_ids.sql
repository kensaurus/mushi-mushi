CREATE OR REPLACE FUNCTION public.get_user_emails_by_ids(p_user_ids uuid[])
RETURNS TABLE(id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email FROM auth.users WHERE id = ANY(p_user_ids);
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM PUBLIC, anon, authenticated;;
