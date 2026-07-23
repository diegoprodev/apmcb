# APMCB — Spec: Unificar assinatura de cautela e autenticação de turno no bridge biométrico real

**Data:** 2026-07-23 (v3)
**Status:** Em revisão.
**Contexto:** Levantamento de todos os pontos de biometria do sistema (pedido do dono do sistema, "explore isso pra mim... quero tudo intuitivo dinâmico interativo... premium") revelou que 2 dos 6 fluxos de captura biométrica nunca foram conectados ao bridge NITGEN real (Fases 0-1C, já entregues e code-reviewed nesta sessão) — usam um SDK de teste (`getFingerprintSDK`/ZKTeco) que **sempre falha por construção**, não por instabilidade. Confirmado pelo dono do sistema: "nunca usei zkteco, pode apagar qualquer referência. foi para testes" — não é uma integração a preservar, é código morto a remover.
**Meta de qualidade:** nota ≥ 9.5/10 em revisão sênior, spec e implementação, antes de fechar esta fase — mesmo padrão das specs anteriores deste projeto (Biometric Bridge Fases 0-1C).

**Histórico de revisão:**
- **v1 → 6,0/10.** Revisor verificou cada citação de arquivo:linha contra o código real. Confirmou a maior parte das citações da seção 1 (causa raiz) como exatas, mas achou: **CRÍTICO** — a rota que cria/consulta desafios biométricos (`POST /api/biometric/challenges`, `GET /challenges/:id/result`) bloqueia a role `usuario`, que é exatamente a role de um militar assinando a própria cautela em `/efetivo/minhas-cautelas` — o caso de uso central da seção 1.1 seria estruturalmente inalcançável como desenhado. **ALTO** — (A1) a spec citava `apps/bff/src/routes/saidas.ts` como já implementando o padrão `loadBiometricProof`/`assertProofScopeAndFreshness`/`consumeBiometricProof` a replicar; na realidade `saidas.ts` retorna 501 pra qualquer tentativa de biometria (`BIOMETRIC_BRIDGE_REQUIRED`) — o padrão real só existe em `lendings.ts`, e mesmo lá o mapeamento de erro HTTP não é granular por tipo (contrário ao que a v1 dizia "replicar"); (A2) `GET /api/cautelamentos` (usado por `_cautelas-client.tsx`, fluxo do armeiro) não seleciona `reserve_id` nem `document_hash` — a v1 afirmava incorretamente que esses campos já estavam disponíveis. **MÉDIO** — (M1) exemplos JSX omitiam a prop obrigatória `canCapture` de `BiometricCaptureDialog`; (M2) a justificativa do risco de dialog aninhado citava um precedente (Sheet) que não é o mesmo tipo de composição (Dialog-em-Dialog não tem precedente testado no código-base); (M3) a afirmação de que `currentUserId` viria "da mesma fonte" que os fluxos já prontos estava errada — esses fluxos identificam OUTRA pessoa, não o próprio usuário logado. **BAIXO** — (B1) snippet de schema mostrava o campo morto `use_biometric` ainda presente com um comentário, contradizendo o texto ao lado; (B2) snippet de código compartilhado entre `sign-armeiro`/`sign-militar` usava uma variável (`authVerified`) que só existe num dos dois handlers; (B3) um dos 2 arquivos de teste listados pra revisão não precisa de nenhuma mudança (testa arquivos que esta spec não toca). Todos corrigidos na v2 — o achado CRÍTICO exigiu desenho de autorização novo (seção 4.0), não só uma correção textual.
- **v2 → 6,5/10.** Revisor confirmou a autorização nova da seção 4.0 como corretamente desenhada e segura para os 3 call sites que ela cobria, e confirmou A1/A2/M1/M2/M3/B1/B2/B3 como genuinamente corrigidos — mas achou que o CRÍTICO da v1 **não estava resolvido de fato**: um **4º call site** do mesmo tipo de bug sobrevivia, não coberto pela seção 4.0. `GET /api/biometric/devices` (`biometric.ts:262`) também bloqueia `usuario` — e é chamada pelo próprio `BiometricCaptureDialog` (`biometric-capture-dialog.tsx:110-131`) **antes** de `POST /challenges`, sempre que `simulatorEnabled` é falso (ou seja, sempre em produção real). Um militar real, com leitor físico pareado, seria bloqueado nesse pré-check, nunca chegando a `POST /challenges` — o caso de uso central continuava estruturalmente inalcançável em produção, só que um passo antes de onde a v1 tinha encontrado. Agravante: o teste E2E via simulador que a v2 desenhava como "o único jeito de pegar o CRÍTICO da v1" é **estruturalmente cego** a esse gap específico, porque o modo simulador pula exatamente esse `useEffect` (`if (simulatorEnabled) { setBridgeAvailable(true); return; }`) — o teste passaria mesmo com produção quebrada. Achou também 1 **ALTO novo**, introduzido pelo próprio código de exemplo da v2 (não presente na v1): no snippet da seção 4.1, a chamada a `consumeBiometricProof` ficava **fora** do `try/catch` que captura `assertProofScopeAndFreshness` — uma prova já consumida faria `consumeBiometricProof` lançar (`biometric-proof-consumption.ts:107-109`, é essa função, não `assertProofScopeAndFreshness`, que checa consumo real) sem ser capturada, subindo pro handler global de erro (500 genérico) em vez do 409 que a própria seção 6 exige testar. E 1 **MÉDIO**: a caracterização "o padrão real só existe em `lendings.ts`" continuava imprecisa — `consumeBiometricProof` nunca é chamada em código de produção (só num arquivo de teste); o padrão real de `lendings.ts` é `loadBiometricProof`/`assertProofScopeAndFreshness` seguidos de consumo **dentro de uma RPC Postgres**, atômico com a mutação de negócio — diferente do desenho da seção 4.1 (consumo solto em JS, não transacional com a mutação de `cautelamentos`). Corrigidos nesta v3: seção 4.0 ganha um 4º call site (`GET /devices`) com checagem de autorização própria (mais fraca, sem `document_id` disponível nesse ponto do fluxo); seção 4.1 corrige a ordem de operações (consumir a prova por último, só depois da mutação de negócio confirmada, dentro do mesmo try/catch) e documenta essa escolha conscientemente em vez de alegar réplica de um padrão que não existe assim.

---

## 1. Problema — evidência concreta, não suposição

### 1.1 Assinatura de cautela por biometria sempre falha (401)

`SignDialog` (`apps/web/src/components/cautelas/sign-dialog.tsx`), usado em `/reserva/cautelas` (assinatura do armeiro e assinatura individual) e `/efetivo/minhas-cautelas` (militar assinando a própria cautela), envia `POST /api/cautelamentos/:id/sign-armeiro` ou `/sign-militar` com `{ use_biometric: true }`.

