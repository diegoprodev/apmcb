# PWA — Experiência de Abertura Nativa (Splash + Ícones)

**Data:** 2026-07-17
**Status:** Aprovado para implementação — 4 rodadas de revisão sênior (7.0 → 8.0 → 9.2 → 9.6/10, nenhum CRÍTICO/ALTO/MÉDIO sobrevivente na 4ª rodada)
**Owner:** engenharia (tratado como iniciativa de produto, não só bugfix)
**Contexto:** Sequência do incidente de PWA desta sessão (logout automático + FOUC de tema, ambos já resolvidos e confirmados pelo usuário em produção). Restam dois sintomas de UX na abertura do app. O usuário pediu explicitamente: pesquisar como apps nativos (Play Store/App Store) resolvem isso, planejar com rigor de produto, submeter a spec a revisão, não aceitar nada abaixo de 9.5/10 de qualidade — e garantir que a solução seja **global**: todos os tamanhos de tela responsivos, todas as marcas Android.

**Histórico de revisão desta spec:**
- **v2** → **7.0/10** (2 CRÍTICOs, 2 ALTOs, 2 MÉDIOs): usava `loading.tsx`/Suspense (descartado — ver seção 3), prometia Lighthouse PWA score como métrica, ignorava o Service Worker, harness raso, ferramenta de geração descrita incorretamente, exposição de dado no resume subestimada.
- **v3/v4** corrigiram os 6 itens e ampliaram para cobertura global — mas uma **segunda rodada de revisão** (mesmo revisor, verificação contra fontes primárias: changelog do Lighthouse, código-fonte da ferramenta, WebKit bugs, registry do Playwright, resoluções reais de device) encontrou **8.0/10**, com 3 ALTOs sobreviventes: (A1) o harness E2E não consegue validar o comportamento real do WebKit — só confirma que a tag existe com o `media` que a própria geração produziu (checagem circular); (A2) o overlay de mascaramento no resume tem uma lacuna de timing real e documentada (WebKit congela o snapshot ao entrar em background antes de garantir repaint — [WebKit bug 202399](https://bugs.webkit.org/show_bug.cgi?id=202399)); (A3) a matriz de devices estava ancorada em modelos de 2023 e **não cobria a classe de resolução 440×956 do iPhone 16/17 Pro Max** — o modelo mais provável do device real do usuário — o que significa que o harness "global" podia passar verde exatamente no caso que mais importa.
- **v5** corrigiu os 3 ALTOs + 2 dos 3 MÉDIOs residuais — uma **terceira rodada de revisão** (mesmo revisor, re-verificação contra o código-fonte real da ferramenta e o registry publicado do Playwright) confirmou os 3 ALTOs genuinamente resolvidos (nenhum CRÍTICO/ALTO sobrevivente) e deu **9.2/10**, apontando 1 MÉDIO residual (reintrodução de um parâmetro fictício `sizes` como entrada da API — só `devices: AppleDeviceName[]` existe de verdade) + 4 BAIXOs de precisão (linguagem "brand-agnostic" desalinhada entre seções, `StaleWhileRevalidate` tratado como equivalente a `NetworkFirst` quando não é, viewport real do Playwright pro iPhone 16 Pro Max é 440×763 não 440×956, direção padrão do overlay de mascaramento ambígua).
- **v6** (esta versão) corrige o MÉDIO residual e os 4 BAIXOs.

---

## 1. Problema (voz do usuário + evidência técnica)

> "tela preta permanece assim que abre app [...] não aparece carregando, aguarde, spinner mensagem amigável [...] isso não é amigável. toda experiência do user nesse pwa, deve ser de um app nativo da playstore e app store."

Dois sintomas distintos:

### 1.1 Tela preta no cold-open (sintoma principal)

**Já mitigado parcialmente nesta sessão**: o middleware ganhou um fast-path que elimina o round-trip Supabase quando não há cookie de sessão (~5s → ~10-50ms). O usuário confirma que a tela preta **ainda aparece no instante de tocar o ícone**, antes de qualquer request HTTP — isso é sobre o que o SO mostra enquanto o processo do WebView inicializa, não sobre latência de rede.

**Auditoria do estado atual:**

| Mecanismo nativo esperado | Estado hoje | Efeito |
|---|---|---|
| Splash automática do Android (gerada do manifest) | `manifest.webmanifest` declara ícones 192×192/512×512 apontando pro mesmo `public/images/logo.png` — na real **4723×6583px, retangular, ~1.3MB**, color type RGBA (com alpha) | Splash degradada/ausente no Android; latência real de download+decode |
| `apple-touch-startup-image` (splash do iOS) | **Não existe** (zero ocorrências no código) | Causa direta do sintoma no iPhone — **mas só quando a `media` da imagem casa exatamente com o device**; ver Causa Raiz Completa abaixo |
| `apple-touch-icon` | **Não existe** | Ícone da tela inicial pode não corresponder à marca |
| `appleWebApp` capable meta | Adicionado nesta sessão (commit `7324d81`) | Pré-requisito já cumprido |

**Causa raiz completa (corrigida na v3 — a v2 estava incompleta aqui):** não basta *existir* uma imagem de `apple-touch-startup-image` — o WebKit só a exibe se a `media` (query CSS combinando `device-width`, `device-height`, `-webkit-device-pixel-ratio` e `orientation`) casar **exatamente** com o device físico. Um asset genérico ou uma cobertura de device desatualizada produz o mesmo sintoma de hoje (tela em branco/preta) mesmo com arquivos presentes. Isso muda a definição de "pronto": não é "gerar uma splash", é "gerar splash para **toda a matriz atual de devices** — não só o iPhone Pro Max/Plus do usuário — porque qualquer militar cadastrado pode abrir o PWA num iPhone de outro tamanho (mini, padrão, Pro, Pro Max) ou num iPad.

**Ampliação de escopo (v4, pedido explícito do usuário — "global em todos tamanhos de telas responsivas, inclusive Android todas marcas"):**

- **iOS**: gerar splash para **toda a cobertura corrente** de modelos de iPhone/iPad (não uma lista pinçada a dedo, e não travada na geração de 2023 — ver pré-requisito bloqueante de confirmar o modelo exato do usuário antes de gerar, seção 3.1, correção do ALTO A3 da 2ª rodada de revisão). O device do usuário é o que **valida de verdade** (único hardware disponível para teste), mas a geração e o harness (seção 4) visam a matriz inteira.
- **Android**: o mecanismo de splash automática (manifest `name`+`background_color`+ícone ≥512×512, com `display: "standalone"` — já presente no manifest atual, confirmar que permanece após a edição da seção 3.3) é implementado pela **engine Chromium/Blink**, não por fabricante — funciona de forma consistente em qualquer Android instalando via Chrome ou browsers baseados em Chromium (cobre a esmagadora maioria do parque no Brasil: Chrome, Samsung Internet). **Correção de precisão (v5 — LOW L1 da 2ª rodada de revisão):** a variável real é o **engine do browser**, não a **marca** do aparelho — "brand-agnostic" da v4 conflacionava os dois. Mais preciso: *engine-agnostic para Chromium*. Ressalva real (não genérica): alguns browsers OEM pré-instalados em aparelhos populares no mercado brasileiro (ex: Mi Browser em alguns Xiaomi) não são Chromium puro e podem ter comportamento de instalação de PWA diferente — fora do controle deste projeto (não é lacuna do fix, é limite da plataforma de terceiros), mas vale registrar como conhecido em vez de simplesmente "raro".

Fontes: [web.dev — PWA enhancements](https://web.dev/learn/pwa/enhancements), [Apple Developer Forums — iOS web app splash screens](https://developer.apple.com/forums/thread/733490), [Progressier — PWA icons & iOS splash generator](https://progressier.com/pwa-icons-and-ios-splash-screen-generator).

### 1.2 Flash do painel do usuário anterior (sintoma secundário, relatado 1x) — **reclassificado como security-adjacent, não cosmético**

> "mesmo eu fazendo logout abre o painel do user 000003, ai fui deslogado, fiz o relogin, não fui mais deslogado"

**Diagnóstico**: consistente com o iOS **suspendendo** (não encerrando) o PWA em background e restaurando instantaneamente o último frame renderizado ao reabrir. O `AuthListener` (`apps/web/src/components/providers.tsx`) escuta `SIGNED_OUT` e força redirect quando a revalidação em background encontra sessão inválida.

**Correção do diagnóstico da v2:** a v2 tratou isto como "cosmético" e propôs só suavizar a transição do redirect — mas isso acontece **depois** de o frame do usuário anterior já ter sido exibido. Num sistema com histórico real de incidente de vazamento de sessão entre usuários (motivo de existir o guard fail-closed), mostrar — mesmo por um frame, mesmo brevemente — o dashboard de outro militar no resume é **exposição de dado**, não estética. Tratado nesta v3 na seção 3.4 com o nível de seriedade correto.

---

## 2. Objetivo e critérios de sucesso

**Objetivo de produto**: a abertura do PWA deve ser indistinguível, em percepção de qualidade, de abrir um app instalado via loja — sem tela em branco sem explicação, com marca visível desde o primeiro frame, sem expor dado de sessão anterior no resume.

**Correção da v2**: o critério "Lighthouse PWA score ≥ 0.90" foi **removido** — a categoria `pwa` foi **descontinuada no Lighthouse 12 (abril/2024)**; o comando `--only-categories=pwa` não produz mais esse score. Além disso, mesmo quando existia, Lighthouse nunca testou `apple-touch-startup-image` (é um mecanismo exclusivo do WebKit/iOS, fora do que Lighthouse audita) — não mediria o problema real do usuário de qualquer forma.

**Critérios de sucesso substituídos por evidência device-ancorada:**

| Critério | Como verificar | Evidência |
|---|---|---|
| Manifest instalável (ícones corretos, tamanhos batendo) — vale para qualquer Android com browser Chromium (Chrome, Samsung Internet — engine-agnostic, não brand-agnostic; ver seção 1.1) | Chrome DevTools → Application → Manifest (painel de installability continua existindo fora do conceito de "categoria" do Lighthouse) | Screenshot do painel, sem warnings |
| Splash do iOS cobre **toda a matriz corrente de devices** (mini/padrão/Pro/Pro Max/iPad), não só o do usuário | Playwright com emulação de **múltiplos perfis** (`devices["iPhone SE"]`, `devices["iPhone 16"]`, `devices["iPhone 16 Pro Max"]`, `devices["iPad Pro 11"]` — ver seção 4.2) confirmando que existe, para CADA perfil, um `<link apple-touch-startup-image>` cujo `media` é idêntico ao emitido pela ferramenta de geração para aquele device (checagem de regressão geração↔metadata, não validação de comportamento WebKit — ver seção 4.2) | Assert automatizado no harness (seção 4), 1 caso por perfil de device |
| Splash renderiza de fato no único device real disponível (iPhone Pro Max/Plus do usuário) | Screenshot enviado pelo usuário do momento exato de abrir o ícone | Artefato visual, não "sim/não" verbal — é a evidência de validação real, a matriz Playwright é a evidência de cobertura ampla |
| Zero regressão em auth/guard de segurança | Suíte E2E completa do CI/CD (já existente) | CI verde |

**Critérios de aceite (validação humana, iPhone do usuário, sem reinstalar o ícone):**

1. Tocar o ícone → fundo `#F5F5F7` com o brasão da APMCB centralizado aparece **imediatamente**, sem frame preto perceptível.
2. Ícone na tela inicial mostra o brasão corretamente enquadrado.
3. FOUC de tema continua ausente (não regressão).
4. No resume a partir de background, nenhum dado do painel do usuário anterior é visível antes da revalidação de sessão completar (ver 3.4).
5. Nenhuma mudança de comportamento em login/logout/guard de segurança.

---

## 3. Escopo e abordagem técnica

**Restrição inegociável** (confirmada pela revisão contra o código real de `(dashboard)/layout.tsx`): zero mudança em `middleware.ts`, `(dashboard)/layout.tsx` ou qualquer `redirect()` de Server Component. A tentativa v1 (`loading.tsx`/Suspense) foi revertida porque converteria o `redirect()` fail-closed do guard `session-mismatch` em algo dependente de JS. Este plano continua **inteiramente client/asset-level**.

### 3.1 Geração de assets — corrigido na v3 (a v2 prometia um pipeline que a ferramenta não entrega)

**Erro da v2**: descrevia `@vite-pwa/assets-generator` como zero-config, gerando splash + emitindo diretamente `{url, media}[]`. **Isso está errado**: o CLI zero-config não inclui splash screens do Apple nos presets padrão; splash exige um arquivo `pwa-assets.config.ts` explícito com bloco `appleSplashScreens` (via `createAppleSplashScreens`); a saída são **tags `<link>` HTML**, não um array JS pronto. A tabela de risco da v2 também errava a tecnologia (dizia Puppeteer; a ferramenta é baseada em `sharp`).

**Erro adicional encontrado na 2ª rodada de revisão (v4→v5)**: o fallback `createAppleSplashScreens({ ..., iPhoneBaseSizes: [...] })` citado na v4 **não existe** na API real da ferramenta — confirmado contra o código-fonte (`src/splash.ts`). O único parâmetro real para adicionar/sobrescrever devices é o 2º argumento posicional, `devices: AppleDeviceName[]` (`sizes` é campo de **saída** do objeto retornado pela função, derivado internamente de `devices` — nunca um parâmetro de entrada; ver comentário do config abaixo). Corrigido abaixo. A assinatura do callback `name` também estava errada (3º parâmetro é `dark?: boolean`, não `index`).

**Pré-requisito bloqueante — RESOLVIDO:** modelo confirmado pelo usuário = **iPhone 13 Pro Max** (classe de resolução lógica 428×926pt, DPR 3 — mesma classe do iPhone 12 Pro Max / 14 Plus, bem coberta por qualquer versão razoavelmente atual da ferramenta, ao contrário da preocupação original com a classe 440×956 do 16/17 Pro Max). `devices: AppleDeviceName[]` deve incluir o nome exato correspondente a essa classe no registry da ferramenta (confirmar durante a geração — nomenclatura pode ser "iPhone 13 Pro Max" ou agrupada).

**Pipeline corrigido:**

1. `pnpm dlx @vite-pwa/assets-generator@<versão pinada>` — **não** roda zero-config; requer `apps/web/pwa-assets.config.ts`:
   ```ts
   import { defineConfig, minimal2023Preset, createAppleSplashScreens } from "@vite-pwa/assets-generator/config";

   export default defineConfig({
     preset: {
       ...minimal2023Preset,
       appleSplashScreens: createAppleSplashScreens(
         {
           padding: 0.3,
           resizeOptions: { background: "#F5F5F7", fit: "contain" },
           linkMediaOptions: { log: true, addMediaScreen: true, basePath: "/images/pwa/" },
           png: { compressionLevel: 9, quality: 80 },
           name: (landscape, size, dark) => `splash-${landscape ? "landscape" : "portrait"}-${size.width}x${size.height}${dark ? "-dark" : ""}.png`,
         },
         // 2º argumento: único override de entrada real da API é
         // `devices: AppleDeviceName[]` (confirmado contra o código-fonte
         // da ferramenta, src/splash.ts — NÃO existe parâmetro `sizes` de
         // entrada nem `iPhoneBaseSizes`; `sizes` é campo de SAÍDA,
         // derivado internamente de `devices`). Lista explícita de nomes
         // de device — inclui o modelo confirmado do usuário (ex:
         // "iPhone 16 Pro Max", já presente em AllAppleDeviceNames na
         // versão pinada). Não usar a lista default sem antes confirmar
         // que ela cobre o modelo exato (ver pré-requisito acima).
         undefined /* substituir por AppleDeviceName[] confirmados na execução, ex: ["iPhone SE", "iPhone 16", "iPhone 16 Pro Max", "iPad Pro 11"] */
       ),
     },
     images: ["public/images/logo.png"],
   });
   ```
2. **Pinar a versão** da ferramenta no comando — a cobertura de devices é um snapshot da data de release; sem pin, uma versão futura pode mudar a lista sem aviso. **Escolher uma versão cujo release date seja posterior ao lançamento do modelo confirmado do usuário** (checar changelog/registry da ferramenta antes de pinar).
3. A ferramenta emite as tags `<link rel="apple-touch-startup-image" media="..." href="...">` no console. **Passo manual explícito**: transformar essas tags no array `{url, media}[]` que `metadata.appleWebApp.startupImage` do Next.js espera (formato do Next confirmado correto e estável desde 13.2 — isso a v2 acertou) — **copiar o `media` gerado literalmente**, nunca reescrever à mão (ver seção 4.2, correção do ALTO A1: reescrever à mão criaria uma segunda fonte de verdade que pode divergir da imagem real).
4. Confirmar visualmente (Read/screenshot de cada PNG) + confirmar textualmente que a lista de `media` gerada inclui uma entrada cujo `device-width`/`device-height`/`-webkit-device-pixel-ratio` bate com o modelo exato confirmado no pré-requisito.

Fonte: `public/images/logo.png` (brasão oficial, 4723×6583 — resolução suficiente).

**Decisão de design — canvas, não corte**: brasão inteiro, sem corte, centralizado sobre canvas quadrado `#F5F5F7` (mesma cor do `background_color` do manifest e da tela de login).

Assets gerados (`apps/web/public/images/pwa/`):

| Asset | Tamanho | Purpose | Padding |
|---|---|---|---|
| `icon-192.png` / `icon-512.png` | 192×192 / 512×512 | `any` | ~10% |
| `icon-maskable-192.png` / `icon-maskable-512.png` | 192×192 / 512×512 | `maskable` | conteúdo dentro do **safe-zone circular de 80% de diâmetro** (spec W3C de maskable icons — correção da v2, que citava 66% incorretamente) |
| `apple-touch-icon.png` | 180×180 | — | ~10%, **fundo opaco obrigatório** (confirmado: `logo.png` tem alpha/color type RGBA — sem achatar, iOS pode renderizar preto) |
| `splash-*.png` | **Matriz completa** do preset — todos os tamanhos lógicos de iPhone/iPad correntes, portrait+landscape, `@2x`/`@3x` — com cobertura do perfil Pro Max/Plus confirmada explicitamente | — | brasão centralizado, `#F5F5F7` |

**Dark splash**: mantida a decisão da v2 de **não gerar variante dark para v1** — a tela de login é sempre clara por design (decisão já validada nesta sessão), e uma splash escura recriaria o mesmo tipo de flash que acabou de ser corrigido. A revisão confirmou que essa decisão está bem fundamentada; o problema real de exposição no resume é outro (seção 3.4), não a cor da splash.

### 3.2 Service Worker e precache — **seção nova na v3** (ausente na v2, apontada como CRÍTICO pela revisão)

O projeto tem um Service Worker ativo (Serwist: `sw.ts`, `public/sw.js` buildado, `precacheEntries: self.__SW_MANIFEST`). O comentário existente em `ServiceWorkerUpdater` (`providers.tsx`) já documenta que **iOS em modo PWA pode rodar semanas com um SW desatualizado** e que o único fix determinístico conhecido hoje é reinstalar o ícone. Isso é um risco direto para este plano: `manifest.webmanifest` e os novos PNGs em `public/images/pwa/` são exatamente o tipo de asset que o precache do Serwist tende a capturar — se capturar, o PWA já instalado do usuário pode continuar servindo o **manifest antigo** (sem os ícones corretos) mesmo após o deploy, até um cold-start online forçar a atualização do SW.

**Ações desta spec (v5 — adiciona mitigação determinística, correção do MÉDIO M1 da 2ª rodada de revisão):**
1. Depois do build (`pnpm build --webpack`), inspecionar o `public/sw.js` gerado e confirmar empiricamente se `manifest.webmanifest` e os novos PNGs entram no `__SW_MANIFEST` precacheado.
2. **Se entrarem — fix determinístico, não só aviso**: excluir `manifest.webmanifest` do precache estático e servi-lo via `runtimeCaching` com estratégia **`NetworkFirst`** (não `StaleWhileRevalidate` — SWR ainda serviria a versão antiga no primeiro resume pós-deploy antes de revalidar em background, não é determinístico para este objetivo; `NetworkFirst` busca da rede primeiro, só cai pro cache em falha de rede) em `sw.ts`, mesmo padrão já usado para as navegações same-origin (`NetworkOnly` hoje) — isso garante que o manifest sempre reflete a versão mais recente do servidor sem depender do timing de `registration.update()`/`skipWaiting`, eliminando a fonte do risco em vez de só comunicá-lo.
3. Ainda assim, documentar que o usuário precisa de **pelo menos um cold-start com rede** após o deploy — não pela stale-ness do manifest (resolvida pelo item 2), mas porque o **próprio JS/HTML do app** (que injeta a `<link apple-touch-startup-image>` via Metadata API) pode continuar vindo do precache até o SW atualizar.
4. Comunicar isso ao usuário **antes** de pedir o teste final, para não gerar um novo falso-alarme como já aconteceu nesta sessão.

### 3.3 `manifest.webmanifest`

Substituir as 2 entradas atuais (`logo.png` bruto, duplicado) por `icon-192`/`icon-512` (`any`) + `icon-maskable-192`/`icon-maskable-512` (`maskable`).

### 3.4 `apps/web/src/app/layout.tsx` — Metadata API

```ts
icons: {
  apple: "/images/pwa/apple-touch-icon.png",
},
appleWebApp: {
  capable: true,
  statusBarStyle: "default",
  title: "APMCB",
  startupImage: [ /* {url, media}[] — transformado das <link> geradas, ver 3.1 passo 3 */ ],
},
```

### 3.5 Mascarar conteúdo no resume — **redesenhado na v5** (v2: "polish cosmético"; v3/v4: overlay reativo insuficiente; correção do ALTO A2 da 2ª rodada de revisão)

**Problema, camada 1 (corrigida na v3):** o fade de opacidade da v2 rodava dentro do handler de `SIGNED_OUT` — depois que o frame do usuário anterior já tinha sido exposto no resume. Não resolvia a exposição, só embelezava o redirect seguinte.

**Problema, camada 2 (encontrada na 2ª rodada de revisão — não estava resolvida na v3/v4):** mesmo um listener de `visibilitychange`/`pagehide` que aplica o overlay "imediatamente" não tem garantia de rodar **antes** do iOS congelar o snapshot que será restaurado no resume — o WebKit captura esse snapshot ao entrar em background, e páginas ocultas têm rendering despriorizado, sem garantia de repaint pós-mudança de estado ([WebKit bug 202399](https://bugs.webkit.org/show_bug.cgi?id=202399) documenta `visibilitychange` como não-confiável em standalone web apps no iOS). Afirmar "sem nunca expor o frame anterior" seria overclaim sobre uma propriedade de segurança que a plataforma não garante.

**Fix honesto (defesa em profundidade, sem prometer garantia que o iOS não dá):**

1. O overlay (`#F5F5F7` + logo, mesmo visual da splash) **não é montado reativamente dentro do handler de evento** — fica **sempre presente na árvore** como elemento controlado por estado React (`useState`), para que, quando o estado mudar, o React já tenha commitado a mudança de classe/estilo o mais cedo possível no ciclo, em vez de depender de um efeito colateral disparado só na hora do evento.
2. **Direção padrão explícita (evita a ambiguidade "quando oculto/quando visível")**: o padrão é mascarar-por-default-no-resume, revelar-só-após-revalidação — ou seja, o estado nasce **oculto** (overlay visível) sempre que o app não está confirmadamente em foreground com sessão já revalidada; o overlay só é removido depois que `onAuthStateChange` (já existente) confirma sessão válida. Isso cobre também o caso em que o app nunca disparou `visibilitychange` de saída (ex: processo encerrado pelo SO em vez de suspenso) — no próximo boot, o overlay já nasce visível por padrão, não depende de ter capturado o evento de saída.
3. O toggle para "oculto" (saindo de foreground) acontece em **múltiplos gatilhos redundantes** (`visibilitychange`, `pagehide`, `blur` da window) — nenhum garante 100%, mas juntos reduzem a janela de exposição em relação a depender de um único evento.
4. **Critério de aceite explícito, não garantia de design**: o overlay é tratado como mitigação best-effort. Validar no device real do usuário (mesmo iPhone da seção 4.4) se o frame congelado no resume já reflete o overlay ou ainda mostra o dashboard anterior por um instante — **isso é um critério de aceite de segurança**, testado em hardware, não "resolvido por design" no papel.
5. Se a validação em hardware mostrar que o frame anterior ainda aparece por um instante (cenário plausível dado o bug do WebKit citado), a mitigação subsequente correta é **reduzir a permanência de dado sensível na tela por padrão** (ex: nenhuma mudança nesta spec — registrado como possível follow-up: ofuscar dados sensíveis do dashboard, não o app inteiro, se a validação confirmar que o overlay não é suficiente).

Isso continua sendo client-side puro, **não toca em nenhum Server Component, redirect() ou middleware** — respeita a restrição inegociável da seção 3. Reclassificado como "mitigação best-effort de exposição de dado em sessão suspensa, validada em hardware" — não como controle garantido.

### 3.6 Limpeza da instrumentação temporária — **escopo explicitado na v3** (correção do MÉDIO 6)

Remover, **estritamente estes 3 itens** (todos já marcados `TEMPORÁRIO ... REMOVER` no código):
- `POST /api/public/diag-log` (`apps/bff/src/index.ts`)
- `reportMismatchDiag` + 2 call sites (`apps/web/src/app/(dashboard)/layout.tsx`)
- `ClientErrorReporter` (`apps/web/src/components/providers.tsx`)

Ordem: remover os call sites do frontend **antes ou junto** da rota do BFF, para não gerar erros de rede (404/connection refused) no meio do caminho.

**Declaração explícita (correção da v2, que dava impressão de "incidente fechado"; reforçada na v5 — correção do MÉDIO M3 da 2ª rodada de revisão):** a ação de segurança suspensa temporariamente no guard `session-mismatch` (`[session-mismatch-ACTION-SUSPENDED]`, caso "inconclusive", em `(dashboard)/layout.tsx`) **NÃO faz parte desta limpeza e NÃO está resolvida por esta spec**. Num sistema de custódia de armamento, um guard fail-closed atualmente desarmado não pode viver só numa frase de "fora de escopo" — a revisão apontou corretamente que isso exige um artefato de rastreamento concreto, não uma menção. **Ação desta spec**: criar, junto com a implementação, uma entrada dedicada em `CHANGELOG.md` (seção "Pendências de segurança conhecidas" ou equivalente) referenciando o arquivo/linha exatos (`(dashboard)/layout.tsx`, bloco `ACTION-SUSPENDED`), com a condição objetiva de reativação já documentada no próprio código-fonte (confirmar que a causa raiz do "inconclusive" no iOS, historicamente ligada a instabilidade de rede em PWA saindo de background, está resolvida antes de reativar). Isso não fecha o guard nesta spec, mas transforma "fora de escopo" em um ponteiro verificável, não uma promessa solta.

---

## 4. Harness de validação — **refocado na v3** (a v2 tinha 3 camadas automatizadas cegas ao problema real; corrigido ALTO 3)

### 4.1 Script de verificação estática — `apps/web/scripts/verify-pwa-assets.mjs` (mantido da v2, validado como de valor real pela revisão)

Falha o build se: ícone referenciado no manifest não existe; dimensões reais (IHDR) não batem com `sizes` declarado; ícone declarado quadrado não é quadrado; `apple-touch-icon.png` tem canal alpha (color type 4/6 no PNG header — heurística confirmada correta pela revisão).

### 4.2 E2E com emulação de matriz de devices — `apps/web/e2e/pwa-manifest.spec.ts` (redesenhado v3/v4, escopo corrigido na v5 — ALTO A1 da 2ª rodada)

**O que este teste NÃO prova (correção explícita do overclaim da v4):** Playwright/Chromium headless **não instala PWA na home screen do iOS** e não aciona o mecanismo real de `apple-touch-startup-image` — esse comportamento é proprietário do WebKit, indisponível fora de hardware Apple real. Um teste que gera seu próprio `media` esperado e depois confere se a tag tem esse `media` é uma checagem **circular**: garante consistência interna entre geração e teste, não comportamento real do WebKit. A v4 alegava "reproduzir a mesma lógica de match que o WebKit real usa" — isso é overclaim, removido nesta versão.

**O que este teste PROVA (escopo real, honesto):**
1. O `manifest.webmanifest` responde 200 com todos os ícones resolvendo — isso não depende de device nenhum, e cobre qualquer Android com browser Chromium por construção (engine-agnostic, não brand-agnostic — ver correção de precisão na seção 1.1).
2. Para cada perfil da matriz, existe uma `<link apple-touch-startup-image>` cujo `media` é **byte-idêntico** ao `media` que a ferramenta de geração emitiu para aquele device (comparação direta com a saída bruta da ferramenta, nunca reescrita à mão — ver seção 3.1 passo 3) — isto é, detecta regressão/dessincronia entre o que foi gerado e o que foi para o `layout.tsx`, não valida o comportamento do WebKit em si.
3. A matriz amplia a **cobertura de geração verificada contra si mesma**, reduzindo o risco de "esqueceram de portar um device pro Metadata API" — não substitui, em nenhuma hipótese, a validação em hardware real (seção 4.4), que continua sendo a única fonte de verdade sobre o que o WebKit de fato exibe.

```ts
const DEVICE_MATRIX = [
  devices["iPhone SE"],            // menor tela iOS corrente
  devices["iPhone 16"],            // padrão corrente (substituído de "iPhone 15" — trocar sempre pelo modelo atual de mercado, não fixar geração)
  devices["iPhone 16 Pro Max"],    // maior tela iOS corrente — confirmado presente no registry do Playwright (viewport 440×763 CSS px, DPR 3); a classe lógica de largura 440 (diferente de 430 do iPhone 15 Pro Max) É a razão desta linha existir (ver 3.1). Nota: 440×763 é o viewport do Playwright (descontando chrome do browser); o `device-width`/`device-height` usado no `media` do apple-touch-startup-image vem da ferramenta de geração, não deste descriptor — a comparação do teste (item 2 abaixo) usa o `media` bruto da ferramenta, não recalcula a partir do viewport do Playwright.
  devices["iPad Pro 11"],          // tablet
  devices["Pixel 7"],              // referência Android — valida que nada quebra (Android não depende de startup-image)
];
// Se `devices["iPhone 16 Pro Max"]` não existir na versão instalada do
// Playwright, criar um descriptor custom com viewport 440×763 / DPR 3 —
// não pular esta linha da matriz.
```

- `GET /manifest.webmanifest` → 200, JSON válido, todos os `icons[].src` resolvem 200
- Para cada perfil iOS/iPadOS: `<link rel="apple-touch-icon">` presente; `<link rel="apple-touch-startup-image">` com `media` idêntico ao emitido pela ferramenta (não recalculado)
- Para o perfil Android (Pixel): confirma que a splash automática depende só do manifest correto + `display: standalone` presente — sem asset adicional a checar
- Regressão: `login-ui-session.spec.ts` (já existente, 3 perfis) continua verde, sem modificação

### 4.3 Removido da v2: Lighthouse PWA score (categoria descontinuada, nunca mediu iOS — ver seção 2)

### 4.4 Validação humana final — única fonte de verdade real (v5: elevada a critério de aceite, não formalidade)

iPhone do usuário, PWA **já instalado** (sem reinstalar), **depois de pelo menos 1 cold-start online pós-deploy** (ver 3.2). Dado que nem o harness 4.1 nem o 4.2 conseguem validar comportamento real de WebKit (seção 4.2), esta etapa **é** a validação, não uma confirmação burocrática por cima de algo já "provado" por automação:

1. Screenshot do momento exato de tocar o ícone (evidência do critério 1 da seção 2 — splash real)
2. Screenshot do momento de resume a partir de background, especificamente checando se o dashboard do usuário anterior aparece antes do overlay de mascaramento (critério de aceite de segurança da seção 3.5 — reportar mesmo se aparecer por um instante, não é reprovação silenciosa)
3. Confirmação visual dos critérios 2-3, 5 da seção 2

---

## 5. Riscos e mitigação — **v5, reescrita 2x** (v3 corrigiu os riscos errados da v2; v5 corrige overclaims da v3/v4)

| Risco | Mitigação |
|---|---|
| **SW/Serwist serve `manifest.webmanifest` antigo do cache mesmo após deploy** | Fix determinístico: `runtimeCaching` `NetworkFirst` pro manifest em vez de deixá-lo no precache estático (seção 3.2, item 2) — `NetworkFirst`, não `StaleWhileRevalidate` (que ainda serviria a versão antiga no 1º resume pós-deploy, não é determinístico pro objetivo aqui) |
| **Splash gerada não cobre a resolução exata do device real do usuário** (16/17 Pro Max = classe 440×956, ausente em presets de 2023) | Pré-requisito bloqueante: confirmar modelo exato ANTES de gerar (seção 3.1); pinar versão da ferramenta com cobertura confirmada; se ausente, adicionar via `devices: AppleDeviceName[]` — único parâmetro de entrada real da API (não `sizes`, que é campo de saída; nem o `iPhoneBaseSizes` fictício da v4) |
| **Harness automatizado (4.1+4.2) não consegue validar comportamento real do WebKit — pode passar verde com o device do usuário ainda quebrado** (ALTO A1, não eliminável — é limite estrutural de testar comportamento proprietário Apple sem hardware) | Reclassificado: harness detecta regressão de geração↔metadata, não comportamento de splash; validação em hardware (4.4) é a ÚNICA fonte de verdade, tratada como critério de aceite obrigatório, não formalidade |
| **Overlay de mascaramento no resume pode não cobrir a janela real de exposição** (WebKit bug 202399 — `visibilitychange` não confiável em standalone iOS) | Defesa em profundidade (estado React sempre montado + múltiplos gatilhos) em vez de garantia única; validado em hardware como critério de aceite de segurança (seção 3.5/4.4), não declarado resolvido "por design" |
| Ferramenta de geração não faz zero-config splash (config explícito necessário) | Pipeline corrigido na seção 3.1 com `pwa-assets.config.ts` explícito usando a API real (parâmetros verificados contra o código-fonte da ferramenta) |
| PWA já instalado não pega novo `apple-touch-icon`/nome sem reinstalar | Comportamento conhecido do iOS (metadados de instalação fixados no "Adicionar à Tela de Início") — comunicar como limitação aceita, não bug |
| Ícone gerado corta/distorce o brasão | Inspeção visual (Read/screenshot) de cada asset gerado ANTES de integrar ao manifest — bloqueante |
| `apple-touch-icon` com alpha (iOS renderiza preto) | Coberto pelo script 4.1 — falha o build |
| Guard `session-mismatch` suspenso não tem rastreamento verificável | Entrada dedicada em CHANGELOG.md com arquivo/linha exatos + condição objetiva de reativação (seção 3.6) — não fecha o guard, mas sai de "fora de escopo" solto |
| Regressão em login/auth | Escopo 100% client/asset-level, zero mudança em middleware/layout/auth — suíte E2E completa (CI/CD) é a rede de segurança |

---

## 6. Fora de escopo (registrado, não iniciado)

- Mover a decisão de redirect de auth inteiramente para `middleware.ts` (permitiria `loading.tsx` seguro em todo lugar) — mudança arquitetural maior, mexe no guard fail-closed, não faz parte deste polish de assets.
- Reativar a ação suspensa do guard `session-mismatch` para o caso "inconclusive" — rastreado separadamente (ver 3.6).
- Variante dark do splash — decisão consciente de adiar, ver 3.1.

---

## 7. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/web/pwa-assets.config.ts` | **Novo.** Config explícito da ferramenta de geração (splash + ícones). |
| `apps/web/public/images/pwa/*.png` | **Novo.** Ícones + splash gerados, cobertura confirmada para Pro Max/Plus. |
| `apps/web/public/manifest.webmanifest` | Substitui referências de ícone. |
| `apps/web/src/app/layout.tsx` | Estende `metadata.icons` + `metadata.appleWebApp.startupImage`. |
| `apps/web/src/components/providers.tsx` | Overlay de mascaramento no `visibilitychange` (3.5); remove `ClientErrorReporter` (3.6). |
| `apps/web/src/app/(dashboard)/layout.tsx` | Remove `reportMismatchDiag` + 2 call sites (guard suspenso permanece intocado — fora de escopo). |
| `apps/bff/src/index.ts` | Remove `POST /api/public/diag-log`. |
| `apps/web/scripts/verify-pwa-assets.mjs` | **Novo.** Harness de verificação estática. |
| `apps/web/e2e/pwa-manifest.spec.ts` | **Novo.** Harness E2E com emulação de device real. |
| `docs/superpowers/specs/2026-07-17-pwa-native-boot-experience-design.md` | **Novo.** Esta spec, formalizada — 1º passo da implementação. |
| `CHANGELOG.md` | Entrada documentando o fix, sem a métrica Lighthouse removida da v2. |

## 8. Verificação (ordem de execução, v5)

1. **Bloqueante**: confirmar modelo exato do iPhone do usuário (Ajustes → Geral → Sobre) — não prosseguir para geração sem isso (seção 3.1)
2. Pinar versão da ferramenta com cobertura confirmada do modelo exato; escrever `pwa-assets.config.ts` com a API real (sem `iPhoneBaseSizes`)
3. Gerar assets, inspecionar visualmente cada um (bloqueante) — confirmar textualmente que a lista de `media` inclui o device confirmado no passo 1
4. Build local; inspecionar `public/sw.js` gerado — confirmar se manifest/PNGs entram no precache; se sim, implementar `runtimeCaching` NetworkFirst pro manifest (3.2)
5. Rodar `verify-pwa-assets.mjs` localmente
6. `tsc --noEmit` limpo em `apps/web`
7. `pwa-manifest.spec.ts` verde com a matriz de devices (escopo: consistência geração↔metadata, não comportamento WebKit — seção 4.2)
8. Code review obrigatório (CLAUDE.md) — foco em `layout.tsx`, `providers.tsx` (overlay + remoção de instrumentação), `sw.ts` (runtimeCaching novo)
9. Adicionar entrada de rastreamento do guard suspenso no CHANGELOG.md (3.6)
10. Commit + push → CI/CD completo verde
11. Comunicar ao usuário a necessidade de 1 cold-start online antes de testar
12. Pedir screenshot do momento de abrir o ícone (splash) + screenshot do resume a partir de background (mascaramento) + confirmação dos critérios 2-3/5 da seção 2 — tratado como critério de aceite real, não formalidade (seção 4.4)
