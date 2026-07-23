# APMCB — Spec: Unificar assinatura de cautela e autenticação de turno no bridge biométrico real

**Data:** 2026-07-23 (v1)
**Status:** Em revisão.
**Contexto:** Levantamento de todos os pontos de biometria do sistema (pedido do dono do sistema, "explore isso pra mim... quero tudo intuitivo dinâmico interativo... premium") revelou que 2 dos 6 fluxos de captura biométrica nunca foram conectados ao bridge NITGEN real (Fases 0-1C, já entregues e code-reviewed nesta sessão) — usam um SDK de teste (`getFingerprintSDK`/ZKTeco) que **sempre falha por construção**, não por instabilidade. Confirmado pelo dono do sistema: "nunca usei zkteco, pode apagar qualquer referência. foi para testes" — não é uma integração a preservar, é código morto a remover.
**Meta de qualidade:** nota ≥ 9.5/10 em revisão sênior, spec e implementação, antes de fechar esta fase — mesmo padrão das specs anteriores deste projeto (Biometric Bridge Fases 0-1C).

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

---

## 2. Objetivo e critérios de sucesso

**Objetivo**: os 6 fluxos de biometria do sistema (identificar, cadastrar/alterar digital, dar saída, receber material, assinar cautela, abrir/encerrar turno) usam o **mesmo motor real** (bridge NITGEN via challenge/purpose/proof), com a **mesma experiência visual** (`BiometricCaptureDialog` — card de estados idle/pending/success/failure/expired/retry). TOTP continua como alternativa em todos.

**Critérios de sucesso:**

| Critério | Como verificar |
|---|---|
| Assinar cautela via biometria funciona de ponta a ponta (armeiro e militar) | E2E via simulador + validação manual (guia de teste já entregue) |
| Abrir/encerrar turno via biometria funciona de ponta a ponta | E2E via simulador + validação manual |
| Nenhuma prova biométrica pode ser reaproveitada entre propósitos/documentos/atores diferentes | Teste de integração replicando os já existentes para saída/devolução (`assertUsableBiometricProof`) |
| TOTP continua funcionando exatamente como hoje nos 2 fluxos (nenhuma regressão) | Suíte E2E existente de cautelas/livro continua verde |
| Nenhum resquício do SDK de teste (ZKTeco) no código | Grep de `getFingerprintSDK`, `ZKTecoSDK`, `zkteco` retorna zero resultados fora do git history |
| Code review sênior sem CRÍTICO/ALTO pendente | Regra CLAUDE.md, ≥9.5/10 |

---

## 3. Escopo

**Dentro do escopo:**
- Assinatura de cautela (armeiro e militar) via biometria — `purpose: sign_cautela_armeiro` / `sign_cautela_militar`.
- Abertura e encerramento de turno via biometria — `purpose: open_shift` / `close_shift`.
- Remoção completa do SDK de teste ZKTeco e de `validateBiometric`/`validateSelfBiometric`.
- Testes E2E novos cobrindo os 6 fluxos via clique real de UI (não só API), usando o modo simulador.

**Fora do escopo (registrado, não esquecido):**
- `handover_sign_exit` / `handover_sign_entry` — purposes já tipados no frontend (`biometric-capture-dialog.tsx`) mas sem nenhuma tela usando; não há fluxo de troca de plantão implementado hoje para conectar a eles. Fica para quando esse fluxo existir.
- Qualquer mudança no bridge Windows (Fase C, já entregue) ou no protocolo de challenge/proof em si — esta spec só conecta telas novas ao que já existe e passou por review.
- Validação de hardware físico — mesma dependência já documentada nas specs anteriores (gate de hardware da Fase 1C), não duplicada aqui.

---

## 4. Arquitetura da correção

### 4.1 Backend — `apps/bff/src/routes/cautelamentos.ts`

**`signBodySchema`** (linha ~114) ganha um campo novo, mantendo os existentes:

```ts
const signBodySchema = z
  .object({
    totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
    use_biometric: z.boolean().optional(),        // REMOVIDO — ver nota abaixo
    biometric_proof_id: z.string().uuid().optional(),  // NOVO
  })
  .refine((d) => d.totp_token || d.biometric_proof_id, {
    message: "Informe totp_token ou biometric_proof_id",
  });
```

