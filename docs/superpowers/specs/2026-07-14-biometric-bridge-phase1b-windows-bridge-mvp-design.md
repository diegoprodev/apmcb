# APMCB — Spec: Biometric Bridge Phase 1B — Contrato de Device-Auth do Bridge no BFF

**Data:** 2026-07-19 (v1 formalizada; código-fonte escrito em sessão anterior, nunca commitado)
**Status:** v3 — spec de arquitetura aprovada (9.6/10); code review obrigatório de implementação encontrou 1 CRÍTICO + 2 ALTO adicionais, todos corrigidos e aplicados em produção antes do commit
**Precede:** [`2026-07-14-biometric-bridge-design.md`](2026-07-14-biometric-bridge-design.md) (arquitetura mestra), [`2026-07-14-biometric-bridge-phase1a-armeiro-ux-design.md`](2026-07-14-biometric-bridge-phase1a-armeiro-ux-design.md)
**Auditoria de referência:** [`docs/security/reports/biometric-bridge-architecture-audit-2026-07-14.md`](../../security/reports/biometric-bridge-architecture-audit-2026-07-14.md)
**DoD de fases anteriores:** [`Phase 0`](../../enterprise/reports/2026-07-14-biometric-bridge-phase0-dod.md), [`Phase 1A.1`](../../enterprise/reports/2026-07-14-biometric-bridge-phase1a1-dod.md), [`Phase 1A.2`](../../enterprise/reports/2026-07-15-biometric-bridge-phase1a2-dod.md), [`Phase 1A.2 closure`](../../enterprise/reports/2026-07-16-biometric-bridge-phase1a2-closure-dod.md)

**Histórico de revisão:**
- **v1 → 7.8/10** (revisor verificou contra código real: rodou os testes, leu cada arquivo, consultou `list_migrations` real). Achados que sobreviveram: (A1) migration local `20260716000001_...` divergia do nome real em produção (`20260716142223_...`) — a própria tabela §1.2 já citava o nome correto, só o arquivo em disco estava errado; (A2) `POST /api/biometric/devices/:id/revoke` já existe, completo, auditado (`biometric.ts:298-339`) — a v1 deixava isso como "pendência de investigação" em 4 lugares diferentes, contradizendo a própria alegação de ter "lido cada arquivo"; (A3) revogação não tinha NENHUM caminho de UI — só a API; (M1) §4 superestimava a proteção contra uma refatoração futura hipotética de `authMiddleware` para um wildcard `/api/*`; (M2) tabela §3.3 cobria só 5 dos 12 itens da checklist original da auditoria, com numeração divergente; (M3) device revogado pode ser reativado silenciosamente via colisão de `device_name` no re-pareamento, não discutido; (M4) `templates/sync` dá a qualquer bridge pareado acesso a todos os templates do tenant (não só da própria reserva) — raio de explosão de um device roubado não estava documentado; (M5) plano de fechamento sem menção a teste de carga/pentest/colisão de nonce; (B1) duplicata do A1; (B2) subestimava cobertura de teste de expiração de challenge (já coberta indiretamente via `biometric-proof.test.ts:101-104`).
- **v2 → 9.6/10, "PRONTA PARA IMPLEMENTAÇÃO"** corrigiu todos os itens acima: migration renomeada; revoke endpoint documentado como resolvido (não pendência); UI de revogação implementada (`_biometric-console-client.tsx`, admin-only, mesmo teto de papel do BFF); §4 qualificada; §3.3 expandida para os 12 itens originais; M3/M4/M5 documentados explicitamente como riscos residuais aceitos (não omitidos); E2E spec registrado no projeto Playwright `"suite"`. Essa nota é sobre a **arquitetura** — a spec em si estava correta e completa.
- **v3** (esta versão): depois da v2 aprovada, segui para a implementação (wiring da rota, suíte de testes, build) e disparei o code review obrigatório do CLAUDE.md (regra canônica antes de qualquer commit) — dessa vez focado em **implementação**, não arquitetura. Achado honesto: a revisão de arquitetura (2 rodadas, ambas rigorosas, ambas verificando contra código real) **não pegou** um bug real na implementação do RPC de pareamento que tornava o próprio risco M3 (já documentado como "aceitável, exige admin legítimo") estritamente mais grave do que a v2 descrevia — ver CRÍTICO #1 abaixo. Isso não invalida as 2 rodadas anteriores (elas verificaram exatamente o que se propuseram a verificar, e verificaram bem), mas confirma por que este projeto trata "revisão de spec/arquitetura" e "code review de implementação" como duas camadas obrigatórias distintas, não uma substituindo a outra. Achados do code review de implementação, todos corrigidos e aplicados em produção antes deste commit:
  - **CRÍTICO** — `consume_biometric_pairing_code` (migration): `ON CONFLICT (tenant_id, device_name) DO UPDATE` não incluía `reserve_id` no `SET`. Um `admin_reserva` autorizado **só** numa Reserva B podia gerar um pairing_code legítimo para B e, ao chamar `/pair` com o `device_name` de um device já ativo na Reserva A (mesmo tenant), sequestrar a identidade desse device — `public_key` substituída, `status` reativado, mas `reserve_id` continuava sendo o de A, então o device resultante autenticava como pertencente a A no `deviceAuthMiddleware`, sem o ator jamais ter tido autorização sobre A. Nenhum teste (unit ou E2E) cobria esse branch do RPC. **Fix**: migration nova (`20260719230524_biometric_bridge_phase1b_security_fixes.sql`, já aplicada em produção) rejeita a colisão quando a reserva do pairing_code difere da reserva já registrada para aquele `(tenant_id, device_name)`, levantando `BIOMETRIC_PAIRING_DEVICE_RESERVE_MISMATCH`.
  - **ALTO** — `biometric_device_request_nonces` sem limpeza real: o comentário da tabela prometia "limpar via pg_cron" mas nenhum job existia. **Fix**: mesma migration, job `cleanup-biometric-device-request-nonces` (hora em hora, retenção 24h), mesmo padrão de `revoked_sessions`.
  - **ALTO** — `limit_req_zone` do nginx (`infra/nginx/api.apmcb.pmpb.online.conf`, aplicado no VPS real) chaveava `/api/` inteiro por IP — anulava o propósito do bucket `rateLimitBiometricBridge` (chaveado por device_id) sempre que 2+ bridges compartilhassem o mesmo IP de saída. **Fix**: nova `location /api/biometric-bridge/` sem `limit_req` (o bucket do BFF já cobre), aplicada no VPS via SSH com `nginx -t` antes do reload, backup do config anterior mantido em `/root/apmcb.nginx.bak-*`.
  - **MÉDIO** (2 de 4 corrigidos, 2 documentados como follow-up não bloqueador): `last_ip` agora só grava quando muda e não bloqueia a resposta (`biometric-device-auth.ts`); cursor de `templates/sync` agora composto `(updated_at, id)` em vez de só `updated_at`, evitando descartar linhas silenciosamente sob timestamps colididos; teste comportamental novo para `rateLimitBiometricBridge` (chaveamento por device confirmado, não só grep estático). Não corrigidos nesta v3 (ver seção 8): campos `device_detected`/`device_model` do heartbeat validados mas nunca persistidos (schema incompleto — sem consumidor real até o app bridge existir); duplicação de fetch de `biometric_devices` entre middleware e handlers (TOCTOU recheck intencional, não documentado como tal).
  - Uma re-revisão focada (rodada dedicada, só nos 3 achados acima) confirmou os 3 fixes DIRETAMENTE em produção — não só no arquivo de migration: `SELECT prosrc FROM pg_proc` confirmou o corpo real da função em produção idêntico ao da migration; `SELECT * FROM cron.job` confirmou o job de limpeza ativo. Único gap apontado: nenhum teste cobria o branch exato do CRÍTICO — fechado no mesmo ciclo com `PB08` (`biometric-bridge-phase1b.spec.ts`), que reproduz o cenário completo (pairing_code legítimo de uma 2ª reserva, mesmo `device_name` de um device ativo na 1ª, confirma rejeição `BIOMETRIC_PAIRING_DEVICE_RESERVE_MISMATCH` e que o device original não foi alterado no banco). Achado BAIXO da mesma rodada: o arquivo local da migration tinha timestamp `20260719000001`, divergente do registrado em produção (`20260719230524`) — renomeado antes do commit, mesmo padrão do fix do A1 na v1→v2.

