# Relatorio final - Metadados de materiais e alertas de validade

Data: 2026-06-28

## Escopo entregue

- Categorias de material agora aceitam texto customizado com slug normalizado.
- Material pode ter descricao opcional e foto opcional via bucket `material-photos`.
- Armas exigem calibre no cadastro direto e na solicitacao do armeiro.
- Coletes exigem validade por unidade e alertas configuraveis em 365, 180 e 90 dias.
- Materiais podem habilitar controle por numero de serie.
- Solicitacoes do armeiro continuam indo para o `admin_reserva`; `admin_global` nao executa mutacao direta no almoxarifado.
- Relatorios de admin e reserva aceitam filtro por categoria e calibre quando a categoria e arma.
- BFF inclui rotina protegida por `admin_reserva` para gerar notificacoes de validade.

## Banco de dados

Migration aplicada no Supabase remoto:

- `supabase/migrations/20260628000003_material_metadata_alerts.sql`

Validacao remota executada:

- `supabase migration list` confirmou `20260628000003` em local e remoto.
- Consulta em `material_availability` confirmou as colunas `categoria_slug`, `calibre`, `requires_validity` e `validity_alert_days`.

## RBAC e seguranca

- `admin_reserva`: pode aprovar solicitacoes e executar rotina de alertas.
- `armeiro`: pode solicitar adicao/desativacao, sem mutacao direta sem aprovacao.
- `admin_global`: visualizacao administrativa sem botao de mutacao direta no almoxarifado.
- `superadmin`: permanece fora da gestao interna de materiais.
- Endpoints alterados mantem validacao de entrada antes de persistir metadados sensiveis.

## Validacoes locais

- `node --experimental-strip-types --test apps/bff/src/__tests__/audit-hash.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/material-metadata.test.ts`:
  - 21 passed, 0 failed.
- `pnpm typecheck`:
  - 3 workspaces successful.
- `pnpm lint`:
  - 0 errors; warnings preexistentes e warnings de hooks sem bloqueio de CI.
- `pnpm --filter web build`:
  - compiled successfully.

## Observacao de concorrencia

Havia arquivos untracked do Livro Digital criados por execucao paralela. Para destravar o `typecheck` do workspace, foi feita uma correcao local minima de assinatura Next 16 em `apps/web/src/app/(dashboard)/admin/livros/[shift_id]/page.tsx`; esse arquivo nao faz parte do escopo deste commit.

## Validacao pos-deploy

Producao validada em `https://apmcb.pmpb.online` com BFF em `https://api.apmcb.pmpb.online`:

- `pnpm exec playwright test e2e/arsenal-profile-feedback.spec.ts --workers=1`
  - 9 passed, 0 failed.

Cobertura do smoke em producao:

- `/reserva` sem erro `no-response` do service worker.
- `admin_global` visualiza almoxarifado sem botao de mutacao direta.
- Armeiro ve botao de adicionar material e foto opcional na solicitacao.
- Formulario de material exibe calibre para arma e validade/alertas para colete.
- Armeiro solicita adicao e desativacao por aprovacao.
- Relatorios exibem filtro de calibre quando categoria e arma.
- `/reserva/cautelas` sai do carregamento dentro do limite validado.
- Menu de usuario abre perfil e suporte.
- Suporte usa canal unico, email `suporteonix@arckosia.com.br`, copia de email e prazo de ate 3 dias uteis.

Status final: aprovado.
