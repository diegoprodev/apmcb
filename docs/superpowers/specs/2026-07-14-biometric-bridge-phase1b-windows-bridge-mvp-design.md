# APMCB - Spec: Biometric Bridge Phase 1B, Windows Bridge MVP NITGEN/eNBioBSP

> Status: auditada em 2026-07-16 (nota 6.5/10) — 2 achados CRITICAL de integracao
> corrigidos nesta revisao (ver secoes marcadas "Ajuste pos-auditoria"); pronta
> para virar plano de implementacao.
> Data: 2026-07-14 (revisado 2026-07-16)
> Base tecnica: `main` em `1c8f201`/`830091d`/`476d7dc` — Phase 1A.2 (cadastro,
> saida e devolucao via challenge/proof) ja mergeada, deployada em producao e
> validada. Ver `docs/enterprise/reports/2026-07-16-biometric-bridge-phase1a2-closure-dod.md`.
> Fases anteriores: Phase 0, Phase 1A.1 e Phase 1A.2 ja mergeadas em `main`.
> Regra operacional: finalizado nao significa entregue; entrega exige harness, validacao real, code review, changelog, commit e push.

## Veredito

A proxima fase correta e implementar o primeiro bridge Windows real para o
leitor NITGEN/eNBioBSP. O BFF continua cloud/VPS e nunca acessa USB. O browser
continua falando apenas com `https://apmcb.pmpb.online` e nunca chama
`127.0.0.1`, `localhost` ou uma porta local.

O bridge Windows e um agente local instalado no computador fisico da reserva.
Ele usa o SDK NITGEN instalado na maquina, captura/verifica a digital localmente,
assina uma proof Ed25519 e envia essa proof para o BFF por HTTPS outbound.

Esta fase deve provar o fluxo real no notebook com o leitor conectado:

1. Bridge detecta SDK e dispositivo NITGEN.
2. Bridge pareia com uma reserva.
3. Armeiro abre `/reserva/biometria` no site cloud.
4. UI cria challenge no BFF.
5. Bridge busca a challenge pendente, captura digital no USB, identifica o
   usuario e envia proof assinada.
6. UI mostra o usuario identificado pelo endpoint de resultado ja existente.

## Estado Real do Repo

### Ja entregue no `origin/main` inspecionado

- `biometric_devices`, `biometric_challenges`, `biometric_proofs`.
- `biometric_devices.is_simulator`.
- `biometric_proof_consumptions` com `unique(proof_id)`.
- RPC `record_biometric_proof` para consumir challenge e inserir proof em uma
  transacao unica.
- `GET /api/biometric/challenges/:id/result`.
- `POST /api/biometric/challenges/:id/submit` browser-facing, ainda dependente
  de sessao do ator.
- `/api/biometric/simulator/*` gated por `NODE_ENV !== "production"` e
  `BIOMETRIC_SIMULATOR_ENABLED=true`.
- Console `/reserva/biometria` e `BiometricCaptureDialog`.
- Endpoints legados `/api/biometric/identify` e `/api/biometric/register`
  falham fechado com `BIOMETRIC_BRIDGE_REQUIRED`.

### Nota sobre Phase 1A.2 (Ajuste pos-auditoria 2026-07-16 — resolvido, sem condicional)

Phase 1A.2 esta 100% mergeada, deployada em producao e validada em `main`
(commits `1c8f201`, `830091d`, `476d7dc`). Os caminhos legados (`use_biometric`,
`validateBiometric`, `validateSelfBiometric`) foram aposentados com
`501 BIOMETRIC_BRIDGE_REQUIRED`; os fluxos de negocio reais ja consomem
`biometric_proof_id` de ponta a ponta:

- **Saida** (`POST /api/lendings/batch`, `POST /api/lendings/`): exige
  `biometric_proof_id` + `movement_id` quando `auth_mode=biometria`; a RPC
  `record_lending_batch` (`supabase/migrations/20260714000010_...sql`) trava
  `purpose='confirm_saida_militar'`, consome a proof via
  `biometric_proof_consumptions` (unique por `proof_id`) e rejeita prova com
  mais de 2 minutos (`v_proof.created_at <= now() - interval '2 minutes'`).
- **Devolucao** (`POST /api/lendings/identify` + `POST /api/lendings/bulk-return`):
  `record_lending_returns` trava `purpose='return'`, mesmo padrao de consumo
  unico e janela de 2 minutos.
- **TOTP como fallback** em ambos os fluxos usa uma tabela paralela
  (`totp_identity_claims`) com o mesmo padrao de consumo atomico — nao afeta
  o bridge real, mas mostra a convencao que qualquer RPC nova da Phase 1B deve
  seguir: consumo unico dentro da propria transacao, nunca no cookie de sessao.

**Implicacao direta para Phase 1B**: o bridge real vai gerar proofs que
alimentam DIRETO esses fluxos ja em producao. A proof que o bridge assina e
envia precisa:

1. Ser consumida em ate 2 minutos pela RPC de destino (`record_lending_batch`/
   `record_lending_returns`) — o round-trip completo do bridge (poll + captura
   fisica + assinatura + HTTPS) precisa caber nessa janela; ver ajuste em
   "Variaveis de Ambiente BFF" sobre `BIOMETRIC_CHALLENGE_TTL_SECONDS`.
2. Respeitar a distincao 1:1 vs 1:N por `purpose` — ver "Adaptador NITGEN"
   (ajustado abaixo): `confirm_saida_militar`/`enroll` sempre vem com
   `expected_user_id` preenchido (verify 1:1 direcionado); so `identify`/
   `return` sao 1:N real.