---

## 0. Correção de nome — leia isto antes do resto

O arquivo se chama "windows-bridge-mvp" porque foi assim que os comentários no código (escritos numa sessão anterior, nunca revisados até agora) já referenciavam este documento antes de ele existir. **O nome está impreciso**: esta fase NÃO entrega um app Windows. Ela entrega o **contrato do lado do BFF** que um app Windows futuro vai consumir — pareamento, autenticação de dispositivo por assinatura, polling de desafios, submissão de prova. Mantido neste caminho para não invalidar ~10 referências cruzadas já escritas no código; a seção 8 (Fora de Escopo) e a seção 9 (Próximas Fases) deixam a fronteira real explícita.

Isso responde diretamente à pergunta "quando testamos o leitor no meu notebook simulando o armeiro em produção": **não nesta fase**. Ver seção 9.

---

## 1. Contexto

### 1.1 O que já está em produção (Fases 0, 1A.1, 1A.2 — commitadas, revisadas, deployadas)

- Tabelas `biometric_devices`, `biometric_challenges`, `biometric_proofs` (Fase 0).
- Fluxo challenge/proof completo para cadastro, saída e devolução de material — mas **validado inteiramente contra o simulador de bridge** (`BIOMETRIC_SIMULATOR_ENABLED`), nunca contra hardware NITGEN real. Isso já era um risco residual **explicitamente registrado** no relatório de fechamento da 1A.2 (seção 11: *"Hardware NITGEN real não validado — gate explícito para a próxima fase"*).
- `/reserva/biometria` (console do armeiro) já lista devices e mostra estado "Pareie ou reative um bridge antes de iniciar" quando não há device ativo — a UI já espera um device real, só não existe nenhum caminho para criar um.
- Libs de negócio já auditadas e reaproveitadas por esta fase, **sem nenhuma alteração**: `biometric-proof.ts` (assinatura da prova, `assertChallengeAcceptsProof`), `biometric-enrollment.ts` (`recordBiometricEnrollment`), `biometric-policy.ts` (`assertBiometricPolicy`, threshold de score, liveness).

### 1.2 O que foi escrito nesta sessão anterior (achado nesta retomada, no disco, nunca commitado)

Investigação completa feita agora (ler cada arquivo, rodar os testes, conferir migrations contra o banco real):

| Arquivo | Linhas | Estado |
|---|---|---|
| `apps/bff/src/routes/biometric-bridge.ts` | 484 | Completo — 5 rotas bridge-facing |
| `apps/bff/src/lib/biometric-device-auth.ts` | 68 | Completo — canonicalização + verificação Ed25519 do request |
| `apps/bff/src/middleware/biometric-device-auth.ts` | 99 | Completo — `deviceAuthMiddleware` |
| `apps/bff/src/lib/biometric-pairing-code.ts` | 35 | Completo — geração/hash do código one-time |
| `apps/bff/src/routes/biometric.ts` (diff) | +62 | `POST /api/biometric/pairing-codes`, browser-facing, admin-only |
| `apps/bff/src/middleware/rate-limit.ts` (diff) | +32 | Bucket dedicado `rateLimitBiometricBridge`, chaveado por device, não IP |
| `apps/bff/src/types/hono.ts` (diff) | +9 | Variáveis de contexto do device autenticado |
| `apps/bff/.env.example` (diff) | +43 | 8 novas env vars documentadas |
| `apps/bff/src/__tests__/biometric-device-auth.test.ts` | 180 | 15 testes — canonicalização, assinatura, skew, wiring estático |
| `apps/bff/src/__tests__/biometric-pairing-code.test.ts` | 60 | 9 testes — formato, hash, fail-closed sem pepper |
| `apps/web/e2e/biometric-bridge-phase1b.spec.ts` | 329 | 7 cenários E2E (PB01–PB07) com bridge falso Ed25519 real |
| `supabase/migrations/20260716142223_biometric_bridge_phase1b_device_auth.sql` | 154 | **Já aplicada em produção** (confirmado via `list_migrations`) |
| `supabase/migrations/20260716142628_biometric_templates_updated_at.sql` | 23 | **Já aplicada em produção** (idem) |

