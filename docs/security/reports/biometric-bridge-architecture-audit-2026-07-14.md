# Auditoria Técnica — Integração Biométrica NITGEN/eNBioBSP (Bridge Local + BFF Autoritativo)

> Auditoria read-only (sem alterações de código) solicitada em 2026-07-14, gerada por sub-agente com acesso completo ao código do repositório. Escopo: avaliar a arquitetura proposta de "APMCB Biometric Bridge" (agente local Windows falando com o leitor NITGEN/eNBioBSP, BFF como autoridade de tenant/reserva/autorização/auditoria) antes de qualquer implementação.

## Veredito curto

A escolha arquitetural de fundo — **template centralizado no tenant + agente local ("Bridge") no Windows da reserva + BFF como única autoridade de tenant/reserva/autorização/auditoria** — está correta e é, na prática, a única opção tecnicamente sã dado que o leitor NITGEN é um dispositivo USB com SDK proprietário (não um autenticador FIDO2/WebAuthn) e o backend roda num VPS sem acesso físico ao hardware. Não existe alternativa "sem agente local" para este hardware específico.

Mas a especificação, como está descrita, ainda tem lacunas reais de "banking-grade": falta um mecanismo concreto de *device attestation* (como o bridge prova que é ele mesmo, e não um script HTTP qualquer, enviando o resultado), falta escopo explícito de tenant/reserva na busca 1:N, falta binding forte entre a prova biométrica e a ação/documento assinado, e falta rate-limit/lockout dedicado a biometria (hoje herdado apenas do limite genérico de rota).

Mais importante: o código atual não é "quase lá" — ele está arquiteturalmente invertido (tenta capturar no servidor) **e** tem bugs concretos que quebram até a UI existente, independente do SDK. Isso muda o ponto de partida do projeto: não é "adicionar bridge a um sistema biométrico que funciona parcialmente", é "substituir um subsistema que hoje falha sempre, por design, em todos os pontos de entrada."

## Nota: 7/10 (para a arquitetura proposta, não para o código atual)

O código atual relacionado a biometria está funcionalmente em **~2/10** — não autentica ninguém hoje (stub sempre falha) e tem pelo menos dois endpoints com bug de URL que nunca chegam ao BFF. Isso é bom do ponto de vista de segurança (falha fechado, não fechado-aberto), mas péssimo do ponto de vista de produto.

A **arquitetura proposta** pelo usuário (template central + bridge + BFF autoritativo + prova com nonce/challenge) merece **7/10**: a direção é certa e já inclui os elementos certos na lista de campos do "modelo de prova esperado" (nonce, TTL, consumo único, tenant/reserve, purpose, document_hash, assinatura do bridge). Falta para chegar a 9–10:

1. Definir **como** a chave do bridge é provisionada, armazenada e rotacionada (hoje a spec diz "assinatura do bridge com chave privada registrada no BFF" mas não define o protocolo de pareamento nem o algoritmo).
2. Escopo explícito de candidatos no 1:N (tenant-wide, não global — hoje nem a spec nem o código fixam isso).
3. Um mecanismo de *liveness/anti-spoof* (ainda que best-effort, dependente do que o SDK NITGEN expõe) — sem isso, "score >= threshold" sozinho não distingue dedo real de um dedo de silicone/gelatina, algo relevante para "banking-grade".
4. Rate limiting e lockout dedicados por dispositivo/usuário identificado, espelhando o padrão que já existe para TOTP (`failure_count`, `last_failure_at`) — a spec não menciona isso.
5. Regra de revogação de bridge/token perdida/roubado (o PC da reserva é um alvo físico razoável de furto).

Com esses cinco pontos endereçados na spec final (não necessariamente no MVP de código), a arquitetura chega a 9/10. O 10/10 exigiria HSM/TPM-backed key storage no bridge e liveness certificado — provavelmente fora do orçamento de complexidade que o usuário pediu para evitar.

---

## Achados críticos

### 1. [CONFIRMADO] BFF tenta capturar biometria no próprio servidor — incompatível com bridge/cloud

Confirmado em código, não só em spec. Todo caminho de verificação biométrica hoje chama `getFingerprintSDK()` **dentro do processo do BFF** e invoca `sdk.capture()`/`sdk.identify()` ali mesmo:

