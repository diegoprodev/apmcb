# CHANGE_OWNERSHIP — mapa de áreas (baseline 0, HEAD `bf0aa0f`)

> Ownership aqui = "qual frente/escopo é dono de mudanças nesta área e com quem precisa
> coordenar". Onde a arquitetura não permite separação limpa, está marcado **SHARED_CRITICAL**.
> Regra prática: arquivo SHARED_CRITICAL → **um agente/branch por vez**, merge em ordem.

---

## Visão rápida dos pontos de colisão

Os arquivos abaixo aparecem em 3+ áreas e concentram o risco de conflito:

| Arquivo | Linhas | Áreas que dependem dele |
|---|---|---|
| `apps/bff/src/routes/cautelamentos.ts` | 1871 | DOCUMENT_ENGINE, DOCUMENT_ARTIFACT, BIOMETRIA (WIP), SECURITY_SCOPE |
| `apps/bff/src/routes/ssa.ts` | 1402 | SECURITY_SCOPE (SoD, reserva), FRONTEND (efetivo) |
| `apps/bff/src/routes/shifts.ts` | 804 | BIOMETRIA (WIP), DOCUMENT_ENGINE (livro) |
| `apps/bff/src/middleware/auth.ts`, `routes/auth.ts`, `routes/session.ts`, `lib/session.ts` | — | SECURITY_SCOPE, INFRA_HIBRIDA (AuthProvider), Modo Usuário |
| `supabase/migrations/**` | 178 arquivos | todas |
| `CHANGELOG.md` | 350 KB | todas |

---

## SECURITY_SCOPE — **SHARED_CRITICAL**

- **Diretórios**: `apps/bff/src/middleware/`, `apps/bff/src/lib/{session,session-guard,reserve-scope,reserve-staff,active-reserve,shift-guard,totp-guard,crypto,audit-*}.ts`, `apps/bff/src/routes/{auth,session,reserves,profiles,admin,ssa,dashboard,totp,nexus}.ts`, RLS/RPC guards em `supabase/migrations/*reserve_rls*`, `*rpc_guard*`.
- **Arquivos críticos**: `middleware/auth.ts` (papel efetivo, Modo Usuário, fallback Bearer), `middleware/role-guard.ts`, `lib/reserve-scope.ts`, `routes/session.ts` (toggle), `routes/reserves.ts` (troca de reserva), `routes/totp.ts`.
- **Dependências cruzadas**: AuthProvider (INFRA_HIBRIDA) está dentro de `auth.ts`/`middleware/auth.ts`/`session.ts`; biometria consome `lib/biometric-authorization.ts` (WIP); toda rota de negócio consome `reserveId`/`tenantId` da sessão.
- **Risco de conflito**: ALTO com INFRA_HIBRIDA; MÉDIO com BIOMETRIA.

## DOCUMENT_ENGINE (regras de emissão/assinatura/hash)

- **Diretórios**: `apps/bff/src/lib/{document-hash,signature-proof,snapshot,shift-events,audit-hash}.ts`, `apps/bff/src/routes/{signatures,cautelamentos,handovers,inventory,shifts}.ts` (trechos de hash/assinatura), `routes/public.ts` (verificação de turno), `supabase/migrations/*document_signatures*`, `*signatures_triggers*`.
- **Arquivos críticos**: `lib/document-hash.ts` (R-01), `routes/signatures.ts` (verify público, revoke — R-07), `makeDocHash` em `cautelamentos.ts` e em `handovers.ts` (dois algoritmos distintos).
- **Dependências cruzadas**: BIOMETRIA (assinatura biométrica de cautela/turno — WIP reescreve), TOTP.
- **Risco de conflito**: ALTO com WIP_BIOMETRIA (`cautelamentos.ts`, `shifts.ts`). → **SHARED_CRITICAL** nos handlers `sign-*`.

## DOCUMENT_ARTIFACT (PDF/QR/página de verificação)

- **Diretórios**: `apps/bff/src/lib/pdf/*` (cautela, handover, histórico, inventário, livro, tema, datas), `apps/bff/src/assets/`, `apps/web/src/app/v/**` (páginas públicas `/v/:id`, `/v/turno`, `/v/inventario`, `/v/passagem`).
- **Arquivos críticos**: `lib/pdf/cautela-pdf.ts` (QR → `${WEB_PUBLIC_URL}/v/${id}`), `lib/pdf/inventory-pdf.ts` (QR com `?hash=`), `app/v/[document_id]/page.tsx` (chama `/api/verify/:id`).
- **Dependências cruzadas**: DOCUMENT_ENGINE (hash exibido é o do banco, não do PDF).
- **Risco de conflito**: BAIXO (isolável), exceto `GET /:id/pdf` dentro de `cautelamentos.ts`.

