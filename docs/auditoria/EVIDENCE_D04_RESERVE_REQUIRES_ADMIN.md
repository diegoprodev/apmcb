# D-04 — reserva exige `admin_reserva` (criação, acesso, último admin)

Data: 2026-10-02. Sem produção, sem migration.

## Implementado
| Ponto | Mudança |
|---|---|
| `POST /api/admin/reserves` | exige `admin_reserva_id` (perfil do tenant da sessão, papel `admin_reserva`; senão 422 + log); cria a reserva e a membership `admin_reserva`; falha na membership desfaz a reserva (compensação) e responde 500 genérico com log |
| `GET /api/admin/estrutura` | devolve `admin_reserva_options` (admins elegíveis do tenant) |
| `POST /api/reserves/switch/:id` | 409 para reserva sem `admin_reserva` (qualquer papel, inclusive `admin_global`/matriz); erro de banco → 500 fail-closed; novo `lib/reserve-admin.ts` (`reservesWithoutOtherAdmin`, `reserveHasAdmin`, `ReserveAdminLookupError`) |
| `PATCH /api/profiles/:id` | 409 ao rebaixar o último `admin_reserva` de uma reserva (mudança de papel) ou removê-lo via `reserve_ids`; erro de banco → 500 |
| Web `admin/estrutura` | diálogo "Nova Reserva" tem seletor de administrador (obrigatório) |
| Revisão 1 (4 ALTO, corrigidos) | A1: o helper conta só quem é `admin_reserva` de verdade (join com `profiles.role`) e o rebaixamento para `armeiro` rebaixa também a membership; A2: login/exchange só elegem como reserva ativa as que têm admin (`onlyReservesWithAdmin`); A3: `POST /api/nexus/tenants/:id/reserves` exige `admin_reserva_id` (membership + rollback); A4: `DELETE /api/nexus/reserves/:id/members/:userId` nega remover o último admin, e o DELETE de reserva (`admin.ts`) deixa de ser bloqueado pelo admin obrigatório. Também: acronym duplicado → 409 |
| Testes | `reserve-requires-admin.test.ts` (19, handlers reais inclusive Nexus com sessão selada); mutações detectadas: gate do switch, papel e tenant do admin, rollback, guarda do último admin, join de perfil, sync de membership, guardas do Nexus. Suítes: BFF unit 695, integração 371, unit 695, web 376 |

## Pendentes / limitações
- Reservas já existentes sem `admin_reserva` ficam inacessíveis pelo `switch` (efeito intencional da regra); verificar em produção por SELECT antes do deploy.
- `authMiddleware` e sessões já abertas continuam com a reserva ativa salva (checar admin por requisição custaria uma consulta por chamada): o gate vale no `switch` e no login/exchange; a trava definitiva é no banco (trigger em `profiles_validate_active_reserve` + constraint em `reserve_memberships`) = migration, fora de escopo.
- `PATCH /:id/status` desativando o último admin e admin com status não ativo contando como admin (M3 da revisão): regra de produto a decidir (admin "ativo"?).
- Rollback da criação best-effort (se o delete de compensação falhar, fica reserva sem admin inacessível e logada); RPC transacional resolveria (migration).
- A guarda do último admin é verificação-e-escrita (sem trava transacional): janela de corrida entre dois rebaixamentos simultâneos; trava definitiva exigiria trigger/RPC no banco (migration — fora de escopo).
- E2E `admin-estrutura.spec.ts` (ES03) e `avu-alertas-vencimento.spec.ts` (AVU01) ajustados para enviar `admin_reserva_id` (admin_reserva de teste, por matrícula); **não executados** (E2E só roda contra produção — BLOQUEADO_AMBIENTE).
- Re-revisão: 0 CRÍTICO/0 ALTO; BAIXO aceitos: matriz com reserva ativa órfã legada via login, remoção de membership fantasma no Nexus, `POST /reserves/:id/members` aceitando admin_reserva sem validar perfil, lista de `/estrutura` mostrando fantasmas. Ordem do switch corrigida (membership antes do gate de admin, sem vazar 409 a não-membros).