No BFF, `apps/bff/src/routes/cautelamentos.ts:82-111` (`validateBiometric`) chama:

```ts
const sdk = await getFingerprintSDK();       // default: ZKTecoSDK (stub)
const captured = await sdk.capture(1);       // sempre retorna um buffer fake
const result = await sdk.identify(captured.data, templates...);  // sempre retorna null
```

`apps/bff/src/services/fingerprint/zkteco.ts:37-44` — `identify()` sempre retorna `null` **por implementação** (comentário no próprio arquivo: `"Stub until real libzkfp bindings are available"`). Consequência direta: `result.userId !== expectedUserId` é sempre verdadeiro (comparando com `null`), e `validateBiometric` sempre retorna `{ ok: false, status: 401, error: "Biometria não reconhecida ou não corresponde ao signatário esperado" }`.

**Não é um bug de hardware ou rede — é matematicamente impossível essa chamada ter sucesso hoje**, independente de o usuário ter ou não biometria cadastrada.

### 1.2 Autenticação de turno por biometria: desligada no frontend E quebrada no backend

`ShiftAuthDialog` (`apps/web/src/components/livro/shift-auth-dialog.tsx`) só mostra a aba "Biometria" quando `biometricAvailable=true` — `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx` **nunca passa essa prop** (confirmado via grep — ausente nas duas instâncias, "Assumir Turno" e "Encerrar Turno"). Mesmo se fosse religada, o caminho de backend (`apps/bff/src/lib/shift-auth.ts:99-151`, `validateSelfBiometric`) tem a mesma causa raiz do item 1.1: `getFingerprintSDK()` → `sdk.verify()` (`zkteco.ts:46-52`) **sempre retorna `false`** por implementação. `match` nunca vira `true`, resultado sempre `{ ok: false, status: 401, error: "Biometria não reconhecida. Tente novamente." }`.

### 1.3 Causa raiz comum

Ambos os caminhos usam `apps/bff/src/services/fingerprint/index.ts` (`getFingerprintSDK`), que por padrão instancia `ZKTecoSDK` — uma tentativa de integração com um fabricante diferente (ZKTeco) do que o resto do sistema usa (NITGEN, via o bridge Windows entregue nas Fases 0-1C desta sessão). Nunca chegou a ter bindings reais (`zkteco.ts:9-17`, comentário do próprio arquivo lista os passos que faltam). Confirmado com o dono do sistema: nunca foi usado de propósito, é código de teste — **remoção completa está no escopo desta spec, não migração**.

### 1.4 Por que isso não apareceu antes

Os 4 fluxos que usam o bridge NITGEN real (identificar, cadastrar/alterar digital, dar saída, receber material) foram construídos e testados nas Fases 0-1C **depois** que este código ZKTeco já existia — ninguém foi obrigado a tocar em `sign-armeiro`/`sign-militar`/`shift-auth.ts` durante essas fases, então o código morto nunca foi encontrado ou removido. A investigação desta spec (leitura direta do backend, não só do frontend) foi o que revelou o problema.

### 1.5 Achado da revisão v1→v2 — a própria API de challenge bloqueia o caso de uso principal

`POST /api/biometric/challenges` (`apps/bff/src/routes/biometric.ts:342-376`), `GET /challenges/:id/result` (linha 402-486) e a rota equivalente do simulador `POST /simulator/challenges/:id/complete` (`apps/bff/src/routes/biometric-simulator.ts:209-337`) são gateadas por `roleGuard("admin_global", "admin_reserva", "armeiro")` — **`usuario` não está na lista**. `actorCanAccessReserve` (duplicada, idêntica, em `biometric.ts:132-148` e `biometric-simulator.ts:65-80`) reforça isso: `if (role !== "admin_reserva" && role !== "armeiro") return false;` (mais `admin_global`, tratado à parte) — rejeita `usuario` incondicionalmente.

O BFF usa a service-role key (RLS desligado) — esses guards são a **única** barreira de autorização, não uma camada redundante sobre RLS.

**Consequência**: um militar (role `usuario`) logado em `/efetivo/minhas-cautelas`, tentando assinar a própria cautela via biometria, recebe 403 ao criar o challenge — antes de qualquer captura de dedo. Exatamente o cenário que a seção 1.1 descreve como motivador desta spec. A seção 4.0 desenha a correção.

---

## 2. Objetivo e critérios de sucesso

**Objetivo**: os 6 fluxos de biometria do sistema (identificar, cadastrar/alterar digital, dar saída, receber material, assinar cautela, abrir/encerrar turno) usam o **mesmo motor real** (bridge NITGEN via challenge/purpose/proof), com a **mesma experiência visual** (`BiometricCaptureDialog` — card de estados idle/pending/success/failure/expired/retry). TOTP continua como alternativa em todos.

**Critérios de sucesso:**

| Critério | Como verificar |
|---|---|
| Assinar cautela via biometria funciona de ponta a ponta pro armeiro (role `armeiro`/`admin_reserva`) | E2E via simulador autenticado como armeiro |
| Assinar cautela via biometria funciona de ponta a ponta pro militar (role `usuario`, autoatendimento) | E2E via simulador autenticado como `usuario` — **este teste é o que teria pego o achado CRÍTICO da v1**, ver seção 6 |
| Abrir/encerrar turno via biometria funciona de ponta a ponta | E2E via simulador + validação manual |
| Nenhuma prova biométrica pode ser reaproveitada entre propósitos/documentos/atores diferentes | Teste de integração replicando os já existentes em `lendings.ts` para `assertUsableBiometricProof` |
| Um militar (`usuario`) nunca consegue criar um desafio de propósito diferente de `sign_cautela_militar`, nem mirar noutra pessoa, nem noutra cautela que não seja sua | Teste de integração negativo — ver seção 4.0/6 |
| TOTP continua funcionando exatamente como hoje nos 2 fluxos (nenhuma regressão) | Suíte E2E existente de cautelas/livro continua verde |
| Nenhum resquício do SDK de teste (ZKTeco) no código | Grep de `getFingerprintSDK`, `ZKTecoSDK`, `zkteco` retorna zero resultados fora do git history |
| Code review sênior sem CRÍTICO/ALTO pendente | Regra CLAUDE.md, ≥9.5/10 |

---

## 3. Escopo