Ambas as migrations estão live no banco de produção (`jepitcrkicwmvzrmllpn`) desde 2026-07-16 — o schema já existe; só o código da aplicação nunca chegou a ser commitado.

### 1.3 Por que ficou pausado

Comentário encontrado em `apps/bff/src/index.ts` (código já commitado, sem o import de `biometricBridgeRoutes`):

> *"Bridge Windows real (Phase 1B) — wiring revertido temporariamente (2026-07-17): os arquivos de `src/routes/biometric-bridge.ts` e libs relacionadas ainda não foram commitados (aguardando review completo do changeset, pausado pelo incidente de logout no PWA iOS), mas `index.ts` já tinha sido commitado importando o módulo — quebrou o TypeScript Check em CI ('Cannot find module'). Retomar a montagem quando o Phase 1B for commitado como um todo."*

Ou seja: alguém (sessão anterior) chegou a montar a rota, quebrou o CI porque o restante do changeset não tinha sido commitado junto, reverteu só o wiring para destravar o pipeline, e o resto ficou solto — exatamente o estado em que esta sessão encontrou o repositório.

### 1.4 Verificação do estado real (rodada agora, não presumida)

- `npx tsc --noEmit` (apps/bff): **limpo**.
- `bun test src/__tests__/biometric-device-auth.test.ts src/__tests__/biometric-pairing-code.test.ts`: **23/24 passam**. 1 falha: *"app.route('/api/biometric-bridge', ...) existe e authMiddleware nunca é aplicado a esse path"* — falha porque a rota **não está montada** hoje (consequência direta de 1.3, não um bug de lógica).
- `mcp__supabase__list_migrations`: as 2 migrations de 1B aparecem na lista de migrations aplicadas.
- Nenhuma UI web chama `/api/biometric/pairing-codes` (`grep -rl "pairing" apps/web/src` = vazio) — confirma 1.1 (não há caminho de admin para gerar o código ainda).

---

## 2. Objetivo desta fase (escopo real, corrigido)

Fechar exatamente o que já está implementado no disco — o contrato de device-auth do lado do BFF — com o mesmo rigor de revisão das fases anteriores, e commitá-lo. Não expandir escopo (sem UI de pareamento, sem app bridge — ver seção 8).

Concretamente:

1. Um device (bridge) se autentica perante o BFF por **assinatura Ed25519 do request HTTP inteiro** (método + path + hash do body + timestamp + nonce + device id), nunca por cookie/sessão de usuário.
2. Um admin autorizado (`admin_reserva`/`admin_global`) gera um código de pareamento one-time via sessão normal (browser-facing, já autenticado).
3. O device consome esse código uma única vez para se registrar (`POST /pair`), recebendo `device_id` e o `tenant_id`/`reserve_id` do código — nunca do que o cliente afirma no body.
4. Device pareado faz polling de desafios pendentes, sincroniza templates, submete provas de identificação/assinatura e de enrollment — reaproveitando 100% da lógica de negócio já auditada nas Fases 1A.1/1A.2 (mesmas RPCs, mesma política de score/liveness/tenant).
5. Revogação (`status != 'active'`) e replay (nonce único) derrubam o device imediatamente, sem depender de restart do BFF.

---

## 3. Arquitetura implementada — revisão técnica

### 3.1 Duas assinaturas distintas, propositalmente

O código separa dois conceitos que a spec mestra original (seção "Prova Biométrica") não distinguia explicitamente, e que a auditoria (achado 1, "falta mecanismo concreto de device attestation") pedia:

- **Assinatura do REQUEST** (`biometric-device-auth.ts`, `canonicalDeviceRequest`): prova que quem está falando com o BFF agora, neste request específico, é o dispositivo pareado — cobre método, path, hash do body, timestamp, nonce, device id. Verificada pelo `deviceAuthMiddleware` **antes** de qualquer handler rodar.
- **Assinatura da PROOF** (`biometric-proof.ts`, já existente desde 1A.2, `verifyBridgeSignature`): prova que o resultado biométrico específico (`matched_user_id`, `match_score`, `finger_index`...) foi produzido por aquele device — payload JSON canonicalizado (chaves ordenadas), não o request HTTP.

Isso é o desenho correto: a assinatura do request evita que um MITM ou um ator com acesso à rede da reserva consiga *reenviar* requests de heartbeat/polling como se fosse o device (mesmo sem saber o conteúdo de uma proof real), enquanto a assinatura da proof garante não-repúdio do resultado biométrico em si, mesmo que alguém comprometesse o transporte. Dois nonces, dois momentos, dois propósitos — não é duplicação, é defesa em profundidade real.

### 3.2 Fechamento do achado CRITICAL C1 da auditoria (verificado, não presumido)

A auditoria de 2026-07-14 não previa isto porque na época não havia código de device-auth — mas a implementação atual documenta e testa explicitamente um risco que só apareceria *depois* de implementar: se `/api/biometric-bridge/*` fosse montada sob (ou depois de, na ordem de registro do Hono) `app.use("/api/biometric/*", authMiddleware)`, todo request do bridge morreria com 401 antes de `deviceAuthMiddleware` rodar — o bridge não tem cookie nem JWT de usuário.

