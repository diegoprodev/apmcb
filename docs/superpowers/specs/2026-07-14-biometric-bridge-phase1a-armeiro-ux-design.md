# APMCB - Spec: Biometric Bridge Phase 1A, Armorer UX and Simulated Bridge

> Status: spec pronta para auditoria externa antes de implementacao.
> Data: 2026-07-14
> Base tecnica: `biometric-bridge-phase0` (`c38419b`)
> Fase anterior: `docs/enterprise/reports/2026-07-14-biometric-bridge-phase0-dod.md`
> Regra operacional: finalizado nao significa entregue; entrega exige harness, validacao real, code review, changelog, commit e push.

## Veredito

A proxima fase correta nao e plugar o SDK NITGEN diretamente no navegador nem no
BFF. A fase correta e criar uma experiencia completa para o armeiro usando o
contrato `challenge/proof` da Phase 0, com um bridge simulado para testes e uma
interface pronta para receber o bridge Windows real na fase seguinte.

O objetivo desta fase e fazer o fluxo do armeiro ficar excelente, intuitivo e
testavel, sem depender ainda do executavel Windows real. O sistema deve parar de
parecer "biometria tecnica que talvez funcione" e passar a parecer um console
operacional governado: estado do leitor claro, acao primaria clara, progresso
visivel, fallback seguro e resultado auditavel.

## Estado Real do Repo

### Ja entregue na Phase 0

- `biometric_devices`, `biometric_challenges`, `biometric_proofs`.
- proof assinada por bridge, Ed25519, TTL, consumo unico e anti-replay.
- escopo por tenant/reserva e `reserve_memberships`.
- rate limit dedicado `/api/biometric/*`.
- redaction de segredos biometricos.
- endpoints legados `/api/biometric/identify` e `/api/biometric/register`
  falham fechado com `BIOMETRIC_BRIDGE_REQUIRED`.

### Lacunas ainda reais

- `apps/web/src/app/(dashboard)/reserva/page.tsx` ainda apresenta cards simples:
  "Identificar Usuario" vai para `/reserva/militares` e o texto ainda cita
  "leitor ZKTeco".
- `apps/web/src/app/(dashboard)/reserva/militares/_militares-table.tsx` ainda
  chama `${BFF_URL}/biometric/register` sem `/api` e sem challenge/proof.
- `apps/web/src/app/(dashboard)/reserva/saidas/nova/_form.tsx` ainda chama
  `${BFF_URL}/biometric/identify` sem `/api` e sem proof.
- `apps/web/src/app/(dashboard)/reserva/saidas/_desarmamento-modal.tsx` usa
  `POST /api/lendings/identify` com `mode="biometria"`, mas o BFF ainda tenta
  matching no servidor.
- `apps/bff/src/routes/lendings.ts`, `saidas.ts`, `cautelamentos.ts`,
  `shifts.ts` e `lib/shift-auth.ts` ainda possuem caminhos biometricos legados
  baseados em `biometric_templates`/SDK no BFF.
- `ShiftAuthDialog` tem uma aba de biometria conceitual, mas hoje ela permanece
  oculta porque a biometria antiga sempre falharia em cloud.

## Objetivo da Phase 1A

Criar a experiencia cloud do armeiro em cima do contrato seguro:

1. painel da reserva mostra estado do bridge e acao de identificacao;
2. armeiro identifica um usuario por biometria e ve historico/pendencias;
3. armeiro cadastra biometria presencialmente em usuario do proprio escopo;
4. "Nova Saida" e "Receber/Devolver Material" usam `proof_id`, nao flag booleana;
5. Livro Digital usa proof biometrica para abrir/fechar turno quando bridge ativo;
6. TOTP continua disponivel e visivel como fallback;
7. Playwright valida o fluxo usando bridge simulado, sem depender de hardware;
8. a interface fica pronta para o bridge Windows real da Phase 1B.

## Nao Objetivos