**Dentro do escopo:**
- Assinatura de cautela (armeiro e militar) via biometria — `purpose: sign_cautela_armeiro` / `sign_cautela_militar`.
- Abertura e encerramento de turno via biometria — `purpose: open_shift` / `close_shift`.
- Autorização self-service escopada para `usuario` criar/consultar desafios do próprio `sign_cautela_militar` (seção 4.0) — necessária pro item acima funcionar de verdade, não apenas "no papel".
- Remoção completa do SDK de teste ZKTeco e de `validateBiometric`/`validateSelfBiometric`.
- Consolidação da função duplicada `actorCanAccessReserve`/`reserveBelongsToTenant` (hoje copiada idêntica em `biometric.ts` e `biometric-simulator.ts`) num módulo compartilhado — descoberta como duplicação real durante o desenho da seção 4.0, corrigida como parte do trabalho já em curso ali (não é refatoração à parte).
- Testes E2E novos cobrindo os 6 fluxos via clique real de UI (não só API), usando o modo simulador.

**Fora do escopo (registrado, não esquecido):**
- `handover_sign_exit` / `handover_sign_entry` — purposes já tipados no frontend (`biometric-capture-dialog.tsx`) mas sem nenhuma tela usando; não há fluxo de troca de plantão implementado hoje para conectar a eles. Fica para quando esse fluxo existir.
- Qualquer mudança no bridge Windows (Fase C, já entregue) ou no protocolo de challenge/proof em si — esta spec só conecta telas novas ao que já existe e passou por review.
- `POST /challenges/:id/submit` (`biometric.ts:488-...`) — confirmado via grep que nenhum frontend chama essa rota (o simulador usa `/simulator/challenges/:id/complete`, uma rota diferente); fora do escopo desta spec, sem necessidade de tocar.
- Validação de hardware físico — mesma dependência já documentada nas specs anteriores (gate de hardware da Fase 1C), não duplicada aqui.

---

## 4. Arquitetura da correção

### 4.0 Autorização self-service para `usuario` em `sign_cautela_militar`

**O problema exato** (seção 1.5): `roleGuard` nas rotas envolvidas não inclui `usuario`. Simplesmente adicionar `usuario` à lista do `roleGuard` seria uma escalação de privilégio real — essas mesmas rotas atendem TODOS os purposes, incluindo `identify` e `enroll`, que permitiriam a um militar raso criar desafios de identificação/cadastro de **outras pessoas**.

**Correção da v2→v3 (achado CRÍTICO da revisão v2)**: a v2 tratou só 3 call sites (`POST /challenges`, `GET /challenges/:id/result`, `POST /simulator/challenges/:id/complete`) — mas **`GET /api/biometric/devices`** (`biometric.ts:260-296`) é um **4º** call site do mesmo tipo de bug, e é chamado **antes** de todos os outros: `BiometricCaptureDialog` (`biometric-capture-dialog.tsx:110-131`) consulta essa rota no mount pra decidir `bridgeAvailable`, sempre que `simulatorEnabled` é falso — ou seja, sempre em produção real (`simulator_available` só é `true` fora de produção). Sem corrigir esta rota também, um militar real com leitor físico pareado é bloqueado aqui, antes mesmo de tentar criar um challenge — e um teste E2E via simulador **não pega isso**, porque o modo simulador pula esse `useEffect` inteiro (`if (simulatorEnabled) { setBridgeAvailable(true); return; }` — linha 117-120). Corrigido nesta v3: seção 4.0 cobre os 4 call sites; seção 6 exige um teste de integração dedicado pra `GET /devices` como `usuario`, não só o E2E via simulador.

**Correção**: autorização escopada por purpose, verificada dentro do handler (não no `roleGuard`, que é um gate binário demais para essa granularidade). Novo módulo `apps/bff/src/lib/biometric-authorization.ts`, consolidando as duas cópias duplicadas de `actorCanAccessReserve`/`reserveBelongsToTenant` (`biometric.ts:122-148`, `biometric-simulator.ts:55-80` — hoje idênticas, código morto de duplicação) em duas funções novas, compartilhando um helper de membership:

```ts
// Importa o singleton `supabase` diretamente (mesmo padrão já usado em
// biometric.ts/biometric-simulator.ts/biometric-proof-service.ts neste
// projeto — não injeta o client como parâmetro). Os testes de integração da
// seção 6 rodam contra um Supabase real (mesma filosofia de teste já
// estabelecida neste projeto — ver testes de RPC do bridge biométrico),
// não um client mockado, então injeção de dependência não traria ganho de
// testabilidade aqui, só divergiria do estilo do resto do arquivo.

async function hasReserveMembership(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", userId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

// Usada só por GET /devices (achado CRÍTICO da revisão v2) — mais fraca que
// actorCanAccessChallenge de propósito: essa rota não carrega um document_id
// específico (é consultada ANTES de qualquer challenge existir), então a
// prova de legitimidade possível aqui é "este militar tem alguma cautela
// ativa nesta reserva", não "esta cautela específica é dele". Não expõe
// nada sensível de terceiros — a resposta é status/modelo/nome de um leitor
// físico, não dado de pessoa nenhuma.
async function usuarioHasActiveCautelaInReserve(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("cautelamentos")
    .select("id")
    .eq("militar_id", userId)
    .eq("reserve_id", reserveId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativa")
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function actorCanAccessChallenge(params: {
  userId: string;
  role: Role;
  tenantId: string;
  reserveId: string;
  purpose: string;
  expectedUserId: string | null;
  documentId: string | null;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId, purpose, expectedUserId, documentId } = params;

  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") {
    // Autoatendimento — só pode tocar no PRÓPRIO purpose de assinatura de
    // cautela, só mirando a si mesmo, só numa cautela que é sua de verdade
    // (a checagem de posse da cautela substitui a checagem de reserve
    // membership, que um usuario nunca tem — ver seção 1.5/CRÍTICO da v1).
    if (purpose !== "sign_cautela_militar") return false;
    if (expectedUserId !== userId) return false;
    if (!documentId) return false;

    const { data } = await supabase
      .from("cautelamentos")
      .select("id")
      .eq("id", documentId)
      .eq("militar_id", userId)
      .eq("reserve_id", reserveId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return !!data;
  }
  return false;
}

export async function actorCanAccessReserveDevices(params: {
  userId: string; role: Role; tenantId: string; reserveId: string;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId } = params;
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") return usuarioHasActiveCautelaInReserve(userId, reserveId, tenantId);
  return false;
}
```

**Aplicação nos 4 call sites** (troca direta de `actorCanAccessReserve(actorId, role, tenantId, reserveId)` pela função nova correspondente — os campos extras já estão disponíveis em cada handler antes da checagem, sem precisar de query nova):

