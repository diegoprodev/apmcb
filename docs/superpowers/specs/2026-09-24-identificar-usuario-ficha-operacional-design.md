# Andrômeda — Spec: Identificar Usuário → Ficha Operacional

**Data:** 2026-09-24 (v4)
**Status:** v4 — em revisão sênior adversarial (meta ≥ 9,5/10). Nenhum código de produção desta spec foi escrito.
**Pedido do dono do sistema (2026-09-24):** "não apenas aparecer *biometria localizada*, mas também a página de cadastro do usuário, com pendências, ocorrências, saídas, histórico, cautelas, tudo organizado, com foto. Assim o armeiro decide o próximo passo mais fácil e reduzimos atrito." Armar, devolver ou cautelar "tudo na tela do usuário, e para confirmar sempre biometria ou código dinâmico". "Identificar usuário deve ser diferente de identificar leitor biométrico"; o card do painel sai dos termos técnicos ("bridge").
**Premissa operacional confirmada pelo dono (2026-09-24):** a reserva **sempre** opera com o armeiro presente supervisionando (é quem tem acesso ao sistema lógico). O armeiro é o operador de todas as ações desta feature.
**Meta de qualidade:** ≥ 9,5/10 em revisão sênior, spec e implementação, antes de fechar cada fase.

**Histórico de revisão:**
- **v1 → 8,0/10 (fatos) e 7,0/10 (segurança/produto).** ~40 citações `arquivo:linha` conferidas; 5 imprecisas/falsas. Achados: **CRÍTICO** — (a) `/challenges/:id/result` e a sincronização de templates são por **tenant**, então o leitor de uma reserva já identifica e devolve nome/matrícula de militar de **outra** reserva hoje (`biometric.ts:457-466`, `biometric-bridge.ts:264-275`); (b) o tempo real descrito não existia — `armeiro-sync` não envia `row` e, se passasse a enviar, transmitiria dados de todas as reservas do tenant (`realtime.ts:58-77,198`). **ALTO** — `?p=<proof_id>` e id da pessoa na URL (PC compartilhado, histórico, Referer, replay); PC compartilhado/troca de turno/bfcache sem tratamento; `admin_global` em modo matriz sem reserva; consulta por busca sem controle de finalidade; devolução aceitaria digital de outra pessoa (`return` é 1:N); `search-profiles` apontado para o arquivo errado (é rota edge do web, RLS dormente). **MÉDIO** — pendências insuficientes para decidir armar; minimização/base legal/retenção LGPD; TTL de 10 min divergente da convenção de 2 min; enumeração por tempo de resposta; D2 já respondível; `assertMilitaryBelongsToReserve` não é exportada. **Todos tratados nesta v2** (§§ 1.9, 4.2, 4.4, 5.2-5.6, 6, 8).
- **v2 → 8,4/10.** Revisor conferiu contra código e banco de produção. Confirmou token opaco, modo consulta, reserva obrigatória, consumo de prova viável (`biometric_proof_consumptions`, `unique(proof_id)`, `operation_type` livre). Achados: **ALTO** — (A1) V1b (sync de templates por reserva) é contraditório: o sync é incremental por `updated_at|id` e não emite remoção, e a unicidade tenant-wide exigiria enviar ao leitor os templates que se queria tirar; (A2) a pendência "extravio/dano bloqueia Armar" não tem dado (`ocorrencias` não tem tipo, `tenant_id` nem `reserve_id`) e seria regra só de interface; (A3) guardar tokens no cookie iron-session estoura ~4 KB e sofre "última escrita vence" contra `pendingIdentity`; (A4) a checagem de reserva do V1 estava na camada errada — `/lendings/identify` também vaza, e as rotas que **recebem** a prova validam só o tenant (`biometric-bridge.ts:405-412`, `biometric.ts:556-563`). **MÉDIO** — devolução: o RPC **já** amarra a pessoa (premissa da v2 era falsa); `IdleTimeoutGuard`/`ResumeMaskOverlay` não servem; SSE precisa de token, publicação de `ocorrencias` e fechamento; V2 deve filtrar por `scopedReserveIds`; limite de 5 tokens baixo. **BAIXO** — `sanitizeSearchTerm` só no web; linha do `auditLog`; prefill via BFF. **Todos tratados nesta v3.**
- **v3 → 8,7/10.** Revisor conferiu contra `origin/main` e catálogo do banco. Confirmou: tokens no servidor, sync adiado com R8, `record_biometric_proof` aceita `failure`, 50 vínculos `usuario` em produção (os 43 perfis `usuario` sem vínculo estão inativos/pendentes e sem template), 0 empréstimos ativos com reserva nula, `REPLICA IDENTITY FULL` e publicação de `lendings`/`cautelamentos`/`material_requests`/`profiles`, padrão web→BFF com cookie (`lib/verified-user.ts:52`). Achados: **ALTO** — (N1) a regra "a ficha só bloqueia o que o servidor bloqueia" não se sustentava: emissão de cautela não checa situação nem pertencimento, `/batch` só checa impedimento, conta inativa arma por código. **MÉDIO** — (N2) gravar `matched_user_id=null` diverge do payload assinado; (N3) `assertBiometricPolicy` recusa impedido/inativo/pendente em qualquer finalidade, então impedido não é identificado pela digital; (N4) textos/resultados distintos para "fora da reserva" permitem enumeração e `/result` devolve `failure_reason` cru; (N5) premissa errada — o isolamento por reserva **está ligado** no tenant principal (V3 não é vazamento ativo); (N6) `lendings.item_id` nunca é preenchido; (N7) "Registrar ocorrência" não existe para staff; (N8) consumo da prova não é atômico com a criação da entrada; (N13) assinatura de cautela por digital em `main` usa SDK no servidor e falha em produção. **BAIXO** — DELETE não filtrável no realtime; token no caminho vai ao log de acesso; token deve exigir a reserva ativa atual e `sessionId`; F0a-1 só para `identify`/`return`; faltava `GET /ficha/pessoa`; linhas citadas desatualizadas. **Todos tratados nesta v4** (N5 conferido no banco: `reserve_isolation_enabled=true` no tenant com 3 reservas/92 perfis).

---

## 1. Problema — evidência do código atual

Levantamento de 2026-09-24; citações conferidas por revisor.

