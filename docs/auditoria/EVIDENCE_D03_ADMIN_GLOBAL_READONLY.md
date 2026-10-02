# D-03 — `admin_global` somente leitura sobre material e movimentação (classificação, sem código)

Data: 2026-10-02. Fonte: levantamento estático dos `roleGuard` de rotas não-GET que incluem `admin_global` em `apps/bff/src/routes`.

## A. Remover `admin_global` (material / movimentação — clara)
| Arquivo | Rotas |
|---|---|
| `arsenal.ts` | `PATCH /items/:id/ocorrencia` |
| `lendings.ts` | `POST /`, `/batch`, `/bulk-return`, `/identify`, `PATCH /:id/return` |
| `handovers.ts` | `POST /`, `/:id/sign-exit`, `/:id/assign-entry`, `/:id/sign-entry`, `/:id/report-divergence` |
| `ssa.ts` | `PATCH /requests/:id/deliver`, `POST /modo-a` (entregas) |
| `cautelamentos.ts` (**WIP — só depois**) | `POST /`, `/batch`, sign-*, `/:id/return`, `/:id/cancel`, `PATCH /:id`, `/:id/vencimento-snooze`, `/:id/substitute` |
| `saidas.ts` (**WIP — só depois**) | `POST /`, `/:id/sign-armeiro`, `PATCH /:id/return` |
| `inventory.ts` | `POST /reserve-checks/:id/items/:iid/check` |

Web: remover botão/ação de escrita para `admin_global` (ex.: `RegistrarOcorrenciaButton` em `/admin/arsenal/manutencao`, `_aprovacao-client`, `_cautelas-client`, `reserva/passagens/[id]/_detail`).

## B. Ambíguas — precisam de decisão do dono do produto
- Aprovar/rejeitar solicitações de material: `arsenal.ts /requests/:id/approve|reject`, `categories.ts /requests/:id/approve|reject`, `ssa.ts /requests/:id/approve|reject` (decisão de gestão ou movimentação?).
- Inventário (campanhas): `inventory.ts /campaigns`, `/start`, `/close`, `/reserve-checks/:id/assign|sign` (gestão/auditoria, não altera material diretamente).
- Assinaturas: `signatures.ts POST /` e `/:id/revoke` (R-54).
- Biometria: `devices/pair|revoke`, `pairing-codes`, `challenges*`, `identify`, `register` (WIP).

## C. Mantêm `admin_global` (administração, D-03)
`admin.ts` (convites, `enviar-acesso`, `email-change`, `org-units`, `reserves`, `branding`), `profiles.ts` (`PATCH /:id`, `/:id/status`, foto de perfil), `reserves.ts` (`switch`, `settings`), `totp.ts`.

## Observações
- Uploads de foto de item (`arsenal.ts /material-photo`) alteram material: classificar em A.
- `requireActiveShift` já não cobre admin_global; passa a ser irrelevante para ele nas rotas de A.
- Mudança de comportamento: remove capacidade existente — exige teste por rota (admin_global → 403 + log) e ajuste dos testes que hoje afirmam o contrário.

## Implementação (2026-10-02) — decisões do dono do produto
Respostas às ambiguidades: **aprovar/rejeitar** — nada disso aparece para o `admin_global` (remover); **inventário** — o `admin_global` pode criar campanhas (e iniciar/fechar), que aparecem para os `admin_reserva`; atribuir/assinar conferência é rotina da reserva (removido do `admin_global`); o `admin_global` mantém visão global (relatórios completos, dashboard) e administra reserva, unidade, material (catálogo), usuário (criar, editar, desativar).

