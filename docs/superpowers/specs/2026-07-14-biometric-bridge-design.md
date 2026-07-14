# APMCB - Spec: Biometric Bridge NITGEN/eNBioBSP

> Status: design aprovado para documentacao. Nao implementado ainda.
> Data: 2026-07-14
> Relatorio de auditoria: `docs/security/reports/biometric-bridge-architecture-audit-2026-07-14.md`
> Nota alvo: 9/10 apos fechar pareamento, prova assinada, escopo tenant-wide, rate limit, revogacao e liveness.

## Veredito

A arquitetura correta para o APMCB e: template biometrico centralizado por tenant,
bridge local Windows no PC da reserva, e BFF como autoridade final de autorizacao,
tenant, reserva, assinatura, auditoria e regra de negocio.

O BFF/VPS nao deve acessar USB. O leitor NITGEN/eNBioBSP e fisico, conectado ao PC
da reserva. O backend cloud deve validar provas, nunca tentar capturar a digital
diretamente.

## Estado Atual Encontrado

O codigo atual de biometria nao e funcional em producao:

- `apps/bff/src/routes/biometric.ts`, `lendings.ts`, `saidas.ts`,
  `cautelamentos.ts` e `lib/shift-auth.ts` tentam capturar/match no BFF.
- `apps/bff/src/services/fingerprint/zkteco.ts` e stub; `identify()` retorna
  `null` e `verify()` retorna `false`.
- Duas UIs chamam URL sem prefixo `/api`: `/biometric/register` e
  `/biometric/identify`.
- A documentacao e a UI dizem que o armeiro cadastra biometria do militar
  presencialmente, mas o BFF bloqueia `armeiro` cadastrando terceiros.
- `biometric_templates.tenant_id` existe, mas historicamente foi nullable; a
  busca 1:N nao pode depender de tenant nullable.

Esse projeto nao e "trocar SDK"; e substituir um contrato invertido por um fluxo
challenge/proof.

## Objetivo de Produto

Reproduzir o modelo operacional de caixa eletronico:

1. O usuario cadastra biometria uma vez dentro do tenant.
2. Qualquer reserva do mesmo tenant com bridge ativo pode identificar esse usuario.
3. O leitor local captura a digital, mas o BFF decide se a operacao e permitida.
4. TOTP permanece como fallback operacional.
5. Toda assinatura ou movimentacao sensivel gera trilha auditavel.

## Regra Canonica

Uma biometria cadastrada no tenant pode identificar o usuario em qualquer reserva
do mesmo tenant, desde que:

- o usuario identificado pertence ao tenant;
- o cadastro esta ativo e sem `impedimento_administrativo`;
- o bridge esta ativo, pareado e autorizado na reserva atual;
- o operador esta autorizado para a reserva e, quando aplicavel, em turno ativo;
- a operacao/material/documento pertence ao escopo autorizado;
- o score biometrico atingiu o threshold configurado;
- a prova foi emitida para a operacao correta, com nonce valido e consumo unico.

Biometria nao substitui RBAC, tenant isolation, reserve scope, estado do turno,
pre-condicoes de material ou assinatura. Ela prova identidade; o BFF autoriza a
acao.

## Arquitetura

### Componentes

| Componente | Responsabilidade |
|---|---|
| APMCB Web | UI cloud; inicia challenges, mostra status do bridge, envia operacoes ao BFF |
| APMCB Biometric Bridge | App/servico Windows local; fala com o leitor NITGEN/eNBioBSP; assina provas |
| BFF | Autoridade de sessao, tenant, reserva, nonce, score, documentos, auditoria |
| Supabase PostgreSQL | Templates, devices, challenges, proofs, signatures e audit logs |
| NITGEN SDK | Captura, enrollment, verify/identify local no PC da reserva |

### Fluxo de Alto Nivel

1. Usuario logado clica em identificar, cadastrar ou assinar com biometria.
2. Web pede ao BFF um `biometric_challenge`.
3. BFF cria nonce com TTL curto, purpose, tenant, reserva, actor e documento.
4. Bridge local busca ou recebe o challenge.
5. Bridge captura a digital usando NITGEN SDK.
6. Bridge compara contra candidatos permitidos ou retorna template de enrollment.
7. Bridge assina o resultado com chave privada do device.
8. BFF valida assinatura, nonce, TTL, escopo e score.
9. BFF grava `biometric_proofs` imutavel e consome o challenge.
10. Endpoint de negocio usa a proof para liberar a operacao.