1. `POST /challenges` (`biometric.ts:342-376`) — `actorCanAccessChallenge`, com `purpose`/`expected_user_id`/`document_id` vindos de `body` (schema já aceita, sem mudança de schema aqui). `roleGuard` ganha `"usuario"` na lista.
2. `GET /challenges/:id/result` (`biometric.ts:402-486`) — `actorCanAccessChallenge`, com `purpose`/`expected_user_id`/`document_id` vindos do `challenge` carregado (linha 412-418, select já inclui essas 3 colunas). `roleGuard` ganha `"usuario"`.
3. `POST /simulator/challenges/:id/complete` (`biometric-simulator.ts:209-337`) — `actorCanAccessChallenge`, mesma coisa, `challenge` já carregado com essas colunas (linha 225-231). `roleGuard` ganha `"usuario"`.
4. **NOVO (v3)** `GET /devices` (`biometric.ts:260-296`) — `actorCanAccessReserveDevices` no lugar de `actorCanAccessReserve` (linha 284). `roleGuard` (linha 262) ganha `"usuario"`. Ramo `admin_global` (linhas 275-281) fica como está — já correto.

**Por que isso é seguro (não uma ampliação genérica disfarçada)**: um `usuario` só passa na checagem de `actorCanAccessChallenge` se as 3 condições baterem simultaneamente — propósito fixo (`sign_cautela_militar`), alvo é ele mesmo (`expected_user_id === userId`, nunca client-trusted sozinho — comparado contra `c.get("userId")`, resolvido pela sessão, não pelo body), e a cautela referenciada (`document_id`) pertence a ele de fato (`militar_id === userId`, verificado contra o banco, não só o formato do UUID). `actorCanAccessReserveDevices` é deliberadamente mais fraca (sem `document_id` disponível nesse ponto do fluxo) mas expõe só metadado operacional do leitor, não dado de pessoa — e ainda exige uma cautela ativa real na reserva, não é acesso incondicional. Um `usuario` não ganha acesso a `identify`/`enroll`/`confirm_saida_militar`/`return`/`open_shift`/`close_shift`/`sign_cautela_armeiro` — todos continuam `false` pra essa role.

`POST /challenges/:id/enroll-submit` (`biometric.ts:150-207`) **não muda** — só atende `purpose === "enroll"`, que `usuario` nunca vai ter (checagem acima já barra antes de chegar lá).

### 4.1 Backend — `apps/bff/src/routes/cautelamentos.ts`

**`signBodySchema`** (linha ~114) troca `use_biometric` por `biometric_proof_id` (não os dois):

```ts
const signBodySchema = z
  .object({
    totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
    biometric_proof_id: z.string().uuid().optional(),
  })
  .refine((d) => d.totp_token || d.biometric_proof_id, {
    message: "Informe totp_token ou biometric_proof_id",
  });
```

`use_biometric: true` sai do schema por completo (não fica como campo aceito e ignorado) — deixar o campo morto aceito silenciosamente esconderia a mudança de contrato de um client desatualizado atrás de uma validação que passa mas não faz nada, exatamente o tipo de ambiguidade que este projeto já tratou como bug em specs anteriores (achado A5, spec Fase 1C).

**`sign-armeiro`** (linha 350-424): o `select` de `cautela` (linha 364) ganha `reserve_id` — hoje ausente, necessário pro contexto de validação da prova. O bloco `if (body.use_biometric) { ... }` (linhas 376-380) vira:

```ts
let loadedProof: Awaited<ReturnType<typeof loadBiometricProof>> | null = null;

if (body.biometric_proof_id) {
  loadedProof = await loadBiometricProof(body.biometric_proof_id, tenantId);
  try {
    assertProofScopeAndFreshness(loadedProof, {
      tenantId,
      reserveId: cautela.reserve_id,
      actorId: armeiroId,
      purpose: "sign_cautela_armeiro",
      expectedUserId: armeiroId,   // autoautenticação — o armeiro prova que é ele mesmo
      documentId: cautela.id,
      documentHash: cautela.document_hash,
    });
  } catch (err) {
    return c.json({ error: mapBiometricProofError(err) }, statusForBiometricProofError(err));
  }
  authVerified = true;
  authMethod = "biometric";
} else {
  // ramo TOTP inalterado
}
```

**Correção da revisão v2 (achado ALTO — 500 em vez de 409)**: a v2 chamava `consumeBiometricProof` logo depois da checagem de escopo, e **fora** do `try/catch` que trata `assertProofScopeAndFreshness` — um erro de `consumeBiometricProof` (é essa função, não `assertProofScopeAndFreshness`, que detecta consumo real — `assertProofScopeAndFreshness` ignora consumo prévio de propósito, `biometric-proof-service.ts:42-49`) subiria sem tratamento, virando 500 genérico no handler global em vez do 409 que a seção 6 exige testar.

**Correção estrutural, não só de try/catch**: `consumeBiometricProof` passa a ser chamado **por último**, depois que `document_signatures`/`cautelamentos` já foram gravados com sucesso (código existente, inalterado nesta spec — insert de `document_signatures`, update condicional de `cautelamentos` com compensação se falhar):

```ts
// (código existente inalterado: insert em document_signatures, depois
// update condicional em cautelamentos com compensação se falhar — linhas
// 390-418 hoje)

// Consumir a prova só DEPOIS da assinatura confirmada — nunca antes. Se a
// mutação de negócio falhar (ex: corrida com outra assinatura simultânea —
// já tratada pelo update condicional + compensação acima, que devolve 409
// via "Cautela não encontrada ou já alterada" ANTES de qualquer tentativa
// de consumir a prova), a prova biométrica nunca é marcada como consumida,
// e o request perdedor pode reenviar a mesma prova (dentro do TTL de 2 min)
// sem recapturar o dedo. Isto não é o padrão transacional de lendings.ts
// (que consome a prova DENTRO da mesma RPC Postgres da mutação de negócio —
// ver nota logo abaixo, correção do achado MÉDIO da revisão v2); é uma
// alternativa sequencial e mais simples, com uma janela residual estreita
// entre a assinatura confirmada e o registro do consumo, aceita
// conscientemente (seção 5) em vez de reescrever este fluxo como RPC.
if (loadedProof) {
  try {
    await consumeBiometricProof(supabase, loadedProof.proof, {
      proofId: body.biometric_proof_id!,
      tenantId, reserveId: cautela.reserve_id, actorId: armeiroId,
      operationType: "cautela_sign_armeiro",
      operationId: cautela.id,
      purpose: "sign_cautela_armeiro",
      expectedUserId: armeiroId,
      documentId: cautela.id, documentHash: cautela.document_hash,
    });
  } catch (err) {
    // A assinatura JÁ foi gravada com sucesso — não desfazer por causa
    // disso. Loga (janela residual real, mas rara) sem falhar a resposta:
    // do ponto de vista de quem assinou, a assinatura aconteceu de verdade.
    logger.warn("cautela.sign.proof_consume_failed", {
      signatureId: sig.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

auditLog(c, { action: "signature.created", ... });  // inalterado
return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
```

