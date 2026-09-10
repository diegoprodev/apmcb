-- ═══════════════════════════════════════════════════════════════════
-- SP1 — guard de backfill de `active_reserve_id`.
-- Pós clean-slate as contas de sistema são superadmin/admin_global → matriz
-- (active_reserve_id NULL, resolvido no login por resolveDefaultActiveReserve).
-- Nada a preencher. Esta migração só ALERTA se surgir uma conta staff
-- (admin_reserva/armeiro/usuario) COM membership e SEM active_reserve_id — o
-- login vai resolver o default, mas convém conferir.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.profiles p
  WHERE p.role IN ('admin_reserva', 'armeiro', 'usuario')
    AND p.active_reserve_id IS NULL
    AND EXISTS (SELECT 1 FROM public.reserve_memberships m WHERE m.user_id = p.id);
  IF n > 0 THEN
    RAISE WARNING 'reserva/SP1: % conta(s) staff com membership e sem active_reserve_id — o login resolve o default, mas confira', n;
  END IF;
END $$;
