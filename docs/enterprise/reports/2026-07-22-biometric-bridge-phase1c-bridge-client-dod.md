# DoD — Biometric Bridge Phase 1C (Bridge Client Windows)

**Data:** 2026-07-22 (implementação inicial) — atualizado 2026-07-23 (2 rodadas de code review sênior + correções)
**Spec:** [`2026-07-21-biometric-bridge-phase1c-client-design.md`](../../superpowers/specs/2026-07-21-biometric-bridge-phase1c-client-design.md)
**Status:** Implementação sem hardware CONCLUÍDA (seção 8.1 da spec), com 2 rodadas de code review sênior + 1 re-revisão de confirmação. **Gate de hardware (8.2) PENDENTE — bloqueador explícito, esta fase NÃO está "entregue".**

## Code review sênior (regra CLAUDE.md) — histórico honesto, não só o resultado final

A 1ª rodada de review (agente em segundo plano) morreu no meio por limite de
sessão da conta, mas já tinha encontrado e confirmado 2 problemas reais antes
de cair — corrigidos antes de prosseguir:
- Vazamento do handle nativo `HFIR` (`NitgenSdkAdapter.BuildResult` nunca
  chamava `.Dispose()` em nenhum caminho de retorno) — corrigido com
  `try/finally` cobrindo os 6 caminhos de retorno.
- `CertificatePinning.PinnedSpkiSha256Hex` nunca era populado em lugar
  nenhum (pinning sempre inerte, fail-open) — corrigido: `BridgeConfig`
  ganhou `PinnedSpkiSha256Hex` lido de `APMCB_BRIDGE_PINNED_SPKI_SHA256`
  (env var, hashes separados por vírgula), populado em `Program.cs` antes
  de qualquer `HttpClient` real ser criado.

A 2ª rodada (retry completo, leu os ~26 arquivos + comparou byte a byte
contra `biometric-device-auth.ts`/`biometric-proof.ts`/`biometric-enrollment.ts`/
`biometric-bridge.ts` do BFF) encontrou, verificados empiricamente (não só
por inspeção):

- **CRÍTICO** — `proof.timestamp` gerado com `DateTimeOffset.UtcNow.ToString("O")`
  produz sufixo `+00:00`; o BFF valida com Zod `z.string().datetime()` sem
  `offset:true`, que só aceita `Z` — confirmado rodando o validador Zod real
  (`node -e`) contra os dois formatos. **Todo `/proof` e `/enrollment` falhava
  com 400 antes de qualquer lógica de negócio rodar** — o app rodava,
  autenticava, pareava, sincronizava templates, mas nenhuma identificação ou
  cadastro biométrico jamais tinha sucesso contra o BFF real. Corrigido:
  novo `ProofTimestamp.UtcNowIso()` (usa `DateTime`, não `DateTimeOffset`) nos
  2 call sites de `BiometricProcessor.cs`.
- **CRÍTICO** — `format: "eNBSP"` (nome do produto) no payload de enrollment;
  `DEFAULT_ALLOWED_FORMATS` do BFF só aceita `"nitgen-fmd"`
  (`biometric-enrollment.ts:9`) — todo enrollment seria rejeitado mesmo após
  corrigir o timestamp. Corrigido: constante trocada para `"nitgen-fmd"`.
- **ALTO** — repareamento (`TrayApp` "Parear leitor…", sempre habilitado)
  reabre o mesmo `INitgenAdapter`/device nativo compartilhado; `Capture`/
  `Enroll` são chamadas síncronas bloqueantes no SDK (até 30s) sem
  `CancellationToken` real — se o operador repareasse durante uma captura em
  andamento, `Stop()` desistia depois de 5s e fechava o device enquanto a
  chamada antiga ainda podia estar presa nele. Corrigido: `BiometricProcessor.IsProcessing`
  (volatile, try/finally) bloqueia o menu de repareamento durante um
  challenge em voo; `BridgeOrchestrator.Stop()` só fecha o device se o task
  de fato completou (checa `IsCompleted`, não confia no retorno de `Wait`).
- **MÉDIO** (3) — refresh da tenant key (`TenantKeyRefreshDays`, default 7d)
  só rodava uma vez no boot, nunca em runtime contínuo (corrigido: loop
  `TenantKeyProvider.RunAsync` no `Task.WhenAll`); device revogado (401/403,
  ex: PC roubado) ficava com ícone verde indefinidamente — exatamente o
  cenário que a revogação deveria tornar visível (corrigido: `HeartbeatStatus.AuthRejected`
  + ícone vermelho `Status.Revoked`); campos mutáveis compartilhados entre
  threads sem `volatile` (corrigido em `HeartbeatService`/`TemplateSyncService`/
  `TenantKeyProvider`).
