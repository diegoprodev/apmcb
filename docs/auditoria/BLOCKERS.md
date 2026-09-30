# BLOCKERS — matriz de bloqueios (baseline 0, 2026-09-29)

> Nenhum bloqueio aqui torna uma feature "NÃO FUNCIONAL". Bloqueio = "não conseguimos produzir
> evidência de execução agora". Itens que dependem do BFF ficam `[BLOQUEADO_BFF]` e entram na
> fila de reexecução (§Fila).

---

## B-01 — BFF de produção indisponível (pagamento) — previsão: dia 3

| Campo | Conteúdo |
|---|---|
| Impacto | Nenhum fluxo autenticado pode ser executado ponta a ponta (login, sessão, Modo Usuário, troca de reserva, cautela, saída, SSA, assinatura, TOTP, PDF, verificação pública, biometria via bridge, notificações, Nexus). |
| Features afetadas | Praticamente todas as da matriz de ~230 itens que passam pelo BFF. Exceções: UI estática/SSR sem dados, páginas públicas quebradas sem BFF. |
| Testes afetados | Playwright E2E (91 arquivos, todos os `projects`), `test:pentest` (7 suítes), jornadas `docs/journeys/*`, `biometric-bridge-phase1b.spec.ts`, cenário de SoD (§10 do prompt), isolamento A1/A2/B1/B2 em runtime. |
| Validável localmente | Unit BFF (644 testes, handlers com cliente Supabase mockado), integração BFF com mock (89), unit/typecheck/lint/build web, sondas de funções puras (hash, TOTP, resolução de reserva ativa, `canAccessResourceReserve`), leitura estática de rotas/RPCs. |
| Não validável | Comportamento real de RLS com grants de produção, RPCs `SECURITY DEFINER`, estado do flag `reserve_isolation_enabled`, cookies cross-subdomain, iron-session real, CSRF real, rate limit real. |
| Reexecutar quando voltar | Ver §Fila. |

## B-02 — Egress deste container bloqueado para os hosts do produto

`api.apmcb.pmpb.online` e `apmcb.pages.dev` retornam `connect_rejected` pela política de rede
do ambiente cloud. **Mesmo com o BFF de volta**, testes contra produção não rodam a partir desta
sessão sem ajuste da política de rede do ambiente. Impacto idêntico a B-01 para sessões cloud.

## B-03 — Supabase MCP sem conexão (`ERR_PROXY_TUNNEL`)

| Campo | Conteúdo |
|---|---|
| Impacto | Sem leitura do banco real: não dá para confirmar flag de isolamento, drift de migrations (ex. `fix/lending-rpcs-liveness-null`, correções "ao vivo" da v53), existência das contas `*@apmcb.dev` (R-02), `document_hash` repetido em `cautelamentos` (R-01). |
| Validável localmente | Nada do banco real. |
| Reexecutar | Queries somente-leitura listadas em §Fila (Q1–Q6). |

## B-04 — Ausência de ambiente de banco local para RLS/RPC

| Campo | Conteúdo |
|---|---|
| Impacto | Toda evidência de isolamento no banco hoje vem de execuções em **produção** (`reserve_isolation_canary.sql`). Não há Supabase local/CI com as 178 migrations. |
| Evidência | T11: Postgres 16 local + shim on-prem aplica 2/178 migrations (quebra em `seed_dev`). |
| Validável | Nada de RLS/RPC localmente sem um stack Supabase local (`supabase start` exige Docker; Docker existe no container mas não foi usado nesta sessão — avaliar em sessão própria). |
| Impacto em processo | Etapa 2/3 do pipeline do `CLAUDE.md` (Playwright/verificação de fluxo) não tem alvo seguro não-produtivo. |

## B-05 — Bridge Windows / hardware NITGEN

| Campo | Conteúdo |
|---|---|
| Impacto | `BridgeClient.Tests` (.NET) não roda (sem `dotnet`); captura/matching real exige Windows + leitor. |
| Validável | Leitura estática; contrato BFF da bridge via testes unitários BFF (`biometric-*`). |
| Observação | Frente WIP_BIOMETRIA ativa — **não tocar**. |

## B-06 — Suítes E2E e pentest apontam para produção por default

`playwright.config.ts`: `baseURL = process.env.E2E_BASE_URL ?? "https://apmcb.pages.dev"`.
Pentest usa contas reais e já alterou dado de produção (comentário em
`privilege-escalation.pentest.test.ts`). Não é bloqueio externo, é **bloqueio de segurança do
processo**: nenhuma dessas suítes deve rodar até existir alvo não-produtivo (ledger R-14).

## B-07 — Skills do pipeline canônico ausentes neste ambiente

`CLAUDE.md` exige `superpowers:test-driven-development`, `spec-to-code-compliance`,
`differential-review`, `insecure-defaults:audit`, `static-analysis:semgrep`, sub-agente
`code-reviewer`. Nenhuma instalada aqui. Disponíveis: `code-review`, `security-review`,
`simplify`. Precisa decisão antes da 1ª remediação.

---

## Fila de reexecução quando B-01/B-02/B-03 caírem

| # | Teste | Pré-condição | Resultado esperado para fechar |
|---|---|---|---|
| E1 | Cenário SoD (armeiro → Modo Usuário → SSA → staff → approve/deliver da própria) | BFF + conta armeiro de teste | registrar status HTTP de cada passo; hoje o código prevê 201/200/200 (sem bloqueio) |
| E2 | Armeiro A1 aprova/entrega SSA de A2 (mesmo tenant) | 2 reservas de teste | hoje o código prevê 200 (R-05) |
| E3 | `GET /api/dashboard/stats` com armeiro do tenant A | 2 tenants com dados | hoje o código prevê contagens globais (R-06) |
| E4 | `GET /api/dashboard/command?reserve_id=<A2>` com admin_reserva de A1 | 2 reservas | hoje prevê dados de A2 (R-10) |
| E5 | Revogar assinatura e consultar `/api/verify/:id` | assinatura de teste | hoje prevê `status: "válido"` (R-07) |
| E6 | `GET /api/totp/code` seguido de `POST /api/signatures` com o código obtido | armeiro com TOTP | hoje prevê 201 (R-03) |
| E7 | 2× `PATCH /api/ssa/requests/:id/deliver` concorrentes | SSA aprovada de teste | hoje prevê lendings duplicados (R-08) |
| E8 | Troca de reserva no dispositivo X, operação no dispositivo Y | 2 sessões | registrar qual reserva Y usa (R-11) |
| Q1 | `select reserve_isolation_enabled from tenants` | acesso DB leitura | confirmar flag |
| Q2 | `select document_hash, count(*) from cautelamentos group by 1 order by 2 desc limit 5` | leitura | confirmar R-01 em dado real |
| Q3 | `select id, email from auth.users where email like '%@apmcb.dev'` | leitura | confirmar R-02 |
| Q4 | `select version from supabase_migrations.schema_migrations order by 1 desc limit 10` | leitura | detectar drift vs. repo |
| Q5 | `select count(*) from document_signatures s where exists (select 1 from document_signatures r where r.replaced_by = s.id) and s.revoked_at is null` | leitura | medir R-07 |
| Q6 | `select military_id, reserva_id from material_requests where military_id = reserva_id` | leitura | medir casos reais de autoaprovação (R-04) |