Removido `admin_global` do `roleGuard` de (BFF, fora de arquivos em WIP): `arsenal` approve/reject/ocorrencia; `categories` request/approve/reject; `ssa` approve/reject/deliver/modo-a; `lendings` identify/batch/POST /bulk-return/return; `handovers` POST/sign-exit/assign-entry/sign-entry/report-divergence; `inventory` item-check/assign/sign; `ocorrencias` PATCH /:id (rotina da reserva; R-53 permanece sobre o escopo).
Ramos mortos removidos: bypass de membership e elegibilidade de `admin_global` como entrante em `handovers.ts`; ramo `null` de `writeReserveScope` em `arsenal.ts` (a pergunta de assimetria leitura×escrita do R-48 fica sem objeto).
Web: `/admin/arsenal/solicitacoes` só `admin_reserva`; banner de pendências removido de `/admin`; botão de ocorrência removido de `/admin/arsenal/manutencao`.
Testes: `admin-global-readonly.test.ts` (4: 24 rotas → 403 sem tocar no banco e com `role_guard.denied`; controle positivo `admin_reserva`; campanhas mantidas); mutações em `ssa /modo-a` e `handovers sign-entry` detectadas; testes antigos migrados para `admin_reserva`. Suítes: BFF unit 695, integração 352, web 376.

## Pendente (não feito)
- **WIP:** `cautelamentos.ts`, `saidas.ts`, biometria (tabela A) — liberar para remover `admin_global`.
- **Web (próximo lote):** `_cautelas-client`, `reserva/passagens/[id]/_detail`, `admin/saidas`, `admin/inventario/[id]`, notificação/sidebar que apontam para `/admin/arsenal/solicitacoes`, demais telas com ação de escrita para `admin_global`; confirmar que dashboard/relatórios globais seguem completos.
- Dead code `admin_global` em `lendings.ts` (`assertActorReserveAccess`), `arsenal.ts` (`requestBelongsToScope`), `categories.ts`, `ssa.ts`: inofensivo (rotas negam antes), limpar depois.
- `signatures.ts` (R-54): decisão sobre `admin_global` ainda não tomada.

## Revisão (code + segurança) — 0 CRÍTICO; 1 ALTO = lacuna de cobertura já declarada
- **ALTO (A1):** rotas de escrita ainda abertas ao `admin_global` fora do diff: `cautelamentos.ts` (14 guards), `saidas.ts` (3), `arsenal /material-photo`, `signatures.ts` (R-54), `totp.ts` (/validate, /identify, /admin-provision). Cautelamentos/saidas/biometria seguem em WIP; `material-photo` (catálogo) e `signatures` aguardam decisão. **D-03 NÃO está concluída até fechar A1** — status do ledger continua parcial.
- **M2 (feito no BFF):** `notifyReviewers` (arsenal) e `notifyCategoryReviewers` deixam de notificar `admin_global`; `canReviewRequests` = só `admin_reserva`. **Pendente na web:** link do sino para `/admin/arsenal/solicitacoes`, botão "Aprovações" e accordion em `reserva/arsenal/page.tsx`, `_detail.tsx` (atribuir entrante), `_ocorrencias-client` (ações), `admin/inventario/[id]` (assinar/conferir) ainda mostram ação que dá 403 para `admin_global`.
- **M3 (pergunta de produto):** o fechamento da campanha exige todas as conferências assinadas e agora só `admin_reserva` assina; reserva sem `admin_reserva` ativo trava o fechamento. Definir caminho de "encerrar sem assinatura" (com auditoria) ou aceitar.
- **M1/B2:** ramos mortos de `admin_global` em `lendings.ts` (`assertActorReserveAccess`), `arsenal.ts` (`requestBelongsToScope`), `categories.ts` (`scopedReserveIds`), `ssa.ts`: limpar depois (hoje inalcançáveis; risco só se o guard for reaberto).
- **M4:** faltam testes positivos (admin_reserva/armeiro passam) por rota, assign-entry com entrante `admin_global` (422) e página `solicitacoes`.
- **B3 (a verificar):** RLS direta no Supabase (`material_items`, `ocorrencias`) pode permitir escrita por `profiles.role='admin_global'` fora do BFF — checar quando houver acesso ao banco (R-34).