- Nao implementar ainda o executavel Windows NITGEN/eNBioBSP real.
- Nao chamar `http://127.0.0.1` ou qualquer endpoint local a partir do browser.
- Nao armazenar imagem bruta de digital.
- Nao comparar templates no browser.
- Nao permitir `use_biometric: true` como autorizacao.
- Nao remover TOTP.
- Nao prometer hardware real validado nesta fase.

## Decisao Arquitetural

### Abordagens consideradas

#### A. UI direta chamando bridge local no PC

Exemplo: browser chama `http://127.0.0.1:8765/capture`.

Rejeitada. Em ambiente cloud, isso gera problemas de CORS, mixed content,
instalacao local por usuario, spoofing e divergencia por tenant. Tambem prende a
UI ao bridge e dificulta auditoria.

#### B. Esperar o bridge Windows real antes de mexer na UI

Rejeitada. A UI atual ja quebra ou confunde fluxos reais e nao ha como validar
ergonomia do armeiro sem uma experiencia simulavel.

#### C. Contrato BFF + bridge simulado + UI completa

Escolhida. O BFF continua autoridade. A UI so cria challenge, exibe progresso e
consome proof. O bridge simulado permite validar jornadas e2e agora. O bridge
Windows real pluga no mesmo contrato depois.

## Experiencia do Armeiro

### Principios UX

- `Fitts`: a acao primaria "Identificar Usuario" deve ser grande, direta e
  sempre facil de clicar.
- `Hick`: a tela nao deve oferecer dez caminhos iguais. O fluxo padrao e
  identificar primeiro, agir depois.
- `Doherty`: todo estado assíncrono deve responder em menos de 100ms na UI:
  challenge criado, aguardando dedo, bridge indisponivel, match feito, falha e
  retry.
- `Miller`: informacao do usuario identificado deve vir agrupada: identidade,
  risco/status, materiais, cautelas/saidas, acoes.
- `Postel`: se o bridge nao estiver ativo, a UI deve explicar e oferecer TOTP ou
  busca manual quando permitido, sem erro tecnico cru.

### Tela `/reserva`

Adicionar um bloco operacional superior, antes do grid de cards:

**BiometricCommandCenter**

- titulo: `Identificacao operacional`;
- estado do bridge:
  - `Ativo`;
  - `Sem bridge pareado`;
  - `Bridge revogado`;
  - `Bridge offline`;
  - `Modo simulador`;
- CTA principal: `Identificar usuario`;
- CTA secundario para admin: `Gerenciar bridge`;
- indicador de fallback: `TOTP disponivel`;
- microcopy: curta e operacional, sem jargao de SDK.

O card existente "Identificar Usuario" deve apontar para o mesmo fluxo, mas o
centro de gravidade da tela deve ser o console operacional, nao um card generico
no grid.

### Nova rota `/reserva/biometria`

Criar uma tela dedicada de identificacao e atendimento:

1. painel esquerdo: status do bridge e botao `Iniciar identificacao`;
2. centro: estado da captura:
   - pronto;
   - criando challenge;
   - aguardando dedo;
   - challenge expirada;
   - verificando assinatura;
   - identificado;
   - nao reconhecido;
   - bridge indisponivel;
3. painel direito: resultado do usuario identificado:
   - nome, posto, matricula, foto/iniciais;
   - status da conta;
   - impedimento administrativo;
   - materiais em posse;
   - cautelas/saidas abertas;
   - pendencias remotas;
   - acoes: `Registrar saida`, `Receber material`, `Ver historico`,
     `Cadastrar/atualizar biometria`.

Essa tela deve ser util mesmo quando o match falha: mostrar retry, fallback TOTP
e instrucoes curtas.

O estado `challenge expirada` deve ter countdown visivel. Reusar o padrao ja
comprovado em `_desarmamento-modal.tsx`, adaptando a janela de 60s da challenge
biometrica. Ao expirar, a UI deve oferecer `Tentar novamente` sem reutilizar a
challenge antiga.

### Cadastro biometrico em `/reserva/militares`

Substituir `handleCapture()` legado por `BiometricEnrollmentPanel`:

- escolher dedo pelo `FingerSelector` existente;
- criar challenge `purpose="enroll"` com `expected_user_id` do militar;
- mostrar estado `Aguardando leitura no leitor da reserva`;
- receber proof/enrollment;
- atualizar dedos cadastrados e status;
- mostrar qualidade e data do cadastro;
- se usuario ja tiver TOTP, permitir configurar regra futura de exigir TOTP do
  proprio militar como testemunha, mas nao bloquear esta fase sem regra ativa.

Texto proibido na UI: "ZKTeco", "SDK", "VPS", "stub", "local host". O armeiro
precisa ver linguagem operacional: leitor, digital, identidade, autorizado,
pendente, tentar novamente.

### Nova Saida

O fluxo atual tem `Biometria` e `Codigo TOTP`. Na Phase 1A:

- modo biometria cria challenge com purpose `confirm_saida_militar`;
- resultado precisa gerar `biometric_proof_id`;
- `POST /api/lendings` recebe `auth_mode="biometria"` e `biometric_proof_id`;
- o BFF valida que a proof:
  - pertence ao tenant/reserva;
  - pertence ao militar selecionado;
  - tem purpose correto;
  - nao foi usada em outra operacao;
  - esta dentro da janela de TTL operacional;
  - foi criada pelo actor correto.

Se a pessoa identificada for diferente do militar selecionado, a UI deve travar
com mensagem clara: `Digital reconhecida como outro usuario. Confira a selecao.`

### Receber/Devolver Material

O modal de desarmamento deve parar de chamar matching BFF legado. Novo fluxo:

- `mode="biometria"` cria challenge `purpose="return"`;
- proof identifica o usuario;
- BFF cria ou atualiza `pendingIdentity` com `auth_mode="biometria"` e
  `biometric_proof_id`;
- UI mostra itens em posse do usuario identificado;
- bulk return usa a identidade pendente/proof ja validada.

### Livro Digital

`ShiftAuthDialog` deve usar o mesmo componente de biometria:

- se bridge ativo, mostra tabs `TOTP` e `Biometria`;
- se bridge ausente, mostra apenas TOTP e um estado informativo discreto;
- abertura de turno usa purpose `open_shift`;
- fechamento usa purpose `close_shift`;
- BFF `shifts.ts` troca `validateSelfBiometric(userId)` por validacao de
  `biometric_proof_id` quando `auth_mode="biometria"`.

### Cautelas e Passagens

Entram apenas na subfase 1A.3. O contrato e o mesmo:

- assinaturas deixam de aceitar `use_biometric: true`;
- passam a aceitar `biometric_proof_id`;
- `document_hash` da challenge deve ser igual ao documento assinado.

### Fluxo legado `saidas.ts`

`apps/bff/src/routes/saidas.ts` tem rotas item-based de assinatura que ainda usam
`validateBiometric()` legado, mas nao possuem caller UI ativo nesta spec. A
Phase 1A deve tomar decisao explicita:

- na subfase 1A.2, aposentar o caminho biometrico legado em `saidas.ts` com o
  mesmo padrao `BIOMETRIC_BRIDGE_REQUIRED`/501 usado em `/api/biometric/identify`
  e `/api/biometric/register`; ou
- se algum caller real for encontrado antes da implementacao, migrar esse caller
  para `biometric_proof_id` na mesma subfase.

O caminho proibido e deixar `use_biometric: true` em `saidas.ts` fazendo captura
ou verify no BFF cloud.

## Componentes Frontend

### `BiometricBridgeStatus`

Responsabilidade: exibir estado do bridge sem iniciar captura.

Props previstas:

```ts
type BridgeStatus = "active" | "missing" | "revoked" | "offline" | "simulator";

interface BiometricBridgeStatusProps {
  status: BridgeStatus;
  deviceName?: string;
  lastSeenAt?: string | null;
  bridgeVersion?: string | null;
  compact?: boolean;
}
```

### `BiometricCaptureDialog`

Responsabilidade: fluxo padrao de captura/identificacao por challenge.

Props previstas:

