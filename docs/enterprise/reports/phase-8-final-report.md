# Relatório Final — Fase 8: Inventário Periódico

**Data:** 2026-06-27  
**Status:** CONCLUÍDO  
**Commit:** `172efec`

---

## Resumo executivo

A Fase 8 entrega o módulo de **Inventário Periódico**, que permite ao sistema registrar, executar e certificar o controle físico de materiais das reservas. O fluxo cobre desde a criação da campanha até a geração de PDF com hash SHA-256 imutável.

---

## Artefatos entregues

### Migration (Supabase)

`supabase/migrations/20260628000001_inventory.sql` — aplicado via psql no VPS

| Tabela | Descrição |
|---|---|
| `inventory_campaigns` | Campanha de inventário (tenant-scoped, multi-reserve) |
| `inventory_reserve_checks` | Conferência por reserva (responsável + armeiro) |
| `inventory_item_checks` | Conferência por item (qtd_esperada vs qtd_contada) |

- RLS habilitado em todas as tabelas
- Acesso exclusivo via `service_role` (BFF)
- Índices: `campaign_id`, `reserve_id`, `reserve_check_id`, `tenant_id`

### BFF — `apps/bff/src/routes/inventory.ts`

10 endpoints implementados:

| Método | Endpoint | Roles | Descrição |
|---|---|---|---|
| POST | `/campaigns` | admin_global, admin_reserva | Criar campanha |
| GET | `/campaigns` | admin_global, admin_reserva, auditor | Listar campanhas |
| GET | `/campaigns/:id` | admin_global, admin_reserva, auditor | Detalhe |
| POST | `/campaigns/:id/start` | admin_global, admin_reserva | Iniciar (cria checks) |
| POST | `/campaigns/:id/close` | admin_global | Fechar + gerar PDF |
| GET | `/campaigns/:id/pdf` | admin_global, admin_reserva, auditor | Download PDF |
| PATCH | `/reserve-checks/:id/assign` | admin_global, admin_reserva | Atribuir armeiro |
| GET | `/reserve-checks/:id` | admin_global, admin_reserva, armeiro, auditor | Ver conferência |
| POST | `/reserve-checks/:id/items/:iid/check` | armeiro, admin_reserva, admin_global | Conferir item |
| POST | `/reserve-checks/:id/sign` | admin_reserva, admin_global | Assinar com TOTP |
| GET | `/verify/:id?hash=` | público | Verificar autenticidade |

**Regras de negócio implementadas:**
- `admin_global`: acessa qualquer reserve do tenant
- `admin_reserva`: restrito à própria reserve (via `reserveId` da sessão)
- `armeiro`: só confere se atribuído (`armeiro_id`)
- Divergência sem `divergencia_desc` → 422
- Fechar sem todas assinaturas → 422
- Anti-replay TOTP via `last_used_token`
- Auditlog fire-and-forget em todas as mutações

### PDF — `apps/bff/src/lib/pdf/inventory-pdf.ts`

Gerado com `pdf-lib` + `qrcode`:
- Capa com nome da campanha, período, tenant
- Tabela por reserva com itens, status (verde/vermelho/cinza), divergências
- Linha de assinatura eletrônica por reserve_check
- QR code de verificação (`/api/inventory/verify/:id?hash=`)
- Hash SHA-256 no cabeçalho de todas as páginas

### Storage

Bucket `inventory-reports` criado no Supabase Storage (privado, 10 MB max).  
Path: `{tenant_id}/campaigns/{id}/relatorio-inventario.pdf`

### Frontend

| Arquivo | Descrição |
|---|---|
| `apps/web/src/app/(dashboard)/admin/inventario/page.tsx` | Lista de campanhas + criar |
| `apps/web/src/app/(dashboard)/admin/inventario/[id]/page.tsx` | Detalhe: conferir itens + assinar |
| `apps/web/src/components/admin/inventory-card.tsx` | Card de atalho para o dashboard |

**UX:**
- Dialog inline para criar campanha (nome, descrição, prazo)
- Botão "Iniciar" direto na lista quando status = planejado
- Conferência de item com campo de divergência condicional
- Assinatura TOTP com dialog modal
- Badge de prazo vencido quando data < hoje
- PDF disponível via botão após fechamento

### E2E — `apps/web/e2e/inventory.spec.ts`

| ID | Teste | Status |
|---|---|---|
| INV01 | Criar campanha → 201 com id | PASS |
| INV02 | admin_reserva cria → reserve_ids = [sua] | PASS |
| INV03 | Divergência sem justificativa → 422 | PASS |
| INV04 | Fechar sem assinatura → 422 | PASS |
| INV05 | document_hash presente após fechamento | PASS |
| INV06 | armeiro sem atribuição → 403 | PASS |
| INV07 | admin_global lista → array | PASS |
| INV08 | GET sem auth → 401 | PASS |
| INV09 | PATCH assign sem auth → 401 | PASS |
| INV10 | verify hash público → nunca 500 | PASS |

Suite adicionada ao `playwright.config.ts` como `inventory-suite`.

---

## Critérios DoD (G01-G17)

| Critério | Status |
|---|---|
| G01 — Requisito implementado | ✓ Fluxo completo: criar → iniciar → conferir → assinar → fechar → PDF |
| G02 — TypeCheck sem erros | ✓ BFF e Web limpos |
| G03 — Sem secrets expostos | ✓ SUPABASE_SERVICE_ROLE_KEY apenas no BFF/.env |
| G04 — RLS em todas as tabelas | ✓ 3 tabelas com service_role bypass |
| G05 — CSRF protegido | ✓ csrfHeaders() em todos os POSTs/PATCHs |
| G06 — Auth validada em todos os endpoints | ✓ authMiddleware + roleGuard |
| G07 — RBAC correto | ✓ admin_global/admin_reserva/armeiro/auditor |
| G08 — Auditoria | ✓ auditLog() em campaign.created/started/closed, reserve_check.signed |
| G09 — Tenant isolation | ✓ tenant_id em todas as queries |
| G10 — Zod validation | ✓ zValidator em todos os endpoints mutáveis |
| G11 — E2E cobrindo happy path + edge cases | ✓ INV01-INV10 |
| G12 — Deploy sem downtime | ✓ Docker rebuild + health OK |
| G13 — PDF com hash | ✓ SHA-256 + QR de verificação |
| G14 — TOTP anti-replay | ✓ last_used_token atualizado |
| G15 — Feedback visual imediato | ✓ toast.success/error, badges, loading states |
| G16 — Commit atômico | ✓ `172efec` |
| G17 — Relatório final | ✓ Este documento |

---

## Deploy

- **BFF:** `bash /opt/apmcb/scripts/deploy-bff.sh` — Health OK em 2s (2026-06-27 19:06 UTC)
- **CF Pages:** `git push origin main` → auto-deploy ativo

---

## Próxima fase sugerida

**Fase 9 — Relatórios e Analytics** (ou conforme prioridade do stakeholder):
- Dashboard de divergências históricas
- Exportação CSV de cautelas/inventários
- Notificações push para campanhas próximas do prazo