- `apps/bff/src/routes/biometric.ts:20-21` (`/identify`) e `:89-90` (`/register`)
- `apps/bff/src/routes/lendings.ts:268-269` (`/identify`, mode biometria)
- `apps/bff/src/routes/saidas.ts:66-67` (`validateBiometric`)
- `apps/bff/src/routes/cautelamentos.ts:86-87` (`validateBiometric`)
- `apps/bff/src/lib/shift-auth.ts:111-122` (`validateSelfBiometric`)

Isso é literalmente assumir um leitor USB conectado ao processo Node/Bun no Hetzner. A evidência mais forte de que essa suposição já foi levada a sério em infraestrutura é `docker-compose.biometric.yml` (raiz do repo), que monta `/dev/bus/usb:/dev/bus/usb` no container do BFF — ou seja, em algum momento tentaram literalmente passar um dispositivo USB físico para dentro do container do VPS. O `CHANGELOG.md:1153` confirma que isso foi revertido ("remover USB device do compose base; criar docker-compose.biometric.yml override"), mas o padrão de código que motivou essa tentativa continua ativo em todos os handlers acima.

**Refinamento sobre o achado do usuário**: o problema não é "captura no servidor" de forma abstrata — é que hoje **não existe nenhum ponto de extensão** para um bridge remoto injetar um resultado de match. O contrato de função `IFingerprintSDK.identify()`/`.capture()` (`apps/bff/src/services/fingerprint/interface.ts`) é síncrono e presume hardware local. Qualquer solução de bridge precisa trocar esse contrato inteiro por um fluxo assíncrono baseado em challenge/proof — não dá para "só trocar a implementação do SDK" mantendo a mesma interface.

### 2. [CONFIRMADO] Provider atual é stub ZKTeco, não resolve NITGEN, e hoje sempre falha

`apps/bff/src/services/fingerprint/zkteco.ts` é um stub explícito ("Stub until real libzkfp bindings are available"): `capture()` retorna um buffer fixo `stub-template-finger-N`, e `identify()`/`verify()` **sempre retornam `null`/`false`** (linhas 37-52). Ou seja, mesmo ignorando o problema de arquitetura (servidor sem USB), a biometria hoje **nunca autentica ninguém em produção** — todo fluxo cai em 404/401/503. O `mock.ts` funcional (que de fato compara bytes) é bloqueado em produção por `index.ts:12-14` (`FINGERPRINT_SDK=mock` proíbe `NODE_ENV=production`), corretamente.

Isso confirma que trocar "ZKTeco" por "NITGEN" não é uma troca de driver — é preciso desenhar o protocolo bridge↔BFF do zero, porque a abstração atual (`IFingerprintSDK`) não sobrevive à mudança de topologia (processo local → dispositivo remoto assíncrono).

### 3. [CONFIRMADO] Prova de assinatura atual é determinística e sem nonce — não seria válida para o novo modelo

Em `saidas.ts:312`, `cautelamentos.ts:396/470`, `handovers.ts:270/402`, o campo `signature_proof` é sempre:

```
signature_proof: `${document_hash}:${armeiroId}:armeiro`
```

Isso não é uma assinatura criptográfica — é uma string totalmente derivável de dados que já estão visíveis em outras respostas (`document_hash` aparece, por exemplo, em `GET /api/handovers/:id/verify`, endpoint **público sem autenticação**, `handovers.ts:538-560`). Hoje isso não é explorável como bypass de autenticação, porque nada no sistema **verifica** esse valor contra nada — ele só é gravado, nunca comparado. Mas é uma "prova" de fachada: se alguém auditasse `document_signatures.signature_proof` esperando não-repúdio real, não encontraria nenhum. O ponto do usuário está certo: isso precisa virar uma prova one-time vinculada à ação (nonce + assinatura de dispositivo), exatamente como a spec propõe.

**Nuance importante**: o campo `signature_level` já existe na tabela `document_signatures` (`supabase/migrations/20260620000004_document_signatures.sql:18-19`, valores 1/2/3) mas não é usado em nenhum insert atual (sempre implícito no default). Esse é o gancho natural para versionar "nível de prova": 1 = TOTP, 2 = biometria sem device attestation, 3 = biometria com prova assinada por bridge registrado. Reaproveitar em vez de criar coluna nova.

### 4. [CONFIRMADO E AGRAVADO] Inconsistência armeiro-cadastra-biometria-de-terceiro — a real é a regra do código, não a da doc

Duas fontes documentam explicitamente que o armeiro captura a biometria do militar presencialmente:

- `docs/journeys/usuario-journey.md:54-69`: *"Na reserva de armamento (presencialmente): 1. Armeiro acessa `/reserva/militares` 2. Busca o militar... 3. Clica 'Registrar Biometria' 4. Coloca dedo do militar no leitor"* — e mais adiante, linha 248: *"Biometria registrada presencialmente | Armeiro captura na reserva — não pode ser feito remotamente"*.
- `docs/feature-rbac-photo-biometria.md:21/39-41`: tabela de permissões lista "Capturar biometria: Admin ✅, Master (Armeiro) ✅, Military ❌" e o fluxo de cadastro do militar já embute checkbox "Capturar biometria" no dialog operado pelo armeiro.

Mas o código (`apps/bff/src/routes/biometric.ts:69-71`) bloqueia exatamente esse caso:

```ts
// Privilege ceiling: armeiro can only register their own biometrics
if (role === "armeiro" && userId !== masterId) {
  return c.json({ error: "Acesso negado: armeiro só pode registrar a própria biometria" }, 403);
}
```

Ou seja, **a persona que a documentação e a UI (`_militares-table.tsx`, `MilitarSheet.handleCapture`) descrevem como a única que faz esse trabalho no dia a dia é justamente a que o backend proíbe**. `admin_reserva`/`admin_global` (que normalmente não estão fisicamente no balcão da reserva) *podem* registrar biometria de terceiros, desde que do mesmo tenant (linhas 73-85).

**Regra correta recomendada**: inverter a lógica. Em vez de "armeiro só pode registrar a própria biometria", a regra deveria ser "quem registra biometria de terceiro deve (a) pertencer ao mesmo tenant do alvo — já existe para admin_reserva/admin_global, replicar para armeiro via `reserve_memberships`/`tenant_memberships`, e (b) ter turno ativo (`service_shifts.status = 'ativo'`) no momento do cadastro" — reaproveitando o mesmo padrão `SHIFT_REQUIRED` já usado em `lendings.ts:91-101`, `saidas.ts:151-161` e `cautelamentos.ts:238-248`. Isso resolve a contradição, mantém least-privilege (o armeiro só enrola gente da sua própria reserva, durante um turno auditável) e não exige nenhuma tabela nova — só trocar o predicado de `userId !== masterId` por uma checagem de escopo igual à que já existe para admin_reserva/admin_global.

Vale registrar como **risco residual aceito**: o enrollment é a operação de maior confiança de toda a cadeia — quem cadastra o template define, dali para frente, "quem é" aquele usuário biometricamente. Um armeiro mal-intencionado pode, fisicamente, cadastrar o próprio dedo sob o `profile.id` de outra pessoa. Isso é um risco inerente a qualquer enrollment presencial (o mesmo existe hoje em um posto de identificação civil) e não tem solução puramente de software — a mitigação realista é auditoria (`registered_by` já existe, manter) e, se o apetite de segurança pedir mais, exigir que o **próprio militar autentique com TOTP** durante o próprio enrollment (uma espécie de "testemunha ativa"), o que é barato de implementar e fecha boa parte do gap.

### 5. [CONFIRMADO — pior do que o achado original sugere] `/identify` sem escopo de tenant, e a doc afirma o contrário

`apps/bff/src/routes/biometric.ts:23-25`:

```ts
const { data: templates } = await supabase
  .from("biometric_templates")
  .select("user_id, template_data");
```

Nenhum filtro de tenant, nenhum de reserva. Como esse cliente é `service_role` (bypassa RLS por completo — ver `docs/security.md` §21, regra 4: "BFF com service_role deve aplicar escopo no código, pois bypassa RLS"), a política de RLS tenant-scoped que existe na tabela (`biometric_staff_tenant`, em `supabase/migrations/20260629000005_tenant_isolation_backfill.sql:165-177`) **não protege nada aqui** — é só uma defesa para acesso direto via cliente anon/browser, que não é o caminho usado.

O mesmo padrão se repete em `lendings.ts:270` (sem filtro), mas ali há uma segunda checagem pós-match por `default_tenant_id` (linha 282) que rejeita o resultado se for de outro tenant — funcionalmente correto, mas ineficiente e revela por matching cruzado. Já `saidas.ts:69-72` e `cautelamentos.ts:89-92` fazem `.eq("user_id", expectedUserId)` (não é 1:N, é verify 1:1 contra o usuário esperado) — esses dois não têm o problema de escopo porque não fazem busca ampla.

