# APMCB — Spec: Biometric Bridge Phase 1C — Bridge Client Windows (MVP)

**Data:** 2026-07-21 (v6)
**Status:** v6 — implementação iniciada ("Fase A", mudanças de contrato do BFF, ver commits). Durante a preparação da Fase C (Bridge Client em si), o SDK NITGEN real foi localizado na máquina de desenvolvimento (`eNBSP SDK Professional`, DLL .NET + 6 samples C#/VB.NET) — seção 7 reescrita com fatos confirmados via reflection contra a DLL real (não mais suposição), substituindo 2 pontos que a v5 deixava em aberto: (1) `IndexSearch` (engine 1:N nativa) exige ID inteiro, não UUID, e mantém índice próprio persistente — decisão nova: usar loop `VerifyMatch` O(n) em vez disso (KISS, volume real não justifica a complexidade); (2) o SDK não expõe `match_score` contínuo em nenhuma chamada — decisão nova: bridge reporta `1.0` fixo em sucesso (o SDK já filtra por `SecurityLevel` internamente). Nenhuma mudança nas seções 1-6/8-10 (contrato do BFF, chave, pareamento, DoD) — só a seção 7 (integração SDK) foi substancialmente revisada. **Teto realista em papel: ~8,5-9/10** (nota da v5, 4ª rodada) — a diferença até 9,5/10 fecha com implementação real rodando (suíte de testes, migrations aplicadas, gate de hardware), não mais revisão de texto. **Pronta para implementação — em andamento.**
**Precede:** [`2026-07-14-biometric-bridge-design.md`](2026-07-14-biometric-bridge-design.md) (arquitetura mestra), [`2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md`](2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md) (contrato do BFF, seção 9 nomeia esta fase)
**Pré-requisito confirmado com o dono do sistema (2026-07-21):** stack C#/.NET — validado contra a documentação real do SDK antes de escrever esta spec (seção 1).

**Histórico de revisão:**
- **v1 → 6,8/10.** Revisor verificou contra código real (`apps/bff/src/routes/biometric-bridge.ts`, `biometric-enrollment.ts`, `biometric-proof.ts`, migrations). Achados: **CRÍTICO** — `recordBiometricEnrollment`/`validateBiometricEnrollment` exige `liveness_passed === true` incondicionalmente (nunca checa `BIOMETRIC_REQUIRE_LIVENESS`, ao contrário de `/proof`), travando TODO enrollment se o modelo de leitor não expuser LFD real — descoberto só no gate de hardware, o pior momento possível. **ALTO** — (A1) seção 2.8 afirmava que a assinatura de enrollment usa a mesma função/payload da assinatura de proof; código real tem duas funções distintas com payloads diferentes (`verifyBridgeSignature` vs. `verifyBiometricEnrollmentSignature`); (A2) design da chave de template (seção 3) não especificava nonce/layout do AES-256-GCM, crítico porque a MESMA chave é compartilhada por múltiplos bridges independentes sem coordenação; (A3) "TLS é proteção suficiente" equiparava erroneamente o transporte de ciphertext (`/templates/sync`) ao transporte da CHAVE em si (`/tenant-key`) — interceptação nesse endpoint é exfiltração tenant-wide não revogável; (A4) rejeição da alternativa de chave armazenada ignorava que `biometric_templates.encryption_key_version` já existe no schema (Fase 0) exatamente para isso; (A5) fluxo de pareamento (seção 6) inconsistente com o RPC real — `POST /pairing-codes` exige `device_name` do admin, mas `consume_biometric_pairing_code` nunca usa esse valor, só o que o bridge envia em `/pair`; (A6) claim de que Ed25519 está disponível nativamente via `System.Security.Cryptography` no .NET 8 é falsa especificamente na plataforma-alvo (Windows) — sem citação, ao contrário do resto da pesquisa de SDK. **MÉDIO** — (M1) regra de rejeição por liveness em `/proof` incompleta (falta o `liveness_passed === false` incondicional); (M2) tray app não conectava o requisito de auto-login ao sintoma de falha já visível via `last_seen_at`; (M3) `INitgenAdapter` reduz retrabalho mas não elimina — a própria interface é uma hipótese sem hardware; (M4) HKDF salt/info invertido do padrão comum (não é bug, é estilo). **BAIXO** — (B1) refresh da tenant-key sem env var nomeada.
- **v2 → 6,5/10 (nota mais baixa que a v1, apesar de ter corrigido itens reais).** Revisor confirmou A1, A2, A5, A6, M1-M4, B1 corretamente resolvidos — mas achou que o CRÍTICO da v1 tinha sido corrigido só PELA METADE: `validateBiometricEnrollment` (JS) foi corrigido, mas existe um SEGUNDO gate de liveness, idêntico e incondicional, dentro do RPC `record_biometric_enrollment` (SQL) — nunca mencionado nem tocado pela v2. Pior: o erro desse RPC (`P0001`, mesmo código genérico de todas as exceções da função) era capturado e convertido sempre em "409 challenge já consumido", uma mensagem enganosa que esconderia o problema real. Também achou 2 ALTO novos, introduzidos pelas próprias correções da v2: a incorporação de `encryption_key_version` no HKDF (achado A4) não era implementável como descrita — faltava transporte da versão em 3 endpoints diferentes; e a mitigação de certificate pinning (achado A3) não especificava alvo nem estratégia de rotação, e um pin ingênuo contra o certificado folha do Let's Encrypt (que renova automaticamente) quebraria todos os bridges em produção simultaneamente a cada renovação. Mais 2 MÉDIO: mecânica de mudança de assinatura do RPC de pareamento não especificada (função com histórico de 2 hotfixes por ambiguidade); DoD não mencionava atualizar os E2E existentes que enviam `device_name` no payload antigo de `/pair`. Todos corrigidos na v3 — a correção do CRÍTICO passou a cobrir as DUAS camadas (JS + SQL) mais o tratamento de erro; o escopo de `encryption_key_version` foi HONESTAMENTE REDUZIDO (permanece sempre `1` nesta fase, versionamento completo adiado pra Fase 3) em vez de mantida uma alegação de "mecanismo pronto" que não era verdadeira.
- **v3 → 7,5/10, veredito "pronta para implementação, condicionada a 2 correções textuais objetivas".** Revisor confirmou TODOS os achados da v2 corretamente resolvidos na lógica, mas achou 2 problemas novos, ambos de mecânica de baixo nível (não de arquitetura): **ALTO** — a correção do gate SQL (`record_biometric_enrollment`) não especificava que `CREATE OR REPLACE FUNCTION` não substitui a função in-place quando a lista de parâmetros muda (cria função nova, deixa a antiga com o gate incondicional ainda executável/`GRANT`ada) — a própria v3 já tinha aplicado esse raciocínio corretamente para `consume_biometric_pairing_code`, só não repetiu pro RPC do próprio CRÍTICO; risco real: função nova sem GRANT (erro ruidoso) ou, pior, security definer chamável por `anon`/`authenticated` se privilégios default não estiverem travados. **MÉDIO** — um parágrafo residual sobre `BIOMETRIC_TEMPLATE_MASTER_KEY` ainda dizia que "com encryption_key_version ativo" a rotação seria mais branda, contradizendo a própria decisão de escopo reduzido 2 parágrafos antes. Ambos corrigidos na v4 (`DROP FUNCTION` + `CREATE FUNCTION` + `REVOKE`/`GRANT` explícitos pro RPC de enrollment; parágrafo do env var corrigido para "nunca rotacionar, ponto final" nesta fase). Também aplicados 2 ajustes cosméticos não-bloqueantes que o revisor sinalizou (mecânica de certificate pinning em .NET — `ServerCertificateCustomValidationCallback` + SPKI pinning via `X509Chain`; ordem da fórmula HKDF mostrando o valor fixo desta fase primeiro).
- **v4 → 8,0/10.** Dono do sistema perguntou explicitamente "o que falta pra 9,5/10?" — 4ª rodada dispachada especificamente pra responder isso, comparando contra a nota 9,6/10 da spec 1B como calibração. Confirmou as 2 correções da v3 corretas (inclusive verificando a assinatura real de 16 parâmetros do RPC contra a migration). Achou 1 problema novo, ALTO, nunca visto em nenhuma rodada anterior: DPAPI (seção 3.2, escopo `CurrentUser` implícito) protege a chave tenant-wide de decifragem de templates só enquanto NÃO houver sessão auto-logada — mas a seção 4 exige auto-login como pré-requisito de instalação (pra manter o bridge disponível após reboot). As duas decisões, escritas em rodadas diferentes, nunca tinham sido cruzadas: com auto-login, um PC roubado (mesmo desligado) liga direto na sessão autenticada, e DPAPI `CurrentUser` fica acessível sem senha — furto de QUALQUER PC pareado dá acesso à chave de TODO o tenant. Corrigido nesta v5: decisão honesta de que DPAPI não é a proteção real contra furto do dispositivo inteiro — a proteção real é revogação imediata do device (já existente), agora com requisito explícito de runbook tratando isso como incidente com prazo. Também corrigido 1 BAIXO residual: placeholder `<16 tipos atuais>` no `DROP FUNCTION` do RPC de enrollment substituído pela lista literal de tipos (mesmo rigor já usado pro RPC de pareamento). **Resposta direta à pergunta do dono do sistema**: o revisor foi explícito que o teto realista em papel, mesmo corrigindo tudo, fica em ~8,5-9/10 — os ~0,5-1,0 ponto restante até 9,5 só fecha quando a suíte de testes (seção 8.1) rodar de verdade em CI, as migrations forem aplicadas e confirmadas contra um banco real, e o gate de hardware (seção 8.2) for cumprido — exatamente a mesma dinâmica que a Fase 1B viveu (a nota 9,6 dela era de uma spec já parcialmente as-built, não de um desenho pré-implementação).

---

---

## 0. O que esta fase entrega, e o que não entrega

Entrega: o processo Windows que roda no PC físico da reserva, fala com o leitor
NITGEN via USB, gera/guarda sua identidade criptográfica, e implementa o
protocolo que o BFF já expõe desde a Fase 1B — pareamento, heartbeat, polling
de challenges, sincronização de templates, submissão de proof/enrollment.

Não entrega (fora de escopo, ver seção 9): 1:N verdadeiramente tenant-wide
substituindo o `/identify` legado (Fase 2), lockout dedicado por falhas
consecutivas (Fase 3), rotação de chave do bridge (Fase 3), liveness/anti-spoof
real além do campo já propagado.

**Regra inegociável herdada da spec mestra, repetida aqui porque é a mais
fácil de esquecer numa fase inteiramente nova:** biometria é ADITIVA. Nada
nesta fase pode degradar, remover ou tornar TOTP menos disponível. O bridge é
puramente um provedor de prova adicional — se ele estiver offline, revogado,
ou o leitor falhar, o fluxo TOTP continua idêntico ao de hoje.

---

## 1. Pesquisa de SDK — confirmação da stack antes de comprometer arquitetura

Pedido explícito do dono do sistema: confirmar a stack ANTES de escrever a
spec, para não refatorar depois. Pesquisa feita (WebSearch, 2026-07-21):

- O SDK NITGEN eNBSP (BSP + engine de fingerprint 1:N) publica uma
  **classe .NET nativa e oficial**: `NITGEN.SDK.NBioBSP.dll`, projetada
  explicitamente para C#, VB.NET, ASP.NET, J# — não é COM interop
  improvisado, é um binding de primeira classe do próprio fabricante.
  Instalação típica: `C:\Program Files (x86)\NITGEN\eNBSP SDK
  Professional\SDK\dotNET\NITGEN.SDK.NBioBSP.dll`.
- O SDK inclui exemplos C# prontos (`BSPDemoCS`, `UITestCS`,
  `IndexSerchDemoCS` — NSearch 1:N, `RollDemoCS`) — evidência de que o
  fabricante trata .NET como plataforma de referência, não secundária.
