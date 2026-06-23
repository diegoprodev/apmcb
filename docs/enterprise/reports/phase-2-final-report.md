# Relatório Final — Fase 2: RBAC Enterprise

**Fase:** 2  
**Data de início:** 2026-06-22  
**Data de encerramento:** 2026-06-22  
**Executor:** Diego Rodrigues + Claude Sonnet 4.6  
**Status final:** ✅ APROVADA

---

## 1. Escopo Planejado

Expandir o sistema de controle de acesso de 3 roles (admin/master/usuario) para 6 roles institucionais (superadmin/admin_global/admin_reserva/armeiro/usuario/auditor), com roleGuard atualizado em todos os endpoints e UI adaptada para esconder/mostrar funcionalidades por role.

---

## 2. Escopo Entregue

- ✅ Tipo `Role` expandido para 6 valores: superadmin, admin_global, admin_reserva, armeiro, usuario, auditor
- ✅ `SessionData.role` tipado com novos roles
- ✅ `HonoVariables` expandido
- ✅ `roleGuard()` atualizado para todos os endpoints do BFF
- ✅ Migration de atualização de profiles existentes (admin→admin_global, master→armeiro)
- ✅ Suite E2E `e2e/rbac.spec.ts` com PT01-PT08
- ✅ UI: sidebar e menus adaptados (role checks corrigidos para novos valores)
- ✅ Correções de `status_legacy` em todas as páginas do frontend

---

## 3. Arquivos Alterados

| Arquivo | Tipo | Motivo |
|---|---|---|
| `supabase/migrations/20260620000002_rbac_roles.sql` | CRIADO | CHECK constraint 6 roles + migration de dados |
| `apps/bff/src/types/hono.ts` | MODIFICADO | Tipo Role expandido |
| `apps/bff/src/middleware/role-guard.ts` | MODIFICADO | roleGuard para 6 roles |
| `apps/bff/src/lib/session.ts` | MODIFICADO | SessionData.role tipado |
| `apps/bff/src/routes/lendings.ts` | MODIFICADO | roleGuard com novos roles |
| `apps/bff/src/routes/ssa.ts` | MODIFICADO | roleGuard com novos roles |
| `apps/bff/src/routes/arsenal.ts` | MODIFICADO | roleGuard com novos roles |
| `apps/bff/src/routes/nexus.ts` | MODIFICADO | roleGuard superadmin |
| `apps/web/src/app/(dashboard)/admin/usuarios/_users-table.tsx` | MODIFICADO | role checks para novos valores |
| `apps/web/src/app/(dashboard)/admin/usuarios/_edit-dialog.tsx` | MODIFICADO | UserData com role tipado |
| `apps/web/src/app/(dashboard)/admin/usuarios/_user-actions.tsx` | MODIFICADO | role checks |
| `apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx` | MODIFICADO | status_legacy |
| `apps/web/e2e/rbac.spec.ts` | CRIADO | PT01-PT08 |
| `apps/web/playwright.config.ts` | MODIFICADO | rbac-suite registrada |

---

## 4. Migrations Criadas

| Arquivo | O que criou/alterou |
|---|---|
| `20260620000002_rbac_roles.sql` | CHECK constraint em profiles.role com 6 valores; UPDATE admin→admin_global, master→armeiro; superadmin para primeiro admin_global |

---

## 5. Endpoints Envolvidos

Nenhum novo endpoint. roleGuard aplicado em todos os existentes:

| Método | Path | Roles permitidos | Status |
|---|---|---|---|
| POST | `/api/lendings` | armeiro, admin_reserva, admin_global | ✅ |
| PATCH | `/api/lendings/:id/return` | armeiro, admin_reserva, admin_global | ✅ |
| GET | `/api/lendings` | armeiro, admin_reserva, admin_global, usuario, auditor | ✅ |
| POST | `/api/ssa` | usuario, armeiro | ✅ |
| PATCH | `/api/ssa/:id/approve` | armeiro, admin_reserva | ✅ |
| GET | `/api/dashboard/summary` | admin_reserva, admin_global | ✅ |
| GET | `/api/nexus/*` | superadmin (nexus) | ✅ |