Além disso — achado adicional não listado pelo usuário — a **doc contradiz o próprio código**: `docs/journeys/armeiro-journey.md:304` afirma *"Biometria 1:N: Template comparado contra todos os militares da reserva — não aceita bypass"*, mas o código (linha 23-25 acima) compara contra **toda a tabela `biometric_templates`, sem filtro nenhum de reserva ou tenant**. Isso é uma divergência doc-vs-código que precisa ser corrigida junto com o fix técnico.

**Confirmação adicional de gap de dados**: `tenant_id` em `biometric_templates` é **nullable** (`supabase/migrations/20260620000001_multitenant_foundation.sql:172-173`: `ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)` — sem `NOT NULL`). Nenhuma migration posterior torna a coluna obrigatória. Um filtro `.eq("tenant_id", tenantId)` adicionado hoje simplesmente **excluiria silenciosamente** templates com `tenant_id = NULL` da busca, em vez de falhar ruidosamente — isso precisa de backfill + `ALTER COLUMN ... SET NOT NULL` antes do fix de escopo, não só do fix de query.

### 6. [CONFIRMADO — e o próprio código já documenta isso] Livro Digital esconde biometria, coerentemente

`apps/web/src/components/livro/shift-auth-dialog.tsx:24-30` tem um comentário explícito confirmando o problema:

> *"O SDK ZKTeco em produção é um stub (verify() sempre retorna false) e o BFF roda num VPS sem leitor USB conectado — a aba de biometria hoje é uma autenticação que sempre falha. Mantida oculta até o SDK real estar integrado; controlado por `NEXT_PUBLIC_BIOMETRIC_ENABLED` no caller."*

Na prática, o prop `biometricAvailable` tem `default = false` (linha 49) e **nenhum caller no repositório passa `true`** — busquei todas as ocorrências e a única referência a `NEXT_PUBLIC_BIOMETRIC_ENABLED` é esse comentário; a variável de ambiente não é lida em nenhum lugar do código. Ou seja, a aba está permanentemente oculta hoje, o que é o estado seguro (fail-closed) e coerente com o resto do achado.

**Inconsistência não listada pelo usuário, encontrada na auditoria**: `apps/web/src/components/cautelas/sign-dialog.tsx` (usado para assinar cautelas) **não** tem esse gate — o botão "Biometria" aparece incondicionalmente (linhas 134-137), e ao clicar chama o mesmo `validateBiometric()` quebrado do BFF, resultando num toast de erro genérico ("Erro no hardware biométrico — tente TOTP"). É um bug de UX (usuário real vai clicar, esperar, e tomar erro) que deveria ter o mesmo tratamento condicional do `shift-auth-dialog.tsx`.

### 7. [CONFIRMADO] Passagens de turno (handovers) são TOTP-only

`apps/bff/src/routes/handovers.ts` — `signSchema` (linha 70-72) só aceita `totp_token`; `sign-exit` e `sign-entry` chamam `validateTotp()` sem alternativa biométrica. Nenhuma menção a `use_biometric` em todo o arquivo. **Recomendação**: sim, deveriam entrar no mesmo padrão (challenge/proof), por consistência — é a única operação sensível de assinatura que ficaria de fora do modelo unificado. Não é bloqueador para o MVP do bridge (pode ficar em fase posterior), mas deve entrar na spec final como item de paridade, não como "talvez".

---

## Achados adicionais (não listados pelo usuário, encontrados na auditoria)

### A. Dois endpoints de biometria têm bug de URL e nunca chegam ao BFF — independente do SDK/hardware

- `apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx:152`: `fetch(`${BFF_URL}/biometric/register`, ...)` — falta o prefixo `/api`.
- `apps/web/src/app/(dashboard)/reserva/saidas/nova/_form.tsx:132`: `fetch(`${BFF_URL}/biometric/identify`, ...)` — mesmo problema.

O BFF só monta a rota em `/api/biometric` (`apps/bff/src/index.ts:148`: `app.route("/api/biometric", biometricRoutes)`). Todo o resto do app usa `bffFetch()` (`apps/web/src/lib/bff-client.ts`) passando o path completo com `/api/...` (ex.: `sign-dialog.tsx` usa `/api/cautelamentos/${id}/sign-armeiro`). Esses dois pontos usam `fetch()` cru e esqueceram o prefixo — são **404 garantidos**, mascarados hoje pelo fato de o SDK também estar quebrado (então ninguém percebeu porque o resultado visível — "erro no leitor" — é o mesmo esperado de qualquer forma). Isso precisa ser corrigido independentemente da decisão arquitetural sobre o bridge, porque é um bug de código puro.

### B. Documentação usa nome de endpoint que nunca existiu

