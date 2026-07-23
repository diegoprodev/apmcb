# APMCB — Spec: Unificar assinatura de cautela e autenticação de turno no bridge biométrico real

**Data:** 2026-07-23 (v8)
**Status:** Em revisão.
**Contexto:** Levantamento de todos os pontos de biometria do sistema (pedido do dono do sistema, "explore isso pra mim... quero tudo intuitivo dinâmico interativo... premium") revelou que 2 dos 6 fluxos de captura biométrica nunca foram conectados ao bridge NITGEN real (Fases 0-1C, já entregues e code-reviewed nesta sessão) — usam um SDK de teste (`getFingerprintSDK`/ZKTeco) que **sempre falha por construção**, não por instabilidade. Confirmado pelo dono do sistema: "nunca usei zkteco, pode apagar qualquer referência. foi para testes" — não é uma integração a preservar, é código morto a remover.
**Meta de qualidade:** nota ≥ 9.5/10 em revisão sênior, spec e implementação, antes de fechar esta fase — mesmo padrão das specs anteriores deste projeto (Biometric Bridge Fases 0-1C).

**Histórico de revisão:**
- **v1 → 6,0/10.** Revisor verificou cada citação de arquivo:linha contra o código real. Confirmou a maior parte das citações da seção 1 (causa raiz) como exatas, mas achou: **CRÍTICO** — a rota que cria/consulta desafios biométricos (`POST /api/biometric/challenges`, `GET /challenges/:id/result`) bloqueia a role `usuario`, que é exatamente a role de um militar assinando a própria cautela em `/efetivo/minhas-cautelas` — o caso de uso central da seção 1.1 seria estruturalmente inalcançável como desenhado. **ALTO** — (A1) a spec citava `apps/bff/src/routes/saidas.ts` como já implementando o padrão `loadBiometricProof`/`assertProofScopeAndFreshness`/`consumeBiometricProof` a replicar; na realidade `saidas.ts` retorna 501 pra qualquer tentativa de biometria (`BIOMETRIC_BRIDGE_REQUIRED`) — o padrão real só existe em `lendings.ts`, e mesmo lá o mapeamento de erro HTTP não é granular por tipo (contrário ao que a v1 dizia "replicar"); (A2) `GET /api/cautelamentos` (usado por `_cautelas-client.tsx`, fluxo do armeiro) não seleciona `reserve_id` nem `document_hash` — a v1 afirmava incorretamente que esses campos já estavam disponíveis. **MÉDIO** — (M1) exemplos JSX omitiam a prop obrigatória `canCapture` de `BiometricCaptureDialog`; (M2) a justificativa do risco de dialog aninhado citava um precedente (Sheet) que não é o mesmo tipo de composição (Dialog-em-Dialog não tem precedente testado no código-base); (M3) a afirmação de que `currentUserId` viria "da mesma fonte" que os fluxos já prontos estava errada — esses fluxos identificam OUTRA pessoa, não o próprio usuário logado. **BAIXO** — (B1) snippet de schema mostrava o campo morto `use_biometric` ainda presente com um comentário, contradizendo o texto ao lado; (B2) snippet de código compartilhado entre `sign-armeiro`/`sign-militar` usava uma variável (`authVerified`) que só existe num dos dois handlers; (B3) um dos 2 arquivos de teste listados pra revisão não precisa de nenhuma mudança (testa arquivos que esta spec não toca). Todos corrigidos na v2 — o achado CRÍTICO exigiu desenho de autorização novo (seção 4.0), não só uma correção textual.
- **v2 → 6,5/10.** Revisor confirmou a autorização nova da seção 4.0 como corretamente desenhada e segura para os 3 call sites que ela cobria, e confirmou A1/A2/M1/M2/M3/B1/B2/B3 como genuinamente corrigidos — mas achou que o CRÍTICO da v1 **não estava resolvido de fato**: um **4º call site** do mesmo tipo de bug sobrevivia, não coberto pela seção 4.0. `GET /api/biometric/devices` (`biometric.ts:262`) também bloqueia `usuario` — e é chamada pelo próprio `BiometricCaptureDialog` (`biometric-capture-dialog.tsx:110-131`) **antes** de `POST /challenges`, sempre que `simulatorEnabled` é falso (ou seja, sempre em produção real). Um militar real, com leitor físico pareado, seria bloqueado nesse pré-check, nunca chegando a `POST /challenges` — o caso de uso central continuava estruturalmente inalcançável em produção, só que um passo antes de onde a v1 tinha encontrado. Agravante: o teste E2E via simulador que a v2 desenhava como "o único jeito de pegar o CRÍTICO da v1" é **estruturalmente cego** a esse gap específico, porque o modo simulador pula exatamente esse `useEffect` (`if (simulatorEnabled) { setBridgeAvailable(true); return; }`) — o teste passaria mesmo com produção quebrada. Achou também 1 **ALTO novo**, introduzido pelo próprio código de exemplo da v2 (não presente na v1): no snippet da seção 4.1, a chamada a `consumeBiometricProof` ficava **fora** do `try/catch` que captura `assertProofScopeAndFreshness` — uma prova já consumida faria `consumeBiometricProof` lançar (`biometric-proof-consumption.ts:107-109`, é essa função, não `assertProofScopeAndFreshness`, que checa consumo real) sem ser capturada, subindo pro handler global de erro (500 genérico) em vez do 409 que a própria seção 6 exige testar. E 1 **MÉDIO**: a caracterização "o padrão real só existe em `lendings.ts`" continuava imprecisa — `consumeBiometricProof` nunca é chamada em código de produção (só num arquivo de teste); o padrão real de `lendings.ts` é `loadBiometricProof`/`assertProofScopeAndFreshness` seguidos de consumo **dentro de uma RPC Postgres**, atômico com a mutação de negócio — diferente do desenho da seção 4.1 (consumo solto em JS, não transacional com a mutação de `cautelamentos`). Corrigidos na v3: seção 4.0 ganha um 4º call site (`GET /devices`) com checagem de autorização própria (mais fraca, sem `document_id` disponível nesse ponto do fluxo); seção 4.1 corrige a ordem de operações (consumir a prova por último, só depois da mutação de negócio confirmada, dentro do mesmo try/catch) e documenta essa escolha conscientemente em vez de alegar réplica de um padrão que não existe assim.
- **v3 → 7,0/10.** Revisor confirmou que o CRÍTICO da v1/v2 está **genuinamente resolvido**: a estrutura real de `GET /devices` (`biometric.ts:260-297`, ramo `admin_global` separado do `else`) bate exatamente com o que a seção 4.0 descreve, e `usuarioHasActiveCautelaInReserve` é corretamente escopada por `reserve_id` (testou adversarialmente: um `usuario` com cautela ativa na reserva X não consegue listar dispositivos da reserva Y). Confirmou também que o raciocínio de concorrência da seção 4.1 (o 409 de reuso vem do guard condicional de `cautelamentos`, não de `consumeBiometricProof`) bate com o código real (`cautelamentos.ts:406-418`/`480-494`, UPDATE condicional com compensação). Mas achou **2 ALTO novos**: (1) `loadBiometricProof` (não só `assertProofScopeAndFreshness`) continuava **fora** do try/catch no snippet da seção 4.1 — mesma classe de bug que a v2 já tinha achado, só que numa chamada adjacente (proof_id inexistente/expirado faria `loadBiometricProof` lançar sem captura → 500 em vez de 401); e diverge do precedente real que a spec cita (`lendings.ts:314-327` tem as duas chamadas no MESMO try). (2) `shifts.ts:353-358` (`/​:id/close`) **não tem** guard condicional equivalente ao índice único de `open_shift` nem ao UPDATE condicional de `cautelamentos` — um double-close concorrente (dois requests, nenhum bloqueado por nada hoje) produziria duas gravações bem-sucedidas; confirmado via migration (`20260721194127_log_shift_event_atomic_subject_dedup.sql:21-22`) que o mecanismo de dedup de eventos do Livro Digital **explicitamente não cobre** `turno_encerrado`. Pré-existente (afeta TOTP hoje também), mas a seção 4.2 generalizava "mesmo raciocínio da 4.1" sem checar que `shifts.ts` não tem a mesma garantia estrutural que `cautelamentos.ts` — e o desenho "logar, não falhar" de erro de consumo mascararia justamente o sintoma (`"already consumed"`) que revelaria um double-close. Mais 1 BAIXO: seção 4.0 não estendia a justificativa de "`usuario` nunca terá `purpose===enroll`" para o gêmeo do simulador (`POST /simulator/challenges/:id/enroll`) — inofensivo (roleGuard inalterado ali), mas lacuna de completude na auditoria. Corrigidos na v4: seção 4.1 move `loadBiometricProof` pra dentro do try (mesmo padrão de `lendings.ts`); seção 4.2 adiciona guard condicional ao UPDATE de `/close` (mesmo padrão de `cautelamentos.ts` — corrige a causa raiz pré-existente, não só documenta); seção 4.0 estende a justificativa ao 5º call site real.
- **v4 → rodada de revisão externa falhou por limite de sessão da conta antes de produzir resultado; autoverificação (mesmo roteiro de perguntas que seria usado na rodada externa) encontrou 1 problema real, corrigido nesta v5**: o guard novo de `/close` (v4) tratava **qualquer** `closeErr` do UPDATE como 409 "já encerrado por outra requisição" — inclusive erros de banco genuínos não relacionados à corrida (conexão, constraint, permissão), que ficariam escondidos atrás de uma mensagem enganosa. É exatamente o mesmo tipo de problema que a v3 apontou para `consumeBiometricProof`, reintroduzido pela própria correção do guard. Corrigido: diferencia `closeErr?.code === "PGRST116"` (0 linhas — a única causa possível dado o filtro por `id`, chave única — race genuína, 409) de qualquer outro erro (500, logado, mesmo tratamento que já existia antes do guard). `PGRST116` já é um padrão usado neste projeto para essa exata distinção (`nexus.ts:830`), reaproveitado, não inventado. Também adicionado nesta v5: snippet explícito de `validateSelfBiometricProof` (seção 4.2) — até então só descrito em prosa — porque a mesma classe de bug (chamada fora do try) já escapou duas vezes (v2, v3) em código mostrado; mostrar o código elimina a ambiguidade de uma descrição textual.
- **v5 → 8,0/10.** Revisor confirmou o fix de `PGRST116` correto (inclusive verificando adversarialmente um 3º valor de `status` que existe no schema, `encerrado_sem_passagem` — confirmou via grep que nada escreve esse valor hoje, não é um problema real) e confirmou que nada dos itens já corrigidos em v3/v4 regrediu. Mas achou **1 ALTO novo, introduzido pela própria v5**: o snippet novo de `validateSelfBiometricProof` (só passou a existir nesta versão) devolvia `status: statusForBiometricProofError(err)` — tipo `401 | 409` — mas `ShiftAuthResult["status"]` (`shift-auth.ts:10-12`, código real) é `400 | 401 | 403 | 404 | 422 | 429 | 503`, **sem `409`** — erro de tipo que TypeScript rejeitaria, bloqueando o próprio typecheck do DoD. Mais **2 MÉDIO**: (1) seção 4.2 prometia que `statusForBiometricProofError`/`mapBiometricProofError` seriam "movidos para um local compartilhado (seção 9)", mas a seção 9 não tinha nenhuma linha pra esse módulo — destino prometido e nunca entregue; (2) o mesmo padrão de mascarar erro genuíno de banco como 409 — corrigido em `/:id/close` nesta mesma v5 — sobrevivia sem menção nos guards condicionais de `cautelamentos.ts:415-418`/`491-494`, arquivo que a spec já edita para outro fim, sem decisão explícita de escopo. Mais 2 BAIXO: o snippet unificado de chamada a `validateSelfBiometricProof` usava `reserve_id` genérico, mas `/:id/close` não tem essa variável solta (só `shift.reserve_id`); e a citação de `nexus.ts:830` como "essa exata distinção" overclaimava — é o mesmo mecanismo do PostgREST, mas aplicado a um SELECT ali, não um UPDATE. Corrigidos na v6: `ShiftAuthResult` ganha `409` na união; seção 9 ganha a linha do módulo compartilhado (`biometric-proof-service.ts`); o guard de `cautelamentos.ts` (sign-armeiro/sign-militar) ganha a mesma distinção `PGRST116`, com decisão de escopo explícita sobre o que fica de fora; os dois snippets de chamada (`/open`/`/close`) mostrados separados; citação de `nexus.ts` suavizada.
- **v6 → 7,5/10 (nota mais baixa que a v5, apesar de corrigir tudo que a v5 apontou).** Revisor confirmou os 5 itens da v5 genuinamente corrigidos, mas achou **1 ALTO introduzido pela própria extensão que a v6 fez**: ao levar a distinção `PGRST116` pra `cautelamentos.ts` (seção 4.1), o primeiro branch testava `cautelaUpdateErr?.code === "PGRST116" || !signedCautela` — mas com `.single()`, TODO erro de UPDATE vem acompanhado de `data: null`, então `!signedCautela` é verdadeiro pra qualquer erro, não só `PGRST116`. Isso tornava a condição equivalente a `!signedCautela` sozinho, e o branch de 500 (o que a correção existia pra proteger) ficava **inalcançável em qualquer cenário real** — o mesmo mascaramento que a seção alegava ter corrigido, reintroduzido na própria correção, numa forma mais sutil que a de `/close` (que nunca teve esse erro — lá `!closedShift` sempre esteve no branch certo). Revisor também confirmou, ponto a ponto, que nada das v1-v5 regrediu, e fez uma varredura de ~20 citações de arquivo:linha espalhadas pela spec inteira — todas exatas, com uma única imprecisão cosmética (o `useEffect` de `biometric-capture-dialog.tsx` citado com `return;` genérico quando o código real tem `return () => { mounted = false; }`, uma função de cleanup). Sugeriu também mostrar o diff real de pelo menos 1 dos 4 call sites da seção 4.0 (a descrição "troca direta" não deixava claro que a chamada muda de argumentos posicionais pra um objeto). Corrigidos na v7: `!signedCautela` sai do branch de `PGRST116`, fica só no de 500 (idêntico ao padrão já correto de `/close`); novo caso de teste explícito na seção 6/DoD pra esse cenário; diff real mostrado pro call site de `GET /devices` (item 4, seção 4.0); citação do `useEffect` corrigida nas 2 ocorrências não-históricas.
- **v7 → 6,5/10 (nota mais baixa de novo, apesar do fix de `PGRST116` estar genuinamente correto).** Revisor confirmou os 4 itens que a v7 alegou corrigir (lógica do guard, diff de `GET /devices`, 2 citações do `useEffect`) todos corretos — mas, seguindo instrução explícita de varrer a spec inteira do zero com ceticismo máximo (dado que v2→v3 e v5→v6 já tinham achado bugs reintroduzidos por correções anteriores), achou **3 ALTO novos, nenhum tocado pelas 6 rodadas anteriores porque nenhuma tinha investigado esses pontos especificamente**: (1) o `select` de `cautela` em `sign-militar` nunca ganhava `reserve_id` — só `sign-armeiro` tinha essa instrução explícita (linha 230 da spec); "mesmo padrão" escondia a lacuna; sem isso, `reserveId` chegaria `undefined` em `assertProofScopeAndFreshness`, e a checagem de escopo sempre lançaria "reserve_id mismatch" — reproduzindo, especificamente pro militar assinando a própria cautela (o caso de uso central desta spec inteira), o exato sintoma que motivou a spec toda; não pego pelo typecheck (client Supabase sem tipos gerados). (2) a seção 4.0 dizia "remove a cópia local de `actorCanAccessReserve`" — mas o revisor contou **11 call sites reais** dessa função (7 em `biometric.ts`, 2 em `biometric-simulator.ts`, incluindo rotas de produção já em uso como `/pairing-codes` da Fase 1B), e só 4 migravam pras funções novas; remover sem migrar os outros 7 quebraria a compilação. (3) `ShiftAuthResult`'s `{ok:true}` não carregava a prova carregada (`loadBiometricProof`) pra fora de `validateSelfBiometricProof` — mas o desenho da própria seção 4.2 exige que `shifts.ts` chame `consumeBiometricProof` com o `proof` completo, depois da mutação, e não há como obtê-lo sem isso (diferente de `cautelamentos.ts`, onde a variável sobrevive na mesma função). Corrigidos nesta v8: `select` de `sign-militar` ganha `reserve_id` explicitamente; `actorCanAccessReserve` passa a ser **movida** (não removida) pro módulo novo, comportamento idêntico, os 11 call sites reais listados nominalmente, só 4 migram de fato; `ShiftAuthResult` ganha campo opcional `loadedProof`, com exemplo de uso mostrado nos dois handlers de `shifts.ts`.

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