`use_biometric: true` é removido do schema (não apenas ignorado) — deixar o campo morto aceito silenciosamente esconderia a mudança de contrato de um client desatualizado atrás de uma validação que passa mas não faz nada, exatamente o tipo de ambiguidade que este projeto já tratou como bug em specs anteriores (achado A5, spec Fase 1C).

**`sign-armeiro`** (linha 350-424) e **`sign-militar`** (linha 426+): o `select` de `cautela` ganha `reserve_id` (necessário para o contexto de validação da prova — hoje ausente do select, linha 364/440). O bloco `if (body.use_biometric) { ... }` é substituído por:

```ts
if (body.biometric_proof_id) {
  const loaded = await loadBiometricProof(body.biometric_proof_id, tenantId);
  try {
    assertProofScopeAndFreshness(loaded, {
      tenantId,
      reserveId: cautela.reserve_id,
      actorId: armeiroId,           // ou militarId em sign-militar
      purpose: "sign_cautela_armeiro",  // ou "sign_cautela_militar"
      expectedUserId: armeiroId,    // autoautenticação — o signatário prova que é ele mesmo
      documentId: cautela.id,
      documentHash: cautela.document_hash,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "biometric proof invalid" }, 401);
  }
  await consumeBiometricProof(supabase, loaded.proof, {
    proofId: body.biometric_proof_id,
    tenantId, reserveId: cautela.reserve_id, actorId: armeiroId,
    operationType: "cautela_sign_armeiro",  // ou "cautela_sign_militar"
    operationId: cautela.id,
    purpose: "sign_cautela_armeiro",
    expectedUserId: armeiroId,
    documentId: cautela.id, documentHash: cautela.document_hash,
  });
  authVerified = true;
  authMethod = "biometric";
} else {
  // ramo TOTP inalterado
}
```

Mesmo padrão exato de `apps/bff/src/routes/saidas.ts`/`lendings.ts` — `loadBiometricProof` → `assertProofScopeAndFreshness` → `consumeBiometricProof`, importados de `apps/bff/src/lib/biometric-proof-service.ts` e `biometric-proof-consumption.ts` (já existentes, já testados, sem mudança nesta spec).

**Erros**: `assertProofScopeAndFreshness`/`consumeBiometricProof` lançam `Error` com mensagens como `"biometric proof purpose mismatch"`, `"biometric proof already consumed"`, `"biometric proof expired"` — mapeados para 401 (ou 409 no caso de já-consumida, para diferenciar de identidade errada vs. reuso — replicar o mesmo mapeamento que `saidas.ts` já faz, não inventar um novo).

### 4.2 Backend — `apps/bff/src/lib/shift-auth.ts` e `apps/bff/src/routes/shifts.ts`

**`OpenShiftSchema`/o schema de close** (`shifts.ts:18-42`) ganham `biometric_proof_id: z.string().uuid().optional()`, com o mesmo `.refine` adaptado: `auth_mode !== "biometria" || !!biometric_proof_id`.

**`validateSelfBiometric`** (`shift-auth.ts:99-151`) é **removida por completo** — não adaptada, removida — e o branch em `shifts.ts:120-122` e `343-345` vira:

```ts
const authResult = auth_mode === "totp"
  ? await validateSelfTotp(userId, totp_token!)
  : await validateSelfBiometricProof(userId, reserve_id, biometric_proof_id!, {
      tenantId,
      purpose: isOpen ? "open_shift" : "close_shift",
      documentId: isOpen ? null : shiftId,  // ver nota abaixo
    });
```

Nova função `validateSelfBiometricProof` em `shift-auth.ts` (substitui `validateSelfBiometric`), mesmo padrão `loadBiometricProof`/`assertProofScopeAndFreshness`/`consumeBiometricProof` do item 4.1, com `operationType: "shift_open"` / `"shift_open_denied"` etc. mantendo o mesmo `audit_logs` insert que já existe hoje (linhas 132-148) para não perder rastreabilidade — só troca a fonte da verificação, não a auditoria.