```ts
type BiometricPurpose =
  | "identify"
  | "enroll"
  | "sign_saida_armeiro"
  | "confirm_saida_militar"
  | "return"
  | "open_shift"
  | "close_shift"
  | "sign_cautela_armeiro"
  | "sign_cautela_militar";

interface BiometricCaptureDialogProps {
  open: boolean;
  purpose: BiometricPurpose;
  reserveId: string;
  expectedUserId?: string;
  documentType?: string;
  documentId?: string;
  documentHash?: string;
  title: string;
  onCancel: () => void;
  onProof: (proof: BiometricProofResult) => void;
}

interface BiometricProofResult {
  proofId: string;
  matchedUserId: string | null;
  matchScore: number;
  fingerIndex: number | null;
  livenessPassed: boolean | null;
}
```

### `BiometricIdentityPanel`

Responsabilidade: mostrar usuario identificado e suas pendencias operacionais.

Dados minimos:

- profile;
- materiais em posse;
- cautelas/saidas abertas;
- impedimentos;
- ultimas provas biometricas;
- acoes permitidas por role/reserva.

### `useBiometricChallenge`

Hook client-side para:

- criar challenge;
- iniciar polling;
- mapear erros tecnicos para mensagens operacionais;
- cancelar/retry;
- retornar proof segura.

O hook nao assina proof e nao acessa SDK.

Novos componentes e hooks devem reutilizar os padroes existentes do repo:

- `friendlyApiError` para mensagens vindas do BFF;
- helper de CSRF existente para mutacoes, quando a rota exigir CSRF;
- `createClient()` e sessao conforme padrao atual de chamadas autenticadas;
- `sonner` para feedback curto;
- `data-testid` nos estados criticos para Playwright.

## Contratos BFF Necessarios

### Ajuste de schema para simulator

A Phase 1A deve adicionar ao schema:

```sql
alter table biometric_devices
  add column if not exists is_simulator boolean not null default false;
```

Regras obrigatorias:

- `/api/biometric/devices/pair` nunca aceita `is_simulator` do cliente;
- device real nunca pode ser marcado como simulador por payload browser-facing;
- device simulador e criado/atualizado somente pelo modulo de simulator gated;
- `BiometricBridgeStatus` deriva `status="simulator"` exclusivamente de
  `biometric_devices.is_simulator=true`, nunca de `bridge_version`;
- `bridge_version` continua apenas informativo e nao e fonte de seguranca;
- harness deve falhar se `pairDeviceSchema` aceitar `is_simulator`.

### Consulta de disponibilidade

`GET /api/biometric/devices?reserve_id=...`

Ja existe na Phase 0. A UI deve usar para decidir estado do bridge.

### Resultado de challenge

Novo ou extensao do existente:

`GET /api/biometric/challenges/:id/result`

Retorna:

```json
{
  "status": "pending | consumed | expired | failed",
  "proof": {
    "id": "uuid",
    "matched_user_id": "uuid",
    "match_score": 0.97,
    "finger_index": 2,
    "liveness_passed": true,
    "created_at": "iso"
  },
  "profile": {
    "id": "uuid",
    "nome_completo": "string",
    "matricula": "string",
    "posto": "string",
    "foto_url": "string | null",
    "registration_status": "complete"
  }
}
```

Nunca retorna template, chave, assinatura ou payload bruto.

### Enrollment submit

Novo endpoint bridge-facing:

`POST /api/biometric/challenges/:id/enroll-submit`

Body assinado pelo bridge:

```json
{
  "proof": {
    "challenge_id": "uuid",
    "tenant_id": "uuid",
    "reserve_id": "uuid",
    "device_id": "uuid",
    "actor_id": "uuid",
    "purpose": "enroll",
    "matched_user_id": "uuid",
    "match_score": 1,
    "finger_index": 2,
    "liveness_passed": true,
    "sdk_version": "5.2.0.6",
    "bridge_version": "1.0.0-sim",
    "timestamp": "iso"
  },
  "encrypted_template_data": "base64",
  "template_hash": "sha256:...",
  "format": "nitgen-fmd",
  "quality": 88,
  "bridge_signature": "base64"
}
```