Mitigação, verificada em 3 camadas independentes:
1. **Path não-ambíguo**: `/api/biometric-bridge/*` não casa com o padrão `/api/biometric/*` (falta a barra depois de `biometric`) — não depende de ordem de registro no Hono, é uma propriedade estrutural do path.
2. **Teste estático** (`biometric-device-auth.test.ts`, linhas 120-137): grep contra o `index.ts` real confirmando que `app.route("/api/biometric-bridge", ...)` existe e que nenhum `app.use(...)` mira esse prefixo.
3. **Teste E2E dinâmico** (`PB04`, `biometric-bridge-phase1b.spec.ts`): heartbeat contra produção-shape real, só com headers de device-auth, **sem** `Authorization`/cookie, esperando 200 — prova em runtime, não só em análise estática de texto.

**Correção da v1 (achado M1 da revisão)**: os 3 mecanismos acima protegem contra a ordem/wiring de HOJE. Nenhum dos dois primeiros protege contra uma refatoração futura hipotética que trocasse o wildcard atual por algo como `app.use("/api/*", authMiddleware)` (um "simplificar tudo num só lugar" plausível) — o teste estático só verifica ausência do path literal `/api/biometric-bridge` num `app.use`, não pegaria um wildcard mais amplo que também o interceptasse por acidente. **A defesa real contra esse cenário é só o teste E2E dinâmico (PB04)**, e só enquanto ele estiver rodando de fato em CI a cada push — por isso ele foi registrado no projeto Playwright `"suite"` nesta v2 (`playwright.config.ts`), que é executado pelo job `e2e-suite` do `ci-cd.yml` a cada push para `main`. Antes desta v2, o arquivo `biometric-bridge-phase1b.spec.ts` não estava registrado em **nenhum** projeto Playwright — não rodava nem manualmente via `pnpm test:e2e`, muito menos em CI. Isso significa que, até agora, mesmo o PB04 não seria pego automaticamente. Corrigido nesta versão.

Avaliação revisada: **achado C1 fechado corretamente para o wiring de hoje**, com proteção estrutural + estática permanentes e uma rede de segurança dinâmica (PB04) que agora, com o registro em CI, também cobre regressões futuras de wildcard — mas essa cobertura dinâmica é a única linha de defesa real contra esse cenário específico, não "triplo reforço equivalente" como a v1 sugeria.

### 3.3 Checklist da auditoria original — os 12 itens, status real

**Correção da v1 (achado M2)**: a versão anterior desta spec mapeava só 5 dos 12 itens da seção "Lista objetiva de ajustes" da auditoria mestra, com numeração própria que não batia com a original. Tabela completa abaixo, numeração idêntica à da auditoria:

| # | Item da auditoria original | Status nesta fase |
|---|---|---|
| 1 | Protocolo de pareamento (Ed25519, código curto, onde a chave privada fica armazenada) | **Metade resolvida**: par de chaves Ed25519 + código curto (`APMCB-XXXX-XXXX`, 40 bits de entropia) — resolvido no BFF. Armazenamento da chave privada (DPAPI) é responsabilidade do app bridge, que não existe ainda (seção 8/9). |
| 2 | 1:N tenant-wide, nunca global; `tenant_id NOT NULL` em `biometric_templates` | `templates/sync` e `challenges/next` filtram corretamente por `tenant_id`/`reserve_id` do device pareado. **Não resolvido**: achado 5 original (`biometric.ts` `/identify` legado, busca sem filtro nenhum) é código antigo, fora do escopo desta fase — continua pendente. Não verificado nesta spec se `tenant_id` já é `NOT NULL` em produção. |
| 3 | Substituir "armeiro só registra a própria biometria" por escopo de reserva/tenant + turno ativo | **Não investigado nesta fase** — pertence ao endpoint legado `biometric.ts` `/register`, não tocado pelo changeset 1B. Marcar como pendência rastreada separadamente, não assumir resolvido. |
| 4 | Adicionar `biometric_devices`/`challenges`/`proofs` ao modelo de dados da spec | Resolvido desde a Fase 0 (já em produção) — fora do escopo temporal desta fase. |
| 5 | Binding de `document_hash` no momento do CONSUMO do challenge, não só na emissão | `assertChallengeAcceptsProof` (reaproveitada de 1A.2, não alterada por esta fase) já faz essa checagem — confirmado em `biometric-proof.ts` (não obrigatoriamente relido linha a linha nesta v2; heranca direta de código já revisado/committado em 1A.2). |
| 6 | Rate limit/lockout dedicado a tentativas biométricas | **Rate limit resolvido**: bucket `rateLimitBiometricBridge`, chaveado por `X-Bridge-Device-Id` (não IP). **Lockout por falhas consecutivas continua pendente** — ver seção 6/8. |
| 7 | Corrigir os 2 bugs de URL (`/biometric/register`, `/biometric/identify` sem `/api`) | Não investigado nesta fase — endpoints legados, fora do changeset 1B. Pendência rastreada, não confirmada resolvida em fase anterior. |
| 8 | Corrigir divergência doc (`armeiro-journey.md`) vs. código sobre escopo do 1:N | Não investigado nesta fase — documentação, fora do changeset 1B. |
| 9 | Corrigir doc (`usuario-journey.md`) citando endpoint inexistente `/api/biometric/capture` | Não investigado nesta fase — documentação, fora do changeset 1B. |
| 10 | Decidir se `handovers.ts` entra no padrão biométrico nesta rodada ou depois | Decidido: fica para **Fase 2** (paridade de endpoints), consistente com a spec mestra — não é escopo de 1B. |
| 11 | Persistir `quality` do template (hoje calculado e descartado) | Resolvido: `biometric-bridge.ts` `/challenges/:id/enrollment` grava `quality` via `recordBiometricEnrollment` (RPC `record_biometric_enrollment`, parâmetro `p_quality`) — herdado do trabalho de 1A.2, não novo nesta fase, mas confirma que o achado original já foi fechado antes de 1B. |
| 12 | Decidir sobre liveness/anti-spoof: requisito best-effort ou risco residual documentado | Decidido: best-effort, campo propagado (`liveness_passed`), `BIOMETRIC_REQUIRE_LIVENESS` default `false` — risco residual explicitamente documentado (não implícito), consistente com o veredito original da auditoria. |