## BIOMETRIA — WIP_BIOMETRIA

- **Diretórios**: `apps/bridge-windows/**`, `apps/bff/src/routes/{biometric,biometric-bridge,biometric-simulator}.ts`, `apps/bff/src/lib/biometric-*.ts`, `apps/bff/src/lib/shift-auth.ts`, `apps/bff/src/middleware/biometric-device-auth.ts`, `apps/bff/src/services/fingerprint/**` (removido na WIP), `apps/web/src/components/{biometric,cautelas/sign-dialog*,livro/shift-auth-dialog*,ui/finger-selector*}`, `docker-compose.biometric.yml`, migrations `*biometric*`.
- **Dependências cruzadas**: cautela/turno (DOCUMENT_ENGINE), RPCs de saída (`record_lending_*`), sessão/escopo (`biometric-authorization.ts`).
- **Risco de conflito**: ALTO — branch ativa hoje com 54 arquivos.

## INFRA_HIBRIDA — WIP_INFRA_HIBRIDA

- **Diretórios**: `docker-compose*.yml`, `apps/bff/Dockerfile`, `apps/bff/ecosystem.config.cjs`, `infra/**`, `scripts/{deploy,setup-vps,cf-build}.sh`, `.github/workflows/**`, `apps/bff/src/lib/{infra-env,auth-provider,auth-provider-factory,local-auth-provider}.ts`, `apps/bff/scripts/provision-local-user.ts`, `MIGRATION_SPEC.md`, `supabase/config.toml`.
- **Dependências cruzadas**: `routes/auth.ts`, `middleware/auth.ts`, `routes/session.ts` (SECURITY_SCOPE); `services/supabase.ts` (toda rota).
- **Risco de conflito**: ALTO nos 3 arquivos de auth/sessão; BAIXO no resto.

## ONPREM — sub-escopo de INFRA_HIBRIDA

- **Diretórios**: `supabase/onprem-bootstrap/**`, migration `20260923120000_usuarios_onprem.sql`, `LocalAuthProvider`, futuros `docker-compose.onprem.yml`/Storage S3/LISTEN-NOTIFY (não encontrados).
- **Dependências cruzadas**: `supabase/migrations/**` (toda migration nova precisa rodar nos dois alvos — hoje a cadeia não roda em Postgres puro, T11).
- **Risco de conflito**: MÉDIO (migrations).

## QA_AUDIT

- **Diretórios**: `docs/auditoria/**` (este processo), `apps/bff/src/__tests__/**`, `apps/web/e2e/**`, `apps/web/src/**/*.test.ts(x)`, `supabase/tests/**`, `scripts/spike-reserva/**`, `scripts/ci/**`, `supabase/ci/policy-snapshot.json`, `docs/security/**`, `docs/enterprise/04-regression-test-strategy.md`.
- **Dependências cruzadas**: testes co-localizados com código de cada área → um PR de remediação deve trazer seu teste junto.
- **Risco de conflito**: BAIXO em `docs/auditoria`; MÉDIO nos `__tests__` que a WIP_BIOMETRIA também altera (`biometric-*`, `idor-write-scope.test.ts`, `actor-reserve-access-staff-filter.test.ts`).

## FRONTEND

- **Diretórios**: `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/hooks/**`, `apps/web/src/lib/**`, `apps/web/src/middleware.ts`, `apps/web/public/**`.
- **Arquivos críticos**: `app/(dashboard)/layout.tsx` (lê `apmcb_mode`), `app/(dashboard)/reserva/layout.tsx` (redirect Modo Usuário), `hooks/use-user-menu-actions.ts` (toggle), `app/api/mode/route.ts` (proxy legado), `middleware.ts`.
- **Observação**: `apps/web/public/sw.js` é gerado pelo build **e versionado** — todo build suja a árvore → conflito trivial recorrente.
- **Risco de conflito**: MÉDIO com BIOMETRIA (componentes de captura/telas de cautela e livro).

## DATABASE — **SHARED_CRITICAL**

- **Diretórios**: `supabase/migrations/**`, `supabase/functions/**`, `supabase/scripts/**`, `supabase/tests/**`, `supabase/ci/**`.
- **Arquivos críticos**: helpers `assert_actor_in_reserve`/`assert_device_in_reserve`/`assert_resource_in_reserve` (`20260915230000`), RLS grupos A/B/C, `record_lending_batch`/`record_lending_returns` (`20260923023207`), `document_signatures` triggers (`20260625000004`), `seed_dev` (`20260611000003`).
- **Dependências cruzadas**: todas as frentes; produção já recebeu correções "ao vivo" (CHANGELOG v53) → risco de drift repo×banco.
- **Risco de conflito**: ALTO — timestamps de migration e ordem de aplicação. Regra proposta: **uma migration por PR, timestamp reservado no momento do merge**.