`docs/journeys/usuario-journey.md:64`: `POST /api/biometric/capture { profile_id }` — esse endpoint não existe; o real é `POST /api/biometric/register { userId, fingerIndex }`. Ajustar a doc junto da spec final.

### C. `quality` do template nunca é persistido

`biometric.ts:127` retorna `quality: template.quality` na resposta do `/register`, mas o `insert` em `biometric_templates` (linhas 100-108) não grava esse valor — não existe coluna `quality` na tabela hoje. Ou seja, a UI mostra "qualidade 85%" no toast (`_militares-table.tsx:165`) mas essa informação se perde permanentemente. Confirma a necessidade de coluna `quality` no modelo de dados novo.

### D. `document_signatures.tenant_id` é `NOT NULL` mas a maioria dos inserts atuais não trata falha de forma auditável — não é bug de biometria, mas relevante para o novo fluxo: qualquer novo insert em `biometric_proofs` deve seguir o mesmo padrão de imutabilidade (`RULE no_update`/`no_delete`) já usado em `document_signatures` e `audit_logs`, não reinventar.

---

## Riscos de segurança

| Risco | Onde | Severidade | Mitigação recomendada |
|---|---|---|---|
| Bridge sem attestation pode "mentir" que uma biometria passou | modelo atual não define protocolo de pareamento/assinatura | Alto | Par de chaves assimétrico por dispositivo (Ed25519), gerado no bridge, chave privada nunca sai da máquina; pareamento via código curto emitido pelo BFF e digitado no bridge (fluxo análogo a TOTP QR enrollment já existente no app) |
| Prova biométrica reaproveitável (replay) em outra ação/documento | achado 3 | Alto (uma vez que a biometria funcione) | nonce de uso único + TTL curto (30-60s) + binding do `document_hash` no momento do consumo, não só no momento da emissão |
| 1:N sem escopo revela/compara contra usuários de outros tenants | achado 5 | Alto | Escopo obrigatório por `tenant_id` na query, `tenant_id NOT NULL` na tabela, teste de isolamento cross-tenant no harness |
| Enrollment por terceiro sem testemunha do próprio usuário | achado 4 | Médio | turno ativo obrigatório + (opcional, recomendado) TOTP do próprio militar como confirmação do enrollment |
| Furto físico do PC/bridge da reserva | novo, arquitetura proposta | Médio | chave privada em DPAPI/TPM quando disponível; endpoint de revogação imediata de device; heartbeat (`last_seen_at`) para detectar bridge offline/substituído |
| Fingerprint spoofing (dedo falso/foto) | inerente a biometria de impressão digital | Médio | usar liveness do SDK NITGEN se disponível; combinar com threshold de score + lockout por tentativas repetidas, nunca depender só do score |
| CSP/Permissions-Policy do frontend já bloqueia `camera=()`, mas não há política equivalente para o novo tráfego bridge↔BFF | `apps/web/src/middleware.ts` (CSP) não cobre o bridge (é um processo nativo, não browser) | Baixo | garantir TLS + pinning de certificado no bridge, e ainda assim autenticação por assinatura (não confiar só em TLS) |
| Vazamento de template via log | regra já existe no projeto (`docs/security.md` §21 — biometria é PII proibida em endpoint público) | Alto se violado | manter a mesma disciplina já aplicada a `totp_secrets`/`TOTP_ENCRYPTION_KEY`: nunca logar `template_data`/`encrypted_data`, nem no `logger.error` de captura (hoje `biometric.register.sdk_failure` já toma esse cuidado — replicar) |

---

## Modelo de dados recomendado

### Novas tabelas

**`biometric_devices`** — registro do bridge
```
id                 uuid pk
tenant_id          uuid not null references tenants(id)
reserve_id         uuid not null references reserves(id)
device_name        text not null
public_key         text not null           -- chave pública Ed25519, base64
sdk_vendor         text not null default 'nitgen'
sdk_version        text
bridge_version     text
status             text not null check (status in ('pending','active','revoked','suspended'))
paired_by          uuid references profiles(id)
paired_at          timestamptz
last_seen_at       timestamptz
revoked_at         timestamptz
revoked_by         uuid references profiles(id)
revoked_reason     text
created_at         timestamptz not null default now()
unique (tenant_id, device_name)
```