**Nota sobre `documentId` no encerramento**: `close_shift` usa `documentId: shiftId` (o turno sendo encerrado) — trava extra que impede reaproveitar uma prova capturada para encerrar um turno diferente do que está na tela. `open_shift` não tem `documentId` (o turno ainda não existe no momento da captura) — o par `tenantId`/`reserveId`/`actorId`/`purpose` já é suficiente para esse caso, replicando a mesma lógica que `confirm_saida_militar` (que também não usa `documentId`) já usa hoje.

### 4.3 Frontend — `SignDialog` (`apps/web/src/components/cautelas/sign-dialog.tsx`)

- Novas props: `reserveId: string`, `simulatorEnabled?: boolean`, `simulationUserId?: string` (repassadas pelos callers, mesmo padrão de `_form.tsx`/`_desarmamento-modal.tsx`).
- Painel "Biometria" (linhas 154-166) troca o `<Fingerprint>` pulsante + `Button onClick={handleBiometria}` por `<BiometricCaptureDialog purpose={role === "armeiro" ? "sign_cautela_armeiro" : "sign_cautela_militar"} expectedUserId={currentUserId} documentId={cautelaId} documentHash={...} reserveId={reserveId} buttonLabel="Capturar Biometria" onResult={handleBiometricResult} />`.
- `documentHash` precisa vir do caller (`_cautelas-client.tsx`/`_minhas-cautelas-client.tsx` já carregam a cautela e têm esse campo — só passar como prop nova de `SignDialogProps`, mesmo padrão de `cautelaId`).
- `handleBiometricResult(result: BiometricResult)`: se `result.proof?.result === "success"`, chama `bffFetch("POST", endpoint, { biometric_proof_id: result.proof.id })` (substitui `handleBiometria`/`{ use_biometric: true }`) e segue o mesmo tratamento de sucesso/erro que `handleTotp` já tem.
- `currentUserId` (necessário pro `expectedUserId`): mesma fonte que os fluxos já prontos usam (`_form.tsx`/`_desarmamento-modal.tsx` — a ser confirmada exatamente no plano de implementação, não é uma incógnita de arquitetura).

### 4.4 Frontend — `ShiftAuthDialog` (`apps/web/src/components/livro/shift-auth-dialog.tsx`)

- Comentário da linha 24-30 (documentando por que a aba fica escondida) é removido — a razão deixa de existir.
- `biometricAvailable` prop **é removida** (não só passada como `true`) — a aba de biometria passa a ser incondicional, mesmo tratamento que TOTP, já que o motivo de escondê-la (SDK de teste) deixa de existir. Simplifica o componente (menos um prop condicional pra manter em sincronia).
- Painel "Biometria" (linhas 129-143) troca o ícone estático + texto ("O leitor será ativado ao confirmar a ação") por `<BiometricCaptureDialog purpose={variant === "open" ? "open_shift" : "close_shift"} expectedUserId={currentUserId} documentId={variant === "close" ? shiftId : undefined} reserveId={reserveId} buttonLabel={confirmLabel} onResult={handleBiometricResult} />` — `variant`/`shiftId`/`reserveId` são props novas do componente (hoje `ShiftAuthDialog` é agnóstico de turno específico; passa a precisar saber se é abertura ou encerramento, e qual turno, exatamente como o backend precisa pro `documentId`).
- `onConfirm(authMode, totpToken?)` (assinatura atual) precisa aceitar também um `biometricProofId?: string` — `_livro-client.tsx` (`handleOpenShift`/`handleCloseShift`) passa esse valor no `POST` como `biometric_proof_id` em vez de simplesmente `auth_mode: "biometria"` sem prova nenhuma (o que o backend aceita hoje sem checagem real — ver 4.2).

### 4.5 Remoção do SDK de teste

Apagar por completo:
- `apps/bff/src/services/fingerprint/` (diretório inteiro: `index.ts`, `interface.ts`, `mock.ts`, `zkteco.ts`).
- `validateBiometric` (`cautelamentos.ts:82-111`).
- `validateSelfBiometric` (`shift-auth.ts:99-151`) — substituída por `validateSelfBiometricProof`, não mantida em paralelo.
- Import de `getFingerprintSDK` nos dois arquivos acima.

**Callers a atualizar, não só apagar (confirmado via grep — 2 arquivos de teste)**:
- `apps/bff/src/__tests__/biometric-bridge-harness.test.ts`
- `apps/bff/src/__tests__/biometric-phase1a2-custody.test.ts`