O escopo de Phase 1B nao muda: entregar bridge Windows real, alimentando os
fluxos que ja existem em producao — nao ha mais cenario de "1A.2 nao existe".

### SDK local validado no ambiente do operador

Arquivos encontrados no Windows:

- `C:\Program Files (x86)\NITGEN\eNBSP SDK Professional\SDK\dotNET\NITGEN.SDK.NBioBSP.dll`
- `C:\Program Files (x86)\NITGEN\eNBSP SDK Professional\SDK\Samples\dotNET\C#\BSPDemoCS\Form1.cs`

O sample C# usa:

- `NBioAPI.GetVersion`
- `NBioAPI.EnumerateDevice`
- `NBioAPI.OpenDevice`
- `NBioAPI.Enroll`
- `NBioAPI.GetFIRFromHandle`
- `NBioAPI.GetTextFIRFromHandle`
- `NBioAPI.Verify`

O operador tambem validou captura, enrollment, verify e NSearch no utilitario
NITGEN/NFD. Isso confirma que o proximo risco nao e driver; o risco agora e
integracao segura com o BFF.

## Objetivos da Phase 1B

1. Criar contrato device-auth para bridge real, independente de cookie/browser.
2. Criar pareamento seguro do bridge Windows com uma reserva.
3. Criar polling/claim de challenge pelo bridge.
4. Criar sync de templates para matching local sem imagem bruta.
5. Criar proof submit bridge-facing reutilizando o contrato Ed25519 existente.
6. Criar app Windows MVP em C# compativel com o SDK NITGEN instalado.
7. Validar identificacao real 1:N com o leitor USB fisico.
8. Documentar deploy, operacao, rollback e troubleshooting.
9. **(Ajuste pos-auditoria, nao-negociavel)** Toda funcao `SECURITY DEFINER`
   nova nasce, na MESMA migration que a cria, com
   `revoke execute on function ... from public, anon, authenticated;` seguido
   de `grant execute on function ... to service_role;`. Este projeto Supabase
   concede `EXECUTE` a `anon`/`authenticated`/`service_role` via
   `ALTER DEFAULT PRIVILEGES` em toda funcao nova do schema `public` —
   `revoke ... from public` sozinho e no-op contra isso. Esse exato erro ja
   expos em producao, por engano, as RPCs de custodia de armamento da Phase
   1A.2 (`record_lending_batch`, `record_lending_returns`,
   `record_biometric_proof`, `record_biometric_enrollment`) por
   aproximadamente 1 dia — ver
   `docs/enterprise/reports/2026-07-16-biometric-bridge-phase1a2-closure-dod.md`
   §4. Nao repetir pela terceira vez.

## Nao Objetivos

- Nao instalar SDK NITGEN na VPS.
- Nao chamar endpoint local a partir do site cloud.
- Nao abrir servidor HTTP local no bridge MVP.
- Nao reimplementar saida/devolucao/cautela/livro se Phase 1A.2/1A.3 ja
  estiverem na branch do Claude; Phase 1B apenas fornece o bridge real para
  alimentar `biometric_proof_id`.
- Nao remover TOTP.
- Nao armazenar imagem bruta da digital.
- Nao prometer modo offline.
- Nao aceitar `use_biometric: true` como autorizacao.

## Decisao Arquitetural

### Abordagem escolhida

Bridge Windows com conexoes outbound HTTPS para o BFF.

Fluxo:

```text
Browser cloud -> BFF: cria biometric_challenge
Bridge Windows -> BFF: poll/claim challenge pendente
Bridge Windows -> SDK NITGEN: captura/match local
Bridge Windows -> BFF: envia proof assinada
Browser cloud -> BFF: consulta result endpoint
```

### Abordagens rejeitadas

#### Browser chamando `http://127.0.0.1:8765/capture`

Rejeitada. Mistura origem cloud com servico local, cria superficie de spoofing,
CORS/mixed-content, suporte dificil por reserva e dependencia de porta local.

#### SDK NITGEN no BFF/VPS

Rejeitada. O leitor USB esta fisicamente na reserva. A VPS nao tem hardware e
nao deve carregar driver biometrico.

#### Bridge com token fixo compartilhado

Rejeitada. Um token roubado autorizaria device falso. O bridge deve usar chave
assimetrica Ed25519, request signing, nonce e timestamp.

## Modelo de Ameacas

| Ameaca | Controle obrigatorio |
|---|---|
| Bridge falso enviando proof | Device auth Ed25519 + device ativo + reserva/tenant |
| Replay de request do bridge | `X-Bridge-Nonce` unico + timestamp curto |
| Replay de proof | `challenge_id` unico + `biometric_proof_consumptions` |
| Device roubado | Revogacao em `biometric_devices.status='revoked'` bloqueia endpoints |
| Template vazando em logs | Redaction + testes estaticos + nunca logar `template_data` |
| Bridge pareado na reserva errada | Pareamento com codigo one-time emitido por admin autorizado |
| Usuario de outro tenant identificado | BFF valida `matched_user_id.default_tenant_id = tenant_id` |
| Template sincronizado para device nao autorizado | Sync exige device ativo, reserve scope e assinatura de request |
| Captura sem liveness | Se LFD suportado, exigir; se nao, documentar risco residual e compensar com score, lockout, auditoria e TOTP |

## Contrato BFF Device-Auth

### Ajuste pos-auditoria (CRITICAL) — onde as rotas bridge-facing sao montadas