**Item adicional não numerado na auditoria original, mas citado no corpo do texto — revogação de bridge perdido/roubado**: **resolvido e verificado nesta v2** (achado A2 da revisão v1→v2). `deviceAuthMiddleware` rejeita `status != 'active'` a cada request, não só no pareamento (confirmado por `PB07`). O endpoint `POST /api/biometric/devices/:id/revoke` **já existe, completo**, em `apps/bff/src/routes/biometric.ts:298-339` — commitado desde antes desta sessão, com `roleGuard("admin_reserva","admin_global")`, escopo de tenant (`.eq("tenant_id", tenantId)`) e de reserva (`actorCanAccessReserve`), `auditAction`, grava `revoked_at`/`revoked_by`/`revoked_reason`. A v1 desta spec deixava isso como "pendência de investigação" em 4 lugares — incorreto; uma única leitura do arquivo resolvia. Corrigido: a lacuna real não era a API, era a **UI** (seção 3.4 abaixo).

### 3.4 UI de revogação — gap real encontrado e fechado nesta v2 (achado A3 da revisão)

Busca em todo `apps/web/src` por chamadas a `/devices/:id/revoke` não encontrou nenhuma — a única referência a "revoke" no frontend era leitura de `device.status === "revoked"` para exibir badge (`_biometric-console-client.tsx`). Ou seja: a API de revogação existia, auditada, funcional — mas nenhum admin conseguia acioná-la sem chamar a API diretamente (curl/Postman). Para um sistema cujo próprio modelo de ameaça nomeia "furto físico do PC/bridge da reserva" como risco médio mitigado por "endpoint de revogação imediata" (auditoria mestra, tabela de riscos), isso é uma lacuna operacional real — não cosmética: sem UI, a mitigação documentada não é operável por quem precisa dela sob pressão (perda/furto do equipamento).

Fechado nesta v2: botão "Revogar bridge" adicionado ao card de cada device em `_biometric-console-client.tsx`, condicionado a `canRevokeDevices` (prop nova, calculada em `page.tsx` a partir do papel do usuário — `admin_reserva`/`admin_global`, o mesmo teto do `roleGuard` do BFF, sem duplicar a regra de autorização, só espelhando visualmente), com `window.confirm` (mesmo padrão já usado em `_cadastrar-militar-dialog.tsx`/`_criar-armeiro-client.tsx` para ações destrutivas neste projeto — não introduz um componente novo). Botão só aparece para devices `status === "active"` e não-simulador (revogar um simulador ou um device já revogado não faz sentido).

### 3.5 Pontos fortes confirmados na leitura linha a linha

- **Fail-closed consistente**: pepper ausente → erro explícito (nunca hasheia sem pepper); JSON malformado → 400 explícito; device revogado/simulador → 401; timestamp fora da janela → 401; nonce repetido → 401 (não 500 — distinção de erro correta).
- **Claim atômico de challenge** (`challenges/next`): SELECT seguido de UPDATE condicional (`WHERE status='pending' AND (device_id IS NULL OR device_id=$deviceId)`) — se dois devices (ou dois pollers do mesmo device) competirem, só um ganha a linha; o outro recebe 0 linhas afetadas e tenta de novo no próximo poll. Nenhuma race condition visível.
- **Nunca loga PII biométrica**: teste estático dedicado (`biometric-device-auth.test.ts`, "wiring estático — enrollment nunca loga template_data") faz grep em toda chamada de log dentro de `biometric-bridge.ts` — consistente com a disciplina já usada para `TOTP_ENCRYPTION_KEY`/`totp_secrets`.
- **Transação atômica na migration** (`consume_biometric_pairing_code`): consumo do código + upsert do device na mesma função `plpgsql`, com `for update` no código — evita o "buraco operacional" que a própria migration documenta ter aprendido do achado M3 da 1A.2.
- **Grants corretos desde a criação**: a função de pareamento já nasce com `revoke ... from public, anon, authenticated` + `grant ... to service_role` explícitos — aplicando a lição do incidente real de `ALTER DEFAULT PRIVILEGES` documentado no fechamento da 1A.2 (2 incidentes de produção anteriores pelo mesmo motivo), em vez de repeti-lo.

---

## 4. Gap de segurança investigado a pedido do usuário: "a rota fica fora do authMiddleware — isso é intencional e correto?"

**Sim, é intencional e é a única opção correta** — não é uma lacuna, é uma decisão arquitetural obrigatória:

- `authMiddleware` (`apps/bff/src/middleware/auth.ts`) autentica **sessão de usuário humano** — exige cookie iron-session válido ou Bearer JWT do Supabase. O bridge não é um usuário: não faz login, não tem `profile.id` de ator, roda como processo desatendido no PC da reserva.
- Se `authMiddleware` fosse aplicado a `/api/biometric-bridge/*`, **nenhum request do bridge jamais passaria** — é exatamente o bug que a auditoria de C1 alerta e que os 3 mecanismos da seção 3.2 impedem estruturalmente.
- A autoridade equivalente para o bridge é `deviceAuthMiddleware` — mesmo nível de rigor (assinatura criptográfica + anti-replay + expiração), só que provando identidade de **dispositivo pareado**, não de usuário logado. É o padrão correto para credencial machine-to-machine (mesma família de desenho que webhook signing da Stripe/GitHub, ou SigV4 da AWS) — não existe um "authMiddleware para robôs" genérico no projeto porque este é o primeiro ator não-humano do sistema.

Conclusão: manter fora do wildcard é o desenho certo. O risco real não é "está fora do authMiddleware" — é "ficar fora do authMiddleware **por acidente/omissão**, sem um middleware equivalente cobrindo o mesmo nível de garantia". Ver seção 3.2 (corrigida na v2) para uma avaliação honesta de qual dessas 3 camadas realmente protege contra isso a longo prazo.

### 4.1 Riscos residuais identificados na revisão v1→v2 — documentados, não escondidos

Achados M3 e M4 da revisão sênior. Nenhum dos dois é um bug introduzido por esta fase; ambos são propriedades do desenho já decidido (device-name como identidade operacional; 1:N tenant-wide como objetivo de produto da spec mestra) que a v1 desta spec não tornava explícitas.

