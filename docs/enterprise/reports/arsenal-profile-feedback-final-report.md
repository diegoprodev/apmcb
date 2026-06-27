# Relatorio Final - Arsenal, Perfil e Feedback

**Data:** 2026-06-27
**Status final:** APROVADA
**Escopo:** fotos/categorias de material, perfil do usuario, suporte/feedback, RBAC de solicitacoes do armeiro e regressao do botao de adicionar material.

## Escopo Entregue

- Materiais da reserva agora suportam foto opcional (`material-photos`) e placeholder visual quando nao houver imagem.
- Cadastro/edicao de material aceita upload ou captura de camera no fluxo admin.
- Armeiro visualiza materiais, solicita adicao/desativacao/ajuste, e admin da reserva aprova ou rejeita.
- Admin da reserva gerencia material diretamente; superadmin nao gerencia dados internos da reserva.
- Menu do usuario no header abre Perfil, Reportar e Sair.
- Perfil permite foto (`profile-photos`) e preferencias basicas de tema, densidade e movimento.
- Rota `/suporte` centraliza problema, sugestao, critica e elogio para `iasuporteonix@arckosia.com.br`.

## Migrations

| Arquivo | Alteracao |
|---|---|
| `supabase/migrations/20260627000002_material_photos_arsenal_rbac.sql` | Bucket `material-photos`, colunas de foto em materiais, categorias, policies de storage/RBAC e aprovacao de desativacao. |

## Endpoints e RBAC

| Area | Status |
|---|---|
| `apps/bff/src/routes/arsenal.ts` | Solicitações do armeiro limitadas a `armeiro`; aprovacao limitada a `admin_reserva`. |
| `apps/web/src/app/api/admin/almoxarifado/route.ts` | Gerencia direta para `admin_global`/`admin_reserva`; sem `superadmin` em dados internos. |
| Storage | `material-photos` para materiais; `profile-photos` reaproveitado para perfil. |

## Validacao Executada

| Comando | Resultado |
|---|---|
| `cd apps/web && pnpm typecheck` | OK |
| `pnpm --filter @apmcb/bff typecheck` | OK |
| `cd apps/web && pnpm lint` | OK, com warnings existentes do projeto |
| `cd apps/web && pnpm build` | OK |
| `cd apps/web && pnpm exec playwright test --config=playwright.config.ts --project=arsenal-profile-feedback --reporter=list` | 3 passed |
| `cd apps/web && pnpm exec playwright test --config=playwright.config.ts --project=chromium --project=rbac-suite --project=arsenal-profile-feedback --reporter=list` | 53 passed, 1 skipped local HTTPS |

## Observacoes de Ambiente

- O BFF local nao foi iniciado porque `bun` nao esta instalado no ambiente Windows atual; a validacao local usou `NEXT_PUBLIC_BFF_URL=https://api.apmcb.pmpb.online`.
- O teste HTTPS foi pulado apenas para `localhost`; em deploy `https:` continua obrigatorio.
- O banco remoto usado na validacao ainda nao tinha `material_availability.photo_url`; a UI possui fallback sem foto ate a migration ser aplicada.

## Rollback

- Reverter os arquivos de UI e BFF deste escopo.
- Reverter a migration `20260627000002_material_photos_arsenal_rbac.sql` se ainda nao aplicada.
- Se aplicada, remover policies/bucket `material-photos`, coluna de foto em `material_types` e recriar a view anterior de `material_availability`.