1. **A identificação termina num beco sem saída.** `apps/web/src/app/(dashboard)/reserva/biometria/_biometric-console-client.tsx:432-481`: o card "Identificar usuário pela digital" abre o `BiometricCaptureDialog` e, no sucesso, só preenche "Última identificação" (nome/posto/matrícula). Sem link para a pessoa, sem ação.
2. **O card do painel mistura assuntos e usa jargão.** `reserva/page.tsx:136-142`: "Identificar Usuário" / "Identificação biométrica 1:N via bridge local da reserva" → `/reserva/biometria`, que é o **console do leitor** (status, lista, parear, revogar — `_biometric-console-client.tsx:426,484-533`).
3. **Não existe visão consolidada de uma pessoa para o armeiro.** `MilitarSheet` (`reserva/militares/_militares-table.tsx:109`) mostra cadastro/dedos/TOTP/convite, sem saídas/cautelas/ocorrências/ações; `POST /api/lendings/identify` (`lendings.ts:167-273`) devolve só `{profile, active_lendings}`; não há rota de "ficha" para staff.
4. **Dados dispersos, escopos inconsistentes** (BFF usa service role; escopo manual via `lib/reserve-scope.ts:40,58,70`):
   | Dado | Fonte hoje | Escopo por reserva |
   |---|---|---|
   | Saídas/devoluções | `GET /api/lendings?military_id=` (`lendings.ts:133`) | Sim |
   | `GET /api/saidas?militar_id=` (`saidas.ts:82`) | filtra `item_id not null` — perde lotes (`lendings.ts:380-390`) | Sim |
   | Cautelas | `GET /api/cautelamentos?militar_id=` (`cautelamentos.ts:312`) | Sim |
   | Histórico de cautelas | `GET /api/cautelamentos/history/militar/:user_id` (`cautelamentos.ts:411`) | **Não — só tenant (IDOR ativo, §1.9)** |
   | Ocorrências | `GET /api/ocorrencias` (`ocorrencias.ts:74`); colunas reais: `titulo, descricao, status, military_id, lending_id, material_type_id` — **sem** tipo, `tenant_id` ou `reserve_id` (schema de produção conferido); FK `ocorrencias_military_id_fkey` | Deriva por `lending_id`/`material_type_id` (`ocorrencias.ts:~140`); sem filtro por pessoa para staff |
   | Notificações de terceiros | não existe (`notifications.ts:8`, só do chamador) | — |
   | Dedos | `biometric_templates`, lida em `reserva/militares/page.tsx:62-66`; sem endpoint BFF | Não |
   | Foto | `GET /api/profiles/:id/photo-url` (`profiles.ts:798`) + `components/profile-avatar.tsx` | Tenant; `no-store` |
   | Busca de pessoas | `apps/web/src/app/api/admin/search-profiles/route.ts` — rota **edge do Next**, anon key + RLS; `profiles_select` filtra por reserva quando `tenants.reserve_isolation_enabled=true` (`supabase/migrations/20260917020000_reserve_rls_profiles.sql:56-69`) — **ligado** no tenant principal (3 reservas, 92 perfis; desligado só num tenant de teste com 1 reserva) | Sim (depende da flag) |
5. **Não existe trilha de leitura.** `auditLog` (`middleware/audit.ts:29`; `auditAction` em `:232`) só é usado em escrita; `identify` não audita.
6. **Os fluxos de ação não aceitam "pessoa conhecida".** `reserva/saidas/nova/page.tsx` não lê query string e `_form.tsx:116` (`handleMilitarSelect`) reseta a verificação; `DesarmamentoModal` (`reserva/saidas/_desarmamento-modal.tsx:78-87`) **já** aceita `militaryId`/`militaryMatricula`/`preselectedIds`; cautela (`reserva/cautelas/_cautelas-client.tsx:315,516-524`) sem prefill.
7. **Regras de identidade dos fluxos:**
   - Saída por biometria exige prova **nova** `confirm_saida_militar` com `expectedUserId=military_id` (`lendings.ts:340-352`).
   - Devolução: `POST /lendings/identify` com prova `purpose:'return'` (`lendings.ts:220`) → `session.pendingIdentity`, TTL `IDENTITY_TTL_MS=120_000` (`lendings.ts:17`; checado em 333/576/689). `return` é **1:N** sem usuário esperado (`biometric-proof.ts:77`), **mas o servidor já amarra a pessoa**: `record_lending_returns` recusa qualquer item com `military_id ≠ p_military_id` ou `reserve_id ≠ p_reserve_id` (`20260923023207_lending_rpcs_devolucao_rastreavel.sql:236-257`). O furo é só de UX: com a digital de outra pessoa, o `DesarmamentoModal` lista os itens da pessoa identificada e a pré-seleção some sem aviso (`_desarmamento-modal.tsx:142-148`).
   - Divergência de "em posse": `/identify` inclui empréstimos com `reserve_id` nulo (`lendings.ts:254`), o RPC de devolução os recusa (linha 241).
   - Cautela: identidade nas assinaturas (`cautelamentos.ts:664,757`), verificada contra `cautela.militar_id` (`cautelamentos.ts:246-258`). **Em `main`, a assinatura por digital usa o SDK no servidor** (`cautelamentos.ts:206-235`, VPS sem leitor) e falha em produção; a migração para prova da ponte (`sign_cautela_militar`/`sign_cautela_armeiro`) está implementada no épico `biometric-unify-ssa`, ainda não mergeado (R9).
   - Política biométrica: `assertBiometricPolicy` recusa pessoa impedida, inativa ou com cadastro pendente em **qualquer** finalidade (`biometric-policy.ts:29-40`) — hoje uma pessoa impedida não é identificada pela digital (D8).
   - Guardas de situação no servidor: `/lendings/batch` barra só impedimento (`lendings.ts:314`); a emissão de cautela (`POST /cautelamentos`, `cautelamentos.ts:~494-500`) não checa situação nem pertencimento; a identificação por código (`totp.ts:20-50`) não checa situação — uma conta **inativa** consegue armar por código. A interface já rotula "Inativo — sem acesso ao sistema" e "Impedimento Administrativo — armamento bloqueado" (`_militares-table.tsx:226-228`).
   - Ocorrências: `POST /ocorrencias` aceita só `usuario` (`ocorrencias.ts:16-18`); staff registra por `PATCH /arsenal/items/:id/ocorrencia` (modelo `material_items.ocorrencia_usuario_associado_id`).
   - `lendings.item_id` nunca é preenchido por `record_lending_batch` (`lendings.ts:386-389`; 0 de 3 em produção).
   - Frescor padrão de prova: `DEFAULT_PROOF_TTL_MS = 2*60_000` (`biometric-proof-consumption.ts:1`). Consumo de prova = linha em `biometric_proof_consumptions` (`unique(proof_id)`, `operation_type` texto; `20260714000002`); `consumed_at` é coluna do **desafio**, não da prova.
   - Sessão iron-session já carrega `supabaseAccessToken`, `pendingIdentity`, `csrfToken`, `pendingTotpSecret` e `sessionId` (`lib/session.ts:19-40`); gravações concorrentes são "última escrita vence" (`lendings.ts:318-321`).
   - `assertMilitaryBelongsToReserve` existe (`lendings.ts:87-96`, usada em 303 e 506) mas **não é exportada**.
   - Colunas de vencimento de cautela: `prazo_proxima_conferencia` (`cautelamentos.ts:336`), `vencimento_silenciado`/`vencimento_snooze_until` (339-340).