**M3 — Device revogado pode ser reativado via colisão de `device_name` no re-pareamento.** A função `consume_biometric_pairing_code` (migration `20260716142223_...`) faz `on conflict (tenant_id, device_name) do update set ... status = 'active', revoked_at = null, ...`. Como a identidade do device é ancorada em `device_name` (texto livre escolhido pelo operador no momento do pareamento, não um identificador de hardware imutável), um admin que gera um novo código de pareamento reaproveitando o `device_name` de um device revogado reativa a MESMA linha (`device_id` preservado), com uma chave pública nova. Isto **não é explorável por um atacante sem autorização de admin** — exige um `admin_reserva`/`admin_global` legítimo gerando um código novo, então é mais um risco de disciplina operacional do que uma vulnerabilidade de autenticação (a identidade criptográfica é honestamente reestabelecida, já que a chave pública antiga é substituída, não reaproveitada). Mitigação recomendada para Fase 1C/2 (não bloqueadora para o DoD desta fase): a UI de pareamento (ainda não construída, seção 8) deveria alertar/impedir reuso de `device_name` de um device revogado, ou o RPC deveria exigir um parâmetro explícito de "reativação intencional" separado do fluxo normal de "novo device".

**M4 — `templates/sync` expõe templates de TODO o tenant a qualquer bridge pareado em qualquer reserva, não só na própria reserva.** `biometric-bridge.ts:204-253` filtra só por `tenant_id`, nunca por `reserve_id` — isso é **correto pela arquitetura mestra** (a Regra Canônica exige 1:N tenant-wide: "qualquer reserva do mesmo tenant com bridge ativo pode identificar esse usuário"), não um bug desta fase. Mas a consequência de segurança não estava documentada em nenhuma seção de risco: um único bridge comprometido/roubado tem acesso ao blob (cifrado — ver nota abaixo) de template biométrico de **todos** os usuários do tenant, não só da própria reserva. Isso é exatamente o risco "furto físico do PC/bridge" que a auditoria mestra já nomeia (tabela de riscos, severidade Média) — esta v2 só está conectando explicitamente `templates/sync` a esse risco já aceito, em vez de deixá-lo implícito. Mitigação já existente (não nova): `template_data` é tratado como ciphertext opaco pelo BFF — `recordBiometricEnrollment` (`biometric-enrollment.ts`) nunca decifra, só hasheia e persiste o blob que o bridge envia como `encrypted_template_data`, consistente com "criptografado em nível de aplicação" da spec mestra. A chave de decifragem, e se ela é por-tenant ou por-device, é uma decisão do lado do bridge (que não existe ainda) — **não verificado nesta spec** se um bridge comprometido conseguiria de fato decifrar os templates sincronizados ou só armazená-los cifrados sem uso. Marcar como pergunta em aberto para a Fase 1C (o design do bridge precisa responder isso antes de decidir a chave de decifragem).

**M5 — Plano de fechamento sem teste de carga/pentest/colisão de nonce.** Nenhum passo do plano de fechamento (seção 6) cobre teste de carga do rate limiter sob a cadência real (heartbeat/15s + poll/1.5s + template sync), fuzzing do protocolo de assinatura Ed25519, ou revisão formal de entropia/colisão do nonce (`randomBytes(16).toString("base64url")` no bridge falso do E2E — 128 bits, colisão não é uma preocupação prática, mas isso nunca foi declarado por escrito). Decisão explícita: **não bloqueador para o DoD desta fase** (a suíte unitária/E2E cobre caminhos feliz/triste com rigor; testes de carga/pentest formal são desproporcionais para um contrato que ainda não tem nenhum cliente real em produção). Registrado como item de hardening rastreado para a Fase 3 (seção 8), não silenciosamente descartado.

---

## 5. Harness de validação — o que já existe (avaliado, não reescrito)

### 5.1 Unit/integration BFF (24 testes, 2 arquivos)

Cobre exatamente a lista que a auditoria original exigia na seção "Harness de validação obrigatório", itens 2 (assinatura do bridge: válida aceita, adulterada rejeitada, device errado rejeitado, malformada não lança) e parte do 7 (rate limit dedicado, chaveado corretamente) — mais o wiring estático da seção 3.2 acima.

### 5.2 E2E (`biometric-bridge-phase1b.spec.ts`, 7 cenários seriais)

Reimplementa a mesma canonicalização do BFF **de forma independente** (não importa o código do BFF, reescreve os algoritmos no teste) — isso é deliberado e vale mais do que parece: prova que a spec do protocolo é implementável por um cliente externo que só tem acesso à documentação/contrato, exatamente a posição em que o futuro app C# do bridge estará. Cobre: pareamento, one-time (reuso falha 410), C1 em runtime (PB04), replay de nonce (PB05), fluxo completo challenge→claim→proof→result 1:N (PB06), revogação em runtime (PB07).

**Não coberto pelo harness atual** (gaps genuínos, candidatos a fase 1C ou hardening):
- Expiração de challenge por TTL especificamente no fluxo bridge-facing — **correção da v1 (achado B2)**: não é um gap tão aberto quanto a v1 sugeria. `assertChallengeAcceptsProof` (`biometric-proof.ts`, já coberta por `biometric-proof.test.ts:101-104` desde 1A.2) já testa rejeição de challenge expirado, e é exatamente essa função compartilhada que tanto o fluxo legado quanto `/challenges/:id/proof` do bridge chamam — a regra já está exercitada por teste, só não há um cenário E2E ponta-a-ponta específico simulando um bridge real deixando o challenge expirar antes de responder. Gap real, mas menor do que "sem cobertura nenhuma".
- Isolamento cross-tenant/cross-reserve especificamente para as rotas bridge-facing (device da reserva X tentando `challenges/next?reserve_id=Y`) — o código trata isso (`requestedReserveId !== reserveId → 403`), mas não há teste E2E cobrindo esse caso especificamente para o bridge (existe para o fluxo 1A.2 legado).
- Lockout por falhas consecutivas (item 6 da tabela 3.3) — não implementado, portanto não testável ainda.
- Teste E2E do fluxo de revogação **via UI** (o botão novo desta v2, seção 3.4) — a API já é coberta por `PB07`, mas o clique/confirmação/toast do botão não tem Playwright dedicado ainda. Candidato a spec de regressão de UI antes do fechamento (ver seção 6).