- **BAIXO** (1 de 4 corrigido) — `BridgeConfig.BaseUrl` sem exigir `https://`
  (corrigido: fail-fast no boot). Os outros 3 BAIXO (string `sdk_version`
  cosmética, `NaN`/`Infinity` no canonicalizador — domínio não alcança esse
  caso —, `finger_index` fixo em 1 — já documentado no código) foram
  avaliados e conscientemente não corrigidos por custo/benefício.

3ª rodada (re-revisão focada, só verificando as correções acima, não uma
auditoria nova): **confirmou todas as correções corretas, sem bugs novos
introduzidos.** Build final: 0 warnings, 0 errors. 36/36 testes (3 novos
travando especificamente os 2 CRÍTICO + o reset de `IsProcessing`).

---

## O que foi entregue nesta fase

O processo Windows (app de bandeja, `apps/bridge-windows/`) que roda no PC da
reserva, implementa o protocolo device-auth do BFF (já existente desde a Fase
1B) e fala com o leitor NITGEN via o SDK oficial .NET. **Fase A** (mudanças de
contrato do BFF) já havia sido entregue em sessão anterior; esta sessão
entregou o **Bridge Client em si (Fase C)**.

### Componentes (todos com build limpo, 0 warnings, e 36 testes verdes)

| Componente | Arquivo | Testado sem hardware |
|---|---|---|
| Canonicalização de request (assina cada HTTP) | `DeviceAuthCanonicalizer.cs` | ✅ byte a byte vs BFF |
| Canonicalização de proof/enrollment | `BiometricPayloadCanonicalizer.cs` | ✅ ordem/escaping/número |
| Assinatura Ed25519 (NSec/libsodium) | `Ed25519KeyPair.cs` | ✅ sign/verify + PEM SPKI |
| HTTP client assinado (4 headers) | `DeviceAuthClient.cs` | ✅ headers via handler fake |
| Certificate pinning (SPKI da intermediária) | `CertificatePinning.cs` | ✅ mecanismo (pins vazios até runbook) |
| Cifra de template AES-256-GCM (nonce‖ct‖tag) | `TemplateCipher.cs` | ✅ round-trip + tamper + nonce único |
| KeyStore DPAPI (chave privada + reserve + tenant key) | `KeyStore.cs` | ✅ persistência |
| Cache de templates + merge por (user,finger) | `TemplateStore.cs` | ✅ upsert + cursor |
| Provider da tenant key (fetch/cache/refresh 7d) | `TenantKeyProvider.cs` | — (integra endpoint) |
| Cliente tipado por endpoint | `BridgeProtocolClient.cs` | ✅ composição de request |
| Processador identify (loop O(n) VerifyMatch) + enroll | `BiometricProcessor.cs` | ✅ match/no-match/enroll/liveness |
| Poller de challenges (honra poll_after_ms) | `ChallengePoller.cs` | ✅ branch/poll |
| Sync incremental por cursor opaco | `TemplateSyncService.cs` | ✅ paginação |
| Heartbeat 30s (device_detected/model) | `HeartbeatService.cs` | ✅ payload |
| Pareamento (/pair, único sem device-auth) | `PairingService.cs` | ✅ sucesso/erro/sem órfão |
| Orquestrador (amarra tudo) | `BridgeOrchestrator.cs` | — (composição) |
| App de bandeja + janela de pareamento | `TrayApp.cs`, `PairingForm.cs`, `Program.cs` | — (UI) |
| **Adapter REAL do SDK NITGEN** | `NitgenSdkAdapter.cs` | ❌ **só valida com hardware** |
| Adapter mock (isola o SDK dos testes) | `MockNitgenAdapter.cs` | ✅ |

### Decisões de design confirmadas contra a DLL real (reflection)