BFF valida challenge, bridge, tenant/reserva, actor, expected user, finger index,
qualidade, assinatura e grava `biometric_templates`. Depois, se o perfil estava
`pending_biometric`, muda para `complete`.

### Proof consume para rotas de negocio

Criar helper BFF:

```ts
assertUsableBiometricProof({
  proofId,
  tenantId,
  reserveId,
  actorId,
  expectedUserId,
  purpose,
  documentHash,
  maxAgeSeconds,
})
```

Regras:

- proof existe e pertence ao tenant/reserva;
- proof result e `success`;
- proof actor e o usuario logado esperado;
- proof purpose e o purpose da operacao;
- proof matched_user_id e o usuario esperado quando informado;
- proof document_hash bate quando houver documento;
- proof ainda esta dentro da janela operacional;
- proof ainda nao foi consumida por outra operacao sensivel.

Para impedir reuso de proof, adicionar uma coluna ou tabela de consumo:

Opcao recomendada: `biometric_proof_consumptions`

```sql
id uuid primary key default gen_random_uuid(),
proof_id uuid not null references biometric_proofs(id),
tenant_id uuid not null references tenants(id),
reserve_id uuid not null references reserves(id),
actor_id uuid not null references profiles(id),
operation_type text not null,
operation_id uuid,
created_at timestamptz not null default now(),
unique (proof_id)
```

Regra: uma proof biometrica autoriza exatamente uma operacao de negocio. Ela nao
pode ser reutilizada com outro `operation_type`. Para operacoes em lote,
`operation_id` pode ser `movement_id`, mas a unicidade continua sendo somente
`proof_id`.

## Bridge Simulado

### Objetivo

Permitir Playwright e desenvolvimento local sem hardware, mantendo o mesmo
contrato criptografico.

### Regras

- so habilitado quando `BIOMETRIC_SIMULATOR_ENABLED=true`;
- proibido em `NODE_ENV=production`;
- usa chave Ed25519 propria de teste;
- cria proof assinada real;
- nao grava template real fora de ambiente de teste/dev;
- todo resultado simulado deve aparecer na UI como `Modo simulador`;
- o sinal de simulator vem de `biometric_devices.is_simulator`, nao de strings
  como `bridge_version`.

### Superficie sugerida

`POST /api/biometric/simulator/challenges/:id/complete`

Gates obrigatorios:

- `NODE_ENV !== "production"`;
- `BIOMETRIC_SIMULATOR_ENABLED=true`;
- usuario autenticado com role `admin_global`, `admin_reserva` ou `armeiro`;
- challenge pertence ao mesmo actor/reserva/tenant.

Esse endpoint nao deve ser registrado em producao. O gate deve ocorrer no nivel
de registro da rota, preferencialmente em `apps/bff/src/index.ts`:

```ts
if (process.env.NODE_ENV !== "production" && process.env.BIOMETRIC_SIMULATOR_ENABLED === "true") {
  app.route("/api/biometric/simulator", biometricSimulatorRoutes);
}
```

Nao basta retornar 403 dentro do handler, porque isso ainda torna a superficie
observavel em producao. O harness deve inspecionar o modulo de registro e falhar
se a rota do simulator for montada fora do bloco condicional.

## UI/UX Athena Aplicada ao APMCB

A linguagem visual deve ser institucional e operacional:

- estrutura: console de trabalho, nao grid de cards iguais;
- geometria: cantos moderados, superficies firmes, sem excesso de pills;
- cor: uma accent principal; status verde/vermelho/amarelo apenas para feedback;
- icones: `Fingerprint`, `ShieldCheck`, `Radio`, `Clock`, `PackageCheck`,
  `AlertTriangle`, `RefreshCw`;
- feedback: loading, polling, retry e sucesso sempre visiveis;
- textos: curtos, orientados a acao.

### Microcopy padrao