---

## 6. Plano de fechamento desta fase (ordem de execução)

1. **Corrigir a única falha de teste** — não é bug de lógica, é consequência do wiring revertido (seção 1.3): restaurar `app.route("/api/biometric-bridge", biometricBridgeRoutes)` em `index.ts`, **fora** de qualquer `app.use(..., authMiddleware)`, e rotear `/api/biometric-bridge/*` no `routeRateLimiter` (já implementado na diff de `rate-limit.ts`, só falta a montagem da rota em si estar presente para o dispatch funcionar).
2. ~~Confirmar existência de `POST /api/biometric/devices/:id/revoke`~~ — **resolvido nesta v2** (seção 3.3/3.4): endpoint já existe e está completo; UI nova adicionada.
3. **Rodar suíte completa**: `bun test` (todo o BFF, não só os 2 arquivos novos — para pegar qualquer regressão cruzada), `tsc --noEmit` (BFF + web), `pnpm build --webpack` (web).
4. **Rodar o E2E `biometric-bridge-phase1b.spec.ts`** contra produção real (mesmo padrão desta sessão para os fixes de PWA) — os 2 fixtures usados (`USERS.admin`, `USERS.reserva`) e a query de `reserve_memberships` do `beforeAll` precisam de dados reais compatíveis; validar antes de assumir que passa. Spec já registrado no projeto Playwright `"suite"` nesta v2 (antes não estava em nenhum projeto — seção 3.2).
5. **Code review obrigatório** (regra CLAUDE.md) do changeset completo — mandato focado em: race conditions no claim de challenge, escopo tenant/reserve em cada rota bridge-facing, fail-closed em cada branch de erro, ausência de PII em logs, SSRF/injection em `templates/sync` (paginação por cursor), consistência entre migration e código, correção do teto de papel na UI de revogação nova (`canRevokeDevices` no client vs. `roleGuard` no BFF — client-side é só UX, nunca a fonte de autorização real).
6. **Registrar explicitamente no CHANGELOG.md e no relatório de fechamento**: (a) UI de revogação adicionada (gap fechado); (b) os gaps de harness da seção 5.2 como pendências rastreadas, não esquecidas; (c) M3/M4/M5 (seção 4.1) como riscos residuais documentados, não bloqueadores; (d) que hardware real continua não-validado (mesmo risco já herdado da 1A.2, ainda não fechado).
7. Só então commit + push + CI/CD verde.

---

## 7. Definition of Done desta fase

- [x] `app.route("/api/biometric-bridge", biometricBridgeRoutes)` montada, fora de qualquer wildcard de `authMiddleware`.
- [x] `node --experimental-strip-types --test "src/__tests__/*.test.ts"` (comando real do CI, não `bun test` — ver nota abaixo) 100% verde no BFF: 151/151.
- [x] `tsc --noEmit` limpo (BFF + web).
- [ ] `biometric-bridge-phase1b.spec.ts` verde contra produção real, registrado no projeto `"suite"` (CI-covered) — a rodar após deploy (sem staging disponível para este projeto).
- [ ] Regressão completa (E2E Suite existente) verde — biometria é aditiva, não pode quebrar TOTP nem os fluxos 1A.2 já em produção.
- [x] Endpoint de revogação de device confirmado existente (`biometric.ts:298-339`) — UI de revogação implementada nesta fase (`_biometric-console-client.tsx`).
- [x] Code review sênior sem CRÍTICO/ALTO pendente (changeset completo, incluindo a UI nova) — encontrou 1 CRÍTICO + 2 ALTO de implementação (v3, histórico de revisão), todos corrigidos e aplicados em produção (migration + nginx real via SSH) antes deste commit.
- [ ] CHANGELOG.md atualizado com escopo real (contrato BFF, não bridge completo) e pendências explícitas.
- [ ] Commit e push isolados desta tarefa.

**Nota sobre comando de teste do BFF**: `bun test` (sem args) varre recursivamente TODA a árvore de `src/__tests__/`, incluindo `pentest/**` — que exige env vars não usadas em CI e usa a API `node:test` de um jeito que quebra sob o runner do Bun (`describe() inside another test()`), dando falsa impressão de suíte pré-existente quebrada. O comando real do CI/`package.json` é `node --experimental-strip-types --test "src/__tests__/*.test.ts"` (Node nativo, glob não-recursivo) — usar sempre este para validar antes de commit.

**Finalizado não é entregue** (regra canônica do projeto): mesmo com todos os itens acima verdes, esta fase **não** habilita nenhum armeiro real a usar biometria de verdade — o bridge que fala com o leitor não existe. O DoD desta fase é sobre o contrato do BFF, não sobre a funcionalidade ponta a ponta.

---

## 8. Fora de escopo desta fase (explícito, não implícito)