**`biometric_challenges`** — nonce por operação
```
id                 uuid pk default gen_random_uuid()   -- o próprio id serve como nonce opaco
tenant_id          uuid not null references tenants(id)
reserve_id         uuid not null references reserves(id)
device_id          uuid references biometric_devices(id)   -- null até o bridge assumir o challenge
actor_id           uuid not null references profiles(id)   -- quem operou a tela (armeiro/admin logado)
purpose            text not null check (purpose in
                     ('identify','enroll','sign_saida_armeiro','confirm_saida_militar',
                      'sign_cautela_armeiro','sign_cautela_militar',
                      'handover_sign_exit','handover_sign_entry',
                      'open_shift','close_shift','return'))
expected_user_id   uuid references profiles(id)          -- quando aplica assinatura de usuário específico
document_type      text
document_id        uuid
document_hash      text
status             text not null default 'pending' check (status in ('pending','consumed','expired','failed'))
expires_at         timestamptz not null
consumed_at        timestamptz
created_at         timestamptz not null default now()
index (tenant_id, reserve_id, status)
```
RLS: `service_role` apenas — o BFF é dono do ciclo de vida; nunca exposto cru ao browser além do `id`.

**`biometric_proofs`** — auditoria imutável do resultado
```
id                   uuid pk
challenge_id         uuid not null unique references biometric_challenges(id)
tenant_id            uuid not null
reserve_id           uuid not null
device_id            uuid not null references biometric_devices(id)
actor_id             uuid not null
matched_user_id      uuid references profiles(id)
purpose              text not null
document_type        text
document_id          uuid
document_hash        text
match_score          numeric not null
finger_index         smallint
liveness_passed      boolean
bridge_signature     text not null
signature_algorithm  text not null default 'ed25519'
sdk_version          text
bridge_version       text
result               text not null check (result in ('success','failure','error'))
failure_reason       text
created_at           timestamptz not null default now()
```
+ `CREATE RULE no_update_biometric_proofs ...` e `no_delete_biometric_proofs ...` (mesmo padrão de `document_signatures` e `audit_logs`). Nunca gravar template bruto aqui — só score/resultado.

### Ajustes em `biometric_templates`

```
ALTER TABLE biometric_templates
  ALTER COLUMN tenant_id SET NOT NULL,          -- após backfill
  ADD COLUMN template_hash        text,          -- sha256 do blob cifrado, para checagem de integridade sem decifrar
  ADD COLUMN format               text not null default 'nitgen-fmd',
  ADD COLUMN sdk_version          text,
  ADD COLUMN quality              smallint,       -- hoje calculado e descartado (achado C)
  ADD COLUMN encryption_key_version smallint,     -- suporte a rotação, mesmo padrão de TOTP_ENCRYPTION_KEY
  ADD COLUMN enrolled_device_id   uuid references biometric_devices(id),
  ADD COLUMN revoked_at           timestamptz,
  ADD COLUMN revoked_by           uuid references profiles(id),
  ADD COLUMN revoked_reason       text;
```

Renomear `template_data` para deixar explícito que é cifrado em nível de aplicação (envelope encryption, reaproveitando a mesma disciplina já usada em `totp_secrets`/`readSecret()`), não só "confiar no disco criptografado do Supabase". Excluir linhas com `revoked_at is not null` de qualquer busca 1:N (índice parcial).

---

## Endpoints recomendados

### Bridge-facing (autenticado por assinatura de dispositivo, não por sessão de browser)
- `POST /api/biometric/devices/pair` — bridge envia `public_key` + código de pareamento curto emitido antes pela UI admin; BFF cria `biometric_devices` com `status='active'`.
- `POST /api/biometric/devices/:id/revoke` — `admin_reserva`/`admin_global`.
- `GET /api/biometric/devices` — listagem/health por reserva (`last_seen_at`).
- `GET /api/biometric/challenges/pending?device_id=` (ou canal realtime já existente no projeto, `apps/bff/src/routes/realtime.ts`) — bridge busca challenges pendentes atribuídos a ele.
- `POST /api/biometric/challenges/:id/submit` — bridge envia `{ nonce, matched_user_id?, score, finger_index, liveness_passed?, result, bridge_signature, sdk_version, bridge_version }`; BFF valida assinatura, estado do nonce, escopo tenant/reserve/device, grava `biometric_proofs`, marca challenge `consumed`.

### Browser-facing (sessão iron-session normal, já existente)
- `POST /api/biometric/challenges` — staff (armeiro/admin) inicia uma operação: `{ reserve_id, purpose, expected_user_id?, document_type?, document_id? }` → `{ challenge_id, expires_at }`.
- `GET /api/biometric/challenges/:id` — polling/realtime do status até `consumed`.
- `GET /api/biometric/identify` mantém a assinatura pública (retorna `{ found, profile }`), mas por dentro passa a orquestrar challenge+proof em vez de chamar SDK local.

