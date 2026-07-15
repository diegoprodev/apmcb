# DoD - Biometric Bridge Phase 1A.1

## Escopo entregue

- Migration `20260714000002_biometric_phase1a1.sql`.
- `biometric_devices.is_simulator` e `biometric_proof_consumptions` com
  `unique(proof_id)`.
- Helpers `assertUsableBiometricProof` e `consumeBiometricProof`.
- RPC `record_biometric_proof` para gravar proof e consumir challenge em
  transacao unica.
- Endpoint `GET /api/biometric/challenges/:id/result`.
- Simulator BFF registrado apenas fora de producao e com
  `BIOMETRIC_SIMULATOR_ENABLED=true`.
- Console `/reserva/biometria` para identificacao 1:N pelo armeiro.
- Seletor de reserva para `admin_global`; memberships para `admin_reserva` e
  `armeiro`.
- Componentes `BiometricBridgeStatus` e `BiometricCaptureDialog`.
- Card do painel `/reserva` atualizado para o console bridge.

## Fora de escopo preservado

- SDK/hardware real NITGEN no bridge Windows.
- Enrollment definitivo.
- Saida, devolucao, cautela, livro digital e passagem usando `proof_id`.
- Alteracoes em fluxo de efetivo/livro fora do escopo da biometria.

## Evidencias de validacao

- `cd apps/bff && pnpm test`: aprovado, 112 testes, 0 falhas.
- `pnpm --filter bff typecheck`: aprovado.
- `pnpm --filter web typecheck`: aprovado.
- `pnpm --filter web build`: aprovado.
- `pnpm --filter web exec eslint ...arquivos-da-tarefa`: aprovado sem erros.
- `pnpm --filter web lint -- --quiet`: reprovado por 5 erros pre-existentes
  fora do escopo:
  - `apps/web/src/app/(dashboard)/efetivo/_materiais-uso-client.tsx`
  - `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx`

## Harness especifico

- Teste estatico valida migration, simulator flag, consumo unico de proof e
  RLS em `biometric_proof_consumptions`.
- Teste estatico valida que simulator so e registrado condicionalmente e que
  `/devices/pair` nao aceita `is_simulator`.
- Teste unitario valida `assertUsableBiometricProof` contra tenant, reserva,
  actor, purpose, usuario esperado, documento, expiracao, replay e failure.
- Teste unitario valida `consumeBiometricProof` inserindo consumo e convertendo
  `23505` em replay.
- Harness valida que submit de proof usa RPC atomica em vez de update+insert
  separados.
- Teste estatico valida UI sem `localhost`, sem endpoint `/biometric/*` sem
  `/api`, com `friendlyApiError`, `bffFetch`, estados e `data-testid`.

## Riscos residuais

- Console usa simulator apenas para validacao; hardware real depende da fase de
  bridge Windows.
- Fluxos de custodia fisica ainda nao devem aceitar biometria como assinatura
  ate Phase 1A.2/1A.3.
- Liveness/LFD continua dependente da capacidade real do leitor/SDK instalado em
  cada reserva.

## Code review

- Review imparcial 1: nota 8.2/10, sem CRITICAL/HIGH; apontou MEDIUM sobre
  consumo unico ainda nao amarrado a `biometric_proof_consumptions` e LOWs de
  hardening.
- Review imparcial 2: apontou HIGH no mesmo consumo de proof e MEDIUMs em
  update+insert nao transacional, simulator availability e admin_global sem
  reserva.
- Correcoes aplicadas:
  - helper passou a usar `consumed` derivado da tabela real;
  - `consumeBiometricProof` insere em `biometric_proof_consumptions`;
  - RPC `record_biometric_proof` substitui update+insert separados;
  - BFF expõe `simulator_available`;
  - admin_global recebe reservas do tenant no console.

## Veredito local

Phase 1A.1 implementada e validada dentro do escopo. A entrega nao deve ser
confundida com biometria plena em saida/devolucao/cautela/livro; ela fecha o
contrato e o console de identificacao necessarios para as fases seguintes.