Achado da auditoria de 2026-07-16: `apps/bff/src/index.ts` hoje registra
`app.use("/api/biometric/*", authMiddleware)` **antes** de montar
`biometricRoutes` em `/api/biometric`. Em Hono, esse `app.use` casa por padrao
de caminho — **qualquer** rota nova sob `/api/biometric/bridge/*` cairia
primeiro nesse middleware, que exige cookie `iron-session` ou
`Authorization: Bearer` (JWT Supabase). O bridge Windows, por design desta
spec, nunca tem nenhum dos dois — logo todo request do bridge real receberia
`401 "Authentication required"` **antes** de `deviceAuthMiddleware` sequer
rodar. Isso nao aparece em teste unitario de `deviceAuthMiddleware` isolado
(o harness ja descrito cobre a logica, nao o wiring real) — so apareceria no
primeiro teste contra hardware/producao.

**Decisao obrigatoria**: as rotas bridge-facing NAO podem ficar sob
`/api/biometric/*`. Montar em um path irmao dedicado, fora do wildcard de
`authMiddleware` — precedente ja existente no repo: `/api/push/broadcast`
tem seu proprio middleware de segredo compartilhado e nao esta sob nenhum
`app.use(..., authMiddleware)` (`apps/bff/src/index.ts`).

```ts
// index.ts — NAO sob app.use("/api/biometric/*", authMiddleware)
app.route("/api/biometric-bridge", biometricBridgeRoutes);
```

Todos os paths desta spec que hoje comecam com `/api/biometric/bridge/...`
passam a ser `/api/biometric-bridge/...` (heartbeat, `challenges/next`,
`templates/sync`, `challenges/:id/proof`, `challenges/:id/enrollment`,
`/api/biometric-bridge/pair` — este ultimo tambem precisa ficar fora do
wildcard, ja que roda sem sessao de admin, so com o codigo one-time).

### Headers obrigatorios

Todos os endpoints bridge-facing usam:

```http
X-Bridge-Device-Id: uuid
X-Bridge-Timestamp: 2026-07-14T12:00:00.000Z
X-Bridge-Nonce: base64url-random-128-bit
X-Bridge-Signature: base64
```

Assinatura:

```text
canonical_request =
  METHOD + "\n" +
  PATH_WITH_QUERY + "\n" +
  SHA256_HEX(BODY_UTF8_OR_EMPTY) + "\n" +
  X-Bridge-Timestamp + "\n" +
  X-Bridge-Nonce + "\n" +
  X-Bridge-Device-Id
```

O BFF busca `biometric_devices.public_key` pelo `device_id`, valida:

- device existe;
- `status='active'`;
- `is_simulator=false`;
- timestamp dentro de `BIOMETRIC_BRIDGE_CLOCK_SKEW_SECONDS` default 60;
- nonce ainda nao usado;
- assinatura Ed25519 valida;
- device pertence ao tenant/reserva da operacao.

### Nova tabela: `biometric_device_request_nonces`

```sql
create table biometric_device_request_nonces (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references biometric_devices(id),
  nonce text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique (device_id, nonce)
);
```

Retencao: limpar nonces com mais de 10 minutos em job ou opportunistic cleanup.

## Pareamento

### Problema

O endpoint atual `/api/biometric/devices/pair` e browser-facing e exige sessao de
`admin_global` ou `admin_reserva`. O bridge real nao deve depender de cookie do
navegador e nao deve receber credenciais de usuario.

### Solucao Phase 1B

Criar fluxo de codigo one-time.

#### 1. Browser cria codigo de pareamento

`POST /api/biometric/pairing-codes`

Roles: `admin_global`, `admin_reserva`.

Body:

```json
{
  "reserve_id": "uuid",
  "device_name": "Reserva 1 - Leitor Mesa",
  "expires_in_seconds": 600
}
```

Retorno:

```json
{
  "pairing_code": "APMCB-7H4K-2Q9P",
  "expires_at": "iso",
  "reserve_id": "uuid"
}
```

O codigo aparece na UI para o admin digitar no bridge Windows.

#### 2. Bridge gera chave local e usa codigo

`POST /api/biometric-bridge/pair`

Sem cookie. Body:

```json
{
  "pairing_code": "APMCB-7H4K-2Q9P",
  "device_name": "Reserva 1 - Leitor Mesa",
  "public_key": "-----BEGIN PUBLIC KEY-----...",
  "sdk_vendor": "nitgen",
  "sdk_version": "5.2.0.6",
  "bridge_version": "1.0.0",
  "machine_name_hash": "sha256:...",
  "hardware_serial_hash": "sha256:..."
}
```

O BFF valida codigo, TTL, status `pending`, reserva e tenant. Depois cria ou
atualiza `biometric_devices`, marca codigo como `used`, grava `paired_by` do
admin que criou o codigo e retorna `device_id`.

### Nova tabela: `biometric_pairing_codes`

```sql
create table biometric_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  reserve_id uuid not null references reserves(id),
  code_hash text not null unique,
  device_name text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_device_id uuid references biometric_devices(id),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id)
);
```

Nunca armazenar o codigo em texto puro; armazenar hash com pepper server-side.

**(Ajuste pos-auditoria, MEDIUM)** Consumir o codigo (marcar `used_at`) e
criar/atualizar `biometric_devices` deve ser **uma unica transacao** (RPC
`SECURITY DEFINER` — sujeita ao requisito de grants do Objetivo 9). Um
`UPDATE ... WHERE used_at IS NULL RETURNING` isolado ja impede reuso
concorrente do codigo, mas se o upsert de `biometric_devices` falhar depois
dele, o codigo fica queimado sem device criado — nao e falha de seguranca,
e um buraco operacional que forca reemitir codigo. Envolver os dois passos
numa unica funcao/transacao elimina isso.