8. **Tempo real hoje:** `armeiro-sync` (`realtime.ts:58-77`) é filtrado **só por tenant** e **não envia `row`** (gate em `realtime.ts:198`) — os clientes recebem `{table,type}` e recarregam.
9. **Vazamentos entre reservas que já existem (pré-requisito desta feature):**
   - **V1 — identificação biométrica cruza reservas:** a sincronização de templates é por tenant (`biometric-bridge.ts:264-275`); as rotas que **recebem** a prova validam a pessoa só por tenant (`biometric-bridge.ts:405-412`, `biometric.ts:556-563`, simulador `biometric-simulator.ts:239`); em consequência `GET /challenges/:id/result` (`biometric.ts:457-466`) e `POST /lendings/identify` (`lendings.ts:215-237`, inclui `foto_url`) devolvem dados de militar de **outra** reserva. O vínculo militar↔reserva é `reserve_memberships` (linhas `role='usuario'` desde o SP2, `reserve-staff.ts:3-5`).
   - **V2 — `GET /cautelamentos/history/militar/:user_id`** é só por tenant (`cautelamentos.ts:411`).
   - ~~V3 — busca tenant-wide~~: **não é vazamento ativo** — o isolamento por RLS está ligado no tenant principal (§1.4). A busca da ficha vai pelo BFF escopado só para não depender da flag (F0a-3).
   - **V4 — guardas de situação ausentes no servidor** (§1.7): conta inativa arma por código; emissão de cautela ignora impedimento, inatividade e pertencimento.
10. **UX medida no teste real (2026-09-23):** identificar a pessoa não levava a nada; "identificar → agir" custa ≥ 6 cliques e nova busca manual.

## 2. Objetivo e critérios de sucesso

**Objetivo:** transformar "biometria localizada" em ponto de decisão: identificou → **Ficha Operacional** com o que importa para o próximo passo → inicia armar/devolver/cautelar com a pessoa pré-selecionada, sempre confirmando por digital ou código dinâmico.

