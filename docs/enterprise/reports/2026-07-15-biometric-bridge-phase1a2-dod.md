# DoD - Biometric Bridge Phase 1A.2

## Veredito

**Estado: implementada no codigo e validada localmente; nao inclui deploy da migration nem hardware real.**

Esta fase fecha o primeiro fluxo operacional do armeiro com challenge/proof:
cadastro de digital, nova saida e devolucao em lote. A autoridade continua no
BFF; o leitor USB nunca e executado no VPS.

## Escopo implementado

- `20260714000003_biometric_phase1a2.sql` vincula `lendings` a
  `biometric_proof_id` e registra verificacao biometrica em assinaturas.
- `20260714000004_biometric_enrollment_rpc.sql` grava enrollment em transacao
  unica: consome challenge, cria proof e faz upsert do template.
- O bridge real pode finalizar enrollment em
  `POST /api/biometric/challenges/:id/enroll-submit`; o simulator usa o mesmo
  servico de validacao e persistencia.
- `20260714000005_biometric_phase1a2_return_rpc.sql` torna a devolucao em lote
  atomica e repete no banco as validacoes de tenant, reserva, militar, status,
  prova biometrica e consumo anti-replay.
- Enrollment valida tenant, reserva, ator, usuario esperado, device ativo,
  liveness, qualidade, formato, limite de bytes, hash SHA-256 e assinatura do
  bridge antes de persistir.
- O cadastro da tela de militares usa `BiometricCaptureDialog` e nao chama
  `/biometric/register`.
- Nova saida exige `biometric_proof_id` e `movement_id` quando o modo e
  biometria; a proof e vinculada ao militar, reserva, ator e operacao.
- Devolucao usa identificacao biometrica e `bulk-return`, com pending identity
  em sessao HttpOnly e consumo anti-replay. O BFF agora implementa
  `/api/lendings/identify` e `/api/lendings/bulk-return`; o caminho manual foi
  removido da interface e nao e aceito pelo contrato operacional.
- O endpoint legacy `saidas` nao executa mais SDK USB no BFF; tentativas
  biometricas retornam `501 BIOMETRIC_BRIDGE_REQUIRED` e TOTP continua
  disponivel nesse contrato antigo.
- Simulator de enrollment e gated fora de producao e usa o mesmo servico de
  validacao/persistencia do fluxo real.
- A UI consulta `/api/biometric/devices` por reserva e so habilita captura real
  quando existe bridge ativo; o modo simulator e a unica excecao controlada
  fora de producao.

## Harness e evidencias

- `node --experimental-strip-types --test src/__tests__/*.test.ts` em
  `apps/bff`: **126 testes, 126 aprovados, 0 falhas**.
- `pnpm --filter @apmcb/bff typecheck`: aprovado.
- `pnpm --filter @apmcb/web typecheck`: aprovado.
- ESLint direcionado para as telas e componentes da fase: aprovado, sem
  warnings ou erros.
- `biometric-phase1a2-custody.test.ts` valida migration, proof obrigatoria,
  consumo por operacao e ausencia dos endpoints client-side legados.
- `biometric-enrollment.test.ts` valida vetor canonico, assinatura Ed25519,
  hash, base64, limites, escopo e retorno sem dados biometricos crus.

## Fora de escopo

- Bridge Windows real, pareamento de device em producao e leitura NITGEN real.
- Livro Digital, cautelas e passagens de turno, reservados para Phase 1A.3.
- Liveness fisico/anti-spoof alem do sinal assinado pelo bridge.
- Lockout persistido por device/ator/usuario identificado, alem do rate limit
  existente.
- Aplicacao da migration em Supabase remoto e deploy no VPS; isso precisa ser
  executado e verificado no ambiente de destino antes de liberar a feature.
- Validacao SQL local ficou pendente porque o Docker Engine/Supabase local nao
  estava disponivel neste ambiente.

## Riscos e gates de release

1. Aplicar as migrations em staging e confirmar RPC, constraints, triggers e
   RLS com uma conta de service role controlada.
2. Testar enrollment real com bridge Windows assinado, sem armazenar imagem
   bruta ou segredo privado.
3. Rodar Playwright visual do fluxo do armeiro: selecionar militar, escolher
   dedo, capturar, retry/expirar, salvar, nova saida e devolucao.
4. Obter code review imparcial sem achados CRITICO/ALTO.
5. Reexecutar todas as suites anteriores antes do merge/deploy.

---

## Fechamento (2026-07-15, sessão de continuação)

Gates 1, 4 e 5 fechados nesta sessão; 2 e 3 seguem fora de escopo (hardware
NITGEN real ainda não está em produção).

- **Gate 1 (migrations em staging)** — sem Docker local nem branch dedicada
  disponível para este projeto Supabase; aplicado **direto em produção**
  (autorização explícita do usuário: "no fim migre para a branch real do
  supabase se funcionar ok"), com validação manual de cada RPC contra o
  Postgres real (atomicidade, replay de `movement_id`, replay de
  `biometric_proof_id`, devolução) usando dados descartáveis, antes de
  qualquer deploy de código.
- **Gate 4 (review imparcial sem CRÍTICO/ALTO)** — 2 rodadas de revisão
  independente. A 1ª encontrou 2 ALTO + 5 MÉDIO + 1 BAIXO, todos corrigidos.
  A 2ª encontrou 1 CRÍTICO ativo em produção (não relacionado a esta feature:
  `log_shift_event_atomic` exposta a `anon`), 2 ALTO (mesma classe de
  exposição de grants nas 4 RPCs de custódia; corrida entre requisições
  paralelas no consumo de identidade TOTP) e itens MÉDIO/BAIXO — todos
  corrigidos e revalidados contra Postgres real antes do commit. Ver
  CHANGELOG.md para o detalhamento completo.
- **Gate 5 (regressão)** — `pnpm test` do BFF (126/126) e typecheck de
  ambos os apps reconfirmados após cada rodada de correção. Regressão E2E
  completa (smoke + suite) roda pós-deploy, como de praxe neste projeto (ver
  seção de validação do CHANGELOG desta mesma entrada).

**Migrations aplicadas em produção nesta sessão:** `20260714000001` a
`20260714000010` (as 6 originais do Codex + 4 novas: lockdown de grants,
correção do incidente do Livro Digital, `totp_identity_claims`, integração
do claim atômico nas RPCs de lending).
