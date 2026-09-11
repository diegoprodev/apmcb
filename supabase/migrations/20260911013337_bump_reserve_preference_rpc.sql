-- SP2 Task 9 — bump_reserve_preference: upsert que INCREMENTA selection_count.
-- O upsert do BFF (routes/reserves.ts, POST /switch/:id) gravava
-- selection_count: 1 fixo em toda troca — nunca incrementava. O resolvedor de
-- reserva ativa (lib/active-reserve.ts, resolveDefaultActiveReserve) ordena
-- por selection_count depois last_selected_at; sem incremento real, o
-- ranking degradava pra MRU puro (a ordenação por frequência nunca acontecia).
--
-- ROLLBACK: DROP FUNCTION public.bump_reserve_preference(uuid, uuid);

CREATE OR REPLACE FUNCTION public.bump_reserve_preference(p_user_id uuid, p_reserve_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.user_reserve_preferences (user_id, reserve_id, selection_count, last_selected_at)
  VALUES (p_user_id, p_reserve_id, 1, now())
  ON CONFLICT (user_id, reserve_id)
  DO UPDATE SET selection_count = public.user_reserve_preferences.selection_count + 1,
                last_selected_at = now();
$$;

-- Só o BFF (service_role) chama — nunca authenticated/anon direto (o BFF já
-- valida a membership antes de chamar, no POST /switch/:id).
REVOKE EXECUTE ON FUNCTION public.bump_reserve_preference(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_reserve_preference(uuid, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_reserve_preference(uuid, uuid) TO service_role;