Cada um precisa ser lido no plano de implementação para decidir se o teste inteiro é removido (testava só o caminho morto) ou se só a parte que instancia `getFingerprintSDK` sai, mantendo o resto — decisão de implementação, não de arquitetura.

---

## 5. Segurança

Nenhum mecanismo novo de segurança nesta spec — reaproveita integralmente o já revisado (`assertUsableBiometricProof`, TTL de 2 minutos, constraint única em `biometric_proof_consumptions` como trava de reuso atômica no banco, ver `apps/bff/src/lib/biometric-proof-consumption.ts:58-113`). O único ponto novo é a escolha de `expectedUserId`/`documentId` por fluxo (seção 4), que segue o mesmo raciocínio de escopo mínimo necessário já usado em `confirm_saida_militar`/`return`.

**Consequência de segurança que esta correção introduz (positiva, registrada explicitamente)**: hoje, `auth_mode: "biometria"` em `shifts.ts` é aceito pelo schema mas **nunca verificado de verdade** contra uma prova real (o backend só chama uma função que sempre falha) — ou seja, o único jeito de abrir/fechar turno hoje é TOTP, mesmo que o client mande `auth_mode: "biometria"`. Depois desta correção, `auth_mode: "biometria"` passa a exigir uma prova real, vinculada a propósito/ator/documento — estritamente mais seguro que o estado atual, nunca menos.

---

## 6. Testes

**Novo, por decisão do dono do sistema**: E2E cobrindo os 6 fluxos via clique real de UI (Playwright, modo simulador — `simulator_available`), não só chamada de API:
- Os 4 já prontos (identificar, cadastrar/alterar digital, dar saída, receber material) **nunca tiveram** um spec E2E dirigindo a UI de verdade (achado da investigação anterior) — ganham cobertura nova como parte desta spec.
- Assinar cautela (armeiro e militar) via biometria — novo.
- Abrir/encerrar turno via biometria — novo.

**Testes de integração/unitários**:
- `sign-armeiro`/`sign-militar` com `biometric_proof_id` válido (sucesso), com prova de propósito errado (`sign_cautela_militar` numa chamada de armeiro), com prova já consumida, com prova expirada, com `document_hash` divergente — mesma bateria que `saidas.ts`/`lendings.ts` já têm para seus próprios purposes, replicada aqui.
- Mesma bateria para `open_shift`/`close_shift`.
- Teste de regressão explícito: `grep -r "getFingerprintSDK\|ZKTecoSDK" apps/bff/src` retorna vazio (guarda estático, mesmo espírito do `sql-migrations-on-conflict-guard.test.ts` já existente neste projeto).

**Regressão obrigatória**: suíte E2E existente de `/reserva/cautelas`, `/efetivo/minhas-cautelas` e `/reserva/livro` (fluxo TOTP) continua 100% verde — nenhuma dessas telas muda de comportamento no caminho TOTP.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `BiometricCaptureDialog` renderiza seu próprio `<Dialog>` — embutir dentro do `<Dialog>` já existente de `SignDialog`/`ShiftAuthDialog` aninha um dialog dentro de outro | Base UI (já usado no resto do projeto) renderiza `Dialog` via portal — dialogs aninhados já são um padrão existente e funcional neste código-base (ex: diálogos de confirmação abertos de dentro de outros fluxos). Verificar visualmente via Playwright no plano de implementação antes de considerar concluído, não assumir que "deveria funcionar" é suficiente. |
| Remover `biometricAvailable` de `ShiftAuthDialog` muda a assinatura pública do componente | Só 2 call sites (`_livro-client.tsx`, abrir e encerrar) — grep confirma, sem uso em outro lugar. Atualizar os dois junto. |
| Dois arquivos de teste (`biometric-bridge-harness.test.ts`, `biometric-phase1a2-custody.test.ts`) referenciam `getFingerprintSDK` — remover sem entender o que testam pode apagar cobertura válida por engano | Ler os dois arquivos inteiros no plano de implementação antes de decidir remover vs. adaptar — não decidir isso na spec, decidir com o conteúdo real na frente. |
| `document_hash` de cautela pode não estar carregado no client no momento de montar `SignDialog` | Os campos que a tela de cautelas já busca (`cautelamentos` list/detail) precisam ser conferidos no plano — se `document_hash` não vier hoje na query usada por `_cautelas-client.tsx`/`_minhas-cautelas-client.tsx`, a query precisa ganhar essa coluna (mudança pequena, mas real, a confirmar no plano). |