**`sign-militar`** (linha 426+): mesmo padrão, com `militarId` no lugar de `armeiroId` em todos os campos de ator/expected-user, `purpose: "sign_cautela_militar"`, `operationType: "cautela_sign_militar"`. Esse handler **não** tem uma variável `authVerified` hoje (só `sign-armeiro` tem) — o bloco novo aqui não a referencia, só define `authMethod = "biometric"` como o handler já faz hoje na linha 457.

**Correção da v1 (achado A1)**: `saidas.ts` **não** implementa esse padrão — retorna 501 pra qualquer tentativa de biometria (`saidas.ts:70-77`, `BIOMETRIC_BRIDGE_REQUIRED`). **Correção da revisão v2 (achado MÉDIO)**: `lendings.ts` também não é uma réplica exata do que esta spec propõe — `consumeBiometricProof` **nunca é chamada em código de produção** (só num arquivo de teste, confirmado via grep); o padrão real de `lendings.ts` é `loadBiometricProof`/`assertProofScopeAndFreshness` seguidos de um `insert` em `biometric_proof_consumptions` **dentro da mesma RPC Postgres** que grava a mutação de negócio (`record_lending_batch`, `supabase/migrations/20260714000006_biometric_phase1a2_batch_lending_rpc.sql:100,145` — atômico por transação). Esta spec **conscientemente não** move a assinatura de cautela para uma RPC nova (custo/complexidade desproporcional ao risco real, que é uma janela estreita entre 2 escritas sequenciais, não uma falha de segurança — ver ordenação acima e seção 5) — usa `loadBiometricProof`/`assertProofScopeAndFreshness` (importados de `apps/bff/src/lib/biometric-proof-service.ts`, sem mudança nesta spec) e chama `consumeBiometricProof` (`biometric-proof-consumption.ts`, sem mudança nesta spec) como último passo sequencial, não transacional.

**Mapeamento de erro**: nenhum precedente consistente existe hoje pra copiar (`lendings.ts` mapeia tudo pra 401 num call site e tudo pra 409 em outros dois, sem diferenciar por tipo). Decisão explícita: diferenciar por tipo —

```ts
function statusForBiometricProofError(err: unknown): 401 | 409 {
  const msg = err instanceof Error ? err.message : "";
  return msg.includes("already consumed") ? 409 : 401;
}
function mapBiometricProofError(err: unknown): string {
  return err instanceof Error ? err.message : "biometric proof invalid";
}
```

409 (conflito) para prova já consumida — sinaliza ao client que é um problema de reuso, não de identidade errada. 401 para todos os outros casos (`assertUsableBiometricProof`: `result !== "success"`, expirada, `tenant_id`/`reserve_id`/`actor_id`/`purpose`/`expected_user`/`document_id`/`document_hash` divergentes — ver `apps/bff/src/lib/biometric-proof-consumption.ts:58-89`) — todos são, na prática, "esta prova não serve pra autenticar esta ação", 401 é a semântica correta pro conjunto. **Nota honesta**: dado que `assertProofScopeAndFreshness` ignora consumo prévio de propósito (linha acima) e que `consumeBiometricProof` só é chamado depois da mutação de negócio já confirmada, o caso prático mais comum de "409 por reuso" em cautela-signing tende a vir do **guard condicional de update de `cautelamentos` já existente** (`armeiro_signature_id is null` — código atual, inalterado), não do `consumeBiometricProof`; os dois convergem pro mesmo 409 percebido pelo client, por caminhos de código diferentes. O teste da seção 6 precisa cobrir ambos.

**Correção da v1 (achado A2)**: `GET /api/cautelamentos` (`cautelamentos.ts:131-146`, usada por `_cautelas-client.tsx` — fluxo do armeiro) **não** seleciona `reserve_id` nem `document_hash` hoje. Ganha os dois campos no `select`. (`GET /api/cautelamentos/ativos`, usada por `_minhas-cautelas-client.tsx`, já usa `select("*")` — esses campos já vêm no JSON, só não estão tipados na interface TS do client; a v1 estava certa só para este segundo caso, não para o primeiro.)

### 4.2 Backend — `apps/bff/src/lib/shift-auth.ts` e `apps/bff/src/routes/shifts.ts`

**`OpenShiftSchema`/o schema de close** (`shifts.ts:18-42`) ganham `biometric_proof_id: z.string().uuid().optional()`, com o mesmo `.refine` adaptado: `auth_mode !== "biometria" || !!biometric_proof_id`.

**`validateSelfBiometric`** (`shift-auth.ts:99-151`) é **removida por completo** — não adaptada, removida — e o branch em `shifts.ts:120-122` e `343-345` vira:

```ts
const authResult = auth_mode === "totp"
  ? await validateSelfTotp(userId, totp_token!)
  : await validateSelfBiometricProof(userId, reserve_id, biometric_proof_id!, {
      tenantId,
      purpose: isOpen ? "open_shift" : "close_shift",
      documentId: isOpen ? null : shiftId,
    });
if (!authResult.ok) return c.json({ error: authResult.error }, authResult.status);
```

Nova função `validateSelfBiometricProof` em `shift-auth.ts` (substitui `validateSelfBiometric`) — **mesma correção de ordenação da seção 4.1 (achado ALTO da revisão v2)**: só faz `loadBiometricProof`/`assertProofScopeAndFreshness` e devolve `ShiftAuthResult` (mesmo contrato de `validateSelfTotp` — `{ok:true}` ou `{ok:false, error, status}`), **sem consumir a prova aqui**. `consumeBiometricProof` é chamado pelo handler de `shifts.ts` (`/open` e `/:id/close`), **depois** que o `insert`/`update` em `service_shifts` já teve sucesso — mesmo raciocínio da seção 4.1: consumir antes da mutação de negócio confirmada arrisca queimar a prova sem o turno de fato ter sido aberto/encerrado. Mesmo `statusForBiometricProofError`/`mapBiometricProofError` da seção 4.1, movidos para um local compartilhado (seção 9). Mantém o mesmo `audit_logs` insert que já existe hoje dentro de `validateSelfBiometricProof` (linhas 132-148 do arquivo atual) para não perder rastreabilidade do momento da autenticação em si — só troca a fonte da verificação, não a auditoria; o consumo da prova (evento distinto de "autenticou com sucesso") é responsabilidade do handler chamador, não desta função.

`open_shift`/`close_shift` **não precisam** da autorização self-service da seção 4.0 — quem abre/fecha turno já é `armeiro`/`admin_reserva`, roles já permitidas em `roleGuard` e já cobertas por `actorCanAccessChallenge` via `reserve_memberships` (o mesmo caminho que `admin_reserva`/`armeiro` sempre usaram).