### Endpoints existentes que precisam mudar
- `apps/bff/src/routes/biometric.ts` (`/identify`, `/register`) — remover `getFingerprintSDK().capture()`; reconstruir sobre challenge/proof.
- `apps/bff/src/lib/shift-auth.ts` (`validateSelfBiometric`) — idem.
- `apps/bff/src/routes/saidas.ts` e `cautelamentos.ts` (`validateBiometric()`) — trocar `use_biometric: boolean` client-asserted por `biometric_challenge_id`; olhar `biometric_proofs` já consumida em vez de capturar na hora.
- `apps/bff/src/routes/handovers.ts` — estender `signSchema` para aceitar `biometric_challenge_id` como alternativa a `totp_token` (achado 7).
- `apps/bff/src/routes/shifts.ts` (`open`/`close`) — idem.
- `apps/bff/src/services/fingerprint/*` — módulo inteiro fica obsoleto no BFF (o "SDK" passa a viver no bridge). Manter só como base para um **simulador de bridge** usado em teste (ver harness), não como abstração de produção.
- Corrigir os dois bugs de URL do achado A independentemente de qualquer coisa acima.

---

## Fluxos de UI recomendados

- `apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx` (`MilitarSheet.handleCapture`) — corrigir URL; reconstruir sobre challenge (`purpose=enroll`) com o mesmo esqueleto visual que já existe (spinner "Aguardando leitura do dedo...").
- `apps/web/src/app/(dashboard)/reserva/saidas/nova/_form.tsx` (`handleBiometria`) — corrigir URL; `purpose=identify`.
- `apps/web/src/components/livro/shift-auth-dialog.tsx` — trocar o flag estático `biometricAvailable` (hoje sempre `false`, nunca setado) por dado real: "esta reserva tem `biometric_devices` com `status='active'`?" — buscar isso no server component da página do Livro Digital e passar como prop, em vez de env var global.
- `apps/web/src/components/cautelas/sign-dialog.tsx` — aplicar o mesmo gate condicional (achado do item 6 acima); hoje mostra o botão incondicionalmente e falha silenciosamente.
- Nova tela administrativa de gestão de bridges (pareamento, status, `last_seen_at`) — natural em `/admin` ou dentro do detalhe de reserva já existente.
- `apps/web/src/app/(dashboard)/reserva/passagens/[id]/_detail.tsx` — se/quando handovers ganhar biometria (achado 7), replicar o padrão de `sign-dialog.tsx`.
- `apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx` — nenhuma mudança necessária: o checkbox "Capturar biometria agora" já é bem desenhado (marca `biometria_pendente` e adia a captura real para a etapa presencial em `/reserva/militares`); manter esse desacoplamento.

---

## Harness de validação obrigatório

1. **Ciclo de vida do challenge**: emitir → consumir uma vez (sucesso) → segunda tentativa de consumo do mesmo nonce falha (replay bloqueado) → expiração por TTL → consumo pós-expiração falha.
2. **Assinatura do bridge**: payload válido aceito; payload adulterado após assinar rejeitado; assinatura de device não registrado/revogado rejeitada.
3. **Isolamento tenant/reserva**: proof emitida no tenant A não pode ser referenciada por endpoint de negócio operando no tenant B; device pareado à reserva X não consegue submeter para challenge da reserva Y.
4. **`expected_user_id`**: match com score alto mas `matched_user_id != expected_user_id` deve ser rejeitado pelo endpoint de negócio, mesmo que a proof em si seja "válida" (cenário: usar o dedo errado para confirmar documento de outra pessoa).
5. **Binding de `document_hash`**: challenge emitido com hash H1; se o documento mudar antes do consumo, rejeitar.
6. **Teto de privilégio no enrollment**: teste explícito da regra corrigida do achado 4 — armeiro cadastra biometria de militar da própria reserva com turno ativo = 200; sem turno ativo = 403; de reserva/tenant alheio = 403.
7. **Rate limit/lockout dedicado**: N falhas consecutivas por device ou por `expected_user_id` disparam lockout (espelhar `failure_count`/`last_failure_at` de `totp_secrets`); confirmar `audit_logs` acumulando `biometric.match.failure`.
8. **Sem vazamento de PII biométrica**: teste estático (grep, nos moldes do `owasp-input-safety-harness.test.ts` já existente) garantindo que `template_data`/`encrypted_data`/chave privada nunca aparecem em `logger.*`, corpo de resposta HTTP ou `audit_logs.metadata`.
9. **Simulador de bridge para E2E**: como não há hardware NITGEN em CI, construir um processo simulador que fala o mesmo protocolo HTTP do bridge real (pareia, escuta challenges, envia proofs determinísticas) — substitui o antigo `FINGERPRINT_SDK=mock` in-process, mas fora do processo do BFF, exercitando o fluxo completo challenge→proof→endpoint de negócio.
10. **Regressão TOTP**: todos os testes E2E atuais de saídas/cautelas/turnos/passagens via TOTP devem continuar passando inalterados — biometria é aditiva.