## Pareamento do Bridge

O bridge precisa provar que e um device conhecido. Requisito minimo:

- chave assimetrica Ed25519 gerada no bridge;
- chave privada armazenada localmente com DPAPI no Windows, e TPM quando
  disponivel;
- chave publica registrada no BFF;
- pareamento por codigo curto emitido por admin autorizado no painel;
- `biometric_devices.status` controla `pending`, `active`, `suspended` e
  `revoked`;
- device revogado nao pode buscar challenge nem submeter proof;
- `last_seen_at`, `bridge_version` e `sdk_version` devem ser visiveis para
  admin da reserva.

TLS continua obrigatorio, mas nao substitui assinatura do bridge.

## Modelo de Dados

### `biometric_devices`

Registra cada bridge instalado em um PC de reserva.

```sql
id uuid primary key default gen_random_uuid(),
tenant_id uuid not null references tenants(id),
reserve_id uuid not null references reserves(id),
device_name text not null,
public_key text not null,
sdk_vendor text not null default 'nitgen',
sdk_version text,
bridge_version text,
status text not null check (status in ('pending','active','suspended','revoked')),
paired_by uuid references profiles(id),
paired_at timestamptz,
last_seen_at timestamptz,
revoked_at timestamptz,
revoked_by uuid references profiles(id),
revoked_reason text,
created_at timestamptz not null default now(),
unique (tenant_id, device_name)
```

### `biometric_challenges`

Nonce operacional de uso unico.

```sql
id uuid primary key default gen_random_uuid(),
tenant_id uuid not null references tenants(id),
reserve_id uuid not null references reserves(id),
device_id uuid references biometric_devices(id),
actor_id uuid not null references profiles(id),
purpose text not null,
expected_user_id uuid references profiles(id),
document_type text,
document_id uuid,
document_hash text,
status text not null default 'pending'
  check (status in ('pending','consumed','expired','failed')),
expires_at timestamptz not null,
consumed_at timestamptz,
created_at timestamptz not null default now()
```

### `biometric_proofs`

Registro imutavel do resultado do bridge.

```sql
id uuid primary key default gen_random_uuid(),
challenge_id uuid not null unique references biometric_challenges(id),
tenant_id uuid not null references tenants(id),
reserve_id uuid not null references reserves(id),
device_id uuid not null references biometric_devices(id),
actor_id uuid not null references profiles(id),
matched_user_id uuid references profiles(id),
purpose text not null,
document_type text,
document_id uuid,
document_hash text,
match_score numeric not null,
finger_index smallint,
liveness_passed boolean,
bridge_signature text not null,
signature_algorithm text not null default 'ed25519',
sdk_version text,
bridge_version text,
result text not null check (result in ('success','failure','error')),
failure_reason text,
created_at timestamptz not null default now()
```

`biometric_proofs` deve ter RULE de `no_update` e `no_delete`, seguindo o padrao
de `audit_logs` e `document_signatures`.

### Ajustes em `biometric_templates`

Antes de habilitar 1:N tenant-wide:

- backfill de `tenant_id`;
- `tenant_id set not null`;
- `template_data` deve ser criptografado em nivel de aplicacao;
- adicionar `template_hash`, `format`, `sdk_version`, `quality`,
  `encryption_key_version`, `enrolled_device_id`, `revoked_at`, `revoked_by`,
  `revoked_reason`;
- qualquer identify ignora templates com `revoked_at is not null`;
- templates nunca aparecem em logs, responses, audit metadata ou endpoints
  publicos.

## Prova Biometrica

O payload assinado pelo bridge deve conter, no minimo:

- `challenge_id`;
- `tenant_id`;
- `reserve_id`;
- `device_id`;
- `actor_id`;
- `purpose`;
- `expected_user_id`, quando aplicavel;
- `matched_user_id`, quando houve match;
- `document_type`, `document_id` e `document_hash`, quando aplicavel;
- `match_score`;
- `finger_index`;
- `liveness_passed`, quando o SDK expuser;
- `sdk_version`;
- `bridge_version`;
- `timestamp`.

O BFF deve recomputar/validar o payload antes de aceitar a assinatura. O
`document_hash` deve ser conferido no momento do consumo, nao apenas no momento
da emissao do challenge.