**Nota sobre `documentId` no encerramento**: `close_shift` usa `documentId: shiftId` (o turno sendo encerrado) — trava extra que impede reaproveitar uma prova capturada para encerrar um turno diferente do que está na tela. `open_shift` não tem `documentId` (o turno ainda não existe no momento da captura) — o par `tenantId`/`reserveId`/`actorId`/`purpose` já é suficiente para esse caso, replicando a mesma lógica que `confirm_saida_militar` (que também não usa `documentId`) já usa hoje.

### 4.3 Frontend — `SignDialog` (`apps/web/src/components/cautelas/sign-dialog.tsx`)

- Novas props: `reserveId: string`, `simulatorEnabled?: boolean`, `simulationUserId?: string`, `canCapture: boolean` (repassadas pelos callers, mesmo padrão de `_form.tsx`/`_desarmamento-modal.tsx` — `BiometricCaptureDialog.canCapture` é obrigatória, sem default, `biometric-capture-dialog.tsx:34`).
- Painel "Biometria" (linhas 154-166) troca o `<Fingerprint>` pulsante + `Button onClick={handleBiometria}` por:

```tsx
<BiometricCaptureDialog
  reserveId={reserveId}
  canCapture={canCapture}
  simulatorEnabled={simulatorEnabled}
  simulationUserId={simulationUserId}
  purpose={role === "armeiro" ? "sign_cautela_armeiro" : "sign_cautela_militar"}
  expectedUserId={currentUserId}
  documentId={cautelaId}
  documentHash={documentHash}
  buttonLabel="Capturar Biometria"
  onResult={handleBiometricResult}
/>
```

- `documentHash` precisa vir do caller como prop nova — **correção da v1 (achado A2)**: `_cautelas-client.tsx` não tem esse campo disponível hoje (a query de listagem precisa mudar, seção 4.1); `_minhas-cautelas-client.tsx` já tem (via `select("*")`), só falta tipar.
- `handleBiometricResult(result: BiometricResult)`: se `result.proof?.result === "success"`, chama `bffFetch("POST", endpoint, { biometric_proof_id: result.proof.id })` (substitui `handleBiometria`/`{ use_biometric: true }`) e segue o mesmo tratamento de sucesso/erro que `handleTotp` já tem.
- `currentUserId` (necessário pro `expectedUserId`): **correção da v1 (achado M3)** — não é "a mesma fonte" de `_form.tsx`/`_desarmamento-modal.tsx` (esses identificam OUTRA pessoa, um militar buscado por matrícula; aqui é o próprio usuário logado). É plumbing genuinamente novo — a árvore de `/efetivo/minhas-cautelas` hoje não tem nenhuma fonte de "meu próprio id" (grep vazio); precisa ser resolvido no plano de implementação a partir da sessão/perfil já carregado no layout do dashboard, não é uma incógnita de arquitetura, mas não é reuso de algo existente.

### 4.4 Frontend — `ShiftAuthDialog` (`apps/web/src/components/livro/shift-auth-dialog.tsx`)

- Comentário da linha 24-30 (documentando por que a aba fica escondida) é removido — a razão deixa de existir.
- `biometricAvailable` prop **é removida** (não só passada como `true`) — a aba de biometria passa a ser incondicional, mesmo tratamento que TOTP, já que o motivo de escondê-la (SDK de teste) deixa de existir.
- Painel "Biometria" (linhas 129-143) troca o ícone estático + texto por:

```tsx
<BiometricCaptureDialog
  reserveId={reserveId}
  canCapture={canCapture}
  simulatorEnabled={simulatorEnabled}
  simulationUserId={simulationUserId}
  purpose={variant === "open" ? "open_shift" : "close_shift"}
  expectedUserId={currentUserId}
  documentId={variant === "close" ? shiftId : undefined}
  buttonLabel={confirmLabel}
  onResult={handleBiometricResult}
/>
```

`variant`/`shiftId`/`reserveId`/`canCapture` são props novas do componente (hoje `ShiftAuthDialog` é agnóstico de turno específico; passa a precisar saber se é abertura ou encerramento, e qual turno, exatamente como o backend precisa pro `documentId`).
- `onConfirm(authMode, totpToken?)` (assinatura atual) precisa aceitar também um `biometricProofId?: string` — `_livro-client.tsx` (`handleOpenShift`/`handleCloseShift`) passa esse valor no `POST` como `biometric_proof_id` em vez de simplesmente `auth_mode: "biometria"` sem prova nenhuma (o que o backend aceita hoje sem checagem real — ver 4.2).

### 4.5 Remoção do SDK de teste

Apagar por completo:
- `apps/bff/src/services/fingerprint/` (diretório inteiro: `index.ts`, `interface.ts`, `mock.ts`, `zkteco.ts`).
- `validateBiometric` (`cautelamentos.ts:82-111`).
- `validateSelfBiometric` (`shift-auth.ts:99-151`) — substituída por `validateSelfBiometricProof`, não mantida em paralelo.
- Import de `getFingerprintSDK` nos dois arquivos acima.

**Callers a atualizar (correção da v1, achado B3 — só 1 arquivo, não 2)**:
- `apps/bff/src/__tests__/biometric-bridge-harness.test.ts` — precisa ser lido e adaptado no plano de implementação. **Quebra específica identificada na revisão v2 (achado BAIXO)**: a asserção da linha 78, `assert.ok(file.includes('.from("reserve_memberships")'), "biometric routes must scope admin_reserva/armeiro by reserve membership")`, roda contra o conteúdo de `biometric.ts` — depois da consolidação da seção 4.0, essa string sai de `biometric.ts` e vai para `biometric-authorization.ts`, quebrando a asserção. Precisa apontar pro arquivo novo (ou testar o comportamento em vez do texto-fonte).
- ~~`biometric-phase1a2-custody.test.ts`~~ — **removido da lista** (achado B3 da revisão): suas únicas asserções relacionadas a ZKTeco testam `lendings.ts`/`saidas.ts`, arquivos que esta spec não toca; continuam corretas sem nenhuma mudança.

---

## 5. Segurança

**Autorização nova (seção 4.0)**: escopo mínimo necessário, verificado inteiramente server-side contra a sessão (`expected_user_id` comparado com `c.get("userId")`, nunca confiado do body sozinho) e contra o banco (posse real da cautela via `militar_id`, não só formato de UUID). Um `usuario` não ganha nenhum acesso além de assinar a própria cautela — todos os outros purposes continuam `false` pra essa role, incluindo `identify`/`enroll`, que permitiriam atacar outra pessoa.

O resto reaproveita integralmente o já revisado (`assertUsableBiometricProof`, TTL de 2 minutos, constraint única em `biometric_proof_consumptions` como trava de reuso atômica no banco, ver `apps/bff/src/lib/biometric-proof-consumption.ts:58-113`).