**(Ajuste pos-auditoria, LOW)** Declarar explicitamente o alfabeto/entropia
do `pairing_code` (o exemplo `APMCB-7H4K-2Q9P` sugere ~40 bits, Crockford
Base32-like, 8 caracteres — suficiente contra brute force em 600s mesmo a
taxas generosas) e adicionar contador de tentativas invalidas por codigo
como defesa em profundidade (nao bloqueante para o MVP).

## Extensoes em `biometric_devices`

Adicionar campos operacionais:

```sql
alter table biometric_devices
  add column if not exists machine_name_hash text,
  add column if not exists hardware_serial_hash text,
  add column if not exists driver_version text,
  add column if not exists last_ip inet,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists heartbeat_interval_seconds integer not null default 15;
```

`machine_name_hash` e `hardware_serial_hash` sao identificadores operacionais
sem expor nome real da maquina ou serial bruto.

## Endpoints Bridge-Facing

Todos sob `/api/biometric-bridge/*` (fora do wildcard de `authMiddleware` —
ver ajuste pos-auditoria em "Contrato BFF Device-Auth").

### `POST /api/biometric-bridge/heartbeat`

Device-auth obrigatorio.

Body:

```json
{
  "bridge_version": "1.0.0",
  "sdk_version": "5.2.0.6",
  "driver_version": "4.0.0.9",
  "device_detected": true,
  "device_model": "Hamster HFDU06",
  "last_error_code": null
}
```

Atualiza `last_seen_at`, versoes e ultimo erro. Nao grava dados biometricos.

### `GET /api/biometric-bridge/challenges/next?reserve_id=uuid`

Device-auth obrigatorio.

Comportamento:

1. Valida device ativo e reserve_id do device.
2. Busca challenge `pending`, `expires_at > now()`, mesma reserva, sem
   `device_id` ou ja atribuida ao proprio device.
3. Faz claim atomico:

```sql
update biometric_challenges
set device_id = :device_id
where id = :challenge_id
  and status = 'pending'
  and expires_at > now()
  and (device_id is null or device_id = :device_id)
returning ...
```

Retorno quando nao ha trabalho:

```json
{ "challenge": null, "poll_after_ms": 1500 }
```

Retorno com challenge:

```json
{
  "challenge": {
    "id": "uuid",
    "tenant_id": "uuid",
    "reserve_id": "uuid",
    "actor_id": "uuid",
    "purpose": "identify",
    "expected_user_id": null,
    "document_type": null,
    "document_id": null,
    "document_hash": null,
    "expires_at": "iso"
  }
}
```

Nunca retorna template, assinatura, segredo ou dados de sessao do usuario.

### `GET /api/biometric-bridge/templates/sync?since=iso`

Device-auth obrigatorio.

Objetivo: permitir 1:N local com templates centrais do tenant.

Regras:

- retorna apenas templates ativos (`revoked_at is null`);
- retorna apenas tenant do device;
- para Phase 1B MVP, cache no bridge deve ser em memoria; persistencia local de
  templates fica proibida;
- se o volume for alto, paginar por `updated_at`/`id`;
- response deve incluir `template_hash`, `user_id`, `finger_index`, `format`,
  `sdk_version`, `quality`, `updated_at`;
- nao retorna imagem bruta;
- nao loga `template_data`.

Retorno:

```json
{
  "templates": [
    {
      "user_id": "uuid",
      "finger_index": 2,
      "template_data": "base64-or-text-fir",
      "template_hash": "sha256:...",
      "format": "nitgen-text-fir",
      "sdk_version": "5.2.0.6",
      "quality": 88,
      "updated_at": "iso"
    }
  ],
  "next_cursor": null
}
```

Observacao de seguranca: o bridge e um agente confiavel pareado. O envio de
templates ao bridge e necessario para matching 1:N local. A compensacao da Phase
1B e nao persistir templates em disco e revogar device roubado imediatamente. Em
fase posterior, avaliar cache DPAPI com expurgo e versao de chave.

### `POST /api/biometric-bridge/challenges/:id/proof`

Device-auth obrigatorio.

Equivalente bridge-facing ao submit atual, mas sem cookie de usuario. O BFF
resolve autoridade pelo device assinado e pela challenge.

Body:

```json
{
  "proof": {
    "challenge_id": "uuid",
    "tenant_id": "uuid",
    "reserve_id": "uuid",
    "device_id": "uuid",
    "actor_id": "uuid",
    "purpose": "identify",
    "matched_user_id": "uuid",
    "document_type": null,
    "document_id": null,
    "document_hash": null,
    "match_score": 0.98,
    "finger_index": 2,
    "liveness_passed": true,
    "sdk_version": "5.2.0.6",
    "bridge_version": "1.0.0",
    "timestamp": "iso"
  },
  "bridge_signature": "base64",
  "result": "success",
  "failure_reason": null
}
```

Validacoes:

- `:id === proof.challenge_id`;
- `proof.device_id === X-Bridge-Device-Id`;
- device ativo, nao simulador, mesma reserva/tenant;
- challenge pertence a mesma reserva/tenant e esta `pending`;
- challenge `device_id` e null ou igual ao device;
- proof actor/purpose/documentos batem com challenge;
- `matched_user_id` pertence ao tenant;
- score >= `BIOMETRIC_MIN_SCORE`;
- liveness conforme `BIOMETRIC_REQUIRE_LIVENESS`;
- assinatura da proof valida com a public key do device;
- grava via `record_biometric_proof`.

