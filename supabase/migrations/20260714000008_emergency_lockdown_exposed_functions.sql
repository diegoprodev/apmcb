-- INCIDENTE DE SEGURANÇA ATIVO (2026-07-15) — não relacionado à Biometric
-- Bridge, descoberto durante a auditoria de grants dessa fase: várias
-- funções SECURITY DEFINER pré-existentes estavam com EXECUTE aberto para
-- anon/authenticated desde sua criação, pela mesma causa raiz (este projeto
-- Supabase concede EXECUTE a anon/authenticated/service_role em toda função
-- nova via ALTER DEFAULT PRIVILEGES; revoke apenas "from public" não atinge
-- esses grants diretos a papéis nomeados).
--
-- MAIS GRAVE: log_shift_event_atomic (grava o Livro Digital de Serviço com
-- encadeamento de hash, SEM nenhuma checagem de autorização interna — confia
-- inteiramente em ser chamada só pelo BFF com service_role) estava chamável
-- por QUALQUER cliente com a anon key pública (embutida no bundle do
-- frontend), permitindo forjar eventos no livro digital com hash que
-- encadeia corretamente e actor_id arbitrário (impersonação). Isso ataca
-- diretamente a garantia de tamper-evidence do sistema de custódia.
--
-- Também fechado por excesso de exposição (menor impacto, mesma causa raiz):
-- get_email_by_matricula (permitia colher e-mails reais de militares sem
-- autenticação — lista de alvos de phishing) e expire_material_requests
-- (baixo impacto, mas sem motivo funcional para estar aberta).
--
-- E os 2 triggers da Biometric Bridge que a migration 20260714000007 tentou
-- fechar mas usou "from anon, authenticated" sem "from public" — grant a
-- PUBLIC não é revogado por revoke de papel nomeado (todo papel é membro
-- implícito de PUBLIC).
--
-- Varredura completa confirmou: nenhuma outra função SECURITY DEFINER com
-- tipo de retorno chamável (excluindo trigger/event_trigger, que o Postgres
-- já recusa invocar fora do contexto de trigger) ficou exposta além destas.
-- auth_role/auth_tenant_id/my_tenant_id/auth_admin_reserve_ids são usadas
-- dentro de políticas RLS em todo o banco — permanecem intencionalmente
-- expostas (revogar quebraria toda a aplicação). has_totp() é escopada por
-- auth.uid() (só revela o próprio status do chamador) — seguro.

revoke execute on function public.log_shift_event_atomic(
  uuid, uuid, uuid, text, text, uuid, uuid, text, text, jsonb, boolean
) from public, anon, authenticated;

revoke execute on function public.get_email_by_matricula(text)
  from public, anon, authenticated;

revoke execute on function public.expire_material_requests()
  from public, anon, authenticated;

revoke execute on function public.assert_biometric_bridge_scope()
  from public, anon, authenticated;

revoke execute on function public.assert_biometric_proof_consumption_scope()
  from public, anon, authenticated;