**Consequência de segurança que esta correção introduz (positiva, registrada explicitamente)**: hoje, `auth_mode: "biometria"` em `shifts.ts` é aceito pelo schema mas **nunca verificado de verdade** contra uma prova real (o backend só chama uma função que sempre falha) — ou seja, o único jeito de abrir/fechar turno hoje é TOTP, mesmo que o client mande `auth_mode: "biometria"`. Depois desta correção, `auth_mode: "biometria"` passa a exigir uma prova real, vinculada a propósito/ator/documento — estritamente mais seguro que o estado atual, nunca menos. O mesmo vale para cautela: hoje `use_biometric: true` sempre falha (401); depois desta correção, funciona quando a prova é real e é rejeitado quando não é — nenhum caminho fica mais permissivo do que já era.

---

## 6. Testes

**Novo, por decisão do dono do sistema**: E2E cobrindo os 6 fluxos via clique real de UI (Playwright, modo simulador — `simulator_available`), não só chamada de API:
- Os 4 já prontos (identificar, cadastrar/alterar digital, dar saída, receber material) **nunca tiveram** um spec E2E dirigindo a UI de verdade (achado da investigação anterior) — ganham cobertura nova como parte desta spec.
- Assinar cautela via biometria — **dois** testes distintos, não um: armeiro (autenticado como `armeiro`/`admin_reserva`) E militar (autenticado como `usuario`, em `/efetivo/minhas-cautelas`). **Exigência explícita, não opcional**: o teste do militar precisa autenticar como role `usuario` de verdade — é necessário (mas, como o achado CRÍTICO da revisão v2 mostrou, **não suficiente sozinho**) pra pegar regressões na branch de `usuario` de `actorCanAccessChallenge` (seção 4.0).
- Abrir/encerrar turno via biometria — novo.

**Correção da revisão v2 (achado CRÍTICO — o E2E via simulador é cego a bugs em `GET /devices`)**: o modo simulador faz `BiometricCaptureDialog` pular inteiramente o `useEffect` que chama `GET /api/biometric/devices` (`biometric-capture-dialog.tsx:117-120`, `if (simulatorEnabled) { setBridgeAvailable(true); return; }`) — um E2E via simulador passa mesmo que a autorização dessa rota para `usuario` esteja quebrada. **Exigência nova, obrigatória**: teste de integração dedicado, sem simulador, chamando `GET /api/biometric/devices?reserve_id=...` autenticado como `usuario` com cautela ativa na reserva (espera 200) e como `usuario` sem cautela ativa naquela reserva (espera 403) — é o único jeito de travar essa classe de bug de verdade.

**Testes de integração/unitários**:
- `actorCanAccessChallenge` (seção 4.0), testado isoladamente: `usuario` com `purpose: sign_cautela_militar` + `expected_user_id` = si mesmo + cautela própria → `true`; `usuario` com qualquer outro purpose → `false`; `usuario` mirando `expected_user_id` de outra pessoa (mesmo com purpose certo) → `false`; `usuario` com `document_id` de uma cautela de OUTRO militar → `false` (prova que a checagem de posse funciona, não só o formato); `armeiro`/`admin_reserva` sem `reserve_membership` na reserva do challenge → `false` (comportamento herdado, sem regressão).
- `actorCanAccessReserveDevices` (seção 4.0), testado isoladamente com os mesmos casos positivo/negativo acima, adaptados (sem `document_id`/`purpose` — só posse de alguma cautela ativa na reserva).
- `sign-armeiro`/`sign-militar` com `biometric_proof_id` válido (sucesso, e confirma que `consumeBiometricProof` só é chamado DEPOIS da mutação — seção 4.1), com prova de propósito errado (`sign_cautela_militar` numa chamada de armeiro, espera 401), com a MESMA cautela assinada duas vezes com a mesma prova (espera 409 — hoje vem do guard condicional de `cautelamentos`, seção 4.1, nota honesta), com prova expirada (espera 401), com `document_hash` divergente (espera 401).
- Mesma bateria para `open_shift`/`close_shift`, incluindo a ordem de consumo (proof consumida só após `service_shifts` gravado, seção 4.2).
- Teste de regressão explícito: `grep -r "getFingerprintSDK\|ZKTecoSDK" apps/bff/src` retorna vazio (guarda estático, mesmo espírito do `sql-migrations-on-conflict-guard.test.ts` já existente neste projeto).

**Regressão obrigatória**: suíte E2E existente de `/reserva/cautelas`, `/efetivo/minhas-cautelas` e `/reserva/livro` (fluxo TOTP) continua 100% verde — nenhuma dessas telas muda de comportamento no caminho TOTP. `biometric-bridge-harness.test.ts` (seção 4.5) continua verde depois de atualizado para a nova assinatura de `actorCanAccessChallenge`/`actorCanAccessReserveDevices` e para a linha 78 (aponta pro arquivo novo).

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `BiometricCaptureDialog` renderiza seu próprio `<Dialog>` — embutir dentro do `<Dialog>` já existente de `SignDialog`/`ShiftAuthDialog` aninha um Dialog Base UI dentro de outro | **Correção da v1 (achado M2)**: não existe hoje, no código-base, nenhum precedente de Dialog-em-Dialog (Base UI) simultaneamente aberto — o caso mais próximo (`MilitarSheet`, `_militares-table.tsx`) aninha dentro de um `Sheet` (`createPortal` cru, sem a lógica de foco/overlay do Base UI), uma composição diferente. Verificar visualmente via Playwright no plano de implementação **antes** de considerar concluído — tratado como risco real a testar, não como "deveria funcionar por analogia". |
| Remover `biometricAvailable` de `ShiftAuthDialog` muda a assinatura pública do componente | Só 2 call sites (`_livro-client.tsx`, abrir e encerrar) — grep confirma, sem uso em outro lugar. Atualizar os dois junto. |
| `biometric-bridge-harness.test.ts` referencia `getFingerprintSDK` E testa `biometric.ts`, que a seção 4.0 muda estruturalmente (novo guard, nova função de autorização) | Ler o arquivo inteiro no plano de implementação antes de decidir o que adaptar — a mudança de `biometric.ts` já obriga a revisar esse arquivo de qualquer forma, independente do achado ZKTeco. |
| Query de `GET /api/cautelamentos` ganha 2 colunas novas no select (`reserve_id`, `document_hash`) | Mudança aditiva e pequena (mais 2 campos num select existente) — sem risco de regressão nos consumidores atuais da rota, que já ignoram campos desconhecidos. |
| `actorCanAccessChallenge` fica maior/mais complexa que a função que substitui (3 branches de role em vez de 2) | Testada isoladamente (seção 6) com casos negativos explícitos — a complexidade extra é exatamente o que separa "autoatendimento seguro" de "abrir a API pra qualquer usuario", não é acidental. |