- **SDK v5.2.0.6** (`NITGEN.SDK.NBioBSP.dll`), binding .NET oficial. API
  confirmada: `EnumerateDevice`, `OpenDevice`/`CloseDevice`, `Capture(FIR_PURPOSE,
  out HFIR, timeout, audit, WINDOW_OPTION)`, `Enroll(...)`, `GetTextFIRFromHandle`
  (→ `FIR_TEXTENCODE.TextFIR`, serialização), `VerifyMatch(FIR_TEXTENCODE,
  FIR_TEXTENCODE, out bool, payload)` (match offline texto-a-texto),
  `SetLFDLevel` (liveness), `GetHeaderFromHandle` (→ `FIR_HEADER.Quality`).
- **1:N via loop O(n) `VerifyMatch`**, NÃO `IndexSearch` (spec seção 7, KISS —
  volume real de uma reserva não justifica a engine indexada + índice UUID↔uint).
- **Liveness real via LFD**: `SetLFDLevel(1)` no open; captura que retorna
  `CAPTURE_FAKE_SUSPICIOUS` (516) → `liveness_passed=false`; sucesso com LFD
  ativo → `true`; LFD indisponível no modelo → `null`. Nunca inventa `true`.
- **Serialização de template**: `FIR_TEXTENCODE` (wide) → string → UTF-8 bytes,
  cifrado com AES-256-GCM (tenant key) → `nonce(12)‖ciphertext‖tag(16)` → base64.
  `template_hash` = `sha256:` do CIPHERTEXT (spec 2.7).

### Isolamento do SDK (build portável)

`NitgenSdkAdapter.cs` + a referência à DLL só compilam quando o símbolo
`NITGEN_SDK` está definido (csproj: `Condition=Exists` da DLL, caminho padrão
do eNBSP SDK Professional, sobrescrevível via `NITGEN_SDK_DLL`). Em máquina/CI
sem o SDK, o projeto compila sem a classe real e o app cai no `MockNitgenAdapter`
— nenhum hard-fail de build por ausência do SDK.

---

## Verificação executada

- ✅ `dotnet build` — **0 warnings, 0 errors** (com `NitgenSdkAdapter` real
  compilado, SDK presente na máquina de desenvolvimento).
- ✅ `dotnet test` — **36/36 testes verdes** (canonicalizadores byte-a-byte vs
  BFF, round-trip de cripto, pinning, poller/sync/pairing/processor via
  `HttpMessageHandler` fake + `MockNitgenAdapter`, sem hardware — inclui os
  3 testes novos que travam os 2 CRÍTICO + o reset de `IsProcessing`).
- ✅ Code review sênior (regra CLAUDE.md), 2 rodadas + 1 re-revisão de
  confirmação — ver seção dedicada acima. Nenhum CRÍTICO/ALTO pendente.

## O que falta para "FINALIZADO É ENTREGUE" (bloqueadores explícitos)

1. **Gate de hardware (spec 8.2)** — bloqueador não-contornável: com o leitor
   NITGEN físico, confirmar: enumera o device; capture retorna qualidade
   suficiente; enroll grava template; identify (loop `VerifyMatch`) reconhece o
   usuário certo entre candidatos do tenant; dedo errado falha; device revogado
   para de funcionar sem reiniciar. **Só quem tem o leitor físico fecha isto.**
2. **Confirmar LFD do modelo real** — se o leitor específico expõe LFD confiável
   (afeta só `liveness_passed`; NÃO bloqueia mais o enrollment, já que o gate de
   liveness do BFF virou condicional na Fase A).
3. **Pins reais do certificado** — mecanismo completo (populável via
   `APMCB_BRIDGE_PINNED_SPKI_SHA256`, env var, hashes separados por vírgula)
   e testado; fica vazio (fail-open documentado) até o runbook de deploy
   confirmar a intermediária Let's Encrypt em uso (atual + próxima, para
   rotação sem quebrar) e configurar a env var em produção.
4. **E2E do bridge real contra o BFF de produção** (spec 8.1, último item) —
   rodar o cliente C# real apontando pro `MockNitgenAdapter`, falando com o BFF
   de produção, para validar o protocolo ponta-a-ponta com Ed25519 real.
5. **Runbook de revogação urgente** (spec 3.2/4, achado ALTO da 4ª rodada) —
   auto-login neutraliza o DPAPI contra furto do PC inteiro; revogação rápida do
   device é o único controle real. Documentar como incidente com prazo.
6. **Auto-login + auto-start** do usuário operacional no PC da reserva (spec 4).

**Finalizado não é entregue**: sem o item 1 (hardware), nenhum armeiro usa
biometria de verdade. Esta fase entregou tudo que é testável sem hardware e
deixou os bloqueadores restantes explícitos, não escondidos.
