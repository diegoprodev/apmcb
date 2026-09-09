-- ═══════════════════════════════════════════════════════════════════
-- profiles.account_activated_at: backfill único + endurecimento do trigger.
--
-- Duas partes nesta migration:
--   1. UPDATE de backfill (contas que já logavam antes do trigger).
--   2. CREATE OR REPLACE do trigger handle_user_first_login para que
--      qualquer login futuro conserte uma conta ainda sem o carimbo.
--
-- Bug real de produção (profile 000003 "Cadete Teste", relato do usuário,
-- 2026-09-08): o card em /admin/usuarios e /reserva/militares mostrava o
-- badge "Sem acesso" para uma conta que loga todos os dias
-- (auth.users.last_sign_in_at recente), porque account_activated_at era
-- NULL. Esse timestamp só é gravado pelo trigger on_first_login, que
-- dispara APENAS na transição last_sign_in_at NULL -> não-NULL. Toda conta
-- cujo primeiro login ocorreu antes de 2026-06-17 nunca teve o trigger
-- executado e carrega account_activated_at NULL para sempre.
--
-- Correção: para cada profile sem account_activated_at cujo auth.users já
-- registra um last_sign_in_at, copiar last_sign_in_at (melhor aproximação
-- disponível da "ativação" — é o único carimbo de login que o GoTrue
-- mantém). Roda uma única vez, aqui — não é um caso recorrente (o trigger
-- cobre daqui pra frente).
--
-- Idempotente: o predicado `account_activated_at IS NULL` faz uma segunda
-- execução não tocar nada.
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.profiles p
   SET account_activated_at = u.last_sign_in_at
  FROM auth.users u
 WHERE p.id = u.id
   AND p.account_activated_at IS NULL
   AND u.last_sign_in_at IS NOT NULL;

-- ─── Endurecimento do trigger (self-heal daqui pra frente) ─────────────
-- O trigger original (20260617000003) só grava account_activated_at na
-- transição last_sign_in_at NULL -> não-NULL. Uma conta pré-trigger que o
-- backfill acima não cobriu (ex: nunca logou até hoje, loga pela 1ª vez
-- amanhã com last_sign_in_at já não-NULL de antes) continuaria sem o
-- carimbo. Trocamos a condição para "houve login novo E o profile ainda
-- não tem o carimbo": qualquer login posterior a esta migration conserta a
-- conta sozinho. Continua idempotente (o predicado account_activated_at IS
-- NULL) e não regride quem já tem o valor.
CREATE OR REPLACE FUNCTION public.handle_user_first_login()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_sign_in_at IS NOT NULL
     AND NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.profiles
    SET account_activated_at = NEW.last_sign_in_at
    WHERE id = NEW.id AND account_activated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-emite o trigger de forma idempotente (mesmo bloco de 20260617000003) —
-- se algum ambiente tiver perdido o trigger (drop manual, restore parcial),
-- esta migration o reata.
DROP TRIGGER IF EXISTS on_first_login ON auth.users;
CREATE TRIGGER on_first_login
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_first_login();

-- ─── ROLLBACK (aplicar manualmente se necessário) ──────────────────────
-- Trigger: restaurar a condição original (transição estrita NULL -> não-NULL):
--
-- CREATE OR REPLACE FUNCTION public.handle_user_first_login()
-- RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF NEW.last_sign_in_at IS NOT NULL AND OLD.last_sign_in_at IS NULL THEN
--     UPDATE public.profiles
--     SET account_activated_at = NEW.last_sign_in_at
--     WHERE id = NEW.id AND account_activated_at IS NULL;
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- Backfill:
-- Não há reversão perfeita por linha: depois desta migration, o trigger
-- on_first_login e o fluxo normal também gravam account_activated_at, e
-- não guardamos marca de "foi o backfill". A reversão abaixo zera TODOS os
-- profiles cujo account_activated_at é exatamente igual ao last_sign_in_at
-- atual do auth.users — o que inclui tanto os backfilled quanto os que o
-- trigger gravou com esse mesmo valor. Só executar se esta migration foi
-- aplicada isoladamente e nenhum novo primeiro-login ocorreu depois.
--
-- UPDATE public.profiles p
--    SET account_activated_at = NULL
--   FROM auth.users u
--  WHERE p.id = u.id
--    AND p.account_activated_at IS NOT NULL
--    AND p.account_activated_at = u.last_sign_in_at;