### `POST /api/biometric-bridge/challenges/:id/enrollment`

Device-auth obrigatorio.

Escopo: permitir cadastro biometrico real em fase 1B quando a UI ja criar
challenge `purpose='enroll'`.

Body inclui os mesmos campos de proof e:

```json
{
  "template_data": "base64-or-text-fir",
  "template_hash": "sha256:...",
  "format": "nitgen-text-fir",
  "quality": 88,
  "finger_index": 2
}
```

Validacoes adicionais:

- challenge purpose `enroll`;
- `expected_user_id` obrigatorio;
- `proof.matched_user_id === expected_user_id`;
- finger index 1..10;
- qualidade >= `BIOMETRIC_ENROLL_MIN_QUALITY`, default 50;
- usuario pertence ao tenant/reserva permitidos;
- template hash bate com template_data recebido;
- template_data nunca e logado.

Gravacao:

- upsert em `biometric_templates` por `(tenant_id, user_id, finger_index)` ou
  regra equivalente existente;
- set `format`, `sdk_version`, `quality`, `template_hash`,
  `enrolled_device_id`, `encryption_key_version`;
- se aplicavel, mover profile de `pending_biometric` para `complete`;
- audit log sem template.

## App Windows Bridge MVP

### Tecnologia

Recomendacao: C# targeting .NET Framework 4.8 no MVP, porque o SDK instalado
fornece `NITGEN.SDK.NBioBSP.dll` antigo e samples C#/.NET Framework. Depois de
validar compatibilidade, uma versao .NET 8 Worker Service pode ser planejada.

Projeto sugerido:

```text
apps/biometric-bridge-windows/
  APMCB.BiometricBridge.sln
  src/APMCB.BiometricBridge/
    Program.cs
    BridgeWorker.cs
    BridgeConfig.cs
    DeviceIdentityStore.cs
    BffClient.cs
    NitgenSdkAdapter.cs
    TemplateCache.cs
    ProofSigner.cs
    DoctorCommand.cs
  tests/APMCB.BiometricBridge.Tests/
```

### Modo de execucao

MVP recomendado: aplicativo Windows tray/console assistido, nao servico
headless.

Motivo:

- facilita ver status do leitor na primeira validacao real;
- evita problemas de sessao/desktop do SDK biometrico;
- simplifica suporte no notebook/reserva.

Fase posterior pode transformar em Windows Service se o SDK funcionar sem
desktop interativo.

### Configuracao local

Pasta:

```text
%ProgramData%\APMCB\BiometricBridge\
```

Arquivos:

```text
config.json              # base_url, device_id, reserve_id, poll interval
device-key.dpapi         # private key protegida por Windows DPAPI
logs\bridge-yyyy-mm-dd.log
```

Regras:

- private key nunca em texto puro;
- logs sem template, assinatura, raw FIR, senha, token ou digital;
- `base_url` default `https://apmcb.pmpb.online`;
- modo dev pode apontar para BFF local, mas precisa banner claro.

### Comandos do bridge

```powershell
APMCB.BiometricBridge.exe doctor
APMCB.BiometricBridge.exe pair --url https://apmcb.pmpb.online --code APMCB-7H4K-2Q9P
APMCB.BiometricBridge.exe run
APMCB.BiometricBridge.exe unpair
```

`doctor` deve validar:

- Windows version;
- presenca de `NITGEN.SDK.NBioBSP.dll`;
- `NBioAPI.GetVersion`;
- `EnumerateDevice`;
- `OpenDevice(AUTO)`;
- capacidade de captura teste;
- acesso a `%ProgramData%`;
- relogio local dentro de margem aceitavel.

### Adaptador NITGEN

Interface:

```csharp
public interface IBiometricSdk
{
    SdkInfo GetInfo();
    DeviceStatus GetDeviceStatus();
    CapturedSample Capture(TimeSpan timeout);
    EnrolledTemplate Enroll(Guid userId, int fingerIndex, TimeSpan timeout);
    MatchResult Identify(CapturedSample sample, IReadOnlyList<BiometricTemplate> templates);
    MatchResult Verify(CapturedSample sample, BiometricTemplate template);
}
```

Implementacao MVP:

- `NitgenSdkAdapter` encapsula `NBioAPI`;
- inicializa `NBioAPI` uma vez;
- usa `OpenDevice(NBioAPI.Type.DEVICE_ID.AUTO)`;
- captura com timeout configuravel;
- converte template para Text FIR ou Binary FIR conforme melhor compatibilidade
  com sync.

**(Ajuste pos-auditoria, HIGH) Verify 1:1 e o modo padrao quando ha usuario
esperado — nao e fallback de SDK, e decisao de produto.** Confirmado no
codigo real de producao (Phase 1A.2): challenges de `confirm_saida_militar`
(nova saida) e `enroll` (cadastro) SEMPRE vem com `expected_user_id`
preenchido (`apps/web/.../saidas/nova/_form.tsx`, `_militares-table.tsx`) —
o militar ja foi selecionado na UI antes de acionar a biometria. So
`identify` (console generico) e `return` (devolucao, `_desarmamento-modal.tsx`)
sao 1:N real, sem usuario pre-selecionado. O adaptador decide o modo pelo
`purpose`/`expected_user_id` do challenge recebido, nao pela disponibilidade
de `eNSearch`:

- `challenge.expected_user_id != null` (confirm_saida_militar, enroll) →
  **Verify 1:1 direcionado sempre**, independente de `eNSearch` estar
  acessivel — mais preciso (sem risco de falso-aceite num 1:N com centenas de
  templates) e reduz a superficie de templates residentes na memoria do
  bridge a qualquer momento.
- `challenge.expected_user_id == null` (identify, return) → 1:N real via
  `eNSearch` se acessivel no SDK instalado; se nao acessivel, fallback para
  1:N pequeno com Verify sequencial ate limite configuravel, reportando
  `capabilities.identify_1n=false` no heartbeat.

O bridge nao pode declarar tenant-wide 1:N habilitado se nao houver mecanismo
de matching funcional.

### Proof signer

O bridge assina duas coisas diferentes:

1. request HTTP device-auth;
2. `proof` biometrica canonicalizada no mesmo formato do BFF.

Essas assinaturas podem usar a mesma chave Ed25519 no MVP, mas o payload
canonicalizado deve ter dominio separado:

- request: canonical request descrito nesta spec;
- proof: `canonicalizeBiometricPayload` ja existente no BFF.

Harness deve ter vector fixo para provar que C# e TypeScript geram a mesma
canonicalizacao.

## Fluxo Operacional

### Primeiro pareamento

1. Admin abre `/reserva/biometria` ou tela de gestao do bridge.
2. Admin clica em `Parear bridge`.
3. BFF gera codigo one-time de 10 minutos.
4. Tecnico abre bridge no Windows e roda `pair --code ...`.
5. Bridge gera chave Ed25519 local.
6. Bridge envia public key e metadados.
7. BFF cria `biometric_devices`.
8. UI mostra `Leitor biometrico pronto nesta reserva`.

### Identificacao 1:N (console `/reserva/biometria`, devolucao)

1. Armeiro clica `Identificar usuario` (ou inicia devolucao).
2. Web cria challenge `purpose='identify'` (ou `'return'`, sem `expected_user_id`).
3. Bridge faz polling e claim da challenge.
4. Bridge sincroniza templates se cache em memoria estiver vazio/antigo.
5. Bridge captura digital via NITGEN e roda 1:N (`eNSearch` ou fallback).
6. Bridge envia proof assinada.
7. Web consulta result endpoint e mostra usuario/historico.
8. Para devolucao: `POST /api/lendings/bulk-return` consome a proof via
   `record_lending_returns` (purpose `return`, janela de 2 minutos).

### Nova saida / cadastro — Verify 1:1 direcionado (Ajuste pos-auditoria)

Fluxo real ja em producao (Phase 1A.2), que a Phase 1B passa a alimentar com
prova real em vez de simulada:

1. Armeiro seleciona o militar na tela `/reserva/saidas/nova` (ou
   `/reserva/militares` para cadastro) — `expected_user_id` ja conhecido.
2. Web cria challenge `purpose='confirm_saida_militar'` (ou `'enroll'`) **com**
   `expected_user_id`.
3. Bridge faz polling e claim da challenge.
4. Bridge captura digital e roda **Verify 1:1** contra o template do
   `expected_user_id` (nao 1:N — ver "Adaptador NITGEN").
5. Bridge envia proof assinada com `matched_user_id === expected_user_id`.
6. Web chama `POST /api/lendings/batch` (ou `/`), que consome a proof via
   `record_lending_batch` (purpose `confirm_saida_militar`, janela de 2
   minutos) e registra a saida atomicamente.

### Enrollment

1. Armeiro/admin escolhe usuario e dedo.
2. Web cria challenge `purpose='enroll'` com `expected_user_id`.
3. Bridge captura/enroll pelo SDK.
4. Bridge envia template e proof assinada.
5. BFF grava `biometric_templates`.
6. Web mostra dedo cadastrado e qualidade.

## UX do Bridge Windows

MVP precisa de UI minima, nao bonita demais:

- status: conectado ao BFF, leitor detectado, pareado, ultima challenge;
- botao `Diagnostico`;
- botao `Parear`;
- botao `Iniciar`;
- log operacional resumido;
- erro claro quando driver/SDK falhar.

Textos proibidos para usuario final:

- stack trace;
- template;
- FIR bruto;
- chave privada;
- assinatura.

## Variaveis de Ambiente BFF

```env
BIOMETRIC_BRIDGE_PAIRING_CODE_TTL_SECONDS=600
BIOMETRIC_BRIDGE_CLOCK_SKEW_SECONDS=60
BIOMETRIC_BRIDGE_NONCE_TTL_SECONDS=600
BIOMETRIC_TEMPLATE_SYNC_PAGE_SIZE=500
BIOMETRIC_ENROLL_MIN_QUALITY=50
BIOMETRIC_MIN_SCORE=0.92
BIOMETRIC_REQUIRE_LIVENESS=false
# Ajuste pos-auditoria: hoje hardcoded (BIOMETRIC_CHALLENGE_TTL_MS = 60_000
# em apps/bff/src/routes/biometric.ts:21). Com bridge real, o round-trip
# inclui poll + captura fisica + assinatura + HTTPS; pode nao caber em 60s
# com retries de qualidade baixa. Expor e validar empiricamente com hardware.
BIOMETRIC_CHALLENGE_TTL_SECONDS=60
# Ajuste pos-auditoria (HIGH): bucket de rate limit dedicado para
# /api/biometric-bridge/*, separado do bucket "biometric" de 30/min ja em
# producao (apps/bff/src/middleware/rate-limit.ts) — esse bucket e
# compartilhado por IP com o console browser-facing, e 30/min estoura em
# ~45s so com o polling de challenges/next (poll_after_ms=1500), antes de
# somar heartbeat (a cada 15s) e template sync. O bucket novo deve ser
# chaveado por device_id, nao por IP, e comportar poll+heartbeat continuos.
BIOMETRIC_BRIDGE_RATE_LIMIT_MAX=120
BIOMETRIC_BRIDGE_RATE_LIMIT_WINDOW_SECONDS=60
```

