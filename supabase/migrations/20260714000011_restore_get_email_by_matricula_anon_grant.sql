-- CORREÇÃO DE REGRESSÃO (2026-07-15, mesma sessão de deploy): a migration
-- 20260714000008_emergency_lockdown_exposed_functions revogou EXECUTE de
-- anon/authenticated em get_email_by_matricula partindo do pressuposto de
-- que só o BFF a chamava (via service_role). Isso estava ERRADO: o login
-- (apps/web/src/app/login/page.tsx) chama essa RPC DIRETO do navegador com
-- a anon key para resolver matrícula->email antes de signInWithPassword —
-- quebrou o login de TODOS os usuários em produção por alguns minutos,
-- detectado e corrigido na mesma sessão via validação visual real (Playwright
-- contra produção) antes de declarar a tarefa concluída.
--
-- Restaurando o grant. A exposição a anon é aceitável aqui: a função só
-- resolve matrícula->email (não é PII sensível como senha/CPF/template
-- biométrico) e é necessária para o fluxo de login funcionar antes de haver
-- sessão.
grant execute on function public.get_email_by_matricula(text)
  to anon, authenticated;