- O módulo nativo (`NBioBSP.dll`, C/C++) existe por baixo e é usável por
  "quase qualquer compilador 32-bit", mas a camada .NET já encapsula isso —
  não há razão para o bridge falar com a DLL nativa diretamente.
- Encontrada uma implementação de referência real e não relacionada a este
  projeto (`FingerTechBR/BiometricServiceAPI`, GitHub) rodando a mesma
  família de SDK **como Windows Service em C#**, expondo captura/1:1/1:N via
  API HTTP local — confirma que o SDK funciona headless num processo Windows
  Service, mas não confirma que funciona em **sessão 0** (serviço sem
  usuário interativo logado) especificamente para acesso a dispositivo USB;
  ver risco aberto na seção 3.1.

**Decisão**: C#/.NET confirmado. Não é só a recomendação inicial — é o
binding oficial do fabricante, o caminho de menor atrito para DPAPI
(API nativa do .NET/Win32), Ed25519 (via `System.Security.Cryptography`
no .NET 5+, sem dependência de terceiros) e HTTP client para o protocolo já
implementado no BFF.

**.NET version**: .NET 8 (LTS, suporte até 2026-11 mínimo) — não .NET
Framework legado.

**Correção da v1 (achado A6 da revisão)**: a v1 afirmava, sem fonte, que
Ed25519 está disponível nativamente via `System.Security.Cryptography`
desde .NET 8. Isso é falso na plataforma-alvo desta spec inteira. Pesquisa
feita agora (WebSearch): o suporte a Ed25519 em
`System.Security.Cryptography` depende do backend criptográfico do SO
(.NET cross-platform crypto só expõe o que a plataforma nativa suporta —
[Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/security/cross-platform-cryptography));
a proposta de API ([dotnet/runtime#63174](https://github.com/dotnet/runtime/issues/63174))
está em preview só em Linux via OpenSSL, sem suporte nativo confirmado via
CNG no Windows — justamente a única plataforma relevante para o Bridge
Client.

**Decisão definitiva desta v2 (não adiada para implementação, dado que é a
operação criptográfica mais sensível do protocolo — a chave privada nunca
sai do device)**: usar [`NSec.Cryptography`](https://nsec.rocks/) (wrapper
.NET moderno sobre libsodium, API baseada em `Span<T>`, mantida
ativamente, propósito específico para Ed25519/X25519 — não uma biblioteca
de crypto genérica). `BouncyCastle` é a alternativa documentada caso o
binário nativo do libsodium (que o NSec empacota) tenha algum problema de
compatibilidade com o ambiente de deploy real (ex: política de assinatura
de driver/antivírus corporativo bloqueando DLL nativa não assinada pela
Microsoft) — decisão de fallback a confirmar só se o caminho principal
falhar em teste real, não uma incógnita de arquitetura.

Fontes: [NITGEN eNBSP SDK for .NET](https://getwinpcsoft.com/NITGEN-ENBSP-SDK-For-NET-94192/), [eNBSP SDK Programmer's Guide .NET (PDF)](https://www.ravirajtech.com/downloads/EN%20eNBSP%20SDK%20Programmer's%20Guide%20.NET.PDF), [FingerTechBR/BiometricServiceAPI](https://github.com/FingerTechBR/BiometricServiceAPI).

---

## 2. Protocolo — grounded no contrato REAL já implementado, não na spec mestra aspiracional

A spec mestra (seção "Endpoints") descreve o protocolo em alto nível. O
contrato REAL, verificado lendo `apps/bff/src/routes/biometric-bridge.ts`,
`apps/bff/src/middleware/biometric-device-auth.ts` e
`apps/bff/src/lib/biometric-device-auth.ts` nesta sessão, é mais específico
e é isso que o bridge precisa implementar byte a byte:

### 2.1 Assinatura do REQUEST (autentica cada chamada HTTP, não a prova biométrica)

Todo request às rotas `/api/biometric-bridge/*` (exceto `/pair`) precisa dos
4 headers abaixo, verificados por `deviceAuthMiddleware`:

```
X-Bridge-Device-Id: <uuid do device, recebido no /pair>
X-Bridge-Timestamp: <ISO 8601, UTC>
X-Bridge-Nonce: <string única por request — recomendado 128 bits aleatórios, base64url>
X-Bridge-Signature: <base64 da assinatura Ed25519 sobre o canonical_request abaixo>
```

```
canonical_request =
  METHOD + "\n" +
  PATH_WITH_QUERY + "\n" +
  SHA256_HEX(BODY_UTF8_OR_EMPTY) + "\n" +
  X-Bridge-Timestamp + "\n" +
  X-Bridge-Nonce + "\n" +
  X-Bridge-Device-Id
```

- `METHOD` maiúsculo. `PATH_WITH_QUERY` inclui querystring exata enviada
  (ex: `/api/biometric-bridge/challenges/next?reserve_id=...`).
- `BODY_UTF8_OR_EMPTY`: corpo cru (não reserializado) como UTF-8; para
  GET/HEAD, string vazia.
- Assinar com a chave PRIVADA Ed25519 do device (gerada no pareamento, nunca
  sai do PC). O BFF verifica com a chave PÚBLICA registrada.
- Clock skew tolerado: 60s (`BIOMETRIC_BRIDGE_CLOCK_SKEW_SECONDS`, default)
  — o relógio do PC da reserva precisa estar sincronizado (NTP do Windows já
  cobre isso por padrão; não assumir que está desabilitado, mas não
  implementar sincronização própria).
- Nonce é anti-replay real: o BFF insere em `biometric_device_request_nonces`
  com `UNIQUE(device_id, nonce)` — reuso é rejeitado com 401. Gerar um nonce
  NOVO a cada request, nunca reaproveitar.

### 2.2 Pareamento — `POST /api/biometric-bridge/pair` (único endpoint sem device-auth)

**Correção da v1 (achado A5 da revisão) — mudança de contrato necessária no BFF**:
a v1 desta spec descrevia `device_name` como campo que o BRIDGE envia em
`/pair`, espelhando o schema Zod atual (`biometric-bridge.ts`,
`pairSchema`). Mas isso é inconsistente com o resto do fluxo já em
produção: `POST /api/biometric/pairing-codes` (browser-facing, admin-only)
já EXIGE que o admin digite um `device_name` ao gerar o código
(`biometric.ts:611-617`) — e o RPC `consume_biometric_pairing_code`
(`supabase/migrations/20260720180000_...sql:26-111`) carrega esse valor em
`v_code.device_name`, mas **nunca o usa**: a identidade real do device hoje
vem exclusivamente de `p_device_name`, o parâmetro que o BRIDGE envia. O
valor que o admin digita é descartado silenciosamente — confirmado lendo o
corpo da função linha a linha nesta v2.

Isso é uma inconsistência de UX e de dado, não só de spec: um admin que
audita "qual device é esse" pelo nome que ELE escolheu ao gerar o código
está olhando pro valor errado. **Decisão desta v2**: o BFF precisa mudar
para usar `v_code.device_name` (não `p_device_name`) no INSERT/UPDATE do
device — a identidade operacional passa a ser decidida no momento em que o
ADMIN gera o código (mesmo lugar onde ele já escolhe `reserve_id`), não no
momento em que o bridge se pareia. Consequência prática: o campo
`device_name` sai do payload que o bridge envia em `/pair`, e a tela de
pareamento do bridge (seção 6) fica mais simples — só o código, nada mais.
**Esta mudança de contrato do BFF entra no escopo desta fase** (ver DoD,
seção 10) — não é opcional, sem ela a UI de pareamento (seção 6) não tem
como funcionar de forma coerente.

**Achado da 2ª rodada de revisão, endereçado aqui — mecânica exata da
mudança de assinatura do RPC**: `consume_biometric_pairing_code` já
sofreu DOIS hotfixes de produção por ambiguidade de coluna
(`20260720173000` e `20260720180000`) — não é um RPC qualquer pra deixar
detalhe de assinatura "pra implementação decidir". Decisão explícita:
`p_device_name` sai da lista de parâmetros da função — como `CREATE OR
REPLACE FUNCTION` não permite mudar a lista de parâmetros de uma função
existente, a migration precisa de `DROP FUNCTION
public.consume_biometric_pairing_code(text, text, text, text, text, text,
text, text)` seguido de `CREATE FUNCTION` com a nova assinatura (7
parâmetros, sem `p_device_name`) — nunca deixar o parâmetro morto/ignorado
na assinatura antiga, dado o histórico de bugs sutis desta função
específica com ambiguidade de nomes.

```json
// Request (device_name REMOVIDO — vem do pairing_code, não do bridge)
{
  "pairing_code": "APMCB-XXXX-XXXX",
  "public_key": "string, chave pública Ed25519 (PEM), 32-4096 chars",
  "sdk_vendor": "nitgen",           // opcional
  "sdk_version": "string",          // opcional
  "bridge_version": "string",       // opcional
  "machine_name_hash": "string",    // opcional — hash, nunca o nome cru da máquina
  "hardware_serial_hash": "string"  // opcional — hash, nunca o serial cru
}
// 201 Response
{ "device_id": "uuid", "tenant_id": "uuid", "reserve_id": "uuid" }
```

Erros: `404` código não existe, `410` já usado/revogado/expirado, `409`
outro conflito, `503` pareamento indisponível (falha no pepper server-side).

**`device_name` é a identidade operacional, não um identificador de
hardware.** Reusar o nome de um device revogado (ao gerar um novo código de
pareamento com o mesmo nome) REATIVA a mesma linha (mesmo `device_id`,
chave pública nova) — comportamento intencional documentado como risco
residual M3 na spec 1B, não um bug a corrigir aqui. Isso agora é
inteiramente responsabilidade do admin no momento de gerar o código (seção
6) — o bridge não participa dessa decisão.

### 2.3 Heartbeat — `POST /api/biometric-bridge/heartbeat`

```json
{
  "bridge_version": "string, obrigatório",
  "sdk_version": "string ou null",
  "driver_version": "string ou null",
  "device_detected": true,
  "device_model": "string ou null",
  "last_error_code": "string ou null"
}
```

**Achado da spec 1B (seção 8) ainda não resolvido**: `device_detected` e
`device_model` são validados pelo schema Zod do BFF, mas **não persistidos**
(sem coluna, sem consumidor de UI). Esta fase precisa decidir: persistir
agora (migration pequena, 2 colunas em `biometric_devices` + UI mostrando
"leitor conectado/desconectado" em `_biometric-console-client.tsx`) ou
continuar descartando até uma fase futura. **Recomendação desta spec:
persistir agora** — é exatamente o tipo de status operacional que um armeiro
precisa ver sem abrir o Bridge Client localmente (ex: leitor desconectado do
USB, mas processo do bridge ainda rodando e mandando heartbeat). Custo baixo
(migration + 1 badge na UI já existente), valor operacional real.

Frequência recomendada: a cada 30s enquanto o bridge está rodando e pareado
(não precisa ser mais frequente — não é o mecanismo de detecção de
challenge, é status de saúde).

### 2.4 Polling de challenges — `GET /api/biometric-bridge/challenges/next?reserve_id=<reserve_id do device>`

```json
// Sem challenge pendente
{ "challenge": null, "poll_after_ms": 1500 }
// Com challenge
{ "challenge": {
    "id": "uuid", "tenant_id": "uuid", "reserve_id": "uuid",
    "actor_id": "uuid", "purpose": "identify|enroll|confirm_saida_militar|...",
    "expected_user_id": "uuid ou null", "document_type": "string ou null",
    "document_id": "uuid ou null", "document_hash": "string ou null",
    "expires_at": "ISO 8601"
} }
```

- `reserve_id` na query DEVE ser igual ao `reserve_id` do device pareado
  (senão 403) — na prática o bridge sempre manda o próprio, não é um
  parâmetro de escolha real, é validação redundante do servidor.
- **Claim atômico**: o BFF já reivindica o challenge para este device no
  próprio GET (SELECT+UPDATE condicional). Não existe endpoint separado de
  "claim". Um challenge retornado por este endpoint já pertence a este
  device — não pode ser "devolvido" se o bridge decidir não processá-lo (ex:
  usuário cancelou no leitor físico); nesse caso, o fluxo correto é
  submeter uma proof com `result: "failure"` (seção 2.6), não deixar
  expirar silenciosamente, para não travar a UI web esperando.
- Intervalo de poll: usar o `poll_after_ms` retornado (hoje fixo em 1500,
  mas o bridge deve honrar o valor do servidor, não hardcodar, para permitir
  ajuste futuro sem novo release do cliente).
- Purpose `"enroll"` NUNCA deve ser submetido em `/challenges/:id/proof` —
  vai para `/challenges/:id/enrollment` (seção 2.7). O bridge precisa
  ramificar no `purpose` recebido.

### 2.5 Sincronização de templates — `GET /api/biometric-bridge/templates/sync?since=<cursor opaco>`

```json
{
  "templates": [{
    "user_id": "uuid", "finger_index": 1, "template_data": "base64",
    "template_hash": "sha256:...", "format": "string",
    "sdk_version": "string ou null", "quality": 0-100,
    "updated_at": "ISO 8601"
  }],
  "next_cursor": "string opaco ou null"
}
```

- Cursor é opaco (`"<updated_at ISO>|<id>"`) — o bridge NUNCA deve
  reconstruir ou interpretar o cursor, só armazenar o último `next_cursor`
  recebido e reenviar como `since` na próxima sincronização.
- Página fixa em `TEMPLATE_SYNC_PAGE_SIZE` (default 500) — se `next_cursor`
  vier não-nulo, há mais páginas; continuar paginando até `next_cursor: null`
  antes de considerar a sincronização completa.
- **`template_data` é ciphertext opaco** — o BFF nunca decifra. A chave de
  decifragem é responsabilidade do bridge. Ver seção 3 (decisão de design
  nova desta spec — pergunta que a spec 1B deixou explicitamente em aberto).
- Escopo: filtra só por `tenant_id` do device — um bridge recebe templates
  de TODAS as reservas do tenant (1:N tenant-wide é o objetivo de produto).
  Isso já é um risco documentado (M4, spec 1B): um bridge comprometido tem
  acesso ao ciphertext de todo o tenant. Ver seção 3 para como isso afeta o
  desenho da chave.
- Estratégia recomendada: sincronizar em background (não bloquear
  identify/enroll), rodar a cada N minutos (ex: 5) + imediatamente após
  reconectar de uma queda de rede. Persistir localmente (SQLite ou arquivo
  cifrado via DPAPI) para funcionar mesmo com o BFF temporariamente
  inacessível — mas ver seção 3 sobre por que os templates armazenados
  localmente ainda precisam estar cifrados em repouso no disco do bridge.

### 2.6 Submissão de proof (identify/verify) — `POST /api/biometric-bridge/challenges/:id/proof`

```json
{
  "proof": {
    "challenge_id": "uuid", "tenant_id": "uuid", "reserve_id": "uuid",
    "device_id": "uuid", "actor_id": "uuid", "purpose": "string",
    "matched_user_id": "uuid ou null",
    "document_type": "string ou null", "document_id": "uuid ou null",
    "document_hash": "string ou null",
    "match_score": 0.0-1.0, "finger_index": 1-10 ou null,
    "liveness_passed": true|false|null,
    "sdk_version": "string ou null", "bridge_version": "string ou null",
    "timestamp": "ISO 8601"
  },
  "bridge_signature": "base64 — assinatura Ed25519 do proof payload, ver 2.8",
  "result": "success|failure|error",
  "failure_reason": "string ou null"
}
```

- Todos os campos de `proof` (exceto `matched_user_id` quando `result !=
  success`) devem ecoar exatamente os valores do challenge recebido em 2.4
  — o BFF valida cada um (`assertChallengeAcceptsProof`) e rejeita
  divergência.
- `result: "success"` exige `matched_user_id` não-nulo — senão 400.
- Regra de rejeição por liveness (`biometric-bridge.ts:359`, correção da v1
  — achado M1): `liveness_passed === false` rejeita **sempre**,
  incondicionalmente, mesmo com `BIOMETRIC_REQUIRE_LIVENESS=false` — um
  "reprovado" explícito do SDK nunca é ignorado. Separadamente, se
  `BIOMETRIC_REQUIRE_LIVENESS=true` e `liveness_passed !== true` (inclui
  `null`), o BFF também rejeita. Ou seja: com o flag desligado (default),
  `liveness_passed: null` passa, mas `liveness_passed: false` NUNCA passa.
  O bridge deve propagar o resultado real do SDK nos três estados possíveis
  (`true`/`false`/`null`), nunca inventar `true` nem omitir um `false` real
  do SDK só porque o flag está desligado.
- 409 = challenge já consumido ou expirado (idempotência: NÃO reenviar a
  mesma proof em retry automático sem checar isso primeiro).

### 2.7 Submissão de enrollment — `POST /api/biometric-bridge/challenges/:id/enrollment`

```json
{
  "proof": { /* mesmo shape de 2.6, mas challenge.purpose === "enroll" */ },
  "encrypted_template_data": "base64, 4-1000000 chars",
  "template_hash": "sha256:<64 hex chars>",
  "format": "string",
  "quality": 0-100,
  "bridge_signature": "base64"
}
```

- Endpoint SEPARADO de `/proof` — challenges de `purpose="enroll"` DEVEM ir
  aqui; `/proof` rejeita com 409 se o purpose for enroll.
- `template_hash` deve ser `sha256:` + hex minúsculo do HASH DO CIPHERTEXT
  (`encrypted_template_data` decodificado de base64), não do template em
  claro — o BFF recomputa e compara.
- `quality` mínima configurável server-side
  (`BIOMETRIC_ENROLLMENT_MIN_QUALITY`, default 70) — abaixo disso o BFF
  rejeita; o bridge deveria idealmente já impedir a tentativa de submeter
  (feedback imediato pro operador: "qualidade insuficiente, capture de
  novo"), mas a validação de autoridade é sempre do servidor.

**CRÍTICO da v1, corrigido nesta v2 — mudança de contrato do BFF necessária,
não opcional**: `validateBiometricEnrollment`
(`apps/bff/src/lib/biometric-enrollment.ts:164`) hoje rejeita QUALQUER
enrollment cujo `liveness_passed !== true` — incondicionalmente, sem checar
`BIOMETRIC_REQUIRE_LIVENESS` (que só é lido em `biometric-bridge.ts`/
`biometric.ts`, nunca em `biometric-enrollment.ts`). Isso é uma
inconsistência real do código já em produção (herdada da Fase 0/1A.2, não
introduzida por esta fase): a política de liveness para IDENTIFICAÇÃO
(seção 2.6) é best-effort/configurável (consistente com a decisão explícita
da spec mestra, item 12 da checklist), mas a política para CADASTRO hoje é
rígida e incondicional, sem que isso tenha sido uma decisão consciente
documentada em nenhuma spec anterior.

Pesquisa feita nesta v2 (WebSearch): a linha NITGEN tem tecnologia real de
detecção de dedo falso ("fake fingerprint detection"/LFD) em modelos
específicos (ex: Fingkey Hamster III, eNBioAccess-T9), mas isso é uma
característica de HARDWARE/modelo, não garantida em todo leitor NITGEN —
e o modelo exato que será usado nesta implementação ainda não está
confirmado. Se o modelo real não expuser LFD confiável, `liveness_passed`
só pode vir `null` (desconhecido) do SDK — e com a regra atual, **nenhum
enrollment jamais seria aceito**, travando o objetivo central desta fase
inteira, descoberto só no gate de hardware (seção 8.2), o pior momento
possível para achar isso.

**Decisão desta v2**: alinhar `validateBiometricEnrollment` à mesma
política condicional já usada em `/proof` — trocar a linha 164 por uma
checagem equivalente a `biometric-bridge.ts:359`
(`liveness_passed === false` rejeita sempre; `BIOMETRIC_REQUIRE_LIVENESS
&& liveness_passed !== true` rejeita só com o flag ligado). Isso não
enfraquece segurança: é a MESMA política best-effort que a spec mestra já
aceita explicitamente para identificação, agora aplicada de forma
consistente ao cadastro — e continua rejeitando incondicionalmente um
`false` explícito do SDK. **Esta mudança de contrato do BFF entra no
escopo desta fase** (ver DoD, seção 10) — é um pré-requisito para o
enrollment funcionar de ponta a ponta com qualquer leitor cujo suporte a
LFD ainda não esteja confirmado.

**Achado da 2ª rodada de revisão, corrigido aqui — o CRÍTICO tem uma
SEGUNDA camada, na função SQL, que a correção acima sozinha NÃO resolve.**
`validateBiometricEnrollment` (JS) é só metade do caminho: depois de passar
por ela, `recordBiometricEnrollment` chama o RPC `record_biometric_enrollment`
(`supabase/migrations/20260714000004_biometric_enrollment_rpc.sql:51-53`),
que tem seu PRÓPRIO gate, idêntico em rigidez e nunca tocado por nenhuma
migration posterior:

```sql
if p_liveness_passed is distinct from true then
  raise exception 'BIOMETRIC_LIVENESS_REQUIRED' using errcode = 'P0001';
end if;
```

Sem parâmetro nenhum equivalente a `BIOMETRIC_REQUIRE_LIVENESS`. Corrigir só
o lado JS deixaria um enrollment com `liveness_passed: null` passar pela
validação de aplicação e ser rejeitado do mesmo jeito pelo RPC — o CRÍTICO
continua acontecendo, só que numa camada diferente. **Agravante real
encontrado nesta 2ª rodada**: o erro `P0001` do RPC (código genérico
usado por TODAS as exceções da função — `BIOMETRIC_TEMPLATE_EMPTY`,
`BIOMETRIC_DEVICE_NOT_ACTIVE`, etc., além de `BIOMETRIC_LIVENESS_REQUIRED`)
é capturado em `biometric-enrollment.ts:240-242` e convertido, sempre, em
`"biometric enrollment challenge already consumed or expired"` (409) —
uma mensagem ativamente enganosa para o problema real (liveness), que
levaria qualquer investigação de campo pro caminho errado.

**Correção definitiva desta v3 (as DUAS mudanças, não uma — e a mecânica de
migração da 1ª, achado novo da 3ª rodada de revisão)**:
1. `record_biometric_enrollment` (SQL) ganha um parâmetro novo
   `p_require_liveness boolean` (o BFF já lê `BIOMETRIC_REQUIRE_LIVENESS`
   no processo Node, só precisa repassar); o gate vira `if
   p_liveness_passed is false or (p_require_liveness and
   p_liveness_passed is distinct from true) then raise ...` — mesma lógica
   OR já usada em `biometric-bridge.ts:359`, agora espelhada em SQL.
   **Mecânica de migração — mesma receita já usada para
   `consume_biometric_pairing_code` (seção 2.2), aplicada aqui**:
   `CREATE OR REPLACE FUNCTION` NÃO substitui a função in-place quando a
   lista de parâmetros muda — cria uma função nova/distinta (novo OID),
   deixando a assinatura antiga (16 params, gate incondicional) intocada
   no catálogo, com seus `GRANT EXECUTE` originais ainda válidos. A
   migration precisa de `DROP FUNCTION public.record_biometric_enrollment(
   uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer,
   smallint, boolean, text, text, text, text)` (assinatura real
   confirmada em `20260714000004_biometric_enrollment_rpc.sql:6-21` —
   mesmo nível de precisão já usado para `consume_biometric_pairing_code`,
   achado da 4ª rodada de revisão apontando que esta função não tinha
   recebido o mesmo rigor) seguido de `CREATE FUNCTION` com os 17
   parâmetros, e `REVOKE ALL ... FROM PUBLIC` +
   `GRANT EXECUTE ... TO service_role` explícitos para a NOVA assinatura —
   sem isso, na melhor hipótese o BFF falha com "permission denied"; na
   pior, se privilégios default de `public` não estiverem travados, a
   função nova `security definer` (que escreve em `biometric_templates` e
   muda `registration_status`) fica chamável por `anon`/`authenticated`
   via PostgREST, contornando o device-auth inteiro — escalação de
   privilégio real, não hipotética, numa função `security definer`.
2. `biometric-enrollment.ts:240-242` para de colapsar todo `P0001` em
   `BIOMETRIC_ENROLLMENT_CONFLICT` — precisa inspecionar `error.message`
   (que carrega o texto da exceção, ex: `"BIOMETRIC_LIVENESS_REQUIRED"`)
   e mapear pra um `BiometricEnrollmentError` com `code`/`status`
   específicos por caso, em vez de um catch-all. Mesmo padrão que
   `biometric-bridge.ts:90-96` já usa pra diferenciar os erros de `P0001`
   de `consume_biometric_pairing_code` por conteúdo da mensagem — não é
   uma técnica nova neste código-base, só nunca foi aplicada aqui.

**Teste que o DoD (seção 10) precisa exigir explicitamente**: um teste
unitário contra `BiometricEnrollmentDatabase` mockado NÃO detecta esse
bug — o mock não reproduz o gate do RPC real. É obrigatório um teste de
integração contra o RPC real (Supabase de teste/produção, mesmo padrão já
usado pelos testes E2E deste projeto) cobrindo especificamente
`liveness_passed: null` com `BIOMETRIC_REQUIRE_LIVENESS=false` retornando
sucesso — sem isso, a correção pode parecer completa (testes verdes) e
continuar quebrada em produção.

### 2.8 Assinatura da PROOF (distinta da assinatura do request, seção 2.1) — DUAS funções, não uma

**Correção da v1 (achado A1 da revisão)**: a v1 afirmava que `bridge_signature`
em 2.6 E 2.7 assina "o objeto proof canonicalizado", a mesma função/payload
para os dois endpoints. Isso está errado e teria quebrado todo enrollment em
produção (401 `BIOMETRIC_SIGNATURE_INVALID`) se implementado literalmente.
São DUAS funções distintas, confirmado lendo `apps/bff/src/lib/biometric-proof.ts`
e `apps/bff/src/lib/biometric-enrollment.ts` nesta v2:

- **`verifyBridgeSignature`** (usada em `/proof`, seção 2.6,
  `biometric-bridge.ts:353`) — canonicaliza SÓ o objeto `proof` (chaves
  ordenadas).
- **`verifyBiometricEnrollmentSignature`** (usada em `/enrollment`, seção
  2.7, `biometric-enrollment.ts:193`) — canonicaliza um payload MAIOR:
  `{ ...proof, template_hash, format, quality }` — incorpora os metadados
  do template, não assina só o `proof` isolado.

A spec mestra já documenta a distinção conceitual (assinatura do request vs.
assinatura da proof) — o que faltava aqui era reconhecer que a "assinatura
da proof" em si se bifurca em dois payloads diferentes dependendo do
endpoint. Ambas usam a MESMA chave privada Ed25519 do device. A
canonicalização exata (ordem de serialização JSON, encoding) de cada uma
**ainda precisa ser lida linha a linha nos dois arquivos antes da
implementação** — confirmado que são funções distintas, mas a replicação
byte a byte de cada uma é item de implementação, não incógnita de design.

---

## 3. Decisão de design NOVA desta spec — chave de decifragem dos templates

A spec 1B (seção 4.1, risco M4) deixou esta pergunta explicitamente em
aberto: *"a chave de decifragem, e se ela é por-tenant ou por-device, é uma
decisão do lado do bridge... não verificado nesta spec se um bridge
comprometido conseguiria de fato decifrar os templates sincronizados."*
Confirmado nesta sessão (leitura de `apps/bff/src/lib/biometric-enrollment.ts`):
o BFF trata `encrypted_template_data` como ciphertext 100% opaco — decodifica
base64, confere hash, persiste. Nunca decifra. Esta spec precisa resolver
isso, porque sem uma chave definida o bridge não consegue fazer 1:N local
contra nada além do que ele mesmo cadastrou nesta sessão de processo.

### 3.1 Restrição que define a resposta

A Regra Canônica da spec mestra exige 1:N **tenant-wide**: qualquer bridge
ativo de qualquer reserva do tenant precisa conseguir identificar um usuário
cujo template foi cadastrado por OUTRO bridge, em OUTRA reserva. Isso elimina
chave por-device (Bridge A nunca teria a chave de um template cifrado por
Bridge B) — a chave TEM que ser compartilhada por todos os bridges do mesmo
tenant.

### 3.2 Proposta: chave simétrica derivada por tenant, nunca armazenada, entregue via endpoint dedicado device-auth

- **Novo endpoint**: `GET /api/biometric-bridge/tenant-key` (device-auth,
  igual a `/heartbeat`/`/templates/sync` — só device `active` e pareado no
  tenant correto pode chamar).
- **Servidor nunca armazena a chave por-tenant em uma tabela.** Deriva sob
  demanda: `HKDF-SHA256(ikm=BIOMETRIC_TEMPLATE_MASTER_KEY, salt=tenant_id,
  info="apmcb-biometric-template-key-v1")` → chave AES-256-GCM de 32 bytes
  (**valor fixo nesta fase — `v1` sem interpolação**; a forma
  parametrizada `v<encryption_key_version>` só passa a existir de fato
  quando a Fase 3 implementar rotação, ver bullet abaixo). Determinístico:
  qualquer bridge pareado no mesmo tenant, chamando este endpoint em
  qualquer momento, recebe a MESMA chave — sem precisar de uma linha nova
  por tenant no banco. **Nota de estilo**:
  o padrão mais comum do RFC 5869 usa `info` para carregar o identificador
  de contexto e salt fixo/ausente; aqui é o inverso (salt = `tenant_id`,
  info = string fixa versionada) — não é uma vulnerabilidade (HKDF continua
  determinístico e correto nos dois arranjos), só uma nota pra quem for
  implementar não estranhar a inversão.
- **Correção da v1 (achado A4), recuada nesta v2 após a 2ª rodada apontar
  que a v2 anterior não era implementável como descrita**:
  `biometric_templates.encryption_key_version` (smallint, default 1) já
  existe desde a Fase 0 (`20260714000001_biometric_bridge_foundation.sql:127`),
  criada exatamente para isto, mas hoje morta — `record_biometric_enrollment`
  grava sempre o literal `1`. A versão anterior desta v2 propunha "ativar o
  mecanismo" incorporando a versão no `info` do HKDF — mas a 2ª rodada de
  revisão confirmou que isso não é implementável sem mudanças adicionais em
  TRÊS lugares que nenhuma versão desta spec chegou a especificar: (1)
  `/templates/sync` (seção 2.5) não retorna `encryption_key_version` por
  template — o bridge não tem como saber qual versão usar pra decifrar um
  template específico ao sincronizar; (2) o schema de `/enrollment` (seção
  2.7) não tem campo pro bridge informar qual versão usou pra cifrar; (3)
  `/tenant-key` nunca teve seu shape de request/resposta detalhado o
  suficiente pra suportar pedir "a chave da versão N".

  **Decisão final desta v2 (escopo reduzido, honesto)**: esta fase usa
  SEMPRE `encryption_key_version = 1` (comportamento idêntico ao atual,
  zero mudança de schema/RPC necessária pra isso) e o `info` do HKDF fica
  fixo (`"apmcb-biometric-template-key-v1"`, sem interpolação). A coluna
  `encryption_key_version` continua existindo e sendo gravada com `1` —
  não removida, só não EXERCITADA por esta fase. Rotação de chave
  versionada (os 3 pontos de transporte listados acima) fica explicitamente
  para a Fase 3 (seção 9), como já estava — a diferença desta v2 é não
  mais alegar que "o mecanismo fica pronto" quando na prática só a metade
  de escrita existe. Isso é mais simples de implementar agora (nenhuma
  mudança de contrato adicional) e honesto sobre o que falta pra rotação
  de verdade funcionar.
- **Novo env var no BFF**: `BIOMETRIC_TEMPLATE_MASTER_KEY` — mesmo padrão de
  criticidade que `TOTP_ENCRYPTION_KEY` já documentado neste projeto
  (memória `totp_architecture`): **nesta fase (1C), nunca alterar depois
  de usado em produção, ponto final** — sem ressalva de versionamento,
  porque o versionamento completo de `encryption_key_version` fica
  explicitamente adiado pra Fase 3 (ver acima e seção 3.3): rotacionar
  `BIOMETRIC_TEMPLATE_MASTER_KEY` nesta fase quebra a decifragem de TODOS
  os tenants simultaneamente, sem exceção. **Correção da 3ª rodada de
  revisão**: uma versão anterior deste parágrafo dizia que, "com
  `encryption_key_version` ativo", a regra passaria a permitir rotação
  incrementando a versão — isso contradizia a decisão de escopo reduzido
  (acima) e a seção 3.3, e foi removido. **Diferença de custo de
  recuperação vs. `TOTP_ENCRYPTION_KEY`** (mesmo assim vale registrar, pra
  quando a Fase 3 implementar rotação de verdade): rotacionar
  `TOTP_ENCRYPTION_KEY` força reset de TOTP por
  autoatendimento remoto (minutos, sem hardware); rotacionar/versionar a
  master key biométrica força reenrollment PRESENCIAL com leitor físico de
  cada usuário afetado — muito mais caro operacionalmente, mesmo com
  versionamento reduzindo o raio de explosão a um tenant por vez.
- **No bridge**: a chave derivada recebida é cacheada localmente,
  **cifrada em repouso via DPAPI** (mesmo mecanismo já decidido na spec
  mestra para a chave privada Ed25519) — nunca gravada em texto claro no
  disco do PC da reserva. Refresh: re-buscar a cada
  `BIOMETRIC_TENANT_KEY_REFRESH_DAYS` (**correção da v1, achado B1 — env
  var nomeada agora, default 7**) ou quando o cache DPAPI local não
  existir/corromper (reinstalação do bridge) — não precisa re-parear, só
  re-chamar o endpoint (já autenticado via device-auth existente).

  **Achado ALTO da 4ª rodada de revisão, honesto sobre o limite real desta
  proteção**: DPAPI (escopo `CurrentUser`, implícito até aqui) protege
  contra um processo SEM a sessão do usuário logado ler o segredo — mas a
  seção 4 exige auto-login como pré-requisito de instalação, exatamente
  pra manter o bridge disponível após reboot sem intervenção humana. As
  duas decisões, tomadas em seções diferentes ao longo de rodadas
  diferentes desta spec, se cruzam mal: com auto-login ativo, um PC
  roubado — mesmo desligado no momento do roubo — liga direto na sessão
  já autenticada, e qualquer processo ali (inclusive um app malicioso
  instalado depois) chama a mesma API de DPAPI que o bridge usa e recupera
  o segredo sem precisar da senha do Windows nem quebrar criptografia
  nenhuma. Como a chave aqui é a chave TENANT-WIDE de decifragem de
  templates (seção 3.1), isso significa: furto de QUALQUER PC pareado dá
  acesso ao ciphertext (via cache local de `/templates/sync`) + à chave de
  TODO o tenant, sem barreira técnica real — mais grave do que a frase
  "raio de explosão limitado ao que já tinha em cache local" (seção 3.3)
  dá a entender, já que "o que já tinha em cache" tende a ser o tenant
  inteiro (sincronização é tenant-wide, não só da própria reserva).

  **Decisão honesta desta v4, sem fingir que DPAPI resolve isto**: contra
  furto do DISPOSITIVO INTEIRO (disco + sessão auto-logada juntos), DPAPI
  não é uma barreira de confidencialidade real — só protege contra um
  vetor mais estreito (cópia isolada do arquivo/disco, sem a sessão viva
  junto, ex: imagem de disco exfiltrada remotamente). A proteção real
  contra furto físico continua sendo a mesma já documentada em 3.3:
  **revogação imediata do device** (`status != active` derruba todo
  acesso subsequente às rotas device-auth, incluindo re-fetch da chave).
  Consequência que entra nesta fase (não é só nota de rodapé): o runbook
  operacional de "PC/leitor perdido ou roubado" (já referenciado na UI de
  revogação existente, `_biometric-console-client.tsx`) precisa tratar
  isso como INCIDENTE DE SEGURANÇA COM PRAZO, não só "revogar quando
  conveniente" — o texto de confirmação do botão "Revogar leitor" já diz
  "Use se o computador/leitor foi perdido ou roubado", mas o DoD desta
  fase (seção 10) precisa registrar explicitamente que a velocidade dessa
  revogação é o único controle real contra este cenário, para que a
  operação trate furto físico com a urgência que o risco exige.
- **Transporte da CHAVE em si — correção da v1 (achado A3 da revisão)**: a
  v1 tratava "TLS é proteção suficiente" igualmente para `/templates/sync`
  (que retorna ciphertext opaco — interceptação ali vaza dado já inútil sem
  a chave) e para `/tenant-key` (que retorna a CHAVE em texto claro dentro
  do JSON) — são riscos categoricamente diferentes. Uma falha de validação
  de certificado no `HttpClient` do bridge (erro conhecido e comum em .NET:
  `ServerCertificateCustomValidationCallback` desabilitado "pra testar" e
  esquecido) resultaria em exfiltração PERMANENTE e tenant-wide da chave —
  ao contrário do cenário de device roubado (seção 3.3), que fica limitado
  ao que aquele device específico já tinha em cache, a interceptação de
  rede no momento da busca da chave não é contida por revogação de device
  nenhuma. **Mitigação obrigatória desta v2, não opcional**: certificate
  pinning no `HttpClient` do bridge especificamente para o host do BFF
  (viável e barato — é um host fixo e conhecido,
  `api.apmcb.pmpb.online`), aplicado a todo o `HttpClient` do bridge, por
  simplicidade de implementação (não há vantagem em pinning seletivo por
  endpoint).

  **Achado da 2ª rodada de revisão, endereçado aqui — alvo e estratégia de
  rotação do pin, ausentes na versão anterior**: confirmado
  (`infra/nginx/api.apmcb.pmpb.online.conf`) que `api.apmcb.pmpb.online`
  usa certificado Let's Encrypt, que renova automaticamente a cada
  ~60-90 dias. Dado que auto-update do bridge está fora de escopo (seção
  9) e o pareamento é físico por PC de reserva, fixar o pin contra o
  CERTIFICADO FOLHA (leaf, o erro mais comum de certificate pinning)
  quebraria TODOS os bridges em produção simultaneamente a cada renovação
  — recuperação exigiria visita física + reinstalação manual em cada
  reserva, trocando um risco teórico (MITM) por uma certeza operacional
  recorrente, num sistema onde biometria é aditiva (TOTP não quebra, mas
  o sintoma seria "biometria parou em todas as reservas ao mesmo tempo,
  sem causa aparente"). **Decisão desta v2**: fixar contra a CHAVE PÚBLICA
  da CA intermediária do Let's Encrypt (hoje R3/R10/R11, sujeita a mudar
  — verificar qual está ativa no momento da implementação), não o leaf —
  intermediárias trocam com muito menos frequência que certificados folha
  individuais. Ainda assim, uma eventual troca de intermediária (já
  aconteceu antes na história do Let's Encrypt) quebraria o pin — por
  isso o bridge precisa aceitar MÚLTIPLOS pins simultâneos (atual +
  próximo conhecido, mesmo padrão de sobreposição que apps mobile usam
  pra rotação de pin sem forçar update síncrono), e um runbook documentado
  de "como saber que uma rotação de intermediária está chegando" (Let's
  Encrypt anuncia com antecedência) fica registrado como pré-requisito de
  implementação, não deixado para descoberta em produção.

  **Mecânica de implementação em .NET (achado da 3ª rodada de revisão —
  a spec dava nível de detalhe mecânico pro nonce/HKDF mas não pro
  pinning)**: via `HttpClientHandler.ServerCertificateCustomValidationCallback`,
  iterando `X509Chain.ChainElements` pra extrair a SubjectPublicKeyInfo
  (SPKI) de cada certificado da cadeia recebida, comparando o hash SHA-256
  da SPKI contra a lista de pins configurados (padrão RFC 7469) — nunca
  contra o certificado inteiro (thumbprint muda a cada renovação mesmo com
  a MESMA chave pública, se a CA reemitir). Fail-closed explícito: nenhum
  pin da lista bater com nenhum elemento da cadeia = conexão rejeitada,
  nunca um fallback silencioso pra validação padrão do SO.
- **Layout do ciphertext — correção da v1 (achado A2 da revisão), ausente
  na v1**: a v1 detalhava a derivação da chave mas nunca especificava como
  o AEAD é usado — crítico aqui porque a MESMA chave simétrica é
  compartilhada por múltiplos processos bridge independentes, em reservas
  diferentes, sem coordenação entre si ao longo do tempo. Reuso de nonce
  sob a mesma chave em AES-GCM é catastrófico (quebra autenticação, pode
  vazar XOR de plaintexts). Decisão explícita desta v2: nonce de 96 bits
  (12 bytes) gerado por CSPRNG a cada operação de cifragem (nunca reusado,
  nunca derivado de contador — cada bridge gera o seu de forma
  independente; a probabilidade de colisão em 96 bits aleatórios, no
  volume realista de cadastros deste sistema, é desprezível). Layout fixo
  do blob armazenado em `encrypted_template_data` (base64 do conjunto):
  `nonce(12 bytes) || ciphertext || tag(16 bytes)` — convenção estável e
  compartilhada entre TODAS as versões do bridge, já que um template
  cifrado por um bridge precisa ser decifrável por outro bridge diferente,
  possivelmente rodando uma versão diferente do cliente.

### 3.3 Consequência de segurança, documentada explicitamente (não escondida)

Um bridge comprometido/roubado, com a chave em cache local, PODE decifrar
templates de qualquer usuário do tenant sincronizados via `/templates/sync`
— isso é uma extensão direta e honesta do risco M4 já aceito na spec 1B
("um único bridge comprometido tem acesso ao blob de todos os usuários do
tenant"), agora com o mecanismo concreto de como esse acesso se realizaria.
Mitigação: revogação de device (`status != active`) bloqueia TODO acesso
subsequente ao endpoint de chave e a qualquer rota device-auth — o raio de
explosão de um device roubado fica limitado ao que ele já tinha em cache
local no momento do roubo, não a acesso contínuo. Isso NÃO cobre
interceptação de rede no momento da busca da chave (ver mitigação de
certificate pinning acima, 3.2) — são dois vetores de ataque distintos,
com mitigações distintas, e a spec agora documenta ambos explicitamente em
vez de só o primeiro. Runbook operacional (Fase 3, quando o versionamento
completo de `encryption_key_version` — seção 3.2, escopo reduzido nesta v2
— for de fato implementado) deveria recomendar rotação de
`BIOMETRIC_TEMPLATE_MASTER_KEY` escopada por tenant em cenário de
comprometimento confirmado. **Nesta fase (1C), sem o versionamento
completo, uma rotação de master key ainda invalida TODOS os tenants
simultaneamente** — risco residual aceito explicitamente, não escondido,
consistente com a decisão de reduzir escopo em 3.2.

### 3.4 Alternativa considerada e rejeitada

Chave por-tenant gerada aleatoriamente e armazenada numa tabela nova
(`tenant_biometric_keys`), em vez de derivada por HKDF. **Correção da v1
(achado A4 da revisão)**: a v1 rejeitava essa alternativa alegando que ela
"adiciona uma tabela + lógica de rotação que a derivação evita inteiramente"
— mas isso ignorava que `encryption_key_version` já existe na tabela-alvo
sem custo de migration adicional. Reavaliado: em tese, a derivação HKDF
versionada poderia entregar a mesma capacidade de rotação escopada que uma
tabela dedicada entregaria, sem o custo operacional de gerar/fazer backup
de N segredos por tenant — mas como esta v2 reduziu o escopo de
`encryption_key_version` pra Fase 3 (3.2), essa paridade de capacidade
ainda não existe DE FATO nesta fase, só a decisão de qual caminho seguir
quando ela for implementada. Decisão de MANTER a derivação HKDF (sobre a
tabela dedicada) confirmada para quando a Fase 3 chegar — não é uma
decisão que precisa ser revisitada agora, só não deve ser lida como "já
implementada" nesta fase.

---

## 4. Arquitetura do processo — Windows Service vs. app de bandeja (tray)

**Risco aberto, não resolvido nesta spec — resolve com hardware real (seção 8).**

Duas opções, com tradeoffs reais:

| | Windows Service | App de bandeja (tray, sessão do usuário) |
|---|---|---|
| Sobrevive a logoff/sem usuário logado | Sim — reserva pode ficar com Windows ligado sem ninguém logado | Não — precisa de uma sessão interativa ativa |
| Acesso a dispositivo USB/HID | **Risco real, não confirmado**: SDKs de biometria historicamente têm problemas de isolamento de sessão 0 (driver/HID pode exigir contexto de sessão interativa) | Roda na mesma sessão do usuário logado no PC da reserva — sem risco de isolamento de sessão |
| Feedback visual pro armeiro (status do leitor) | Precisa de um componente separado (tray app IPC com o service) | Nativo — ícone de bandeja já é a UI |
| Auto-start | Serviço do Windows, robusto | Entrada de Startup — menos robusto a reinício manual do usuário |
| Referência encontrada (seção 1) | `FingerTechBR/BiometricServiceAPI` roda como Service — mas não confirma sessão 0 especificamente | — |

**Recomendação desta spec**: começar pelo modelo mais simples e menos
arriscado — **app de bandeja rodando na sessão do usuário logado no PC da
reserva**, com entrada de auto-start (Registry Run key ou Startup folder).
Motivo: elimina de saída o risco de isolamento de sessão 0 (maior incógnita
técnica desta fase), e o modelo operacional real (per master spec: "leitor
físico conectado no PC da reserva") já assume que há sempre um operador
usando aquele PC quando a reserva está em atividade — não é um servidor
desatendido 24/7 sem ninguém logado. Reavaliar para Windows Service em fase
posterior SE a operação real exigir funcionamento sem sessão interativa
(ex: pareamento remoto antes de qualquer operador chegar) — não é um
requisito confirmado hoje.

**Correção da v1 (achado M2 da revisão) — a suposição operacional vira
requisito de runbook, não fica implícita**: a tabela acima já reconhece que
"Entrada de Startup" é menos robusta a reinício manual do usuário do que um
Windows Service — a consequência prática é que um reboot de rotina (Windows
Update, queda de energia) SEM auto-login configurado deixa o bridge
silenciosamente offline até alguém logar manualmente no PC. Dois pontos que
esta v2 torna explícitos, corrigindo a v1: (1) **auto-login do usuário
operacional é um requisito de instalação desta fase**, não uma nota de
rodapé — o instalador/runbook de setup do bridge deve configurar isso
(Windows suporta auto-login via registry, `netplwiz` ou
`AutoAdminLogon`/`DefaultUserName`/`DefaultPassword` — decisão de mecanismo
exato adiada para implementação, mas o REQUISITO entra na spec agora);
(2) **o sintoma de falha desta suposição já tem onde aparecer**: o
heartbeat (seção 2.3) e o campo `last_seen_at`/badge de status já existente
em `_biometric-console-client.tsx` são exatamente o mecanismo que torna
"bridge offline por falta de sessão interativa" visível pro admin sem
precisar ir fisicamente até o PC da reserva — não é um risco solto, é um
risco com sintoma observável já conectado à UI existente.

**Achado ALTO da 4ª rodada de revisão — este requisito tem um custo de
segurança real que só apareceu ao cruzar esta seção com a seção 3.2**:
auto-login neutraliza a proteção de confidencialidade que DPAPI dá contra
furto físico do PC inteiro (sessão já autenticada = qualquer segredo
protegido por DPAPI `CurrentUser` fica acessível sem senha) — ver seção
3.2 pro detalhe completo e a decisão de tratar revogação rápida, não
criptografia local, como o controle real contra esse cenário.

---

## 5. Componentes do Bridge Client

```
apps/bridge-windows/                    (novo diretório no monorepo, ou
                                          repositório separado — decisão de
                                          seção 6)
├── BridgeClient.sln
├── BridgeClient/                       (app de bandeja, .NET 8)
│   ├── Program.cs                      (entry point, NotifyIcon)
│   ├── PairingService.cs               (fluxo de pareamento, seção 6)
│   ├── KeyStore.cs                     (DPAPI: chave Ed25519 privada +
│   │                                     chave de template cacheada)
│   ├── DeviceAuthClient.cs             (canonical_request, assinatura,
│   │                                     HttpClient com os 4 headers)
│   ├── ChallengePoller.cs              (loop de polling, honra poll_after_ms)
│   ├── TemplateSyncService.cs          (sync incremental, cursor opaco,
│   │                                     armazenamento local cifrado)
│   ├── HeartbeatService.cs             (a cada 30s)
│   ├── NitgenSdkAdapter.cs             (única classe que referencia
│   │                                     NITGEN.SDK.NBioBSP.dll — isolamento
│   │                                     deliberado, ver seção 7)
│   └── TrayUi.cs                       (ícone verde/vermelho/cinza, menu
│                                         de contexto: pareamento, logs, sair)
└── BridgeClient.Tests/                 (testes unitários — mock do SDK via
                                          interface, sem hardware)
```

**Isolamento do SDK atrás de uma interface** (`INitgenAdapter` ou
equivalente) é a decisão arquitetural mais importante desta seção: todo o
resto do bridge (protocolo, polling, assinatura, sync) é testável SEM
hardware NITGEN — só `NitgenSdkAdapter` precisa do dispositivo físico para
validar de verdade.

**Correção da v1 (achado M3 da revisão) — calibrando a expectativa**: a
frase anterior ("isso é o que torna possível avançar a maior parte da
implementação... antes do gate de hardware") dava a entender que só a
CLASSE CONCRETA `NitgenSdkAdapter` está em risco de mudar com hardware
real. Isso não é preciso: sem nunca ter usado o SDK contra hardware, o
SHAPE da própria interface `INitgenAdapter` é uma hipótese — se o SDK real
exigir, por exemplo, threading STA, um handle de device aberto/fechado por
operação (em vez de uma chamada stateless), ou captura assíncrona via
callback (em vez da chamada bloqueante que esta spec assume implicitamente),
o CONTRATO da interface muda, e código que orquestra contra ela
(`ChallengePoller`, o fluxo de captura) pode precisar de ajuste — não só a
implementação concreta. **A abstração contém o raio de explosão de uma
mudança assim (não é preciso reescrever o protocolo/polling/assinatura),
não o elimina.** Tratar o trabalho pré-hardware como "avançado" no sentido
de "testado e íntegro", não "congelado e imune a retrabalho" quando o
hardware finalmente chegar.

---

## 6. Pareamento — UI que também está fora de escopo desde a Fase 1B

A spec 1B já registrou isso como pendência (seção 8): não existe tela no
painel admin que chame `POST /api/biometric/pairing-codes` e mostre o código
pro operador digitar no bridge. **Esta fase precisa entregar essa UI também**
— sem ela, o MVP do bridge não tem como ser pareado por um admin real sem
usar curl/Postman, o que a própria spec 1B já descartou como aceitável só
para um atalho de desenvolvimento, não como fluxo operacional real.

Fluxo mínimo (**revisado nesta v2 — achado A5**: `device_name` agora é
escolhido pelo admin no passo 2, nunca pelo bridge; ver seção 2.2 para a
mudança de contrato do BFF que isso exige):
1. Admin (`admin_reserva`/`admin_global`) abre `/reserva/biometria`, clica
   "Parear novo leitor" (botão novo, ao lado do já existente "Revogar").
2. Formulário pede `reserve_id` (já era exigido) **e `device_name`** (ex:
   "Leitor — Sala de Armas Central") — este é o nome que vai identificar o
   device permanentemente na UI de devices, auditoria e revogação. Web
   chama `POST /api/biometric/pairing-codes` (já existe, browser-facing,
   admin-only — confirmado na spec 1B) com os dois campos, mostra o código
   gerado (`APMCB-XXXX-XXXX`) com TTL visível (contagem regressiva) e
   instrução "digite este código no APMCB Bridge, no PC da reserva".
3. No bridge (app de bandeja), primeira execução sem device pareado abre uma
   janela mínima: **só** campo de texto pro código + botão "Parear" — sem
   campo de nome, já que o `device_name` vem do código (passo 2). Chama
   `POST /pair` (seção 2.2, payload sem `device_name`), salva `device_id` +
   gera/guarda o par de chaves Ed25519 (DPAPI) no sucesso.
4. Sucesso: ícone de bandeja muda de "não pareado" (cinza) para "pareado,
   aguardando leitor" (amarelo) até o primeiro heartbeat com
   `device_detected: true` confirmar o leitor físico (verde).

---

## 7. Integração com o SDK NITGEN — o que fica registrado agora vs. o que só se resolve com hardware

**Atualização (2026-07-21) — SDK real localizado na máquina de desenvolvimento**
(`C:\Program Files (x86)\NITGEN\eNBSP SDK Professional`), incluindo a DLL
.NET oficial (`SDK\dotNET\NITGEN.SDK.NBioBSP.dll`) e 6 projetos de exemplo
C#/VB.NET reais (`SDK\Samples\dotNET`). Toda a seção abaixo foi verificada
contra a API real via reflection .NET (não só os samples) — substitui
suposições da v1-v5 por fatos confirmados. Isso NÃO substitui o gate de
hardware (seção 8.2 — o SDK responde sem dispositivo físico conectado,
mas com erro, não com dado simulado) — ainda não sabemos como o leitor
físico se comporta de verdade, só como a API se comporta.

**Registrado agora (confirmado via reflection contra a DLL real, não mais suposição)**:
- Usar `NITGEN.SDK.NBioBSP.dll` (binding .NET oficial), nunca a DLL nativa
  C/C++ diretamente.
- Isolar toda chamada ao SDK atrás de `INitgenAdapter` (seção 5).
- API confirmada (`NBioAPI`, namespace `NITGEN.SDK.NBioBSP`): `EnumerateDevice`,
  `OpenDevice`/`CloseDevice`, `Enroll(out HFIR, FIR_PAYLOAD)` (bloqueante —
  aguarda o dedo no leitor internamente, sem callback de progresso
  separado), `Capture(out HFIR)` (captura simples pra 1:1/1:N, mais rápida
  que `Enroll`), `Verify(FIR, out bool, FIR_PAYLOAD)` (1:1 contra um FIR
  específico), `VerifyMatch(FIR capturado, FIR armazenado, out bool,
  FIR_PAYLOAD)` (1:1 offline, sem precisar abrir o device de novo),
  `GetFIRFromHandle(HFIR, out FIR)` (extrai o template binário do handle
  pra serializar/persistir). Todas retornam `uint` (código de erro,
  `NBioAPI.Error.NONE` = sucesso).
- **Achado que muda o desenho do 1:N (identify) — decisão nova desta
  versão**: o SDK expõe uma engine dedicada de busca 1:N
  (`NBioAPI.IndexSearch`, classe `AddFIR`/`IdentifyData`), mas ela exige
  `UInt32 UserID` — um inteiro, não a nossa UUID de `profiles.id` — e
  mantém seu PRÓPRIO índice em memória (persistível em arquivo local via
  `SaveDBToFile`/`LoadDBFromFile`), separado do que o bridge já mantém
  localmente para o sync de templates. Usar essa engine exigiria: (a) uma
  tabela de mapeamento local persistente UUID↔uint mantida pelo bridge;
  (b) sincronizar esse índice separadamente a cada `AddFIR`/revogação
  (`RemoveData`/`RemoveUser`/`ClearDB`), duplicando o problema de
  consistência que `/templates/sync` já resolve pro blob cifrado.
  **Decisão**: NÃO usar `IndexSearch` nesta fase. Identify (1:N) é
  implementado como um loop simples: decifrar os templates sincronizados
  (já em memória, pós-`/templates/sync` + `/tenant-key`), capturar via
  `Capture()`, e chamar `VerifyMatch(capturado, candidato_i, out result,
  null)` pra cada candidato até achar um `result == true` (ou esgotar a
  lista). **Justificativa (KISS/YAGNI, já princípio canônico deste
  projeto)**: elimina toda a complexidade de mapeamento de ID e de manter
  um segundo índice persistente sincronizado; o volume real de usuários
  de uma reserva militar/policial (dezenas a poucas centenas, não
  milhares) torna O(n) `VerifyMatch` adequado em latência — cada chamada
  é rápida (comparação 1:1 local, sem I/O de rede); a engine `IndexSearch`
  só compensaria a complexidade adicional numa escala que este sistema não
  tem. Se a escala real algum dia exigir busca indexada de verdade, isso
  vira uma otimização de fase futura, não um requisito do MVP.
- **Achado que muda `match_score` — decisão nova desta versão**: nenhuma
  das chamadas de matching (`Verify`/`VerifyMatch`/`VerifyMatchEx`/
  `IdentifyData`) expõe um score contínuo — busquei por `Score` em toda a
  DLL via reflection, zero métodos/campos. O modelo de segurança do SDK é
  por THRESHOLD (`SecurityLevel`, inteiro 1-9 — Lowest a Highest, mapeado
  internamente pelo SDK pra uma taxa de falso-aceite/falso-rejeite), não
  por score exposto ao chamador — `Verify`/`VerifyMatch` retornam só
  `bool result`. **Decisão**: o bridge reporta `match_score: 1.0` no
  `proof` payload (seção 2.6) quando `VerifyMatch` retorna `true`, e nunca
  submete proof de sucesso quando retorna `false` (challenge expira sem
  proof, ou submete `result: "failure"` explícito — mesmo padrão já
  usado pelo simulador, `biometric-simulator.ts`). Isso é honesto sobre o
  que o SDK realmente entrega: o "score" de 0.92 (`BIOMETRIC_MIN_SCORE`)
  já é efetivamente substituído pelo threshold `SecurityLevel` configurado
  no `INIT_INFO_0` do SDK (`comboSecurityLevel`/`SetInitInfo`, visto nos
  samples) — a validação de qualidade real acontece DENTRO do SDK antes de
  retornar `true`, não depois via um score que o BFF re-avalia. O BFF
  continua validando `match_score >= BIOMETRIC_MIN_SCORE` (seção 2.6) —
  com o bridge sempre reportando `1.0` em sucesso, essa checagem vira
  sempre-verdadeira na prática, o que é aceitável dado que o SDK já fez o
  gate real internamente; documentado aqui pra não ser lido como bug
  futuro.
- `finger_index` no payload de proof/enrollment segue a mesma convenção já
  usada no restante do sistema (1-10, polegar direito a mindinho esquerdo —
  confirmar contra `biometric-capture-dialog.tsx`/schema atual, não inventar
  uma convenção nova).
- `quality` (0-100): mapeamento direto de `INIT_INFO_0.EnrollImageQuality`/
  o parâmetro de qualidade que o SDK já usa nessa mesma escala 0-100
  (confirmado nos samples — `txtEnrollImageQuality`) — sem conversão
  necessária, ao contrário do que a v5 desta spec supunha sobre "escalas
  próprias do SDK".

**Só se resolve com hardware real conectado (gate explícito, seção 8)**:
- Se o SDK expõe liveness/LFD (liveness detection) de verdade neste modelo
  específico de leitor, ou é só campo `liveness_passed` sempre `null` — a
  spec mestra trata isso como best-effort/risco residual aceito, e a
  correção do CRÍTICO da v1 (seção 2.7) já garante que o BFF aceita
  enrollment mesmo com `liveness_passed: null` (política condicional, igual
  a `/proof`) — então isso não bloqueia mais o objetivo central da fase,
  só continua como confirmação pendente de capability do hardware real.
- Comportamento real do loop `VerifyMatch` (seção 7, decisão desta versão
  — 1:N via O(n), não `IndexSearch`) com uma base de templates de tamanho
  realista da reserva — latência total do loop (soma de N comparações
  1:1), taxa de falso positivo/negativo no `SecurityLevel` configurado.
  Se a latência real se mostrar inaceitável em alguma reserva com base
  grande, `IndexSearch` (seção 7) vira candidato a revisitar — não
  esperado dado o volume típico deste sistema, mas não descartado
  estruturalmente.
- Confirmação de que o modelo de processo escolhido (seção 4, app de
  bandeja) tem acesso estável ao dispositivo USB sem exigir reconexão
  manual após sleep/wake do Windows (comportamento comum de USB HID que só
  se observa em uso real, não em simulação).

---

## 8. Harness de validação

### 8.1 Sem hardware (maior parte da implementação testável assim)

- Unit tests de `DeviceAuthClient` (canonical_request, assinatura,
  verificação round-trip) — comparar byte a byte contra os vetores de teste
  já existentes em `apps/bff/src/__tests__/biometric-device-auth.test.ts`
  (mesmos casos, implementação independente — mesma filosofia que
  `biometric-bridge-phase1b.spec.ts` já usa do lado E2E).
- Unit tests de `ChallengePoller`/`TemplateSyncService`/`HeartbeatService`
  contra um mock HTTP do BFF (`HttpMessageHandler` fake) — cobre poll
  loop, honra de `poll_after_ms`, paginação de cursor, retry em falha de
  rede.
- `INitgenAdapter` mockado — permite testar TODO o fluxo challenge→captura
  simulada→proof assinada→submissão sem hardware algum.
- **E2E real contra o BFF de produção**: reaproveitar o padrão já
  estabelecido em `biometric-bridge-phase1b.spec.ts` (bridge falso Ed25519
  real) — agora com o BRIDGE CLIENT REAL (C#) rodando localmente durante o
  teste, apontando pro adapter mockado do SDK, falando com o BFF de
  produção de verdade. Isso valida o cliente real, não uma reimplementação
  em TypeScript do protocolo.

### 8.2 Só com hardware NITGEN físico (gate explícito, não pulável)

Idêntico à seção "Hardware Real" da spec mestra: bridge lista o device
NITGEN; capture retorna qualidade suficiente; enroll salva template;
identify (loop `VerifyMatch`, seção 7) reconhece o usuário correto entre
candidatos do tenant; dedo errado falha; device revogado para de funcionar
sem reiniciar o bridge. **Sem isso, esta fase não pode ser considerada
"finalizada é entregue"** — mesma regra canônica já aplicada em todas as
fases anteriores deste projeto.

**Se hardware não estiver disponível no momento da implementação**: a
implementação e todos os testes da seção 8.1 podem avançar integralmente;
o fechamento formal da fase (DoD, seção 10) fica bloqueado explicitamente
no item de validação de hardware, não escondido nem contornado.

---

## 9. Fora de escopo desta fase

- 1:N tenant-wide substituindo o `/identify` legado sem escopo (Fase 2).
- Paridade com `handovers.ts` (Fase 2, per spec mestra).
- Lockout dedicado por falhas consecutivas (Fase 3).
- Rotação de chave do bridge / do `BIOMETRIC_TEMPLATE_MASTER_KEY` (Fase 3,
  exceto em resposta a incidente confirmado).
- Auto-update do bridge (instalar nova versão sem reinstalação manual) —
  MVP assume reinstalação manual do instalador quando houver nova versão.
- Suporte a múltiplos leitores NITGEN no mesmo PC/reserva.
- Telemetria/observabilidade avançada do bridge além do heartbeat já
  especificado.
- Windows Service (ver seção 4 — só revisitar se a operação real exigir).

---

## 10. Definition of Done desta fase

**Mudanças de contrato do BFF exigidas por esta v2 (todas rastreadas às
correções das 2 rodadas de revisão sênior)**:
- [ ] **CRÍTICO, duas camadas** (seção 2.7): (a) `validateBiometricEnrollment`
      (JS, `biometric-enrollment.ts:164`) corrigido para checar
      `BIOMETRIC_REQUIRE_LIVENESS` em vez de exigir `liveness_passed ===
      true` incondicionalmente; (b) `record_biometric_enrollment` (SQL,
      `20260714000004_biometric_enrollment_rpc.sql:51-53`) ganha parâmetro
      `p_require_liveness` e a mesma lógica condicional — a correção
      SOMENTE em JS não é suficiente, o RPC tem seu próprio gate
      incondicional independente; (c) `biometric-enrollment.ts:240-242`
      para de colapsar todo erro `P0001` do RPC em
      `BIOMETRIC_ENROLLMENT_CONFLICT` (409) — precisa diferenciar por
      conteúdo de `error.message`, mesmo padrão já usado em
      `biometric-bridge.ts:90-96` para os erros de `consume_biometric_pairing_code`.
      **Teste obrigatório de INTEGRAÇÃO contra o RPC real** (não só mock
      de `BiometricEnrollmentDatabase`) cobrindo `liveness_passed: null` +
      flag desligado retornando sucesso — um teste só contra mock não
      detecta o gate do RPC.
- [ ] `consume_biometric_pairing_code` corrigido para usar
      `v_code.device_name` em vez de `p_device_name` (seção 2.2, achado
      A5) — via `DROP FUNCTION` + `CREATE FUNCTION` com nova assinatura
      (7 parâmetros, sem `p_device_name` — nunca deixar parâmetro morto
      nesta função específica, dado o histórico de 2 hotfixes de
      ambiguidade). `device_name` removido do schema de `/pair`; `POST
      /api/biometric/pairing-codes` (já exige o campo) passa a ser a única
      fonte da identidade do device. **`apps/web/e2e/biometric-bridge-phase1b.spec.ts`
      precisa ser atualizado** (PB02, PB03, PB08 hoje enviam `device_name`
      no corpo de `/pair` — Zod ignora campo desconhecido por padrão,
      então os testes continuam passando tecnicamente, mas nenhum deles
      exercitaria o novo contrato sem remoção explícita do campo do
      payload de teste).
- [ ] `encryption_key_version` **permanece sempre `1` nesta fase** (seção
      3.2, escopo reduzido após a 2ª rodada de revisão apontar que o
      versionamento completo exigiria mudanças não especificadas em
      `/templates/sync`, `/enrollment` e `/tenant-key`) — sem mudança de
      RPC/schema para isto nesta fase. Rotação de verdade fica para a
      Fase 3.
- [ ] **Runbook de revogação urgente documentado e publicado** (seção 3.2/4,
      achado ALTO da 4ª rodada de revisão) — dado que auto-login neutraliza
      a proteção de DPAPI contra furto do PC inteiro, revogação do device
      (`status != active`) é o ÚNICO controle real contra esse cenário.
      Runbook precisa tratar "PC/leitor perdido ou roubado" como incidente
      com prazo (ex: revogar em minutos, não em horas), não uma ação
      opcional disponível na UI — mesmo botão já existente
      (`_biometric-console-client.tsx`), tratamento operacional novo.

**Bridge Client + infraestrutura nova**:
- [ ] Bridge Client (C#/.NET 8, app de bandeja) implementa o protocolo
      completo da seção 2, com testes unitários equivalentes aos já
      existentes do lado BFF (seção 8.1).
- [ ] Biblioteca de assinatura Ed25519 confirmada em teste real no Windows
      alvo — `NSec.Cryptography` como escolha principal (seção 1, achado
      A6), `BouncyCastle` como fallback documentado se houver problema de
      compatibilidade do binário nativo do libsodium.
- [ ] Endpoint novo `GET /api/biometric-bridge/tenant-key` implementado no
      BFF (seção 3.2), com `BIOMETRIC_TEMPLATE_MASTER_KEY` documentado no
      `.env.example` com o mesmo aviso de criticidade de
      `TOTP_ENCRYPTION_KEY`, e **certificate pinning contra a chave pública
      da CA intermediária do Let's Encrypt** (não o leaf — seção 3.2,
      achados A3 + achado novo da 2ª rodada), com suporte a múltiplos pins
      simultâneos (atual + próximo conhecido) e runbook de rotação
      documentado, implementado no `HttpClient` do bridge antes de
      qualquer chamada a este endpoint em produção.
- [ ] Layout `nonce(12) || ciphertext || tag(16)` (seção 3.2, achado A2)
      implementado consistentemente entre cifragem (enrollment) e
      decifragem local (loop `VerifyMatch`, seção 7) — com teste unitário
      round-trip.
- [ ] Migration para persistir `device_detected`/`device_model` (seção 2.3)
      + badge de status na UI existente de `_biometric-console-client.tsx`.
- [ ] UI de pareamento (seção 6) implementada em `/reserva/biometria`
      (campos `reserve_id` + `device_name`) + tela mínima de pareamento no
      bridge (só o código, sem campo de nome).
- [ ] `INitgenAdapter` isolando 100% das chamadas ao SDK (seção 5/7) — ver
      seção 5 sobre o limite real dessa proteção (a interface em si é
      hipótese até validar contra hardware).
- [ ] Harness sem hardware (8.1) verde, incluindo E2E do bridge real contra
      BFF de produção.
- [ ] Code review sênior sem CRÍTICO/ALTO pendente (regra CLAUDE.md) —
      superfície nova: `apps/bff` (endpoint de chave, RPC de pareamento
      corrigido, gate de liveness do enrollment corrigido), migration, UI
      de pareamento web, e revisão de arquitetura do C# (padrões de
      segurança .NET: DPAPI usado corretamente, certificate pinning
      efetivo, sem chave em texto claro em memória gerenciada por mais
      tempo que o necessário, sem log de PII biométrica, nonce do AES-GCM
      nunca reusado).
- [ ] **Validação em hardware real (seção 8.2)** — bloqueador explícito,
      não contornável, mesma regra de todas as fases anteriores. Inclui
      confirmar se o modelo de leitor alvo expõe LFD real (afeta só
      `liveness_passed`, não bloqueia mais o enrollment em si — ver
      correção do CRÍTICO acima).
- [ ] CHANGELOG.md atualizado.
- [ ] Commit e push isolados desta fase.

**Finalizado não é entregue**: mesmo com todo o resto verde, sem a
validação de hardware real (8.2) nenhum armeiro consegue usar biometria de
verdade — esta fase só fecha o ciclo completo quando alguém com o leitor
físico na mão confirma que o fluxo ponta-a-ponta funciona.