`BIOMETRIC_REQUIRE_LIVENESS=false` e aceitavel no MVP se o SDK/hardware nao
expuser LFD de forma confiavel. O risco residual precisa ficar no DoD.

## Harness Obrigatorio

### BFF unit/static

- device-auth rejeita ausencia de headers.
- device-auth rejeita device inexistente.
- device-auth rejeita device `revoked`, `suspended` ou `is_simulator=true`.
- device-auth rejeita timestamp fora da janela.
- device-auth rejeita nonce repetido.
- device-auth rejeita assinatura invalida.
- pairing code e salvo hashado, expira e e one-time.
- `/api/biometric-bridge/pair` nao aceita tenant_id/reserve_id do cliente como autoridade.
- `/api/biometric-bridge/challenges/next` so retorna challenge da reserva do device.
- claim de challenge e atomico e nao entrega a mesma challenge para dois devices.
- proof bridge-facing nao exige cookie, mas exige device-auth.
- proof bridge-facing valida `proof.device_id === header device_id`.
- enrollment nao loga template_data.
- template sync nao retorna templates de outro tenant.
- template sync nao funciona com device revogado.
- rotas browser-facing continuam protegidas por `authMiddleware`.
- rotas bridge-facing nao devem usar `roleGuard`, porque nao ha usuario logado;
  devem usar `deviceAuthMiddleware`.
- **(Ajuste pos-auditoria, CRITICAL)** teste de integracao de wiring real:
  requisicao HTTP de verdade (nao chamada direta da funcao de middleware) para
  cada rota `/api/biometric-bridge/*` **sem** cookie e **sem** header
  `Authorization`, só com headers de device-auth validos, confirmando `200`/
  resposta esperada — nao `401`. Esse e o teste que teria pego o bug de
  `authMiddleware` interceptando o wildcard antes de `deviceAuthMiddleware`.
- **(Ajuste pos-auditoria, CRITICAL)** teste de ACL: para toda funcao
  `SECURITY DEFINER` nova desta fase, `has_function_privilege('anon', oid, 'EXECUTE')`
  e `has_function_privilege('authenticated', oid, 'EXECUTE')` devem ser `false`
  logo apos a migration aplicar.
- **(Ajuste pos-auditoria, HIGH)** rate limit de `/api/biometric-bridge/*` usa
  bucket dedicado (nao o bucket `biometric` de 30/min ja em producao,
  compartilhado com o console browser-facing) e nao bloqueia o padrao de
  polling (`poll_after_ms`) + heartbeat combinados sob operacao normal.
- **(Ajuste pos-auditoria, HIGH)** teste fim-a-fim: proof gerada pelo fluxo
  bridge-facing e aceita por `record_lending_batch` (purpose
  `confirm_saida_militar`, com `expected_user_id`) e por
  `record_lending_returns` (purpose `return`, sem `expected_user_id`) — nao
  so pelo endpoint generico de identificacao do console.

### Bridge unit

- canonical request signer gera assinatura verificavel pelo BFF.
- proof canonicalization C# bate com vector TypeScript.
- DPAPI protege e recupera private key.
- config parser rejeita URL que nao seja HTTPS em modo production.
- logger redige template, assinatura e private key.
- fake SDK permite simular:
  - device ausente;
  - capture timeout;
  - match success;
  - match failure;
  - SDK exception.

### Integracao local sem hardware

- BFF com fake bridge client:
  - cria pairing code;
  - pareia fake bridge;
  - cria challenge;
  - fake bridge faz claim;
  - fake bridge envia proof;
  - result endpoint retorna usuario.

### Validacao real com hardware

Obrigatoria antes de declarar Phase 1B entregue:

1. `APMCB.BiometricBridge.exe doctor` detecta `NBioAPI` e dispositivo.
2. Bridge pareia com uma reserva real de teste.
3. `/reserva/biometria` mostra bridge ativo.
4. Armeiro inicia identificacao.
5. Leitor solicita dedo fisico.
6. Bridge captura e identifica usuario cadastrado.
7. Result endpoint mostra o usuario correto.
8. Tentativa com dedo nao cadastrado retorna falha clara.
9. Revogar device no BFF impede novo heartbeat/challenge/proof.
10. **(Ajuste pos-auditoria)** Nova saida real (`/reserva/saidas/nova`,
    `purpose='confirm_saida_militar'`, Verify 1:1) completa ponta a ponta
    contra `record_lending_batch` real — lending criado, estoque decrementado.
11. **(Ajuste pos-auditoria)** Devolucao real (`/reserva/saidas` → identificar
    → devolver, `purpose='return'`, 1:N) completa ponta a ponta contra
    `record_lending_returns` real — status atualizado, item liberado.

## Deploy e Ordem Operacional

### Antes da Phase 1B (Ajuste pos-auditoria — baseline real, sem condicional)

Phase 0, 1A.1 e 1A.2 ja estao mergeadas, deployadas e validadas em `main`
(commits `1c8f201`/`830091d`/`476d7dc`) — nao ha mais cenario condicional.
Confirmar antes de iniciar Phase 1B:

1. `main` em `>= 476d7dc`, deploy BFF/Web ja confirmado (ver
   `docs/enterprise/reports/2026-07-16-biometric-bridge-phase1a2-closure-dod.md`);
2. migrations `20260714000001` a `20260714000011` ja aplicadas em producao
   (11 migrations, nao 2 — inclui lockdown de grants, `totp_identity_claims`
   e a correcao da regressao de login);
3. `BIOMETRIC_SIMULATOR_ENABLED` ausente em producao + `NODE_ENV=production`
   (dupla trava — confirmado, simulador estruturalmente impossivel de ativar);
4. `/reserva/biometria` validado sem simulator em producao (confirmado com
   sessao real de armeiro).

Nenhuma acao de identificar/mergear branch e necessaria — o baseline ja e
`main`.

### Durante a Phase 1B

1. aplicar migration Phase 1B;
2. deploy BFF com endpoints bridge-facing;
3. instalar bridge Windows no notebook/reserva;
4. parear device;
5. validar hardware real.

### Rollback

Rollback rapido:

1. revogar device em `biometric_devices`;
2. desabilitar uso de bridge real na UI mantendo TOTP;
3. remover app Windows;
4. manter migrations, pois tabelas novas sao append-only e nao quebram fluxos
   existentes.

## Criterios de Aceite

- Nenhum endpoint local e chamado pelo browser.
- Nenhum SDK biometrico roda no BFF/VPS.
- Bridge real pareia por codigo one-time.
- Bridge request-auth usa Ed25519, timestamp e nonce.
- Bridge detecta NITGEN via SDK instalado.
- Bridge identifica pelo menos um usuario cadastrado no tenant.
- UI `/reserva/biometria` mostra usuario identificado com proof real.
- Se Phase 1A.2/1A.3 ja estiverem mergeadas, saida/devolucao/cautela/livro
  consomem proof real gerada pelo bridge Windows sem simulator.
- Device revogado para de funcionar.
- Template e digital bruta nao aparecem em logs/responses.
- BFF tests, bridge unit tests e validacao manual com hardware passam.
- Code review imparcial sem CRITICAL/HIGH.
- `docs/security.md`, changelog e DoD report atualizados na implementacao.

## Riscos e Mitigacoes

| Risco | Mitigacao |
|---|---|
| SDK .NET antigo nao roda em .NET 8 | MVP em .NET Framework 4.8, igual sample oficial |
| eNSearch nao exposto no wrapper .NET | fallback 1:1 para expected_user e 1:N pequeno; reportar capability |
| Templates em memoria do bridge | sem persistencia em disco no MVP, device revocation e logs redigidos |
| PC da reserva roubado | revogar device; private key protegida por DPAPI; sem senha de usuario no bridge |
| Relogio Windows errado | `doctor` e device-auth rejeitam timestamp fora da janela |
| Driver falha apos update Windows | `doctor` mostra erro e recomenda reinstalar driver compativel |
| Liveness indisponivel | documentar risco residual; threshold, lockout, TOTP fallback e auditoria |
| (Ajuste pos-auditoria) `record_lending_batch`/`record_lending_returns` ja tem overload orfao em producao (assinatura sem `p_totp_claim_id`, de antes da Phase 1A.2 fechar — ver relatorio de fechamento §11) | Phase 1B nao mexe nessas RPCs diretamente; mas se qualquer ajuste futuro exigir nova assinatura, fazer `DROP FUNCTION` da assinatura antiga na MESMA migration — nao repetir o padrao de deixar lixo de schema pela 3a vez |

## Prompt para auditoria no Claude Code

```text
Audite a spec docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md contra o estado real do repo.

Objetivo: validar se a Phase 1B proposta e a forma mais simples, segura e funcional de ligar o leitor NITGEN USB fisico ao sistema cloud, sem SDK na VPS e sem browser chamando localhost.

Verifique:
1. Se a spec contradiz Phase 0/1A.1 ja mergeadas em main.
2. Se os endpoints bridge-facing propostos fecham a lacuna de o bridge real nao possuir cookie de usuario.
3. Se o device-auth Ed25519 + timestamp + nonce esta suficiente contra spoofing/replay.
4. Se o pareamento por codigo one-time esta implementavel sem vazar tenant/reserve pelo cliente.
5. Se template sync tenant-wide e aceitavel para o MVP ou precisa ser reduzido.
6. Se o uso de C#/.NET Framework 4.8 e correto dado o SDK NITGEN instalado.
7. Se o harness cobre regressao real: device revogado, replay, challenge claim atomico, template leak e proof submit sem cookie.
8. Se Phase 1A.2/1A.3 ja estiverem implementadas em outra branch, se esta spec continua compativel com esse baseline.
9. Se ha lacunas CRITICAL/HIGH antes de implementar.

Entregue nota 0-10, achados CRITICAL/HIGH/MEDIUM/LOW, recomendacao final e ajustes objetivos. Nao implemente nada.
```

## Definition of Done da Phase 1B

- Spec aprovada apos auditoria externa.
- Plano de implementacao criado.
- Migration Phase 1B criada e validada.
- BFF endpoints bridge-facing implementados com TDD.
- Bridge Windows MVP implementado com fake SDK e NITGEN real.
- Harness BFF e bridge passando.
- Validacao manual com leitor USB real documentada.
- Code review imparcial sem CRITICAL/HIGH.
- `docs/security.md`, changelog e relatorio DoD atualizados.
- Commit e push.