**Critérios de aceite (medidos no e2e ou em produção, conforme indicado):**
- **C1 — Atrito:** do fim da captura (diálogo em "sucesso") até o fluxo de ação aberto com a pessoa pré-selecionada: **≤ 2 ações do usuário** (cliques/toques; a digital não conta), sem digitação. Medido no e2e.
- **C2 — Decisão na primeira dobra:** cabeçalho, situação, "em posse agora", pendências e barra de ações visíveis sem rolar em 1366×768.
- **C3 — Desempenho:** 1ª dobra com p95 ≤ 1,5 s medido no BFF em produção (`duration_ms` do log `http.request.completed`) por 7 dias.
- **C4 — Segurança:** zero dado de pessoa de outra reserva **transmitido** ao navegador (não só exibido) — cobre V1, V2, ficha, SSE e busca; toda abertura de ficha auditada; identificação nunca autoriza ação.
- **C5 — Linguagem:** nenhum termo técnico na UI (varredura automatizada de textos + trava global de toasts já entregue, PR #51).
- **C6 — Tempo real:** do commit no banco à ficha aberta atualizada ≤ 3 s (e2e com dois contextos de navegador).
- **C7 — Robustez:** leitor sem contato, pessoa de outra reserva, não reconhecido, turno fechado, impedimento, identificação expirada — todos com caminho amigável (§4.6) e testados.

## 3. Escopo

**Dentro:** F0 (correção de V1, V2 e V4; consolidação da busca), cards do painel, `/reserva/identificar`, Ficha Operacional, endpoints BFF de leitura escopados e auditados, prefill dos fluxos, tempo real escopado por reserva, limpeza de jargão no console do leitor.

**Fora:** reescrever saída/devolução/cautela; novas regras de negócio (a ficha só **lê** estados existentes; a F0a-5 apenas faz o servidor cumprir as situações que o sistema já define e exibe — impedimento e inatividade); registro de ocorrência por staff (N7); exportação/impressão; edição de cadastro na ficha; notificações de terceiros; perfil `auditor` (decisão D3).

## 4. Experiência

### 4.1 Painel (`reserva/page.tsx`, `ActionCard` em `:273`)
| Card | Descrição (sem jargão) | Destino | Badge |
|---|---|---|---|
| **Identificar Usuário** (1º do painel) | "Confirme quem está à sua frente e veja o que ele tem e o que está pendente." | `/reserva/identificar` | "Digital" |
| **Leitor Biométrico** | "Situação do leitor, cadastro de digitais e pareamento." | `/reserva/biometria` | "Conectado" / "Sem contato" (mesmo cálculo de `BiometricBridgeStatus`) |
Demais cards inalterados. "Bridge", "1:N" e "local" saem de todos os textos do painel e do console.

### 4.2 Página `/reserva/identificar`
- Faixa de situação do leitor (verde "Leitor conectado" / âmbar "Leitor sem contato" + "Ver leitor").
- Ação principal: **"Identificar pela digital"** (diálogo já entregue: fases animadas, sem jargão).
- Ação secundária: **"Buscar por nome ou matrícula"** — abre a ficha em **modo consulta** (§4.4.3). Mínimo 3 caracteres; resultados só da reserva ativa.
- Sucesso na digital → `POST /api/reserva/identificacao` (§5.3) → navega para a ficha **sem clique extra**. Falha → mensagem amigável + "Tentar novamente" + "Buscar por nome ou matrícula".
- Pessoa de outra reserva: o **mesmo** texto de "não encontrada" ("Digital não encontrada nesta reserva.") — **nenhum** dado da pessoa chega ao navegador e nada distingue os dois casos (F0a-1); a distinção existe só no log do servidor.
- Sem lista de "últimas identificações" nesta versão (minimização em PC compartilhado; reavaliar após uso real).

### 4.3 Diálogo de captura (entregue — PRs #49, #50, #52)
Sem ids/percentuais; fases rotativas após 6 s; sucesso animado; negado chacoalha. Mudança nesta spec: em modo identificar o navegador só conhece dois resultados — identificado (segue para a ficha pelo `ficha_token`, §5.3) ou "Digital não encontrada nesta reserva." (não reconhecida **ou** de outra reserva, indistinguíveis). `failure_reason` nunca chega ao navegador.

### 4.4 Ficha Operacional (`/reserva/identificar/f/[token]`)

#### 4.4.1 Primeira dobra
- `ProfileAvatar` grande, nome completo (2xl), "Posto · Mat. 000000".
- **Um** selo de situação: Ativo / Impedimento administrativo / Cadastro pendente / Inativo.
- **Um** selo de confirmação disponível: "Confirmação: digital e código" / "só código" / "só digital" / "nenhuma — cadastro incompleto" (sem contagem de dedos, sem detalhe de TOTP — minimização, §6.3).
- Faixa de identificação: "Identificado pela digital às 14:02" (válida 10 min, contagem visível) **ou** "Consulta — confirme a identidade antes de qualquer ação".
- **Alertas** (pendências, §5.1.2) ordenados por severidade.
- **Em posse agora** (lista curta: material, quantidade, desde).
- **Barra de ações** fixa (§4.5).

#### 4.4.2 Abas (sob demanda)
*Cautelas* · *Movimentações* (saídas + devoluções, paginadas) · *Ocorrências* · *Cadastro* (dedos via `FingerSelector readOnly`, unidade, nome de guerra, conta ativada).

#### 4.4.3 Modo consulta (aberta pela busca)
Mostra **apenas** a primeira dobra. As abas ficam atrás de "Ver histórico completo", que registra `ficha.detalhe` (§5.6). Ações liberadas (confirmação da pessoa é sempre exigida no próprio fluxo).

#### 4.4.4 Proteção em PC compartilhado
- `Cache-Control: no-store, private` no HTML da ficha e em todas as respostas BFF desta feature; `Referrer-Policy: no-referrer` na rota.
- `pagehide`/`visibilitychange→hidden` limpa o estado da ficha; ao voltar (bfcache) refaz a leitura, que exige sessão válida e token vivo.
- Logout e fechamento de turno (evento do servidor) fecham a ficha e voltam para `/reserva/identificar`.
- Inatividade de 2 min com a ficha aberta → véu "Toque para continuar" sobre os dados da pessoa. **Componente novo** (`FichaPrivacyVeil`): `IdleTimeoutGuard` faz logout global em 15 min e `ResumeMaskOverlay` só atua em PWA instalado (`providers.tsx:125,299`). O véu é **proteção de privacidade contra olhar de terceiros**, não controle de acesso (a sessão é do próprio armeiro); o controle de acesso continua sendo sessão + token + reserva.

### 4.5 Ações (identificação ≠ autorização)
Registro de ocorrência pela ficha fica **fora** desta versão (N7: o fluxo de staff é por item do arsenal, outro modelo). Cada botão abre o **fluxo existente** com a pessoa pré-selecionada; a confirmação da pessoa acontece **no fluxo**, por digital ou código dinâmico. **Regra:** a ficha só mostra como bloqueio o que o servidor bloqueia; nenhum bloqueio existe só na interface. Como hoje o servidor não barra tudo o que a interface já rotula (§1.7, V4), a **F0a-5** alinha o servidor **antes** de a ficha exibir esses bloqueios.
| Ação | Encaminha para | Confirmação | Bloqueios (motivo mostrado no botão) |
|---|---|---|---|
| Armar | `/reserva/saidas/nova?pessoa=<ficha_token>` | prova nova `confirm_saida_militar` (expected = pessoa) ou identify-TOTP | impedimento; conta inativa; turno fechado (armeiro) — barrados em `/batch` (inativo passa a ser barrado na F0a-5) |
| Devolver | `DesarmamentoModal` com `militaryId`/`militaryMatricula`/`preselectedIds` = em posse | prova `return` ou TOTP; o servidor já exige a mesma pessoa (RPC); o modal passa a **avisar** quando a digital confirmada é de outra pessoa (§5.4) | turno fechado; nada em posse |
| Cautelar | `/reserva/cautelas?pessoa=<ficha_token>` (emissão) → assinaturas existentes | `sign-armeiro` + `sign-militar` por **código dinâmico**; por digital só depois do merge do épico `biometric-unify-ssa` (R9) | impedimento; conta inativa; fora da reserva; turno fechado — barrados na emissão a partir da F0a-5 |

### 4.6 Estados e erros (texto amigável, sem código)
| Situação | Comportamento |
|---|---|
| Leitor sem contato | Faixa âmbar; captura desabilitada com motivo; busca disponível |
| Digital não reconhecida | "Digital não encontrada nesta reserva." + tentar de novo / buscar |
| Pessoa de outra reserva | Mesmo texto e mesmo tempo de resposta que "não encontrada" (sem revelar existência) |
| Sem digital cadastrada | Ficha via busca; selo "Confirmação: só código" |
| Impedimento / inativo | Alerta vermelho; Armar/Cautelar bloqueados; Devolver liberado. Pela digital, só é identificado se D8 for aprovada; senão a ficha chega pela busca e a devolução confirma por código |
| Turno fechado | "Abra o turno para continuar" + atalho ao Livro |
| Identificação expirada (10 min) | Faixa vira "Identificação expirada — identifique de novo"; ficha continua em modo consulta |
| `admin_global` em modo matriz | "Selecione uma reserva para identificar pessoas." (§5.2) |
| Falha de uma seção | Skeleton; erro isolado com "Tentar de novo"; demais seções seguem |

### 4.7 Acessibilidade
Desktop primeiro, utilizável em tablet; alvos ≥ 44 px; contraste AA; foco visível; `aria-live` nas fases do diálogo; `prefers-reduced-motion`; título 2xl e corpo base (legível a 1 m).

## 5. Arquitetura

### 5.0 F0 — correção dos vazamentos existentes (antes de qualquer tela)
**F0a (só BFF, deploy rápido):**
1. **V1 — checagem na entrada da prova (camada certa).** Em `POST /api/biometric-bridge/challenges/:id/proof` (`biometric-bridge.ts:~405`), `POST /api/biometric/challenges/:id/submit` (`biometric.ts:~556`) e no simulador (`biometric-simulator.ts:~239`), **para as finalidades 1:N `identify` e `return`**: se `matched_user_id` não tiver `reserve_memberships` na `challenge.reserve_id`, a prova é gravada com `result='failure'` e `failure_reason='fora_da_reserva'`, **mantendo o `matched_user_id` assinado** (o `result` não é assinado; o id é assinado e fica como evidência de quem usou o leitor — `biometric-proof.ts:97-112`). Finalidades 1:1 (`confirm_saida_militar`, turno, cautela) já fixam o usuário esperado e a ação já exige pertencimento (`assertMilitaryBelongsToReserve` em `/batch`); staff `admin_global` tem 0 vínculos e não pode ser afetado. **Respostas ao navegador** (`/result`, `/lendings/identify`, console) **nunca** incluem pessoa quando `result≠'success'`, e `/result` deixa de devolver `failure_reason` (`biometric.ts:480`): o navegador recebe só `outcome: "identificado" | "nao_encontrado"`. Todos os consumidores de prova já exigem `success`. Log `biometric.identify.cross_reserve` (sem PII). Não altera o bridge.
2. **V2 — `GET /cautelamentos/history/militar/:user_id`** passa a filtrar as **linhas** por `reserve_id in scopedReserveIds` (não por pertencimento da pessoa, que pode estar em duas reservas) e a aplicar o filtro de tenant incondicionalmente (hoje condicional, `cautelamentos.ts:424`).
3. **Busca de pessoas (consolidação, não correção):** endpoint BFF `GET /api/reserva/pessoas?q=` (service role + `scopedReserveIds` via `reserve_memberships`, mínimo 3 caracteres, `limit 10`, rate limit 20/min com log de negação). `sanitizeSearchTerm` sai de `apps/web/src/lib/search-term.ts:11` para `packages/shared` e é usado nos dois lados. A rota edge `api/admin/search-profiles` não muda (R6).
4. **Helper:** `assertMilitaryBelongsToReserve` (`lendings.ts:87-96`) extraído para `lib/reserve-membership.ts` e exportado.
5. **V4 — guardas de situação no servidor** (fazem valer o que a interface já rotula, §1.7): `/lendings/batch` passa a barrar também conta **inativa** (já barra impedimento); a emissão de cautela (`POST /cautelamentos` e `/batch` de cautela) barra impedimento, inatividade e militar fora da reserva (reusa o helper do item 4). A **identificação** permanece neutra (identificar ≠ autorizar) e a **devolução** continua permitida em qualquer situação (recuperar material é sempre desejável). Negações com log estruturado (regra do projeto) e mensagem amigável.

**F0b (spec própria, fora deste documento) — sync de templates ciente de reserva.** Filtrar o sync incremental por pertencimento (`biometric-bridge.ts:264-283`) exige ressincronização completa quando o vínculo muda e eventos de remoção, e afeta o bridge (fora do repositório web). Enquanto isso **fica aceito e documentado (R8)**: o leitor guarda templates do tenant inteiro, cifrados com chave por tenant, em hardware dentro da reserva; a exposição de dados ao navegador (C4) é eliminada pela F0a-1, e a checagem de digital duplicada tenant-wide no bridge continua funcionando.

### 5.1 Endpoints de leitura (BFF)
Todos: `roleGuard("armeiro","admin_reserva","admin_global")`; `tenantId` e `reserveId` **da sessão**; reserva obrigatória (§5.2); `Cache-Control: no-store, private`; a pessoa é resolvida **pelo token** (§5.3), nunca por id vindo do cliente.
O token vai no cabeçalho `X-Ficha-Token` (não no caminho — evita o log de acesso, `access-log.ts:16`, e agrupa a métrica C3 por rota):
- `GET /api/reserva/ficha` — 1ª dobra.
- `GET /api/reserva/ficha/{cautelas|movimentacoes|ocorrencias}?cursor=` — abas, paginadas.
- `GET /api/reserva/ficha/pessoa` — só `{ id, nome_completo, posto, matricula, reserve_id }` para o prefill dos fluxos (§5.4).
A URL da **página** (`/reserva/identificar/f/<token>`) continua com o token (necessário para recarregar), coberto por `no-store`, `no-referrer` e pela amarração à sessão; o SSE (`EventSource` não envia cabeçalho) usa `?t=` e o log de acesso passa a registrar `routePath` e redigir o parâmetro `t`.

#### 5.1.1 Contrato da 1ª dobra (Zod em `packages/shared`)
```
{
  pessoa: { nome_completo, posto, matricula, foto: { profile_id, path } | null,
            situacao: "ativo"|"impedimento_administrativo"|"pendente_biometria"|"inativo",
            confirmacao: "digital_e_codigo"|"so_codigo"|"so_digital"|"nenhuma" },
  identificacao: { via: "biometria"|"busca", em: iso, valida_ate: iso|null },
  pendencias: [{ tipo, severidade: "critica"|"alta"|"media", titulo, aba|null }],
  acoes: { armar, devolver, cautelar: { permitido: boolean, motivo: string|null } },
  em_posse: [{ lending_id, material, quantidade, desde }]
}
```
(`unidade`, `nome_de_guerra`, dedos e `conta_ativada` só na aba *Cadastro*.)

#### 5.1.2 Pendências — definição e efeito (todas são leituras de estados já existentes)
| Pendência | Fonte | Severidade | Efeito em `acoes` |
|---|---|---|---|
| Impedimento administrativo | `profiles.registration_status` | crítica | bloqueia Armar, Cautelar (servidor: `/batch` hoje; cautela a partir da F0a-5) |
| Conta inativa | `registration_status='inactive'` | crítica | bloqueia Armar, Cautelar (servidor a partir da F0a-5) |
| Item em posse além do limite | `lendings` ativos; limite D1 (default 12 h) | alta | só avisa |
| Material da mesma categoria já em posse | `lendings` ativos × categoria | alta | só avisa (a regra de negócio existente decide no fluxo) |
| Item **cautelado** indisponível/em manutenção | `material_items.current_holder_user_id = pessoa` × `status_operacional` (empréstimos não têm vínculo com item: `lendings.item_id` nunca é preenchido, §1.7) | alta | só avisa |
| Devolução parcial de lote | `lendings` do mesmo `movement_id` com parte devolvida | média | só avisa |
| Cautela com conferência vencida | `prazo_proxima_conferencia < now` e não silenciada (`cautelamentos.ts:336,339-340`) | alta | só avisa |
| Ocorrência aberta/em análise ligada à pessoa | (a) `ocorrencias.military_id` (registradas pela pessoa), escopo pela reserva do `lending_id` (sem `lending_id` → por `material_type` da reserva; nenhum dos dois → não aparece); (b) `material_items.ocorrencia_usuario_associado_id` (registradas pela reserva), escopo pelo item | alta | só avisa (D7) |
| Solicitação remota pronta para retirada | `material_requests` | média | só avisa |
| Cadastro incompleto (sem código e/ou digital) | `profiles.totp_configured`, `biometric_templates` | média | só avisa |
Pendências de turno (`service_log_events.is_pending`) são por turno, não por pessoa: fora. **"Em posse" usa a regra do RPC de devolução** (itens `status_legacy='ativo'` com `reserve_id = reserva da sessão`); empréstimos antigos com `reserve_id` nulo aparecem em alerta separado "Itens sem reserva registrada — regularizar" (média, só avisa), porque não podem ser devolvidos pelo fluxo atual. As regras ficam em `lib/ficha-pendencias.ts` (função pura, testada tabela a tabela).

### 5.2 Escopo e autorização
- **Reserva obrigatória para todos os papéis.** `admin_global` em modo matriz (`reserveId` nulo, `reserve-scope.ts:45`) recebe "Selecione uma reserva" — não há modo "matriz vê tudo" nesta feature.
- **Pertencimento verificado antes de qualquer outra consulta.** `assertMilitaryBelongsToReserve` (`lendings.ts:87-96`) é **extraída para `lib/reserve-membership.ts` e exportada** (F0), reutilizada por lendings e pela ficha. Falha → 404 genérico, sem corpo útil; a checagem roda sozinha e primeiro, para que "fora da reserva" e "inexistente" tenham o mesmo custo (anti-enumeração por tempo).
- Movimentações = `lendings` por `military_id` na reserva (não `GET /api/saidas`, que perde lotes).
- Foto: `GET /api/profiles/:id/photo-url` (URL assinada, `no-store`); a ficha entrega `profile_id` só dentro do payload autenticado, nunca na URL.

### 5.3 Identificação na sessão (substitui o `?p=` da v1)
- **`POST /api/reserva/identificacao`**
  - Corpo por digital: `{ via: "biometria", proof_id }`. Validação: `purpose='identify'`, `result='success'`, `actor_id = chamador`, `reserve_id = reserva da sessão`, `matched_user_id` com pertencimento à reserva, frescor ≤ **2 min** (mesmo `DEFAULT_PROOF_TTL_MS` do sistema, `biometric-proof-consumption.ts:1`, sem override), e consumo de uso único (abaixo).
  - Corpo por busca: `{ via: "busca", profile_id }` — validação de pertencimento.
  - Efeito: grava no **servidor**, na tabela nova `ficha_identificacoes` (`token_hash` sha-256 do token, `session_id` da sessão iron-session, `actor_id`, `tenant_id`, `reserve_id`, `profile_id`, `via`, `criado_em`, `identificado_ate`, `expira_em`, `auditado_em`) — **nada no cookie** (a sessão já está perto do limite de 4 KB e gravações concorrentes são "última escrita vence", §1.7). `token` aleatório ≥ 128 bits, só o hash é guardado. **Selo "identificado"** vale 10 min (`identificado_ate`, diferente do frescor de 2 min da *prova*); a **entrada** vale até o fim do turno/sessão (`expira_em` = expiração da sessão, máx. 8 h); até 30 entradas vivas por sessão (fila do início do turno). RLS sem policy (só service role); limpeza diária por `pg_cron` das expiradas. Logout revoga pelo `session_id` (mesmo gancho de `revoked_sessions`).
  - Consumo da prova **atômico com a criação da entrada**: RPC nova `create_ficha_identificacao(...)` (SECURITY DEFINER, `REVOKE` de `anon`/`authenticated`, só service role) que, numa transação, insere em `biometric_proof_consumptions` (`operation_type='identificacao_ficha'`, `unique(proof_id)` garante uso único) e em `ficha_identificacoes`. `consumeBiometricProof` isolado (insert solto, `biometric-proof-consumption.ts:98`) **não** é usado aqui.
  - **Leitura pelo token:** exige `token_hash` + `session_id` da sessão atual + `reserve_id` = reserva **ativa atual** (trocar de reserva não muda o `sessionId`, `auth.ts:171`) + `expira_em > now()`, e **revalida o pertencimento** da pessoa a cada leitura. Sessão sem `sessionId` (legada, `session.ts:31` opcional) → falha fechado: "Identificação não encontrada — identifique de novo".
  - Resposta: `{ ficha_token }`. A navegação usa `/reserva/identificar/f/<ficha_token>`.
- **Propriedades:** a URL não contém id de pessoa nem de prova; o token só vale na sessão que o criou (outro armeiro, outra aba após logout ou link copiado → "Identificação não encontrada — identifique de novo"); replay da prova é impossível (consumida); a ficha resolve a pessoa exclusivamente pela sessão.
- **Expiração:** após 10 min o selo "Identificado" some e a ficha segue em modo consulta até `expira_em`; nenhuma gravação na sessão é necessária (estado no servidor).
- **A identificação nunca autoriza ação:** saída exige prova nova `confirm_saida_militar`; devolução exige `return`/TOTP; cautela usa as assinaturas — como hoje (§1.7).

### 5.4 Prefill dos fluxos
- Saída e cautela recebem `?pessoa=<ficha_token>`; a página resolve a pessoa **no servidor pela sessão** (mesma validação da ficha) e pré-seleciona sem marcar identidade como verificada. Token inválido → ignora e mostra "Não foi possível selecionar esta pessoa".
- Devolução: `DesarmamentoModal` já aceita a pessoa pré-selecionada e o **servidor já exige a mesma pessoa** (RPC, §1.7). Correção (F3, só UX): quando `identify.profile.id ≠ militaryId`, o modal mostra "A digital confirmada é de outra pessoa. Confirme com a pessoa selecionada." e não troca a pré-seleção em silêncio (`_desarmamento-modal.tsx:142-148`).
- **Resolução no servidor:** `/reserva/saidas/nova` é server component que lê o Supabase direto (`page.tsx:10`) e `_cautelas-client` é client component; ambos resolvem `?pessoa=` chamando `GET /api/reserva/ficha/:token/pessoa` no BFF com o cookie da sessão (server component repassa o cookie; client usa `bffFetch`). Nenhuma resolução de pessoa pelo Supabase direto.

### 5.5 Tempo real (sem vazamento)
- Novo canal SSE **`reserva-pessoa`** (`/api/realtime/stream?channel=reserva-pessoa&t=<ficha_token>`): o handler resolve o token pelo BFF (`ficha_identificacoes` + sessão); `subs()` ganha o `profile_id` resolvido (hoje recebe só `{userId, tenantId, reserveId}`, `realtime.ts:31,163`). Filtro por pessoa na assinatura (`military_id=eq.<id>` / `militar_id=eq.<id>`, mesmo padrão do `efetivo-sync`, `realtime.ts:37-55`) e por reserva **no callback** (`payload.new.reserve_id` onde a tabela tem a coluna; `ocorrencias` e `profiles` não têm — filtro só por pessoa, aceitável porque o evento não carrega dado e a ficha relê pelo endpoint escopado). **DELETE não é assinado** (não é filtrável; o `efetivo-sync` já tem essa limitação). O evento transmitido é **mínimo** `{ tipo: "ficha.mudou", secao }` — **nenhuma linha, nenhum id**.
- Pré-requisito: migration adicionando `ocorrencias` à publicação `supabase_realtime` (hoje fora, conferido em produção). `subs()` é síncrono (`realtime.ts:31`): a resolução do token acontece antes, no handler, e o resultado é passado a `subs()`.
- O stream **fecha** quando o token expira, quando a sessão é revogada (logout) ou a cada 10 min força revalidação (reconexão do `EventSource` com o token).
- A ficha, ao receber, refaz só a seção indicada pelo endpoint escopado (throttle 1/s).
- `armeiro-sync` **não** recebe `sendRow` (§1.8); o vazamento existente de metadados por tenant nesse canal fica registrado como R5.
- Mudança de situação (`profiles`) chega pelo mesmo canal, filtrada no servidor.

### 5.6 Auditoria e LGPD
- `auditLog(c,{ action:"ficha.visualizada", resource_type:"profile", resource_id, reserve_id, metadata:{ via } })` **1× por token**, garantido por `UPDATE ficha_identificacoes SET auditado_em=now() WHERE token_hash=$1 AND auditado_em IS NULL` antes de auditar; `ficha.detalhe` ao abrir o histórico completo em modo consulta. Sem conteúdo da ficha em metadados; sem PII em logs.
- Ações iniciadas pela ficha levam `metadata.origem="ficha"` nos eventos existentes (`lending.created` etc.).
- **Uso sem finalidade:** alerta no Nexus quando um armeiro abrir > N fichas por busca em 1 h sem nenhuma ação subsequente (N configurável, default 10); relatório "consultas por armeiro" para `admin_reserva` (F4).
- **Base legal:** tratamento para execução de competência legal/atribuição do órgão (LGPD art. 7º, III e art. 23 — controle de material bélico e custódia de armamento). **Finalidade:** decidir e registrar movimentação de material sob custódia. **Retenção** de `ficha.visualizada`/`ficha.detalhe`: 5 anos, alinhada aos registros de custódia (decisão D5 para confirmação).
- Falha ao gravar auditoria não bloqueia a leitura, mas gera `logger.error` + evento no Nexus (padrão do projeto, `audit.ts:210,218`).

### 5.7 Desempenho
1ª dobra: pertencimento primeiro (§5.2), depois **um** `Promise.all` (pessoa, em posse, pendências agregadas). Contadores com `head:true`; listas com `limit` e cursor; sem N+1 (join de material na mesma consulta). Índices a conferir com `get_advisors` antes/depois (F1): `lendings(tenant_id, military_id, status_legacy, issued_at desc)`, `cautelamentos(tenant_id, militar_id, status)`, `ocorrencias(military_id, status)` (a tabela não tem `tenant_id`), `material_requests(tenant_id, military_id, status)`, `reserve_memberships(user_id, reserve_id)`. Meta C3; se p95 > 1,5 s, cache curto em memória por token (≤ 10 s), invalidado pelo evento SSE da §5.5.

## 6. Segurança e privacidade

### 6.1 Ameaças e mitigação
| # | Ameaça | Mitigação | Teste |
|---|---|---|---|
| T1 | IDOR entre reservas (ficha, abas, busca, histórico) | pessoa resolvida pelo token da sessão; pertencimento primeiro; F0 corrige V2/V3 | integração 2 reservas × 2 armeiros |
| T2 | Vazamento na identificação (leitor de outra reserva) | F0a-1: prova gravada como falha (id assinado preservado), navegador recebe só "não encontrada", sem `failure_reason` | integração + e2e |
| T3 | Id de pessoa/prova na URL, histórico, Referer, link compartilhado | token opaco; só o hash no banco, amarrado ao `session_id`; `no-referrer`; inútil fora da sessão | unit + e2e |
| T4 | Replay da prova de identificação | consumo atômico na criação do token | unit |
| T5 | Ação sem confirmação por "já identificado" | ações sempre confirmam no fluxo; prefill não marca verificado | e2e dos 3 fluxos |
| T6 | Devolução com digital de outra pessoa | já barrada no servidor (RPC, §1.7); modal passa a avisar em vez de trocar a pré-seleção em silêncio | integração (RPC) + web (modal) |
| T7 | Enumeração (tempo de resposta, busca) | pertencimento primeiro; respostas iguais para inexistente/fora; mín. 3 caracteres; 20/min | integração |
| T8 | SSE transmite dados de outra reserva | canal novo filtrado no servidor, evento sem linha/id | integração |
| T9 | PC compartilhado: ficha após logout/turno, bfcache, ombro | `no-store`, limpeza em `pagehide`, fecha em logout/turno, véu por inatividade | e2e "logout → voltar" |
| T10 | Cache do Next/CF com dados pessoais | páginas dinâmicas sem cache; `private, no-store`; nada em rotas estáticas | teste de cabeçalhos |
| T11 | Consulta sem finalidade | modo consulta reduzido, `ficha.detalhe`, alerta de padrão, relatório | unit do detector |
| T12 | `admin_global` cruzando reservas | reserva obrigatória; sem modo matriz | integração |
| T13 | Auditoria perdida | falha registrada e alertada | unit |
| T14 | Conta inativa/impedida armando ou cautelando (inclusive por código) | F0a-5: guardas no servidor em `/batch` e na emissão de cautela | integração |
| T15 | Token usado após trocar de reserva | leitura exige reserva ativa atual e revalida pertencimento | integração |

### 6.2 Papéis
`armeiro`, `admin_reserva`, `admin_global` (este só em modo filial). `auditor` fora (D3). `superadmin` excluído.

### 6.3 Minimização
Primeira dobra só com o necessário para decidir (§4.4.1). Postura de autenticação resumida em um selo (sem número de dedos, sem detalhe de TOTP). Nunca exibir `match_score`, ids ou tokens. Dados cadastrais complementares só na aba *Cadastro*.

## 7. Testes
- **Unit (BFF):** `ficha-pendencias` (cada linha da tabela 5.1.2, limites, silêncio de vencimento, itens sem reserva); validação/consumo da prova de identificação (ator, reserva, pessoa, frescor 2 min, resultado, uso único); gestão de tokens (selo 10 min, entrada até fim de sessão, máx. 30); matriz de `acoes`; detector de consulta sem finalidade.
- **Integração (BFF+banco):** V1 na entrada da prova para `identify`/`return` (bridge, rota de submit e simulador → `/result` e `/lendings/identify` sem dados da pessoa nem `failure_reason`; `matched_user_id` assinado preservado; finalidades 1:1 inalteradas); V4 (inativo barrado em `/batch`, impedido/inativo/fora da reserva barrados na emissão de cautela, devolução liberada); RPC `create_ficha_identificacao` (uso único concorrente); token com troca de reserva e sessão legada; V2 por `scopedReserveIds`; V3; IDOR em todos os endpoints; resposta idêntica inexistente × fora da reserva; RPC de devolução recusando pessoa diferente (regressão); tokens: hash, isolamento por sessão, revogação no logout, auditoria 1× concorrente; `auditLog` 1× por token; SSE sem vazamento (assinante da reserva B não recebe evento da A).
- **Web (vitest):** faixa de identificação e expiração; modo consulta; estados de erro por seção; barra de ações com motivos; varredura de termos técnicos; limpeza em `pagehide`.
- **E2E (Playwright + simulador):** painel com os dois cards; identificar → ficha → Devolver pré-preenchido (≤ 2 ações — C1); busca → modo consulta; outra reserva; leitor sem contato; logout → voltar (T9); tempo real com dois contextos (C6).
- **Regressão:** saída, devolução e cautela idênticas sem `?pessoa=`; identificação no console do leitor.

## 8. Fases (cada uma com a cadeia do CLAUDE.md: TDD → Playwright → verificação de fluxo → revisão sênior → segurança)
- **F0a — Vazamentos e guardas existentes (só BFF):** V1 na entrada da prova (`identify`/`return`), V2 por `scopedReserveIds`, V4 (guardas de situação), busca escopada, `sanitizeSearchTerm` em `packages/shared`, extração do helper. *Entregável isolado; corrige produção mesmo sem a ficha.*
- **F0b — Sync de templates por reserva:** spec própria (R8); não bloqueia F1–F4.
- **F1 — Identificação e leitura:** migration `ficha_identificacoes` (+ `pg_cron`) e RPC `create_ficha_identificacao`, D8 aplicada se aprovada, `POST /identificacao`, tokens no servidor, `GET /ficha/:token` + abas, pendências, auditoria, índices, cabeçalhos de cache. Sem UI nova.
- **F2 — Telas:** cards do painel, `/reserva/identificar`, ficha (1ª dobra, abas, modo consulta, proteção em PC compartilhado), canal SSE `reserva-pessoa` (+ migration de publicação de `ocorrencias`), `FichaPrivacyVeil`.
- **F3 — Ações:** `?pessoa=` em saída e cautela (resolução via `GET /ficha/pessoa`), Cautelar por código (por digital após o merge do épico `biometric-unify-ssa`, R9), devolução pela ficha com aviso de pessoa diferente, barra de ações com bloqueios que espelham o servidor.
- **F4 — Acabamento:** jargão no console do leitor, detector/relatório de consultas, métricas C1/C3/C6 em produção.
Nenhuma fase exige migration destrutiva (tabela nova, índices, publicação realtime).

## 9. Decisões abertas e riscos
| # | Item | Proposta | Dono |
|---|---|---|---|
| D1 | Limite de "tempo em posse" | parâmetro por reserva, default 12 h | dono do sistema |
| D3 | `auditor` vê a ficha? | fora nesta fase | dono do sistema |
| D4 | Notificações da pessoa na ficha | fora (não existe leitura de terceiros) | futuro |
| D5 | Retenção da auditoria de leitura | 5 anos | dono do sistema / encarregado LGPD |
| D6 | Busca por nome/matrícula existe? | sim, em modo consulta reduzido e auditado | dono do sistema |
| D7 | Ocorrência aberta deve **bloquear** Armar/Cautelar? | hoje só avisa; se sim, a regra entra no servidor (`/batch` e emissão de cautela) antes de aparecer na UI, e exige tipificar ocorrências (coluna nova) | dono do sistema |
| R1 | Latência BFF→banco (1–2 s medidos em `/result`) | paralelismo, índices, cache curto por token | F1/F4 |
| R3 | `saidas.ts` perde lotes | ficha usa `lendings`; corrigir/retirar `saidas.ts` é outra tarefa | backlog |
| R5 | `armeiro-sync` é por tenant (metadados `{table,type}`) | não ampliar; migrar para escopo por reserva em tarefa própria | backlog |
| D8 | Pessoa impedida/inativa/pendente pode ser **identificada** pela digital? | sim para `identify` e `return` (identificar ≠ autorizar; devolver é sempre desejável); as finalidades de autorização (`confirm_saida_militar`, cautela, turno) mantêm a política atual (`biometric-policy.ts:29-40`) | dono do sistema |
| R6 | `api/admin/search-profiles` depende da flag de isolamento (ligada no tenant principal, desligada num tenant de teste) | a ficha usa o endpoint BFF escopado; a rota edge segue a decisão do épico de isolamento | backlog |
| R9 | Assinatura de cautela por digital em `main` usa SDK no servidor e falha | merge do épico `biometric-unify-ssa` (prova da ponte para cautela e turno); até lá a ficha oferece Cautelar por código | antes da F3 |
| R8 | Leitor guarda templates do tenant inteiro até a F0b | aceito: cifrados por chave de tenant, hardware dentro da reserva; exposição ao navegador eliminada pela F0a-1 | F0b |

## 10. Definition of Done (por fase)
1. Testes da §7 da fase verdes + `tsc` limpo.
2. Validação no navegador real (Playwright) antes do deploy.
3. Revisão sênior sem CRÍTICO/ALTO abertos; `insecure-defaults` + `semgrep` no diff.
4. Critérios C1–C7 da fase verificados; C3/C6 medidos em produção.
5. Varredura de textos sem termo técnico novo.
6. CHANGELOG, spec e DoD refletindo o as-built.

## 11. Arquivos afetados (previsão)
- **BFF:** `routes/biometric-bridge.ts`, `routes/biometric.ts`, `routes/biometric-simulator.ts` (V1 na entrada da prova; `/result` sem `failure_reason`), `routes/cautelamentos.ts` (V2; guardas V4 na emissão), `routes/lendings.ts` (guarda de inativo em `/batch`), `lib/biometric-policy.ts` (D8), `lib/access-log.ts` (`routePath`, redação de `t`), `lib/reserve-membership.ts` (novo; extrai helper de `routes/lendings.ts`), `routes/reserva-pessoas.ts` (novo: busca, identificação, ficha, abas, pessoa para prefill), `lib/ficha-pendencias.ts` (novo, puro), `lib/ficha-tokens.ts` (novo), `routes/realtime.ts` (canal `reserva-pessoa`), `index.ts`, testes em `__tests__/`; migrations: `*_ficha_identificacoes.sql` (tabela + RLS + `pg_cron` + RPC `create_ficha_identificacao`), `*_ficha_indices.sql`, `*_realtime_ocorrencias.sql`.
- **Shared:** schemas Zod da ficha e da identificação; `sanitizeSearchTerm`.
- **Web:** `reserva/page.tsx` (cards), `reserva/identificar/page.tsx` e `reserva/identificar/f/[token]/page.tsx` (novos) + `components/reserva/ficha/*`, `reserva/saidas/nova/page.tsx` e `_form.tsx` (`?pessoa=`), `reserva/cautelas/_cautelas-client.tsx` (`?pessoa=`), `reserva/saidas/_desarmamento-modal.tsx` (avisar pessoa diferente), `components/reserva/ficha/ficha-privacy-veil.tsx` (novo), `reserva/biometria/_biometric-console-client.tsx` (textos + `outcome`), `components/biometric/biometric-capture-dialog.tsx` (`outcome` com dois valores).
