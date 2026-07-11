# Harness da Fase - Anti-IDOR Enterprise Defense

**Nome legivel:** Anti-IDOR Enterprise Defense
**Codigo:** `IDOR-DEF`
**Spec:** `docs/superpowers/specs/2026-07-11-idor-defense-design.md`
**Status:** Planejada

---

## Campo 1 - Objetivo

Criar uma defesa enterprise contra IDOR cobrindo qualquer referencia externa a objeto em APIs, BFF/service_role, Next handlers, Storage, Realtime/SSE, PDFs publicos, buscas, relatorios e exportacoes.

---

## Campo 2 - Escopo

- Inventariar todas as superficies que aceitam identificadores externos.
- Definir contrato de autorizacao por recurso.
- Criar suite `idor-suite` e testes HTTP/API de matriz de autorizacao.
- Endurecer mutations BFF para aplicar escopo na propria escrita.
- Auditar `superadmin` fora de Nexus.
- Auditar Storage signed/public URLs.
- Auditar Realtime/SSE com service_role.
- Auditar endpoints publicos de verificacao e PDFs.
- Atualizar `docs/security.md`, changelog e relatorio final.

---

## Campo 3 - Fora do Escopo

- Refatoracao visual.
- Troca generalizada de UUIDs.
- Reescrita do sistema de autenticacao.
- Edicao de migrations antigas ja commitadas.
- Deploy em producao sem regressao e aprovacao explicita.

---

## Campo 4 - Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | BFF usa service_role e precisa de escopo no codigo | `Get-Content apps/bff/src/services/supabase.ts` |
| P2 | Roles atuais sao `superadmin`, `admin_global`, `admin_reserva`, `armeiro`, `usuario`, `auditor` | `rg \"type Role|role_enum|roleGuard\" apps/bff/src supabase/migrations` |
| P3 | `superadmin` e Nexus-only para dados operacionais | CHANGELOG v30 e docs da fase |
| P4 | Existem mudancas paralelas em UI/filtros | `git status --short` |
| P5 | UUID ja e padrao de PK critico | `rg \"PRIMARY KEY DEFAULT gen_random_uuid\" supabase/migrations` |

---

## Campo 5 - Arquivos Permitidos

**Planejamento/docs:**
- `docs/superpowers/specs/2026-07-11-idor-defense-design.md`
- `docs/enterprise/phases/phase-idor-defense.md`
- `docs/security.md`
- `CHANGELOG.md`
- `docs/enterprise/reports/idor-defense-final-report.md`

**Implementacao futura BFF:**
- `apps/bff/src/routes/*.ts`
- `apps/bff/src/middleware/*.ts`
- `apps/bff/src/lib/*idor*.ts`
- `apps/bff/src/services/supabase.ts` somente se necessario para helper de cliente scoped

**Implementacao futura Web/API:**
- `apps/web/src/app/api/**/route.ts`
- `apps/web/src/lib/storage.ts`
- `apps/web/e2e/idor.spec.ts`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/harness/idor.ts`

**Database futuro:**
- Nova migration `supabase/migrations/YYYYMMDDHHMMSS_idor_rls_storage_hardening.sql`, se houver policy nova.

---

## Campo 6 - Arquivos Proibidos Sem Nova Aprovacao

| Arquivo/area | Motivo |
|---|---|
| Mudancas UI/filtros ja sujas no working tree | Trabalho paralelo de outro agente |
| Migrations antigas | Nunca editar historico aplicado |
| Fluxo de login/auth principal | Fora do escopo salvo achado IDOR direto |
| Design system | Sem mudanca visual nesta fase |
| Deploy workflows | Fora do escopo desta fase |

---

## Campo 7 - Recursos e Identificadores

| Superficie | Identificadores externos |
|---|---|
| BFF REST | `:id`, `:userId`, `:document_id`, `military_id`, `item_id`, `material_type_id`, `reserve_id`, `tenant_id`, arrays |
| Next API | `[id]`, `searchParams.id`, `q`, filtros por perfil/material |
| Next pages/guards/libs | referencias a `superadmin`, redirects, role maps e acesso SSR a dados operacionais |
| Storage | bucket, object path, signed URL, public URL |
| Realtime/SSE | channel, table, filter, payload row |
| Public verify | `document_id`, `shift_id`, `inventory_id`, hash |
| Relatorios/export | `military_id`, `material_id`, `reserve_id`, filtros de data/status |

---

## Campo 8 - Contrato de Mutation BFF

Toda mutation sensivel deve seguir:

```ts
const { data, error } = await supabase
  .from("resource")
  .update(payload)
  .eq("id", id)
  .eq("tenant_id", tenantId)
  .eq("reserve_id", reserveId);