## Endpoints

### Novos

| Endpoint | Autoridade | Funcao |
|---|---|---|
| `POST /api/biometric/devices/pair` | admin_reserva/admin_global + codigo de pareamento | Ativa bridge e registra chave publica |
| `GET /api/biometric/devices` | admin_reserva/admin_global | Lista bridges e status |
| `POST /api/biometric/devices/:id/revoke` | admin_reserva/admin_global | Revoga device perdido/roubado |
| `POST /api/biometric/challenges` | sessao web | Cria challenge de identify/enroll/sign |
| `GET /api/biometric/challenges/:id` | sessao web | Polling/status do challenge |
| `GET /api/biometric/challenges/pending` | bridge assinado | Bridge busca challenges pendentes |
| `POST /api/biometric/challenges/:id/submit` | bridge assinado | Submete proof assinada |

### Existentes que Devem Mudar

| Arquivo | Mudanca |
|---|---|
| `routes/biometric.ts` | Remover captura server-side; reconstruir identify/register sobre challenge/proof |
| `routes/lendings.ts` | `mode=biometria` usa proof, nao SDK local |
| `routes/saidas.ts` | `use_biometric` vira `biometric_challenge_id` ou proof consumida |
| `routes/cautelamentos.ts` | Mesmo padrao de saidas |
| `routes/shifts.ts` | `auth_mode=biometria` usa proof |
| `routes/handovers.ts` | Passagens tambem devem aceitar biometria |
| `services/fingerprint/*` | Nao e provider de producao do BFF; pode virar simulador de teste |

Corrigir independentemente:

- `apps/web/.../militares/_militares-table.tsx`: `/biometric/register` deve ser
  `/api/biometric/register` ate a troca para challenge.
- `apps/web/.../saidas/nova/_form.tsx`: `/biometric/identify` deve ser
  `/api/biometric/identify` ate a troca para challenge.

## Regras de Cadastro Biometrico

O fluxo real e presencial. Portanto:

- `admin_reserva` e `admin_global` podem cadastrar biometria de usuarios do
  proprio tenant conforme teto de privilegio;
- `armeiro` pode cadastrar biometria de usuario do proprio tenant/reserva
  durante turno ativo;
- cadastro por `armeiro` sem turno ativo deve falhar com `SHIFT_REQUIRED`;
- cadastro de usuario fora do tenant/reserva deve retornar 403/404 sem vazar
  existencia;
- `registered_by`, `enrolled_device_id`, `quality` e audit log sao obrigatorios;
- opcional recomendado: exigir TOTP do proprio militar no enrollment quando ele
  ja possuir TOTP configurado.

Risco residual: enrollment presencial depende da honestidade do operador. A
mitigacao e turno ativo, auditoria, device identificado e, quando exigido,
confirmacao TOTP do proprio militar.

## UI

### Painel da Reserva

O card "Identificar Usuario" deve abrir/encaminhar para um fluxo que:

- testa bridge ativo;
- inicia challenge `purpose=identify`;
- mostra status de captura;
- apos match, mostra perfil, materiais em posse, cautelas, pendencias,
  impedimentos e acoes disponiveis.

### Saida e Devolucao

- "Nova Saida" pode identificar militar por biometria ou busca.
- "Receber Material" usa biometria para identificar usuario e listar itens em
  posse.
- Bulk return continua vinculado a `pendingIdentity`/proof com TTL curto.

### Cautelas e Assinaturas

Assinaturas de armeiro e militar aceitam TOTP ou biometric proof. A aba de
biometria so aparece quando ha bridge ativo para a reserva.

### Livro Digital e Passagens

`ShiftAuthDialog` ja modela TOTP/biometria, mas hoje esconde biometria. A
disponibilidade deve vir de `biometric_devices.status='active'`, nao de env var.
Passagens de turno devem entrar no mesmo padrao para paridade de assinatura.

### Cadastro

O dialog de cadastro pode continuar marcando biometria pendente. A captura real
deve ocorrer no fluxo presencial de `/reserva/militares`, com bridge ativo.

## Rate Limit e Lockout

Biometria precisa de limite dedicado, alem do rate limit geral de `/api/biometric/*`:

