# Plano de Implementacao - Biometric Bridge Phase 1A.1

## Objetivo

Entregar a primeira fatia funcional do bridge biometrico para o painel do
armeiro: contrato seguro no BFF, simulator impossivel em producao, endpoint de
resultado e console de identificacao na UI. Esta fase nao altera ainda saida,
devolucao, cautela, livro digital ou passagem de servico.

## Escopo Autorizado

- Migration incremental:
  - adicionar `biometric_devices.is_simulator boolean not null default false`;
  - criar `biometric_proof_consumptions` com `unique(proof_id)`;
  - manter RLS habilitado e acesso operacional via service role/BFF.
- BFF:
  - adicionar `assertUsableBiometricProof`;
  - adicionar `GET /api/biometric/challenges/:id/result`;
  - adicionar simulator em `/api/biometric/simulator/*`;
  - registrar simulator somente quando `NODE_ENV !== "production"` e
    `BIOMETRIC_SIMULATOR_ENABLED === "true"`;
  - impedir `is_simulator` em `/api/biometric/devices/pair`;
  - expor `is_simulator` somente na listagem/status de dispositivos.
- Web:
  - criar `BiometricBridgeStatus`;
  - criar `BiometricCaptureDialog`;
  - criar `/reserva/biometria`;
  - atualizar card de identificacao no painel `/reserva` para o console bridge.
- Docs:
  - atualizar seguranca/changelog/DoD da fase.

## Fora de Escopo

- Captura USB real no BFF ou na VPS.
- SDK NITGEN/eNBioBSP dentro do backend cloud.
- Assinatura de saida, devolucao, cautela, livro digital ou passagem com
  `biometric_proof_id`.
- Enrollment definitivo de template biometrico.
- Mudanca do TOTP existente.

## Harness Obrigatorio

### BFF e Schema

- Teste estatico falha se a migration nao cria `is_simulator`.
- Teste estatico falha se `biometric_proof_consumptions` nao possuir
  `unique(proof_id)`.
- Teste estatico falha se `pairDeviceSchema` aceitar `is_simulator`.
- Teste estatico falha se o simulator for montado fora do bloco condicional.
- Teste unitario de `assertUsableBiometricProof` rejeita:
  - tenant/reserva/actor/purpose divergente;
  - usuario esperado divergente;
  - `document_hash` divergente;
  - proof expirada;
  - proof ja consumida;
  - result diferente de `success`.
- Teste unitario aceita proof valida, ativa, com result `success`.

### Web

- Teste estatico falha se componentes novos chamarem `/biometric/*` sem
  prefixo `/api`.
- Teste estatico falha se houver chamada para `http://127.0.0.1` ou
  `localhost` em componentes/rotas da biometria web.
- Teste estatico valida uso de `friendlyApiError`, `bffFetch` e `data-testid`
  nos componentes novos.
- UI precisa separar estados: bridge ausente, simulator, aguardando dedo,
  sucesso, falha, expirado e retry.

## Validacao Final Planejada

- `cd apps/bff && pnpm test`
- `pnpm --filter bff typecheck`
- `pnpm --filter web typecheck`
- `pnpm --filter web lint`
- Review imparcial por subagente ou harness equivalente com foco em:
  simulator backdoor, replay de proof, escopo tenant/reserva e regressao de UX.

## Criterios de Aceite

- O armeiro consegue abrir `/reserva/biometria`, iniciar identificacao e ver o
  resultado da challenge usando simulator em ambiente nao-producao.
- Em producao a rota simulator nao existe.
- O BFF continua sendo autoridade: frontend nunca decide identidade por conta
  propria.
- Nenhum segredo biometrico, template, assinatura ou payload cru aparece na UI
  ou em logs.
- A Phase 1A.1 fica pronta para Phase 1A.2 consumir `proof_id` em saida e
  devolucao sem redesenhar o contrato.