---

## 8. Definition of Done

- [ ] `signBodySchema` (`cautelamentos.ts`) trocado para `biometric_proof_id`, `use_biometric` removido.
- [ ] `sign-armeiro`/`sign-militar` validam via `loadBiometricProof`/`assertProofScopeAndFreshness`/`consumeBiometricProof`.
- [ ] `OpenShiftSchema`/schema de close (`shifts.ts`) ganham `biometric_proof_id`.
- [ ] `validateSelfBiometricProof` substitui `validateSelfBiometric` em `shift-auth.ts`, mesmo padrão de proof.
- [ ] `apps/bff/src/services/fingerprint/` removido por completo; `validateBiometric`/`validateSelfBiometric` removidos; zero referência a `getFingerprintSDK`/ZKTeco no código (guarda estático de teste).
- [ ] `SignDialog` usa `BiometricCaptureDialog` real (purpose `sign_cautela_armeiro`/`sign_cautela_militar`).
- [ ] `ShiftAuthDialog` usa `BiometricCaptureDialog` real (purpose `open_shift`/`close_shift`), `biometricAvailable` removido, aba sempre visível.
- [ ] `_livro-client.tsx`/`_cautelas-client.tsx`/`_minhas-cautelas-client.tsx` repassam `reserveId`/`simulatorEnabled`/`simulationUserId`/`documentHash` conforme necessário.
- [ ] Testes de integração novos (proof scope/freshness/replay) para os 2 fluxos novos.
- [ ] Testes E2E novos cobrindo os 6 fluxos via clique real de UI.
- [ ] Suíte E2E existente (cautelas, livro, TOTP) continua verde — zero regressão.
- [ ] Code review sênior sem CRÍTICO/ALTO — nota ≥9.5/10.
- [ ] Guia de teste (artefato já publicado) atualizado pra refletir os 6 fluxos prontos.
- [ ] CHANGELOG.md atualizado.

---

## 9. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/bff/src/routes/cautelamentos.ts` | `signBodySchema`, `sign-armeiro`, `sign-militar` — troca de `use_biometric`/`validateBiometric` por `biometric_proof_id`/proof real. Remove `validateBiometric`. |
| `apps/bff/src/lib/shift-auth.ts` | Remove `validateSelfBiometric`; adiciona `validateSelfBiometricProof`. |
| `apps/bff/src/routes/shifts.ts` | Schemas de open/close ganham `biometric_proof_id`; branch de auth usa a nova função. |
| `apps/bff/src/services/fingerprint/*` | **Removido por completo.** |
| `apps/bff/src/__tests__/biometric-bridge-harness.test.ts` | Revisado — remover ou adaptar trecho que usa `getFingerprintSDK`. |
| `apps/bff/src/__tests__/biometric-phase1a2-custody.test.ts` | Idem. |
| `apps/web/src/components/cautelas/sign-dialog.tsx` | Painel de biometria passa a usar `BiometricCaptureDialog`. Novas props. |
| `apps/web/src/components/livro/shift-auth-dialog.tsx` | Painel de biometria passa a usar `BiometricCaptureDialog`. Remove `biometricAvailable`. Novas props (`variant`, `shiftId`, `reserveId`). |
| `apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx` | Repassa `reserveId`/`documentHash`/simulador pro `SignDialog`. |
| `apps/web/src/app/(dashboard)/efetivo/minhas-cautelas/_minhas-cautelas-client.tsx` | Idem. |
| `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx` | Repassa `reserveId`/`shiftId`/simulador pro `ShiftAuthDialog`; `handleOpenShift`/`handleCloseShift` aceitam `biometricProofId`. |
| `apps/web/e2e/*.spec.ts` | Specs novos cobrindo os 6 fluxos via UI real. |
| `docs/superpowers/specs/2026-07-23-biometric-unify-cautela-turno-design.md` | Esta spec. |
| `CHANGELOG.md` | Entrada documentando a correção. |