---

## 6. Componentes Criados ou Alterados

| Componente | Caminho | Ação |
|---|---|---|
| `_users-table.tsx` | `admin/usuarios/` | MODIFICADO — role checks |
| `_edit-dialog.tsx` | `admin/usuarios/` | MODIFICADO — UserData tipado |
| `_user-actions.tsx` | `admin/usuarios/` | MODIFICADO — role checks |

---

## 7. Testes Executados

| Suite | Resultado |
|---|---|
| rbac-suite (PT01-PT08) | ✅ 8/8 passando |
| multitenant-suite | ✅ 14/14 passando (sem regressão) |
| suite principal | ✅ passando |
| ssa-suite | ✅ passando |
| nexus-suite | ✅ passando |
| rate-limit | ✅ passando |

**Commits de correção:**
- `07511f9` fix(rbac-suite): PT03/PT04 createTempUser com matricula numérica e registration_status correto
- `ad568e8` chore(changelog): registra Fase 2 RBAC Enterprise e atualiza roadmap
- `eb4981d` feat(rbac): Fase 2 — RBAC Enterprise com 6 roles institucionais

---

## 8. Build e Typecheck

```
pnpm --filter web build     → ✅ OK (2026-06-23)
pnpm --filter web typecheck → ✅ OK (zero erros)
```

---

## 9. Riscos Remanescentes

- RT01: RLS por lookup de tenant_memberships (não JWT claim nativo) — mitigado por TT01 passando; JWT claim planejado para Fase 7B
- RT02: `admin_reserva` isolamento por unidade_id não completamente validado — Fase 7B
- RT03: Usuário admin.tsx (`/admin/usuarios`) com roles inline — resolvido nesta sessão (2026-06-23)

---

## 10. Itens Fora do Escopo (não implementados nesta fase)

- UI completa de gestão de usuários e roles → Fase 7+
- Delegação de permissões (admin_global criar admin_reserva) → Fase 7
- Permissões granulares por feature → pós-piloto

---

## 11. Rollback Disponível

1. `git revert eb4981d ad568e8 07511f9` + redeploy
2. DROP CONSTRAINT profiles_role_check + UPDATE roles de volta

---

## 12. Checklist de Definition of Done

| Critério | Status |
|---|---|
| G01: Escopo correto | ✅ |
| G02: Sem feature extra | ✅ |
| G03: UI consistente | ✅ |
| G04: tenant_id nas queries | ✅ (Fase 1) |
| G05: RBAC aplicado | ✅ PT01 passando |
| G06: Auditoria | N/A (Fase 3) |
| G07: Documentos protegidos | N/A (Fase 4) |
| G08: Sem dado sensível em log | ✅ |
| G09: Input validado com Zod | ✅ |
| G10: Fluxos testados | ✅ PT01-PT08 |
| G11: Build | ✅ |
| G12: Typecheck | ✅ |
| G13: Lint | ✅ |
| G14: Testes passando | ✅ 8/8 |
| G15: Regressão passando | ✅ |
| G16: Smoke test | ✅ |
| G17: Relatório gerado | ✅ (este arquivo) |

---

## 13. Conclusão

**Status:** APROVADA

Fase 2 estabeleceu o RBAC enterprise com 6 roles institucionais cobrindo toda a hierarquia operacional: superadmin (Nexus), admin_global (tenant), admin_reserva (reserva), armeiro (operador), usuario (militar/cadete), auditor (controle). Todos os endpoints do BFF foram protegidos por `roleGuard()`. PT01 (role insuficiente → 403) passou como critério de bloqueio. Nenhuma escalada de privilégio foi detectada em 8 cenários de teste.

**Próxima fase:** Fase 3 — Audit Events com Hash Encadeado ✅ (já concluída)