---

## Plano de implementação em fases (sem implementar)

**Fase 0 — Fundação de dados e contrato**
Migrations (`biometric_devices`, `biometric_challenges`, `biometric_proofs`, ajustes em `biometric_templates` com backfill de `tenant_id NOT NULL`). Endpoints de challenge/proof no BFF, testáveis com o simulador de bridge mesmo sem hardware. Corrigir os dois bugs de URL (achado A). Remover chamadas `sdk.capture()` dos handlers de negócio, trocando por checagem de proof consumida — nesse meio tempo a biometria real continua indisponível (como hoje), mas o encanamento já fica correto.

**Fase 1 — Bridge mínimo viável, piloto em 1 reserva**
App Windows real: pareamento, geração/guarda de chave privada (DPAPI), polling/realtime de challenges, chamada ao SDK NITGEN local, submissão assinada. Habilitar `biometricAvailable` dinamicamente só onde há device ativo. TOTP permanece como fallback sempre disponível, sem exceção.

**Fase 2 — Regra "qualquer reserva do tenant" + paridade de endpoints**
Estender identify/challenge para candidatos tenant-wide com os guards da seção "regras de negócio" (tenant membership, status, sem impedimento, turno ativo do operador quando aplicável). Estender `handovers.ts` para aceitar `biometric_challenge_id` (achado 7). Tela admin de gestão de devices.

**Fase 3 — Hardening enterprise**
Rate limit/lockout dedicado a biometria. Liveness/anti-spoof se o SDK suportar. Rotação de chave do bridge, alerta de `last_seen_at` estagnado. Fluxo de revogação de template (LGPD/erasure) com re-cadastro. Runbook operacional (fallback TOTP já existe — documentar formalmente).

---

## Lista objetiva de ajustes necessários para a spec final

1. Definir o protocolo de pareamento do bridge (par de chaves Ed25519, código de pareamento curto, onde a chave privada fica armazenada — DPAPI no mínimo).
2. Fixar que o 1:N é **tenant-wide**, nunca global, e exigir `tenant_id NOT NULL` em `biometric_templates` antes de qualquer fix de query.
3. Substituir a regra "armeiro só registra a própria biometria" por escopo de reserva/tenant + turno ativo (achado 4), e documentar essa decisão em `docs/feature-rbac-photo-biometria.md` e `docs/journeys/*` para eliminar a divergência atual entre doc e código.
4. Adicionar `biometric_devices`, `biometric_challenges`, `biometric_proofs` ao modelo de dados da spec (hoje a spec só menciona os campos da prova, não o esquema de tabelas).
5. Definir binding explícito de `document_hash` no **momento do consumo** do challenge, não só no momento da emissão.
6. Definir rate limit/lockout dedicado a tentativas biométricas (por device e por usuário identificado), nos moldes do que já existe para TOTP.
7. Corrigir os dois bugs de URL (`/biometric/register`, `/biometric/identify` sem `/api`) — independente de qualquer decisão arquitetural, são bugs de hoje.
8. Corrigir a divergência de doc `docs/journeys/armeiro-journey.md:304` ("comparado contra todos os militares da reserva") vs. código (sem filtro nenhum hoje).
9. Corrigir `docs/journeys/usuario-journey.md:64` (endpoint `/api/biometric/capture` que não existe).
10. Decidir explicitamente se `handovers.ts` entra no mesmo padrão biométrico nesta rodada ou fica para fase posterior — hoje a spec não menciona handovers, e é a única superfície de assinatura sensível fora do padrão.
11. Persistir `quality` do template (hoje calculado e descartado) e definir score mínimo de qualidade de enrollment, não só de match.
12. Decidir sobre liveness/anti-spoof: incluir como requisito best-effort (se o SDK NITGEN expuser) ou aceitar como risco residual documentado — não deixar implícito.
