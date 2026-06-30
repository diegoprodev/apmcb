-- Fix: migration 20260629000002 fez DROP+CREATE sem security_invoker, desfazendo 20260629000007.
-- ALTER VIEW preserva definição e apenas ativa a opção sem recriar a view.
ALTER VIEW public.material_availability SET (security_invoker = on);