- por device;
- por actor;
- por `expected_user_id`, quando houver;
- por IP/sessao para endpoints browser-facing;
- lockout temporario apos falhas consecutivas;
- audit log para `biometric.match.failure`, `biometric.challenge.expired`,
  `biometric.proof.replay` e `biometric.device.revoked_attempt`.

O comportamento deve espelhar a disciplina do TOTP: anti-replay, janela curta e
falha auditavel.

## Liveness e Anti-Spoof

O SDK NITGEN/eNBioBSP deve ser auditado para saber se expoe liveness/LFD. A spec
exige:

- habilitar liveness se o SDK/hardware suportar;
- gravar `liveness_passed` na proof;
- bloquear quando liveness for exigido e falhar;
- se o hardware nao suportar, registrar risco residual no runbook e compensar
  com score minimo, lockout, auditoria e TOTP fallback.

## Harness de Validacao

### Unit/Integration BFF

- challenge criado com TTL e purpose corretos;
- challenge consumido uma unica vez;
- replay rejeitado;
- challenge expirado rejeitado;
- assinatura de bridge adulterada rejeitada;
- device revogado rejeitado;
- proof tenant A usada no tenant B rejeitada;
- device da reserva X tentando consumir challenge da reserva Y rejeitado;
- `expected_user_id` diferente de `matched_user_id` rejeitado;
- `document_hash` alterado entre challenge e consumo rejeitado;
- enrollment por armeiro com turno ativo passa;
- enrollment por armeiro sem turno ativo falha;
- enrollment cross-tenant/cross-reserve falha;
- logs/responses nao contem template, raw fingerprint ou chave privada.

### E2E Web

Usar simulador de bridge fora do processo do BFF:

- cadastrar biometria em `/reserva/militares`;
- identificar usuario no painel e ver historico/pendencias;
- registrar saida usando usuario identificado;
- receber/devolver material por biometria;
- assinar cautela por biometria;
- abrir/fechar Livro Digital por biometria;
- assinar passagem de turno por biometria quando fase incluir handovers;
- TOTP continua passando nos fluxos existentes.

### Hardware Real

Validacao manual obrigatoria em PC com NITGEN:

- bridge lista device NITGEN;
- capture retorna qualidade suficiente;
- enroll salva template;
- verify reconhece dedo cadastrado;
- NSearch identifica usuario correto entre candidatos do tenant;
- tentativa com dedo errado falha;
- device revogado deixa de funcionar sem reiniciar BFF;
- evidencias anexadas ao relatorio de DoD.

## Plano em Fases

### Fase 0 - Contrato e dados

- migrations das tres novas tabelas;
- backfill/NOT NULL de `biometric_templates.tenant_id`;
- colunas de qualidade, hash, versao e revogacao em templates;
- endpoints de challenge/proof;
- simulador de bridge;
- corrigir URLs sem `/api`;
- remover dependencia de `sdk.capture()` em endpoints de negocio.

### Fase 1 - Bridge piloto

- app/servico Windows minimo;
- pareamento Ed25519 + DPAPI;
- polling de challenges;
- captura/enroll/identify com NITGEN SDK;
- proof assinada;
- habilitar biometria dinamicamente em uma reserva piloto.

### Fase 2 - Tenant-wide e paridade operacional

- identify 1:N tenant-wide com candidatos escopados;
- regras por reserva/turno/operacao;
- saida, devolucao, cautela, Livro Digital e handover com proof;
- tela admin de devices.

### Fase 3 - Hardening enterprise

- lockout dedicado;
- liveness/LFD se suportado;
- rotacao de chave do bridge;
- alertas de `last_seen_at`;
- runbook de revogacao de device/template;
- relatorio final de validacao com nota alvo 9/10.

## Fora do Escopo Desta Spec

- substituir TOTP;
- permitir biometria sem bridge pareado;
- confiar em match declarado pelo browser;
- armazenar imagem bruta da digital;
- comparar templates globalmente entre tenants;
- implementar WebSocket enterprise antes do MVP local.

## Definition of Done

Finalizado nao significa entregue. A implementacao so pode ser considerada
entregue quando:

- migrations aplicadas e testadas;
- BFF tests e harness passando;
- Playwright com bridge simulador passando;
- hardware real validado em PC Windows com NITGEN;
- `docs/security.md` e jornadas atualizadas;
- changelog atualizado;
- code review senior sem CRITICO/ALTO pendente;
- commit e push isolados da tarefa.