**Correção da v2→v3 (achado CRÍTICO da revisão v2)**: a v2 tratou só 3 call sites (`POST /challenges`, `GET /challenges/:id/result`, `POST /simulator/challenges/:id/complete`) — mas **`GET /api/biometric/devices`** (`biometric.ts:260-296`) é um **4º** call site do mesmo tipo de bug, e é chamado **antes** de todos os outros: `BiometricCaptureDialog` (`biometric-capture-dialog.tsx:110-131`) consulta essa rota no mount pra decidir `bridgeAvailable`, sempre que `simulatorEnabled` é falso — ou seja, sempre em produção real (`simulator_available` só é `true` fora de produção). Sem corrigir esta rota também, um militar real com leitor físico pareado é bloqueado aqui, antes mesmo de tentar criar um challenge — e um teste E2E via simulador **não pega isso**, porque o modo simulador pula esse `useEffect` inteiro (`if (simulatorEnabled) { setBridgeAvailable(true); return () => { mounted = false; }; }` — linha 117-120, o `return` é a função de cleanup do effect, não um `return;` vazio). Corrigido nesta v3: seção 4.0 cobre os 4 call sites; seção 6 exige um teste de integração dedicado pra `GET /devices` como `usuario`, não só o E2E via simulador.

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

// Assinatura e comportamento IDÊNTICOS à função hoje duplicada em
// biometric.ts:122-148 e biometric-simulator.ts:55-80 — só centralizada
// aqui. NÃO é substituída pelas duas funções acima: elas cobrem só os 4
// call sites que precisam abrir exceção pra `usuario` (seção "Aplicação"
// abaixo); os outros 11 call sites reais (7 em biometric.ts, 2 em
// biometric-simulator.ts, achado ALTO da revisão v7 — ver detalhamento
// abaixo) continuam usando exatamente este comportamento, só importado do
// módulo novo em vez de definido localmente em cada arquivo.
export async function actorCanAccessReserve(
  userId: string, role: Role, tenantId: string, reserveId: string,
): Promise<boolean> {
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  return false;
}
```

**Aplicação nos 4 call sites** (troca direta de `actorCanAccessReserve(actorId, role, tenantId, reserveId)` pela função nova correspondente — os campos extras já estão disponíveis em cada handler antes da checagem, sem precisar de query nova):

1. `POST /challenges` (`biometric.ts:342-376`) — `actorCanAccessChallenge`, com `purpose`/`expected_user_id`/`document_id` vindos de `body` (schema já aceita, sem mudança de schema aqui). `roleGuard` ganha `"usuario"` na lista.
2. `GET /challenges/:id/result` (`biometric.ts:402-486`) — `actorCanAccessChallenge`, com `purpose`/`expected_user_id`/`document_id` vindos do `challenge` carregado (linha 412-418, select já inclui essas 3 colunas). `roleGuard` ganha `"usuario"`.
3. `POST /simulator/challenges/:id/complete` (`biometric-simulator.ts:209-337`) — `actorCanAccessChallenge`, mesma coisa, `challenge` já carregado com essas colunas (linha 225-231). `roleGuard` ganha `"usuario"`.
4. **NOVO (v3)** `GET /devices` (`biometric.ts:260-296`) — `actorCanAccessReserveDevices` no lugar de `actorCanAccessReserve` (linha 284). `roleGuard` (linha 262) ganha `"usuario"`. Ramo `admin_global` (linhas 275-281) fica como está — já correto.

**Correção da revisão v6 (achado BAIXO — "troca direta" undersella a mudança de assinatura)**: as funções antigas (`actorCanAccessReserve(actorId, role, tenantId, reserveId)`) recebem 4 argumentos posicionais; as novas recebem um único objeto de parâmetros nomeados (ver assinatura de `actorCanAccessChallenge`/`actorCanAccessReserveDevices` acima) — não é uma substituição 1:1 de nome de função só. Diff real do call site mais simples (item 4, `GET /devices`, código atual vs. proposto):

```diff
- if (!(await actorCanAccessReserve(actorId, role, tenantId, requestedReserveId))) {
+ if (!(await actorCanAccessReserveDevices({ userId: actorId, role, tenantId, reserveId: requestedReserveId }))) {
    return c.json({ error: "Reserva nao autorizada" }, 403);
  }
```

Os outros 3 call sites seguem o mesmo padrão (posicional → objeto), com os campos extras de `actorCanAccessChallenge` (`purpose`, `expectedUserId`, `documentId`) somados ao objeto.

**Por que isso é seguro (não uma ampliação genérica disfarçada)**: um `usuario` só passa na checagem de `actorCanAccessChallenge` se as 3 condições baterem simultaneamente — propósito fixo (`sign_cautela_militar`), alvo é ele mesmo (`expected_user_id === userId`, nunca client-trusted sozinho — comparado contra `c.get("userId")`, resolvido pela sessão, não pelo body), e a cautela referenciada (`document_id`) pertence a ele de fato (`militar_id === userId`, verificado contra o banco, não só o formato do UUID). `actorCanAccessReserveDevices` é deliberadamente mais fraca (sem `document_id` disponível nesse ponto do fluxo) mas expõe só metadado operacional do leitor, não dado de pessoa — e ainda exige uma cautela ativa real na reserva, não é acesso incondicional. Um `usuario` não ganha acesso a `identify`/`enroll`/`confirm_saida_militar`/`return`/`open_shift`/`close_shift`/`sign_cautela_armeiro` — todos continuam `false` pra essa role.

`POST /challenges/:id/enroll-submit` (`biometric.ts:150-207`) **e** seu gêmeo do simulador `POST /simulator/challenges/:id/enroll` (`biometric-simulator.ts:82-207`) **não mudam** — ambos só atendem `purpose === "enroll"`, que `usuario` nunca vai ter (checagem acima já barra antes de chegar lá), e o `roleGuard` de ambos continua sem `"usuario"`. **Correção da revisão v3 (achado BAIXO — completude da auditoria)**: `BiometricCaptureDialog` (`biometric-capture-dialog.tsx`) faz 5 chamadas de rede no total, não 4 — `GET /devices` (linha 121), `GET /challenges/:id/result` (linha 140), `POST /simulator/challenges/:id/enroll` (linha 182), `POST /simulator/challenges/:id/complete` (linha 192), `POST /challenges` (linha 217). A 5ª (`/simulator/.../enroll`) fica de fora do escopo desta seção pelo mesmo motivo do `enroll-submit` de produção — `purpose="enroll"` só é usado hoje em `_militares-table.tsx` (grep confirma ser o único caller), nunca em `SignDialog`/`ShiftAuthDialog` — mas precisava estar dita explicitamente, não só implícita.

**Correção da revisão v7 (achado ALTO — remover `actorCanAccessReserve` sem migrar quem ainda depende dela quebra a compilação)**: contei, no código real, **11 call sites** de `actorCanAccessReserve` — não só os 4 acima. Em `biometric.ts`: `:175` (`enroll-submit`), `:235` (`POST /devices/pair`), `:284` (`GET /devices`, item 4 acima — este SIM migra), `:319` (`POST /devices/:id/revoke`), `:353` (`POST /challenges`, item 1 — migra), `:395` (`GET /challenges/:id`, rota plana, **diferente** de `:id/result`), `:421` (`GET /challenges/:id/result`, item 2 — migra), `:513` (`POST /challenges/:id/submit`, seção 3 já registra como fora de escopo — mas "fora de escopo" não significa "pode quebrar", significa "comportamento não muda"), `:634` (`POST /pairing-codes`, Fase 1B, já em produção). Em `biometric-simulator.ts`: `:107` (`POST /simulator/challenges/:id/enroll`), `:234` (`POST /simulator/challenges/:id/complete`, item 3 — migra). Só **4 desses 11** migram pras funções novas (itens 1-4 acima); os outros **7 continuam precisando de `actorCanAccessReserve` exatamente como é hoje** — por isso ela **não é removida**, é **movida** para `biometric-authorization.ts` (função nova mostrada acima, comportamento idêntico) e os 11 call sites trocam de `import` (função local → `import { actorCanAccessReserve } from "../lib/biometric-authorization"`), sem nenhuma mudança de lógica nos 7 que não migram. "Consolida as 2 cópias duplicadas" (início desta seção) significa isso — nunca significou apagar a função.

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

**Correção da revisão v3 (achado ALTO — mesma classe de bug da v2, numa chamada adjacente)**: a v3 já envolvia `assertProofScopeAndFreshness` num try/catch, mas deixava `loadBiometricProof` **fora** dele — essa função lança (`biometric-proof-service.ts:24-25,34`) para `"biometric proof not found"` (proof_id inexistente, expirado do cache, ou de outro tenant) e para falhas de SELECT, cenário comum (ex: retry de rede com um `biometric_proof_id` velho). Sem captura, sobe cru pro handler global → 500 genérico em vez de 401. Diverge do próprio precedente que esta spec cita: `lendings.ts:314-327` tem as duas chamadas — `loadBiometricProof` **e** `assertProofScopeAndFreshness` — dentro do mesmo `try`. Corrigido:

```ts
let loadedProof: Awaited<ReturnType<typeof loadBiometricProof>> | null = null;

if (body.biometric_proof_id) {
  try {
    loadedProof = await loadBiometricProof(body.biometric_proof_id, tenantId);
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

**Correção estrutural, não só de try/catch**: `consumeBiometricProof` passa a ser chamado **por último**, depois que `document_signatures`/`cautelamentos` já foram gravados com sucesso (`insert` em `document_signatures`, `update` condicional em `cautelamentos` com compensação se falhar — linhas 390-418 hoje).

**Decisão de escopo explícita (revisão v5, em resposta ao MÉDIO "mesmo padrão de mascaramento sobrevive no arquivo já em edição")**: o `update` condicional de `cautelamentos.ts:406-418` (`sign-armeiro`) e `:480-494` (`sign-militar`) tem o **mesmo** padrão que motivou o fix de `/:id/close` (seção 4.2) — `if (cautelaUpdateErr || !signedCautela)` trata qualquer erro do UPDATE como 409 "já alterada", sem diferenciar `PGRST116` (0 linhas — race genuína) de um erro de banco real. Como esta spec já está editando esses dois blocos exatos (pra inserir a lógica de `biometric_proof_id`), a mesma correção **entra no escopo aqui** — não faria sentido elevar o rigor em `shifts.ts` e deixar o defeito idêntico no arquivo ao lado, na mesma spec. **Fora de escopo, explicitamente**: qualquer outro endpoint de ciclo de vida de cautela (substituição de item, devolução da cautela em si) que esta spec não toca — não auditados aqui, não assumidos corrigidos.

```ts
// insert em document_signatures — inalterado
const { data: sig } = await supabase.from("document_signatures").insert({ ... }).select("id").single();
if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

const { data: signedCautela, error: cautelaUpdateErr } = await supabase
  .from("cautelamentos")
  .update({ armeiro_signature_id: sig.id })
  .eq("id", id).eq("tenant_id", tenantId).eq("status", "ativa")
  .is("armeiro_signature_id", null)
  .select("id")
  .single();

// NOVO (v5/v6) — mesma distinção de shifts.ts (seção 4.2): PGRST116 (0
// linhas, única causa possível dado o filtro por id) é a race genuína, 409;
// outro erro qualquer não vira 409 disfarçado.
//
// Achado ALTO auto-encontrado (revisão v6, reincidência do mesmo bug que
// esta correção existe pra evitar): a v6 testava
// `cautelaUpdateErr?.code === "PGRST116" || !signedCautela` no primeiro
// branch — mas com `.single()`, TODO erro vem acompanhado de `data: null`,
// então `!signedCautela` é verdadeiro pra QUALQUER erro, não só PGRST116.
// Isso tornava a condição equivalente a `!signedCautela` sozinho, e o
// branch de 500 abaixo ficava morto (inalcançável em qualquer cenário
// real) — exatamente o mascaramento que esta seção alega corrigir. Fix:
// `!signedCautela` sai do primeiro branch, fica só no segundo — idêntico
// ao padrão já correto de `/close` (seção 4.2), que nunca teve esse erro.
if (cautelaUpdateErr?.code === "PGRST116") {
  await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
  return c.json({ error: "Cautela não encontrada ou já alterada" }, 409);
}
if (cautelaUpdateErr || !signedCautela) {
  await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
  c.get("log").error({ code: cautelaUpdateErr?.code, error: cautelaUpdateErr?.message, cautelaId: id }, "cautela.sign.persist_failure");
  return c.json({ error: "Não foi possível registrar a assinatura. Tente novamente." }, 500);
}

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

**Correção da revisão v7 (achado ALTO — "mesmo padrão" escondia uma mudança que só foi dita explicitamente pra `sign-armeiro`)**: o `select` de `cautela` em `sign-militar` (`cautelamentos.ts:440`, hoje `"id, status, militar_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id"`) **também** precisa ganhar `reserve_id` — exatamente a mesma mudança já especificada pra `sign-armeiro` (linha 364), só que aqui nunca foi dita de forma explícita, só implícita em "mesmo padrão". Sem isso, `assertProofScopeAndFreshness`/`consumeBiometricProof` receberiam `reserveId: cautela.reserve_id === undefined`; `assertSame` (`biometric-proof-consumption.ts:52-53`) faz `(expected ?? null) !== (actual ?? null)` — `undefined ?? null` vira `null`, que nunca bate com o `reserve_id` real da prova, e a checagem de escopo **sempre lançaria "reserve_id mismatch"**. Isso reproduziria, especificamente para o militar assinando a própria cautela — o caso de uso central desta spec inteira (seção 1.1/2) — o exato sintoma "sempre falha por construção" que motivou a spec toda. Não seria pego pelo typecheck (o client Supabase deste projeto não usa tipos gerados do schema — `services/supabase.ts:8` — `cautela.reserve_id` tipa como `any`/`unknown` implícito, não como erro de compilação); só o E2E de militar exigido na seção 6 pegaria, e só depois de investigar um 401 sem causa óbvia.

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

**`validateSelfBiometric`** (`shift-auth.ts:99-151`) é **removida por completo** — não adaptada, removida — e o branch em `shifts.ts:120-122` (`/open`, `reserveId` vem de `reserve_id` do body — `shifts.ts:54`) e `343-345` (`/:id/close`, `reserveId` vem de `shift.reserve_id`, carregado pelo SELECT de propriedade da linha 332-336, **não** existe um `reserve_id` solto no escopo desse handler) vira, respectivamente:

```ts
// /open (shifts.ts, dentro do handler que já tem `reserve_id` do body)
const authResult = auth_mode === "totp"
  ? await validateSelfTotp(userId, totp_token!)
  : await validateSelfBiometricProof(userId, reserve_id, biometric_proof_id!, {
      tenantId, purpose: "open_shift", documentId: null,
    });
if (!authResult.ok) return c.json({ error: authResult.error }, authResult.status);
```

```ts
// /:id/close (shifts.ts, dentro do handler que já tem `shift` carregado — linha 332-336)
const authResult = auth_mode === "totp"
  ? await validateSelfTotp(userId, totp_token!)
  : await validateSelfBiometricProof(userId, shift.reserve_id as string, biometric_proof_id!, {
      tenantId, purpose: "close_shift", documentId: shiftId,
    });
if (!authResult.ok) return c.json({ error: authResult.error }, authResult.status);
```

**Correção da revisão v5 (achado BAIXO)**: a v5 mostrava um único snippet genérico com `reserve_id` pros dois handlers — `/close` não tem essa variável solta no escopo (só `shift.reserve_id`). Dois snippets explícitos eliminam a ambiguidade.

Nova função `validateSelfBiometricProof` em `shift-auth.ts` (substitui `validateSelfBiometric`) — **mesma correção de ordenação e de try/catch da seção 4.1 (achados ALTO das revisões v2/v3)**, mostrada explicitamente aqui (não só em prosa) porque essa exata classe de erro já escapou duas vezes em versões anteriores desta spec:

```ts
export async function validateSelfBiometricProof(
  userId: string,
  reserveId: string,
  proofId: string,
  context: { tenantId: string; purpose: "open_shift" | "close_shift"; documentId: string | null },
): Promise<ShiftAuthResult> {
  let loaded: Awaited<ReturnType<typeof loadBiometricProof>>;
  try {
    loaded = await loadBiometricProof(proofId, context.tenantId);
    assertProofScopeAndFreshness(loaded, {
      tenantId: context.tenantId,
      reserveId,
      actorId: userId,
      purpose: context.purpose,
      expectedUserId: userId,   // autoautenticação — o armeiro prova que é ele mesmo
      documentId: context.documentId,
    });
  } catch (err) {
    return { ok: false, error: mapBiometricProofError(err), status: statusForBiometricProofError(err) };
  }

  // audit_logs de sucesso (mesmo insert que já existe hoje, linhas 142-148
  // do arquivo atual) — inalterado, só a fonte da verificação mudou.
  await supabase.from("audit_logs").insert({
    actor_id: userId, action: "shift.auth.biometric.success",
    resource_type: "service_shifts", resource_id: null, metadata: { user_id: userId },
  });

  return { ok: true, loadedProof: loaded };
}
```

**Correção da revisão v7 (achado ALTO — sem isto, `shifts.ts` não tem como chamar `consumeBiometricProof` depois da mutação)**: `ShiftAuthResult`'s `{ok:true}` precisa carregar o objeto `loaded` (retornado por `loadBiometricProof`) pra fora da função — sem isso, ele é uma variável local que se perde no `return`, e o handler de `shifts.ts` (que só recebe `authResult`) não tem como montar o `proof` que `consumeBiometricProof` exige (`biometric-proof-consumption.ts:91-94`, `proof: BiometricProofForConsumption`, não um `proofId` solto). Diferente de `cautelamentos.ts`, onde `loadedProof` é uma variável `let` que sobrevive na mesma função até a chamada de consumo — aqui a fronteira de função entre `validateSelfBiometricProof` e o handler de `shifts.ts` quebra esse fio, então o valor precisa atravessar explicitamente pelo tipo de retorno. `ShiftAuthResult` (`shift-auth.ts:10-12`) ganha um campo opcional:

```ts
export type ShiftAuthResult =
  | { ok: true; loadedProof?: LoadedBiometricProof }
  | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 };
```

(`LoadedBiometricProof`, tipo já exportado por `biometric-proof-service.ts`, importado aqui.) `validateSelfTotp` continua devolvendo `{ ok: true }` sem esse campo (TOTP não tem prova nenhuma pra carregar) — campo opcional, sem quebrar o caller de TOTP.

Devolve `ShiftAuthResult` (mesmo contrato de `validateSelfTotp`, agora com o campo opcional acima), **sem consumir a prova aqui**. `consumeBiometricProof` é chamado pelo handler de `shifts.ts` (`/open` e `/:id/close`), **depois** que o `insert`/`update` em `service_shifts` já teve sucesso, usando `authResult.loadedProof` (só presente quando `auth_mode === "biometria"` e a autenticação teve sucesso) — mesmo raciocínio da seção 4.1: consumir antes da mutação de negócio confirmada arrisca queimar a prova sem o turno de fato ter sido aberto/encerrado. `statusForBiometricProofError`/`mapBiometricProofError` são os mesmos da seção 4.1, movidos para um local compartilhado (seção 9). O consumo da prova (evento distinto de "autenticou com sucesso") é responsabilidade do handler chamador, não desta função.

Exemplo de uso no handler de `/open` (depois do `insert` em `service_shifts` já ter sucesso, mesmo raciocínio de "consumir por último" da seção 4.1):

```ts
// ... insert em service_shifts, já com sucesso confirmado (shift.id disponível) ...
if (authResult.ok && authResult.loadedProof) {
  try {
    await consumeBiometricProof(supabase, authResult.loadedProof.proof, {
      proofId: biometric_proof_id!,
      tenantId, reserveId: reserve_id, actorId: userId,
      operationType: "shift_open", operationId: shift.id,
      purpose: "open_shift", expectedUserId: userId, documentId: null,
    });
  } catch (err) {
    c.get("log").warn({ shiftId: shift.id, error: err instanceof Error ? err.message : String(err) }, "shift.open.proof_consume_failed");
  }
}
```
`/:id/close` segue o mesmo formato, com `operationType: "shift_close"`, `operationId: shiftId`, `purpose: "close_shift"`, `documentId: shiftId`, chamado depois do `UPDATE` com guard condicional (seção abaixo) ter sucesso.

**Correção da revisão v5 (achado ALTO — erro de tipo, não compilaria)**: `ShiftAuthResult["status"]` hoje é `400 | 401 | 403 | 404 | 422 | 429 | 503` (`shift-auth.ts:10-12`) — **não inclui `409`**, campo já alargado no tipo mostrado acima (junto com `loadedProof`, achado da v7 — as duas mudanças de `ShiftAuthResult` são a mesma edição de tipo, mostradas juntas, não duas revisões separadas do tipo). `statusForBiometricProofError` (seção 4.1) tem assinatura `(err: unknown): 401 | 409`, e o snippet de `validateSelfBiometricProof` devolve esse valor direto em `status` — sem `409` na união, TypeScript rejeitaria a atribuição, bloqueando o typecheck do DoD antes de qualquer teste rodar.

`409` só é alcançável na prática se `assertProofScopeAndFreshness` lançar uma mensagem contendo `"already consumed"` — o que ela não faz por desenho (`biometric-proof-service.ts:42-49`, ignora consumo prévio de propósito). Ou seja: dentro de `validateSelfBiometricProof`, `statusForBiometricProofError` na prática só retorna `401` neste ponto do fluxo — mas o **tipo declarado da função permanece `401 | 409`**, e é o tipo, não o comportamento em runtime, que TypeScript checa na atribuição a `ShiftAuthResult.status`. Alargar a união é a correção mínima e correta (em vez de criar um segundo mapeador que nunca retorna 409, o que duplicaria lógica sem necessidade).

`open_shift`/`close_shift` **não precisam** da autorização self-service da seção 4.0 — quem abre/fecha turno já é `armeiro`/`admin_reserva`, roles já permitidas em `roleGuard` e já cobertas por `actorCanAccessChallenge` via `reserve_memberships` (o mesmo caminho que `admin_reserva`/`armeiro` sempre usaram).

**Nota sobre `documentId` no encerramento**: `close_shift` usa `documentId: shiftId` (o turno sendo encerrado) — trava extra que impede reaproveitar uma prova capturada para encerrar um turno diferente do que está na tela. `open_shift` não tem `documentId` (o turno ainda não existe no momento da captura) — o par `tenantId`/`reserveId`/`actorId`/`purpose` já é suficiente para esse caso, replicando a mesma lógica que `confirm_saida_militar` (que também não usa `documentId`) já usa hoje.

**Correção da revisão v3 (achado ALTO — `/:id/close` sem guard de concorrência, ao contrário de `/open` e de `cautelamentos.ts`)**: `open_shift` já é protegido contra corrida por índices únicos parciais no banco (`uq_shifts_armeiro_ativo`/`uq_shifts_reserve_ativo`, `20260712000001_service_shifts_active_unique_guards.sql`, citados no próprio código como "a barreira real" — `shifts.ts:144-153`) — um INSERT perdedor recebe `23505` e nunca chega a `consumeBiometricProof`. `/:id/close` (`shifts.ts:353-358`) **não tem proteção equivalente**: o `UPDATE` de encerramento não tem `.eq("status","ativo")` nem qualquer guard condicional, ao contrário do padrão que `cautelamentos.ts` já usa (seção 4.1). Duas requisições de encerramento concorrentes (duplo clique sem debounce de rede, retry, duas abas) passam ambas pelo SELECT inicial de propriedade (`status==='ativo'`, linha 332-340 — clássico TOCTOU) e **ambas completam o UPDATE com sucesso**, sem erro de nenhum lado. Se usarem a mesma prova biométrica, a segunda chamada a `consumeBiometricProof` lançaria "already consumed" — mas, pelo desenho desta spec ("logar, não falhar a resposta"), esse seria o único sinal de um double-close, e ficaria silenciosamente engolido. Confirmado que isso não é hipotético: `20260721194127_log_shift_event_atomic_subject_dedup.sql:21-22` documenta explicitamente que o mecanismo de deduplicação de eventos do Livro Digital **não cobre** `turno_encerrado` (sem `subject_id`) — um double-close produziria duas entradas no hash-chain imutável do Livro Digital. Pré-existente (o mesmo risco já existe hoje via TOTP), mas esta spec é quem torna o caminho de biometria alcançável pela primeira vez e quem introduz o "logar, não falhar" que mascararia o sintoma — por isso a correção entra no escopo aqui, não fica só documentada. Corrigido: `UPDATE` de `/:id/close` ganha guard condicional, mesmo padrão de `cautelamentos.ts`:

```ts
const { data: closedShift, error: closeErr } = await supabase
  .from("service_shifts")
  .update({
    status: "encerrado",
    ended_at: new Date().toISOString(),
    closing_snapshot: closingSnapshot,
    handover_id: handover_id ?? null,
  })
  .eq("id", shiftId)
  .eq("status", "ativo")   // NOVO — trava a corrida, igual ao padrão de cautelamentos.ts
  .select("id")
  .single();

// PGRST116 = "0 ou mais de 1 linha" do PostgREST pro .single() — como o
// filtro já é por id (chave única) + status='ativo', só pode significar
// 0 linhas aqui (não está mais ativo), nunca ambiguidade de múltiplas.
// Mesmo código já usado neste projeto (nexus.ts:830, ali um SELECT) —
// mecanismo do PostgREST é agnóstico ao verbo, primeira vez aplicado a um
// UPDATE aqui, não uma réplica literal de outro UPDATE já revisado.
// Autoverificação desta v5 (achado ALTO auto-encontrado, mesma classe do
// resto desta seção): tratar QUALQUER closeErr como 409 "já encerrado"
// esconderia um erro de banco genuíno (conexão, constraint, permissão)
// atrás de uma mensagem enganosa — exatamente o problema que a v3 apontou
// para consumeBiometricProof, só que reintroduzido aqui pela própria correção.
if (closeErr?.code === "PGRST116") {
  return c.json({ error: "Turno já foi encerrado por outra requisição" }, 409);
}
if (closeErr || !closedShift) {
  c.get("log").error({ code: closeErr?.code, error: closeErr?.message, shiftId }, "shift.close.persist_failure");
  return c.json({ error: "Não foi possível encerrar o turno. Tente novamente." }, 500);
}
```

`consumeBiometricProof` (quando `authResult.ok && authResult.loadedProof` — o campo novo do tipo mostrado acima) é chamado logo depois deste bloco, só quando `closedShift` existe — mesma posição relativa (depois da mutação confirmada) que a seção 4.1 já estabelece para cautela, e mesmo formato de chamada mostrado no exemplo de `/open` acima, com `operationType: "shift_close"`, `operationId: shiftId`, `purpose: "close_shift"`, `documentId: shiftId`, `reserveId: shift.reserve_id as string`.

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

**Correção da revisão v2 (achado CRÍTICO — o E2E via simulador é cego a bugs em `GET /devices`)**: o modo simulador faz `BiometricCaptureDialog` pular inteiramente o `useEffect` que chama `GET /api/biometric/devices` (`biometric-capture-dialog.tsx:117-120`, `if (simulatorEnabled) { setBridgeAvailable(true); return () => { mounted = false; }; }`) — um E2E via simulador passa mesmo que a autorização dessa rota para `usuario` esteja quebrada. **Exigência nova, obrigatória**: teste de integração dedicado, sem simulador, chamando `GET /api/biometric/devices?reserve_id=...` autenticado como `usuario` com cautela ativa na reserva (espera 200) e como `usuario` sem cautela ativa naquela reserva (espera 403) — é o único jeito de travar essa classe de bug de verdade.

**Testes de integração/unitários**:
- `actorCanAccessChallenge` (seção 4.0), testado isoladamente: `usuario` com `purpose: sign_cautela_militar` + `expected_user_id` = si mesmo + cautela própria → `true`; `usuario` com qualquer outro purpose → `false`; `usuario` mirando `expected_user_id` de outra pessoa (mesmo com purpose certo) → `false`; `usuario` com `document_id` de uma cautela de OUTRO militar → `false` (prova que a checagem de posse funciona, não só o formato); `armeiro`/`admin_reserva` sem `reserve_membership` na reserva do challenge → `false` (comportamento herdado, sem regressão).
- `actorCanAccessReserveDevices` (seção 4.0), testado isoladamente com os mesmos casos positivo/negativo acima, adaptados (sem `document_id`/`purpose` — só posse de alguma cautela ativa na reserva).
- `sign-armeiro`/`sign-militar` com `biometric_proof_id` válido (sucesso, e confirma que `consumeBiometricProof` só é chamado DEPOIS da mutação — seção 4.1), com `biometric_proof_id` **inexistente** (UUID válido mas sem registro — espera 401, não 500; achado ALTO da revisão v3, `loadBiometricProof` agora dentro do try), com prova de propósito errado (`sign_cautela_militar` numa chamada de armeiro, espera 401), com a MESMA cautela assinada duas vezes com a mesma prova (espera 409 — hoje vem do guard condicional de `cautelamentos`, seção 4.1, nota honesta), com prova expirada (espera 401), com `document_hash` divergente (espera 401).
- **Novo (achado ALTO da revisão v6 — reincidência do mesmo mascaramento em código novo)**: `sign-armeiro`/`sign-militar` com o UPDATE de `cautelamentos` falhando por um motivo QUE NÃO seja a race (código de erro diferente de `PGRST116` — ex: mock/injeção forçando uma constraint/permissão) deve retornar 500, não 409. Espelha o mesmo rigor já exigido pro teste de concorrência de `/:id/close` (linha abaixo) — sem este caso, a reincidência do bug desta seção passaria despercebida pela própria bateria de testes que a spec propõe.
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

- [ ] `apps/bff/src/lib/biometric-authorization.ts` criado com `actorCanAccessChallenge`/`actorCanAccessReserveDevices`/`actorCanAccessReserve`/`reserveBelongsToTenant`/`hasReserveMembership` — `actorCanAccessReserve` é **movida**, comportamento idêntico, não apagada (achado ALTO da revisão v7: 11 call sites reais dependem dela, só 4 migram pras funções novas).
- [ ] Os 11 call sites de `actorCanAccessReserve` (7 em `biometric.ts`, 2 em `biometric-simulator.ts`, listados na seção 4.0) trocam de import (função local → módulo novo); só os 4 já listados no DoD abaixo mudam de função/assinatura.
- [ ] `POST /challenges`, `GET /challenges/:id/result`, `GET /devices` (`biometric.ts`) e `POST /simulator/challenges/:id/complete` (`biometric-simulator.ts`) usam as funções novas; `roleGuard` das 4 rotas ganha `"usuario"`.
- [ ] `signBodySchema` (`cautelamentos.ts`) trocado para `biometric_proof_id`, `use_biometric` removido do schema.
- [ ] `sign-armeiro`/`sign-militar` validam via `loadBiometricProof`/`assertProofScopeAndFreshness` (as DUAS chamadas dentro do mesmo try/catch — achado ALTO da revisão v3), com mapeamento de erro 401/409 (seção 4.1); `consumeBiometricProof` chamado só **depois** de `document_signatures`/`cautelamentos` gravados com sucesso, dentro de try/catch próprio (log, não falha a resposta).
- [ ] Guard condicional de `sign-armeiro`/`sign-militar` (`cautelamentos.ts:406-418`/`480-494`) distingue `cautelaUpdateErr?.code === "PGRST116"` (409, race genuína) de qualquer outro erro (500, logado) — achado MÉDIO da revisão v5, mesma correção de `/:id/close` estendida ao arquivo já em edição; `!signedCautela` SÓ no branch de 500, nunca no de 409 (achado ALTO auto-encontrado na revisão v6 — a versão anterior testava os dois juntos no branch errado, tornando o branch de 500 inalcançável).
- [ ] Teste explícito: UPDATE de `cautelamentos` falhando com código diferente de `PGRST116` em `sign-armeiro`/`sign-militar` retorna 500, não 409 — achado ALTO da revisão v6, mesmo rigor já exigido pro teste de concorrência de `/:id/close`.
- [ ] `GET /api/cautelamentos` ganha `reserve_id`/`document_hash` no select.
- [ ] `OpenShiftSchema`/schema de close (`shifts.ts`) ganham `biometric_proof_id`.
- [ ] `ShiftAuthResult` (`shift-auth.ts:10-12`) ganha `409` na união de `status` (achado ALTO da revisão v5) **e** campo opcional `loadedProof?: LoadedBiometricProof` no variant `{ok:true}` (achado ALTO da revisão v7 — sem isso, `shifts.ts` não tem como obter o `proof` completo que `consumeBiometricProof` exige depois da mutação).
- [ ] `shifts.ts` (`/open` e `/:id/close`) chamam `consumeBiometricProof` usando `authResult.loadedProof.proof` (só quando presente), depois da mutação de `service_shifts` confirmada — achado ALTO da revisão v7.
- [ ] `validateSelfBiometricProof` substitui `validateSelfBiometric` em `shift-auth.ts` — só valida (as duas chamadas de proof no mesmo try/catch), não consome; `shifts.ts` consome a prova depois de `service_shifts` gravado; `/open` e `/close` passam `reserveId` de fontes diferentes (`reserve_id` do body vs. `shift.reserve_id` carregado).
- [ ] `UPDATE` de `/:id/close` (`shifts.ts:353-358`) ganha guard condicional `.eq("status","ativo")` + distingue `closeErr?.code === "PGRST116"` (409, race genuína) de qualquer outro erro (500, logado — mesmo tratamento de hoje) — achado ALTO da revisão v3, corrige race de double-close pré-existente (afeta TOTP hoje também), não só a documenta.
- [ ] `statusForBiometricProofError`/`mapBiometricProofError` (seção 4.1) vivem em `apps/bff/src/lib/biometric-proof-service.ts` (co-localizados com `loadBiometricProof`/`assertProofScopeAndFreshness`, cujos erros interpretam), importados por `cautelamentos.ts` e `shift-auth.ts` — destino que a v5 prometia mas não especificava (achado MÉDIO da revisão v5).
- [ ] `apps/bff/src/services/fingerprint/` removido por completo; `validateBiometric`/`validateSelfBiometric` removidos; zero referência a `getFingerprintSDK`/ZKTeco no código (guarda estático de teste).
- [ ] `SignDialog` usa `BiometricCaptureDialog` real (purpose `sign_cautela_armeiro`/`sign_cautela_militar`), incluindo `canCapture` e `documentHash`.
- [ ] `ShiftAuthDialog` usa `BiometricCaptureDialog` real (purpose `open_shift`/`close_shift`), `biometricAvailable` removido, aba sempre visível.
- [ ] `_livro-client.tsx`/`_cautelas-client.tsx`/`_minhas-cautelas-client.tsx` repassam `reserveId`/`canCapture`/`simulatorEnabled`/`simulationUserId`/`documentHash` conforme necessário.
- [ ] Testes de integração novos para `actorCanAccessChallenge` E `actorCanAccessReserveDevices` (positivos e negativos, incluindo os casos de `usuario` mirando outra pessoa/outra cautela/outra reserva).
- [ ] Teste de integração dedicado pra `GET /devices` como `usuario` (200 com cautela ativa na reserva, 403 sem) — não coberto pelo E2E via simulador (seção 6).
- [ ] Testes de integração novos (proof scope/freshness/replay, incluindo a ordem consume-depois-da-mutação, e `biometric_proof_id` inexistente → 401) para os 2 fluxos novos.
- [ ] Teste de concorrência para `/:id/close` (2 requests simultâneos encerrando o mesmo turno — 1 sucesso, 1 recebe 409, nunca os dois "sucesso") — achado ALTO da revisão v3.
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
| `apps/bff/src/routes/biometric.ts` | `POST /challenges`, `GET /challenges/:id/result`, `GET /devices` usam as novas funções de autorização; `roleGuard` das 3 rotas ganha `"usuario"`; os 9 call sites de `actorCanAccessReserve` (incl. os 3 que migram) trocam a definição local por `import` do módulo novo — comportamento inalterado nos 6 que não migram. |
| `apps/bff/src/routes/biometric-simulator.ts` | `POST /challenges/:id/complete` usa `actorCanAccessChallenge`; `POST /challenges/:id/enroll` (o outro call site) troca a definição local de `actorCanAccessReserve` por `import` do módulo novo — comportamento inalterado. |
| `apps/bff/src/lib/biometric-proof-service.ts` | Ganha `statusForBiometricProofError`/`mapBiometricProofError` (seção 4.1), co-localizados com `loadBiometricProof`/`assertProofScopeAndFreshness` — destino do módulo compartilhado (achado MÉDIO da revisão v5). |
| `apps/bff/src/routes/cautelamentos.ts` | `signBodySchema`, `sign-armeiro`, `sign-militar` — troca de `use_biometric`/`validateBiometric` por `biometric_proof_id`/proof real, `consumeBiometricProof` chamado por último; guard condicional de update distingue `PGRST116` de outro erro, `!signedCautela` só no branch de 500 (achados MÉDIO da v5 e ALTO da v6/v7); `GET /` ganha `reserve_id`/`document_hash` no select; `select` de `sign-militar` (não só `sign-armeiro`) também ganha `reserve_id` (achado ALTO da revisão v7). Remove `validateBiometric`. |
| `apps/bff/src/lib/shift-auth.ts` | Remove `validateSelfBiometric`; adiciona `validateSelfBiometricProof` (só valida, não consome, devolve `loadedProof` pro caller); `ShiftAuthResult["status"]` ganha `409` (achado ALTO da revisão v5); `ShiftAuthResult` ganha campo `loadedProof?` (achado ALTO da revisão v7). |
| `apps/bff/src/routes/shifts.ts` | Schemas de open/close ganham `biometric_proof_id`; branch de auth usa a nova função (com `reserveId` de fontes diferentes em `/open` vs `/close`); consome a prova via `authResult.loadedProof.proof` depois de `service_shifts` gravado (achado ALTO da revisão v7); `UPDATE` de `/:id/close` ganha guard condicional `.eq("status","ativo")` + distinção `PGRST116` (achado ALTO da revisão v3). |
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