```

Regras:

- se a tabela tem `tenant_id`, a escrita inclui `tenant_id`;
- se a tabela tem `reserve_id` e a role e de reserva, a escrita inclui `reserve_id`;
- se a tabela tem owner (`user_id`, `military_id`, `actor_id`, `signer_id`) e a operacao e self-service, a escrita inclui owner;
- bulk mutation valida todos os IDs antes e escreve com predicado de escopo;
- excecao exige justificativa e teste.

---

## Campo 9 - Endpoints e Fluxos a Inventariar

| Area | Arquivos |
|---|---|
| Lendings/Saidas/Cautelas | `apps/bff/src/routes/lendings.ts`, `saidas.ts`, `cautelamentos.ts` |
| Perfis/Biometria/TOTP | `profiles.ts`, `biometric.ts`, `totp.ts` |
| Arsenal/Categorias/Ocorrencias | `arsenal.ts`, `categories.ts`, `ocorrencias.ts` |
| Shifts/Handovers/Inventory | `shifts.ts`, `handovers.ts`, `inventory.ts` |
| Notifications/Realtime/Public | `notifications.ts`, `realtime.ts`, `public.ts` |
| Nexus | `nexus.ts`, apenas para confirmar fronteira Nexus-only |
| Next API | `apps/web/src/app/api/**/route.ts` |
| Public pages | `apps/web/src/app/v/[document_id]/**` |
| Storage helpers | `apps/web/src/lib/storage.ts` |

---

## Campo 10 - Testes de Seguranca

| ID | Cenario | Resultado esperado |
|---|---|---|
| IDOR-001 | Usuario A tenta ler recurso do Usuario B | 403/404, sem payload |
| IDOR-002 | Usuario A tenta mutation em recurso do Usuario B | 403/404, banco inalterado |
| IDOR-003 | Admin_global tenant A tenta recurso tenant B | 403/404 ou lista vazia |
| IDOR-004 | Admin_reserva/armeiro A1 tenta reserva A2 sem membership | 403/404 |
| IDOR-005 | Superadmin chama rota operacional | 403 |
| IDOR-005B | Superadmin acessa pagina operacional fora de `/nexus` | 403, 404 ou redirect para Nexus |
| IDOR-006 | Bulk IDs misturam autorizado e nao autorizado | falha atomica ou comportamento documentado |
| IDOR-007 | Body injeta `tenant_id`/`reserve_id` de outro escopo | backend ignora autoridade do body |
| IDOR-008 | Storage path privado de outro usuario | sem signed URL |
| IDOR-009 | SSE cross-tenant/reserve | nenhum evento recebido |
| IDOR-010 | Public verify com documento valido | payload minimo, sem PII proibida |
| IDOR-011 | Relatorio/export com filtro de outro tenant | 403/404/lista vazia, sem arquivo |
| IDOR-012 | Search/autocomplete hidrata ID fora de escopo | lista vazia |

---

## Campo 11 - Fixtures

Criar harness com:

- `tenantA`, `tenantB`;
- `reserveA1`, `reserveA2`, `reserveB1`;
- `usuarioA1`, `usuarioA2`, `usuarioB1`;
- `armeiroA1`, `armeiroA2`, `armeiroB1`;
- `adminReservaA1`, `adminReservaA2`, `adminReservaB1`;
- `adminGlobalA`, `adminGlobalB`;
- `auditorA`, `auditorB`;
- `superadmin`;
- recursos equivalentes por tenant/reserva: item, material, lending, cautela, notification, shift, documento e objeto Storage.

Todos os dados criados pela suite devem usar prefixo `[IDOR-TEST]` e cleanup no teardown.

---

## Campo 12 - Validacao

Comandos minimos da fase implementada:

```bash
pnpm --filter @apmcb/bff typecheck
pnpm --filter @apmcb/web typecheck
cd apps/web && pnpm test:e2e --project=idor-suite
cd apps/web && pnpm test:e2e --project=rbac-suite
cd apps/web && pnpm test:e2e --project=multitenant-suite
cd apps/web && pnpm test:e2e --project=chromium
```

Comandos de validacao da documentacao:

```bash
rg -n "TBD|TODO|implement later|fill in" docs/superpowers/specs/2026-07-11-idor-defense-design.md docs/enterprise/phases/phase-idor-defense.md
rg -n "superadmin" apps/bff/src apps/web/src/app apps/web/src/components apps/web/src/lib apps/web/src/hooks apps/web/src/middleware.ts apps/web/e2e
rg -n "searchParams\\.get\\([\"']id|/:id|lending_ids|military_id|tenant_id|reserve_id|document_id" apps/bff/src apps/web/src/app/api
```

---

## Campo 13 - Definition of Done

- [ ] Inventario de identificadores externos completo.
- [ ] Contrato de acesso por recurso documentado.
- [ ] Mutations BFF sensiveis com predicado de escopo na escrita.
- [ ] Excecoes documentadas e testadas.
- [ ] `superadmin` Nexus-only verificado.
- [ ] Toda referencia a `superadmin` fora de `/api/nexus/**` e `/nexus/**` revisada, removida ou documentada como excecao.
- [ ] Rotas/paginas operacionais negam `superadmin` com 403, 404 ou redirect para Nexus.
- [ ] Storage private URL protegido.
- [ ] Realtime/SSE isolado por sessao.
- [ ] Public verify com payload minimo.
- [ ] `idor-suite` passando.
- [ ] Estado pos-mutation validado para tentativas negativas.
- [ ] `docs/security.md` atualizado.
- [ ] Changelog atualizado.
- [ ] Code review de seguranca com nota minima 9/10.

---

## Campo 14 - Rollback

Como a fase e majoritariamente hardening:

1. Reverter commit de codigo com `git revert <sha>`.
2. Se houver migration, criar migration reversa especifica.
3. Reexecutar smoke auth e suites IDOR/RBAC/multitenant.
4. Nunca desabilitar RLS como rollback.

---

## Campo 15 - Relatorio Final

Ao encerrar, criar `docs/enterprise/reports/idor-defense-final-report.md` com:

- escopo planejado vs entregue;
- inventario final;
- arquivos alterados;
- excecoes autorizadas;
- testes executados e outputs;
- achados remanescentes;
- nota de revisao final.
