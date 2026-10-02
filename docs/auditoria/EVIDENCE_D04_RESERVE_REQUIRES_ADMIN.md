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

## Atualização 2026-10-02 (2ª rodada): admin ATIVO, convite pendente, SELECT em produção
Decisão do dono do produto: conta como admin **só admin ativo** (papel `admin_reserva`, conta não suspensa — `inactive`/`impedimento_administrativo` — e convite aceito). Enquanto o convite enviado pelo `admin_global` não for aceito, a reserva fica indisponível com **erro amigável** (409, `code: pending_invite`): sem troca de reserva, sem material (aprovação de solicitação), sem membros (PATCH `reserve_ids`, `/users/invite`, `/militares`, Nexus `members`) — exceto o próprio `admin_reserva`, que é quem destrava. Nova função `reserveAdminStates`/`firstNotOperable`; `/api/admin/estrutura` devolve `admin_state` e a tela mostra o aviso na reserva. `/users/invite` agora grava `invite_sent_at` (pendente) e `POST /api/auth/update-password` grava `account_activated_at` (aceite) na primeira vez. Hierarquia unidade→reservas (ex.: DEC → CFAP, APMCB, NUPEX) já existe: `POST /api/admin/reserves` aceita `org_unit_id`.

**SELECT de leitura em produção (projeto `jepitcrkicwmvzrmllpn`, executado a pedido do dono; `docs/auditoria/sql/reservas_sem_admin_ativo.sql`):** 1 reserva sem admin ativo — **CFAP** (`a8376271-d7f9-4fa6-9657-9714016e29b0`, tenant Polícia Militar da Paraíba): 0 admins ativos, 0 pendentes, 0 suspensos; membros: 1 armeiro, 1 usuário (ativos). As demais reservas têm admin ativo. **Ao fazer o deploy, a CFAP fica indisponível (switch/login) até designar um `admin_reserva` ativo** — designar antes do deploy (ou aceitar a indisponibilidade).
Testes: `reserve-requires-admin.test.ts` agora com 24 casos (pendente, suspenso, aceite libera, gates, mutações detectadas: pendente/suspenso contando como ativo, gate do approve, do PATCH, do Nexus e do convite).
Pendente: rota legada do Next (`apps/web/src/app/api/admin/users/route.ts`) também faz upsert de `reserve_memberships` sem esse gate.

### Revisão da 2ª rodada (3 ALTO + MÉDIOS) — correções
- A1: o gate de membros do `PATCH /api/profiles/:id` foi movido para ANTES de qualquer escrita (409 sem escrita parcial; teste afirma zero updates/inserts).
- A2: o gate do approve usa a reserva onde o item será gravado (`payload.reserve_id ?? sessão`) e só barra `material_addition` (a que cria material).
- A3 (falha pré-existente corrigida): `/users/invite` — só `admin_global` escolhe a reserva; armeiro/admin_reserva usam a reserva ativa da sessão; reserva validada por tenant+`ativa` ANTES do gate (400 igual para inexistente e de outro tenant: sem oráculo); antes um armeiro podia plantar membership em reserva de outro tenant.
- M2: convite só é "pendente" se o cadastro não está `complete` (reenvio de acesso a admin legado não o derruba); M3: a guarda do último admin só protege o admin ATIVO (convite pendente/suspenso pode ser removido).
- M1 → R-59 (rota legada do Next sem o gate). M4: o aceite efetivo costuma ser o 1º login (trigger `on_first_login`); a gravação em `update-password` é cinto-e-suspensório (conta suspensa fica coberta pelo status). Decisão registrada: status `null`/`pending_biometric` com convite aceito conta como ativo.
- Testes: 29 em `reserve-requires-admin.test.ts`; 6 mutações novas detectadas (A1, A2, A3 corpo/tenant, M2, M3).
- Re-revisão da 2ª rodada: 0 CRÍTICO/0 ALTO. MÉDIO corrigido: `/users/invite` por `admin_reserva`/armeiro exige membership do caller na reserva da sessão (admin_reserva como admin; armeiro como membro) e 400 se não há reserva ativa (antes: convite sem membership, em silêncio). BAIXO aceitos: upsert do profile no convite sobrescreve profile existente (pré-existente), `console.error` na gravação da ativação em `update-password`. Suítes: unit 695, integração 382, web 377.