---

## 8. Definition of Done

- [ ] `apps/bff/src/lib/biometric-authorization.ts` criado com `actorCanAccessChallenge`/`actorCanAccessReserveDevices`/`reserveBelongsToTenant`/`hasReserveMembership`, consolidando as 2 cópias duplicadas hoje existentes.
- [ ] `POST /challenges`, `GET /challenges/:id/result`, `GET /devices` (`biometric.ts`) e `POST /simulator/challenges/:id/complete` (`biometric-simulator.ts`) usam as funções novas; `roleGuard` das 4 rotas ganha `"usuario"`.
- [ ] `signBodySchema` (`cautelamentos.ts`) trocado para `biometric_proof_id`, `use_biometric` removido do schema.
- [ ] `sign-armeiro`/`sign-militar` validam via `loadBiometricProof`/`assertProofScopeAndFreshness`, com mapeamento de erro 401/409 (seção 4.1); `consumeBiometricProof` chamado só **depois** de `document_signatures`/`cautelamentos` gravados com sucesso, dentro de try/catch próprio (log, não falha a resposta).
- [ ] `GET /api/cautelamentos` ganha `reserve_id`/`document_hash` no select.
- [ ] `OpenShiftSchema`/schema de close (`shifts.ts`) ganham `biometric_proof_id`.
- [ ] `validateSelfBiometricProof` substitui `validateSelfBiometric` em `shift-auth.ts` — só valida, não consome; `shifts.ts` consome a prova depois de `service_shifts` gravado.
- [ ] `apps/bff/src/services/fingerprint/` removido por completo; `validateBiometric`/`validateSelfBiometric` removidos; zero referência a `getFingerprintSDK`/ZKTeco no código (guarda estático de teste).
- [ ] `SignDialog` usa `BiometricCaptureDialog` real (purpose `sign_cautela_armeiro`/`sign_cautela_militar`), incluindo `canCapture` e `documentHash`.
- [ ] `ShiftAuthDialog` usa `BiometricCaptureDialog` real (purpose `open_shift`/`close_shift`), `biometricAvailable` removido, aba sempre visível.
- [ ] `_livro-client.tsx`/`_cautelas-client.tsx`/`_minhas-cautelas-client.tsx` repassam `reserveId`/`canCapture`/`simulatorEnabled`/`simulationUserId`/`documentHash` conforme necessário.
- [ ] Testes de integração novos para `actorCanAccessChallenge` E `actorCanAccessReserveDevices` (positivos e negativos, incluindo os casos de `usuario` mirando outra pessoa/outra cautela/outra reserva).
- [ ] Teste de integração dedicado pra `GET /devices` como `usuario` (200 com cautela ativa na reserva, 403 sem) — não coberto pelo E2E via simulador (seção 6).
- [ ] Testes de integração novos (proof scope/freshness/replay, incluindo a ordem consume-depois-da-mutação) para os 2 fluxos novos.
- [ ] Testes E2E novos cobrindo os 6 fluxos via clique real de UI — o de `sign_cautela_militar` autenticado como role `usuario`, não armeiro/admin.
- [ ] Suíte E2E existente (cautelas, livro, TOTP) continua verde — zero regressão.
- [ ] `biometric-bridge-harness.test.ts` revisado e verde contra as novas funções, incluindo a linha 78 (aponta pro arquivo novo).
- [ ] Code review sênior sem CRÍTICO/ALTO — nota ≥9.5/10.
- [ ] Guia de teste (artefato já publicado) atualizado pra refletir os 6 fluxos prontos.
- [ ] CHANGELOG.md atualizado.

---

## 9. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/bff/src/lib/biometric-authorization.ts` | **Novo.** `actorCanAccessChallenge`, `actorCanAccessReserveDevices`, `hasReserveMembership`, `reserveBelongsToTenant` — consolida as 2 cópias duplicadas. |
| `apps/bff/src/routes/biometric.ts` | `POST /challenges`, `GET /challenges/:id/result`, `GET /devices` usam as novas funções de autorização; `roleGuard` das 3 rotas ganha `"usuario"`; remove a cópia local de `actorCanAccessReserve`/`reserveBelongsToTenant`. |
| `apps/bff/src/routes/biometric-simulator.ts` | `POST /challenges/:id/complete` idem; remove a cópia local duplicada. |
| `apps/bff/src/routes/cautelamentos.ts` | `signBodySchema`, `sign-armeiro`, `sign-militar` — troca de `use_biometric`/`validateBiometric` por `biometric_proof_id`/proof real, `consumeBiometricProof` chamado por último; `GET /` ganha `reserve_id`/`document_hash` no select. Remove `validateBiometric`. |
| `apps/bff/src/lib/shift-auth.ts` | Remove `validateSelfBiometric`; adiciona `validateSelfBiometricProof` (só valida, não consome). |
| `apps/bff/src/routes/shifts.ts` | Schemas de open/close ganham `biometric_proof_id`; branch de auth usa a nova função; consome a prova depois de `service_shifts` gravado. |
| `apps/bff/src/services/fingerprint/*` | **Removido por completo.** |
| `apps/bff/src/__tests__/biometric-bridge-harness.test.ts` | Revisado — adapta uso de `getFingerprintSDK`, de `actorCanAccessReserve`/novas funções, e a asserção da linha 78 (aponta pro arquivo novo `biometric-authorization.ts`). |
| `apps/web/src/components/cautelas/sign-dialog.tsx` | Painel de biometria passa a usar `BiometricCaptureDialog`. Novas props (`reserveId`, `canCapture`, `simulatorEnabled`, `simulationUserId`, `documentHash`, `currentUserId`). |
| `apps/web/src/components/livro/shift-auth-dialog.tsx` | Painel de biometria passa a usar `BiometricCaptureDialog`. Remove `biometricAvailable`. Novas props (`variant`, `shiftId`, `reserveId`, `canCapture`, `currentUserId`). |
| `apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx` | Repassa `reserveId`/`documentHash`/simulador pro `SignDialog`. |
| `apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/_minhas-cautelas-client.tsx` | Idem. |
| `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx` | Repassa `reserveId`/`shiftId`/simulador pro `ShiftAuthDialog`; `handleOpenShift`/`handleCloseShift` aceitam `biometricProofId`. |
| `apps/web/e2e/*.spec.ts` | Specs novos cobrindo os 6 fluxos via UI real — o de `sign_cautela_militar` autenticado como `usuario`. |
| `docs/superpowers/specs/2026-07-23-biometric-unify-cautela-turno-design.md` | Esta spec. |
| `CHANGELOG.md` | Entrada documentando a correção. |