- **App Bridge Windows real** — o processo/serviço que roda no PC da reserva, fala com o SDK NITGEN/eNBioBSP via USB, gera e guarda a chave Ed25519 (DPAPI/TPM), faz polling deste mesmo contrato, e assina provas. **Não existe uma linha de código deste app em lugar nenhum do repositório** (busca ampla por `.csproj`/`.sln`/"nitgen" confirmada na revisão v1→v2 — só aparece em docs/testes/migrations, nunca em código de aplicação Windows). É o maior item de trabalho restante de todo o projeto Biometric Bridge.
- **UI de pareamento no painel admin** — não existe nenhum componente web que chame `POST /api/biometric/pairing-codes` e mostre o código gerado para o operador digitar no bridge. O endpoint existe; a tela para usá-lo, não. (Diferente da UI de **revogação**, que esta v2 já resolve — seção 3.4. Pareamento continua fora de escopo.)
- **Listagem de devices na UI**: já existe e funciona (`GET /api/biometric/devices`, consumido por `_biometric-console-client.tsx`) — confirmado nesta v2, não é mais uma pendência de investigação.
- **Liveness/anti-spoof real** — campo propagado, mas nenhuma integração com o SDK (que nem existe ainda do lado bridge).
- **Lockout dedicado por falhas consecutivas** (distinto de rate limit) — item 6 da auditoria original (tabela §3.3), ainda pendente.
- **Chave de decifragem de `templates/sync`** (por-tenant ou por-device) — decisão de design que pertence ao app bridge (Fase 1C), não ao BFF. Ver risco M4 (seção 4.1).
- **Reforço contra reativação de device via colisão de `device_name` DENTRO da mesma reserva** (risco M3, seção 4.1) — a v3 fechou a variante CROSS-reserve (achada como CRÍTICO pelo code review de implementação, migration `20260719230524_...`), mas reativar um device revogado reusando o nome **dentro da mesma reserva** continua possível para um admin com autorização legítima sobre ela — decisão consciente de manter (é o comportamento de "re-pareamento"/rotação de chave intencional), não um bug residual.
- **Teste de carga/pentest/fuzzing do protocolo de assinatura** (risco M5, seção 4.1) — rastreado para Fase 3 (hardening).
- **Persistência de `device_detected`/`device_model` do heartbeat** — campos validados pelo schema Zod mas descartados antes de chegar ao banco (achado MÉDIO do code review de implementação, v3) — sem coluna para gravar e sem consumidor na UI ainda; adiado para quando o app bridge (Fase 1C) existir de fato e a UI precisar exibir "leitor desconectado".
- **Fase 2 da spec mestra** (1:N verdadeiramente tenant-wide substituindo o `/identify` legado sem escopo, paridade com `handovers.ts`) e **Fase 3** (hardening enterprise, rotação de chave, alertas de `last_seen_at`).

---

## 9. Resposta direta: quando testamos o leitor físico

Não depois desta fase — depois de **duas** fases:

1. **Esta fase (1B)**: fecha o contrato do BFF. Ao final, o BFF está pronto para autenticar um device real, mas nenhum device real existe.
2. **Fase 1C — "Bridge Client MVP"** (nome sugerido, ainda sem spec própria — próximo passo depois desta): aplicação Windows mínima que:
   - gera o par de chaves Ed25519 e guarda a privada via DPAPI;
   - lê um código de pareamento digitado manualmente (a UI de geração da seção 8 precisa existir primeiro, ou o código pode ser obtido via `curl`/Postman contra `POST /api/biometric/pairing-codes` como atalho de MVP, adiando a UI);
   - fala com o SDK NITGEN/eNBioBSP local via USB;
   - implementa o mesmo protocolo que `biometric-bridge-phase1b.spec.ts` já prova ser implementável de forma independente (o teste E2E É, na prática, a especificação executável desse cliente).

Só ao final da Fase 1C — app instalado no notebook, leitor NITGEN plugado via USB, pareado contra uma reserva real (piloto) — é que dá para reproduzir o fluxo do armeiro de verdade: abrir `/reserva/biometria`, clicar identificar, colocar o dedo no leitor físico, ver o match. Esse é o gate de validação de hardware que a spec mestra já previa (seção "Harness de Validação → Hardware Real") e que o fechamento da Fase 1A.2 já sinalizava como pendência.

---

## 10. Arquivos afetados por esta fase

Base (seção 1.2, já escrita em sessão anterior, só revisar/commitar) + mudanças novas desta v2:

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260716142223_biometric_bridge_phase1b_device_auth.sql` | **Renomeado nesta v2** (era `20260716000001_...`, achado A1) — nome agora bate com a versão real aplicada em produção. |
| `apps/web/playwright.config.ts` | **Editado nesta v2** — `e2e/biometric-bridge-phase1b.spec.ts` adicionado ao `testMatch` do projeto `"suite"` (antes não estava em nenhum projeto). |
| `apps/web/src/app/(dashboard)/reserva/biometria/page.tsx` | **Editado nesta v2** — nova prop `canRevokeDevices` calculada a partir do papel do usuário. |
| `apps/web/src/app/(dashboard)/reserva/biometria/_biometric-console-client.tsx` | **Editado nesta v2** — botão "Revogar bridge" por device, admin-only, `window.confirm`, chama `POST /api/biometric/devices/:id/revoke`. |
| `apps/bff/src/index.ts` | **Editado nesta v3** — `app.route("/api/biometric-bridge", biometricBridgeRoutes)` restaurado, fora do wildcard de `authMiddleware`. |
| `supabase/migrations/20260719230524_biometric_bridge_phase1b_security_fixes.sql` | **Novo nesta v3** — fix do CRÍTICO (colisão cross-reserve de `device_name`) + job `pg_cron` de limpeza de nonces (ALTO). Já aplicada em produção. |
| `infra/nginx/api.apmcb.pmpb.online.conf` | **Editado nesta v3** — nova `location /api/biometric-bridge/` sem `limit_req` por IP (fix do ALTO de rate limit). Aplicado no VPS real via SSH (`nginx -t` + reload), não só no repo. |
| `apps/bff/src/middleware/biometric-device-auth.ts` | **Editado nesta v3** — `last_ip` só grava quando muda, non-blocking (fix MÉDIO). |
| `apps/bff/src/routes/biometric-bridge.ts` | **Editado nesta v3** — cursor de `templates/sync` composto `(updated_at, id)` (fix MÉDIO). |
| `apps/bff/src/__tests__/rate-limit-hardening-harness.test.ts` | **Editado nesta v3** — teste comportamental novo para `rateLimitBiometricBridge` (fix MÉDIO de cobertura). |

Restante da base (rotas/libs/middleware/testes/migration de nonces, `.env.example`, diffs em `biometric.ts`/`rate-limit.ts`/`hono.ts`) permanece como descrito na seção 1.2, sem alteração de conteúdo nesta v2 — só revisão e commit.
