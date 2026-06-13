-- RPC: resolve matricula → email for login page
-- SECURITY DEFINER so it can read auth.users without exposing the table

CREATE OR REPLACE FUNCTION public.get_email_by_matricula(p_matricula text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.matricula = p_matricula
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

-- Allow anon to call it (needed from login page before auth)
GRANT EXECUTE ON FUNCTION public.get_email_by_matricula(text) TO anon, authenticated;