- Bridge ativo: `Leitor biometrico pronto nesta reserva.`
- Sem bridge: `Nenhum bridge biometrico ativo para esta reserva. Use TOTP ou solicite pareamento.`
- Captura: `Peça ao usuario para posicionar o dedo no leitor.`
- Sucesso: `Usuario identificado com prova biometrica assinada.`
- Falha: `Digital nao reconhecida para esta operacao. Tente novamente ou use TOTP.`
- Revogado: `Bridge revogado. Pareie um novo leitor antes de usar biometria.`

## Harness Obrigatorio

### BFF unit/static

- rota simulator nao existe em producao;
- simulator e registrado condicionalmente, nao apenas bloqueado no handler;
- `biometric_devices.is_simulator` nao pode ser escrito por `/devices/pair`;
- UI deriva `Modo simulador` de `is_simulator`;
- `assertUsableBiometricProof` rejeita:
  - proof de outro tenant;
  - proof de outra reserva;
  - proof de outro actor;
  - purpose errado;
  - expected user diferente;
  - document hash diferente;
  - proof vencida;
  - proof ja consumida;
  - segundo consumo do mesmo proof com `operation_type` diferente;
  - result diferente de success;
- enrollment rejeita usuario fora do tenant/reserva;
- enrollment rejeita finger index fora de 1..10;
- enrollment rejeita qualidade abaixo do minimo;
- enrollment nao loga template ou assinatura;
- rotas `saidas`, `lendings`, `shifts`, `cautelamentos` nao chamam
  `getFingerprintSDK`, `.capture(`, `.identify(` ou `.verify(`.

### Web unit/static

- nenhum frontend chama `${BFF_URL}/biometric/...` sem `/api`;
- nenhum frontend chama `127.0.0.1`, `localhost:8765` ou endpoint local para
  biometria;
- `BiometricCaptureDialog` possui estados de loading, pending, success, failure,
  expired, missing bridge e retry;
- `ShiftAuthDialog` mostra biometria apenas quando bridge ativo.

### Playwright

Jornadas minimas:

1. armeiro abre `/reserva`, ve bridge ativo em modo simulador e CTA principal;
2. identifica usuario por biometria e ve painel com historico/pendencias;
3. tenta identificar com dedo errado e recebe erro claro + retry;
4. deixa uma challenge expirar durante a captura e ve countdown + retry;
5. cadastra biometria de militar pendente em `/reserva/militares`;
6. registra nova saida usando `biometric_proof_id`;
7. recebe/devolve material por biometria;
8. abre e fecha turno do Livro Digital usando biometria;
9. quando bridge esta ausente, UI oculta biometria e TOTP continua funcional.

### Validacao manual

Como esta fase usa simulador, validacao manual obrigatoria e:

- fluxo completo no navegador com modo simulador;
- nenhuma chamada a endpoint legado sem `/api`;
- nenhuma tentativa de acessar USB pelo BFF;
- evidencias no DoD.

Hardware real fica para Phase 1B.

## Plano de Implementacao Recomendado

A Phase 1A deve ser dividida em tres subfases. Cada subfase precisa de plano,
harness, code review e DoD proprios. Nao implementar tudo em um unico commit.

### Phase 1A.1 - Contrato, Simulator e Console de Identificacao

Escopo:

- adicionar `biometric_devices.is_simulator`;
- adicionar `biometric_proof_consumptions`;
- adicionar helper `assertUsableBiometricProof`;
- adicionar result endpoint;
- adicionar simulator gated com registro condicional;
- adicionar `BiometricBridgeStatus`;
- adicionar `BiometricCaptureDialog`;
- adicionar `/reserva/biometria`;
- atualizar `/reserva` com `BiometricCommandCenter`.
- Playwright: identificar usuario, erro/retry, challenge expirada e bridge ausente.

Nao toca mutacoes de negocio de custodia fisica.

### Phase 1A.2 - Cadastro, Nova Saida e Devolucao

Escopo:

- enrollment presencial em `/reserva/militares`;
- `NovaSaidaForm` usa `biometric_proof_id`;
- `_desarmamento-modal.tsx` usa proof;
- `lendings.ts` valida proof no consumo;
- `saidas.ts` aposenta o caminho biometrico legado ou migra caller real
  encontrado para `biometric_proof_id`;
- Playwright: cadastrar biometria, registrar saida e devolver material.

Esta subfase toca custodia fisica de armamento e deve ter review separado.

### Phase 1A.3 - Livro Digital, Cautelas e Passagens

Escopo:

- `ShiftAuthDialog` usa proof para abrir/fechar turno;
- `shifts.ts` troca `validateSelfBiometric` por proof;
- `cautelamentos.ts` troca `use_biometric` por `biometric_proof_id`;
- handovers/passagens aceitam proof quando houver assinatura biometrica;
- `document_hash` e obrigatorio em assinaturas de documento;
- Playwright: abrir/fechar turno, cautela e passagem com biometria.

Esta subfase toca cadeia de assinatura/documento e deve ter review separado.

## Criterios de Aceite

- UX do armeiro permite completar as jornadas sem entender SDK, VPS ou bridge.
- Todos os fluxos possuem loading, retry, erro amigavel e fallback.
- Nenhum frontend chama endpoint biometrico legado sem `/api`.
- Nenhum BFF operacional tenta capturar digital via SDK local.
- Todas as operacoes sensiveis usam `proof_id`.
- Bridge simulator passa Playwright, mas e impossivel em producao.
- TOTP permanece funcionando.
- Docs e journeys atualizados.
- Code review imparcial sem CRITICAL/HIGH.
- Changelog, DoD, commit e push da branch.

## Riscos e Mitigacoes

| Risco | Mitigacao |
|---|---|
| Simulator virar backdoor | Registro condicional fora de production, `is_simulator` nao gravavel por pair, harness estatico |
| Proof reutilizada em outra operacao | `biometric_proof_consumptions` com `unique(proof_id)` e helper central |
| UI confundir bridge ausente com erro de usuario | Estados separados e microcopy operacional |
| Operador usar biometria de usuario errado | `expected_user_id` obrigatorio em operacoes com usuario selecionado |
| Documento assinado mudar apos challenge | `document_hash` validado no consumo |
| Legado continuar chamando SDK | Harness bloqueando SDK em rotas operacionais |
| Fase ficar grande demais | Implementar como 1A.1, 1A.2 e 1A.3, cada uma com testes e review |

## Prompt sugerido para auditoria no Claude Code

```text
Audite a spec docs/superpowers/specs/2026-07-14-biometric-bridge-phase1a-armeiro-ux-design.md contra o estado real do repo.

Objetivo: validar se a Phase 1A proposta e implementavel, segura e suficiente para deixar o fluxo do armeiro excelente usando challenge/proof, bridge simulado e sem hardware real ainda.

Verifique:
1. Se a spec contradiz a Phase 0 ja implementada.
2. Se algum endpoint/arquivo citado nao existe ou exige ajuste de escopo.
3. Se o simulator pode virar backdoor.
4. Se `proof_id` fica bem amarrado a tenant, reserva, actor, purpose, usuario e document_hash.
5. Se a UX proposta cobre painel da reserva, identificacao, cadastro, nova saida, devolucao e livro digital.
6. Se cautelas/passagens devem entrar na Phase 1A.3 ou devem virar fase posterior.
7. Se o harness proposto detecta regressao real.
8. Se `is_simulator` e `unique(proof_id)` fecham os achados HIGH da auditoria.
9. Se a divisao 1A.1/1A.2/1A.3 esta correta.

Entregue nota 0-10, bloqueadores CRITICAL/HIGH/MEDIUM, e sugestoes objetivas antes de implementarmos.
Nao implemente nada.
```

## Definition of Done da Phase 1A

- spec aprovada apos auditoria externa;
- plano de implementacao detalhado criado;
- implementacao em branch isolada;
- TDD/harness antes de codigo de producao;
- Playwright com simulator passando;
- BFF test/typecheck passando;
- Web lint/typecheck/test relevantes passando;
- code review imparcial antes do commit final;
- docs/security.md, journeys e changelog atualizados;
- DoD report com evidencias;
- commit e push.
