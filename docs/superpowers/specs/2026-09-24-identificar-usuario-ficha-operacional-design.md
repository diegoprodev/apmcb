# Andrômeda — Spec: Identificar Usuário → Ficha Operacional

**Data:** 2026-09-24 (v1)
**Status:** v1 — aguardando revisão sênior adversarial (meta ≥ 9,5/10, mesmo padrão das specs anteriores). Nenhum código de produção desta spec foi escrito.
**Pedido do dono do sistema (2026-09-24):** "não apenas aparecer *biometria localizada*, mas também a página de cadastro do usuário, com pendências, ocorrências, saídas, histórico, cautelas, tudo organizado, com foto. Assim o armeiro decide o próximo passo mais fácil e reduzimos atrito." Se o usuário quiser se armar, devolver ou cautelar, "vai ter essa opção tudo na tela do usuário, e para confirmar sempre biometria ou código dinâmico". "Identificar usuário deve ser diferente de identificar leitor biométrico" — o card do painel deve sair dos termos técnicos ("bridge") e o gerenciamento do leitor (cadastro, pareamento, revogação) vira um card à parte.
**Premissa operacional confirmada pelo dono (2026-09-24):** a reserva **sempre** opera com o armeiro presente supervisionando (é ele quem tem acesso ao sistema lógico). Isso é premissa de desenho, não detalhe: o armeiro é o operador de todas as ações desta feature.

**Meta de qualidade:** nota ≥ 9,5/10 em revisão sênior, spec e implementação, antes de fechar cada fase.

---

## 1. Problema — evidência do código atual

Levantamento feito em 2026-09-24 (todas as citações são `arquivo:linha` reais; onde não achei algo, está dito).

1. **A identificação termina num beco sem saída.** `apps/web/src/app/(dashboard)/reserva/biometria/_biometric-console-client.tsx:432-481` — o card "Identificar usuário pela digital" abre o `BiometricCaptureDialog` e, no sucesso, só preenche o card "Última identificação" com nome, posto e matrícula (`setLastResult`). Não há link para a pessoa, nem ação. O armeiro precisa ir a outra tela e procurar a pessoa de novo.
2. **O card do painel mistura dois assuntos e usa jargão.** `apps/web/src/app/(dashboard)/reserva/page.tsx:136-142` — card "Identificar Usuário", descrição "Identificação biométrica 1:N via bridge local da reserva", badge "Biometria", link `/reserva/biometria`. Essa rota é, na verdade, o **console do leitor** (status do leitor, lista de leitores, parear, revogar — `_biometric-console-client.tsx:426,484-533`). Identificar pessoa e administrar leitor são tarefas diferentes, com públicos e frequências diferentes.
3. **Não existe visão consolidada de uma pessoa para o armeiro.** O que há são pedaços:
   - `MilitarSheet` (`reserva/militares/_militares-table.tsx:109`): dados cadastrais, status, dedos, TOTP, convite — **sem** saídas, cautelas, ocorrências ou ações.
   - `POST /api/lendings/identify` (`apps/bff/src/routes/lendings.ts:167-273`): devolve só `{profile:{id,nome_completo,matricula,posto,foto_url}, active_lendings}`.
   - Não há endpoint que agregue a pessoa; não há rota/página de "ficha" ou "perfil" para staff (as telas `efetivo/*` e `perfil/` são a visão **da própria pessoa**).
4. **Os dados existem, mas dispersos e com escopos inconsistentes** (o BFF usa a service role, então o escopo é aplicado à mão — `apps/bff/src/lib/reserve-scope.ts:40,58,70`):
   | Dado | Fonte hoje | Escopo por reserva? |
   |---|---|---|
   | Saídas/devoluções (lendings) | `GET /api/lendings?military_id=` (`lendings.ts:133`) | Sim (`scopedReserveIds`) |
   | `GET /api/saidas?militar_id=` (`saidas.ts:82`) | filtra `item_id not null` — **perde lotes** (`record_lending_batch` não seta `item_id`, comentário em `lendings.ts:380-390`) | Sim |
   | Cautelas por pessoa | `GET /api/cautelamentos?militar_id=` (`cautelamentos.ts:312`) | Sim |
   | Histórico de cautelas por pessoa | `GET /api/cautelamentos/history/militar/:user_id` (`cautelamentos.ts:411`) | **Não — só tenant** |
   | Ocorrências | `GET /api/ocorrencias` (`ocorrencias.ts:74`) | Deriva reserva por `lending_id`/`material_type_id`; **sem filtro por pessoa** para staff, só abertas/em análise, limit 100 |
   | Notificações da pessoa | `GET /api/notifications` (`notifications.ts:8`) | Só do próprio chamador — **não existe** leitura de terceiros |
   | Dedos cadastrados | tabela `biometric_templates(user_id, finger_index)`, lida em `reserva/militares/page.tsx:62-66` | Sem filtro de reserva; **sem endpoint BFF** |
   | Foto | `GET /api/profiles/:id/photo-url` (`profiles.ts:798`) + `components/profile-avatar.tsx` | Tenant; `Cache-Control: private, no-store` |
5. **Não existe trilha de leitura.** Não há `auditLog` em `identify` nem em leitura de dados de terceiros (`middleware/audit.ts:232`, só ações de escrita). Uma ficha completa de uma pessoa é dado pessoal sensível (LGPD) e precisa ser auditável.
6. **Os fluxos de ação já existem, mas não aceitam "pessoa já conhecida".** `reserva/saidas/nova/page.tsx` carrega todos os `role=usuario` e não lê query string; `_form.tsx:116` (`handleMilitarSelect`) reseta a verificação. `DesarmamentoModal` (`reserva/saidas/_desarmamento-modal.tsx:78-87`) **já** aceita `militaryId`, `militaryMatricula`, `preselectedIds`. Cautela (`reserva/cautelas/_cautelas-client.tsx:315,516-524`) tem estado `militar_id`, sem prefill.
7. **Regras de identidade dos fluxos (fatos que a ficha precisa respeitar):**
   - Saída por biometria exige prova **nova** `purpose='confirm_saida_militar'` com `expectedUserId=military_id` (`lendings.ts:340-352`); prova de "identify" ou "return" **não** serve.
   - Devolução usa `POST /lendings/identify` com prova `purpose:'return'` (`lendings.ts:220`) → `session.pendingIdentity` (TTL `IDENTITY_TTL_MS=120_000`, `lendings.ts:17`, checado em 333/576/689).
   - Cautela não tem passo de identify: a identidade entra nas assinaturas (`sign-armeiro`/`sign-militar`, `cautelamentos.ts:664,757`) verificada contra `cautela.militar_id`, não contra o chamador (`cautelamentos.ts:246-258`).
   - `armeiro` sem turno aberto recebe `SHIFT_REQUIRED` em `/batch` e `/bulk-return`.
8. **Consequência de UX medida no teste real (2026-09-23):** o armeiro identificou a pessoa, viu "Identidade confirmada" e não tinha o que fazer com isso. O caminho "identificar → agir" custa hoje ≥ 6 cliques e uma nova busca manual.

## 2. Objetivo e critérios de sucesso

**Objetivo:** transformar "biometria localizada" em um ponto de decisão. Ao identificar (ou buscar) uma pessoa, o armeiro cai numa **Ficha Operacional** com tudo que importa para o próximo passo — e dali inicia *armar*, *devolver* ou *cautelar* com a pessoa já selecionada, sempre confirmando por biometria ou código dinâmico.

**Critérios mensuráveis (aceite):**
- **C1 — Atrito:** de "dedo apoiado" a "ação iniciada com a pessoa pré-selecionada" em **≤ 2 cliques** (identificar → botão da ação), sem digitar nada.
- **C2 — Decisão sem sair da tela:** a ficha mostra, na primeira dobra, foto, nome/posto/matrícula, status, **o que está em posse agora** e **as pendências críticas**; as demais informações ficam a 1 clique (abas).
- **C3 — Desempenho:** ficha (primeira dobra) com **p95 ≤ 1,5 s** medido no BFF em produção (metas por seção na §5.7); abas carregam sob demanda.
- **C4 — Segurança:** zero vazamento entre reservas (teste adversarial de IDOR na §7); toda visualização gera `auditLog`; nenhuma ação executa só por a pessoa ter sido identificada (identificação ≠ autorização — §5.3).
- **C5 — Linguagem:** nenhum termo técnico na UI (`bridge`, `1:N`, `proof`, `challenge`, códigos, ids) — vale para toasts (trava global já entregue, PR #51) e para textos fixos desta feature.
- **C6 — Tempo real:** mudanças relevantes (nova saída, devolução, cautela assinada, status) refletem na ficha aberta em **≤ 3 s** sem recarregar.
- **C7 — Robustez do fluxo:** leitor sem contato, pessoa de outra reserva, digital não reconhecida, turno fechado e impedimento administrativo têm caminho explícito e amigável (§4.6).

## 3. Escopo

**Dentro:**
1. Painel da Reserva: separar em dois cards — **Identificar Usuário** (novo destino) e **Leitor Biométrico** (gerência do leitor), textos sem jargão (§4.1).
2. Nova página `/reserva/identificar` (identificar por digital ou buscar por nome/matrícula) e nova **Ficha Operacional** `/reserva/identificar/[id]`.
3. Endpoint BFF de leitura agregada, escopado por reserva, com auditoria de leitura (§5.1-5.2, 5.6).
4. Prefill dos fluxos existentes de saída, devolução e cautela a partir da ficha (§5.4).
5. Tempo real da ficha (§5.5).
6. Limpeza de jargão no console do leitor (`/reserva/biometria`) — só textos.

**Fora (não-objetivos):**
- Reescrever os fluxos de saída/devolução/cautela (só ganham prefill e o ponto de entrada).
- Novas regras de negócio de armamento (limites, elegibilidade) — a ficha **reflete** as regras existentes, não cria outras.
- Exportação/impressão da ficha (fase futura, exige decisão LGPD própria).
- Edição de dados cadastrais na ficha (continua em `MilitarSheet`/admin).
- Notificações de terceiros (não existem; ver §9).

## 4. Experiência

### 4.1 Painel "Reserva de Armamento" (`reserva/page.tsx`)
Cards do painel (ordem e textos; ícones já usados no projeto):
| Card | Descrição (pt-BR, sem jargão) | Destino | Badge/contagem |
|---|---|---|---|
| **Identificar Usuário** | "Confirme quem está à sua frente e veja tudo sobre a pessoa." | `/reserva/identificar` | "Biometria" |
| **Leitor Biométrico** | "Cadastro de digitais, pareamento e situação do leitor." | `/reserva/biometria` | estado ao vivo: "Conectado" / "Sem contato" (o mesmo cálculo de `BiometricBridgeStatus`, `_biometric-console-client.tsx:426`) |
| Cadastrar Biometria, Nova Saída, Devoluções Pendentes… | inalterados | inalterados | inalterados |

Regras: o card **Identificar Usuário** é o 1º do painel (ação mais frequente). "Bridge", "1:N" e "local" **saem** de todos os textos. Mantém-se `ActionCard` (`reserva/page.tsx:271`).

### 4.2 Página `/reserva/identificar`
- Título "Identificar usuário". Bloco principal: botão grande **"Identificar pela digital"** (abre o diálogo de captura já entregue — fases animadas, sem jargão).
- Bloco secundário: **"Buscar por nome ou matrícula"** (campo com busca incremental restrita à reserva; endpoint de busca existente com escopo — ver §5.2). Uso: pessoa sem digital cadastrada, leitor sem contato, ou consulta.
- Faixa de situação do leitor no topo (verde "Leitor conectado" / âmbar "Leitor sem contato — usar busca ou verificar o leitor" com link "Ver leitor" → `/reserva/biometria`).
- Lista "Últimas identificações" (somente do armeiro logado, sessão atual, máx. 5, com foto/nome/hora) para reabrir ficha com 1 clique. Guardada em `sessionStorage`; não persiste no servidor (minimização).
- Sucesso na captura → navegação automática para a ficha (sem clique extra). Falha → mensagens já entregues (§C5) + botões "Tentar novamente" e "Buscar por nome ou matrícula".

### 4.3 Diálogo de captura (já entregue nesta sessão — referência)
PRs #49/#50/#52: sem "Tentativa/Confirmação/% de confiança", fases rotativas após 6 s ("Validando seus dados…", "Localizando biometria…"), anel girando, sucesso animado, negado chacoalha, tipografia maior. **Nesta spec ele ganha uma responsabilidade nova:** ao concluir com sucesso em modo "identificar", devolve o `proof.id` ao chamador para a navegação da ficha (§5.3) — nenhum id aparece na UI.

### 4.4 Ficha Operacional — layout
**Cabeçalho (primeira dobra):**
- `ProfileAvatar` grande (foto; fallback iniciais), nome completo em 2xl, "Posto · Nome de guerra · Mat. 000000", unidade.
- Linha de selos (badge classes `badge-success|warning|danger|neutral`): situação cadastral (Ativo / Impedimento administrativo / Cadastro pendente / Inativo), "Digital cadastrada (n dedos)" ou "Digital pendente", "Código dinâmico configurado/pendente".
- Faixa de identificação: "Identificado por digital às 14:02 · válido por 9:41" (contagem regressiva; §5.3) **ou** "Consulta sem identificação — confirme a identidade antes de qualquer ação".

**Alertas prioritários (logo abaixo, só se houver):** lista ordenada por severidade das **pendências** (§5.1.2). Exemplos: "Impedimento administrativo — armamento bloqueado", "2 itens em posse há mais de 12 h", "1 cautela com conferência vencida", "1 ocorrência aberta".

**Blocos-resumo (4 cards clicáveis que levam à aba):** Em posse agora · Cautelas ativas · Ocorrências abertas · Última movimentação.

**Abas:** *Em posse* · *Cautelas* · *Movimentações* (saídas + devoluções, mais recentes primeiro, paginadas) · *Ocorrências* · *Cadastro* (dados e dedos — `FingerSelector readOnly` já entregue). Abas carregam sob demanda (§5.7).

**Barra de ações (fixa no rodapé, visível em rolagem):** três botões grandes com ícone — **Armar / Registrar saída**, **Devolver**, **Cautelar** — mais "Registrar ocorrência" como ação secundária. Cada botão informa, quando desabilitado, o **motivo em linguagem simples** (ex.: "Bloqueado: impedimento administrativo", "Abra o turno para continuar", "Nada em posse para devolver").

### 4.5 Ações e confirmação (identificação ≠ autorização)
Ao clicar numa ação, abre o **fluxo existente** com a pessoa pré-selecionada. A confirmação da pessoa é **sempre** por uma destas duas vias, escolhidas na própria tela do fluxo: **digital** ou **código dinâmico**. A identificação que abriu a ficha **não** autoriza a ação (as provas são amarradas a `purpose` — §5.3). Regras por ação (já existentes; a ficha só encaminha):
| Ação | Encaminha para | Confirmação | Pré-requisitos vistos na ficha |
|---|---|---|---|
| Armar | `/reserva/saidas/nova?militar=<id>` | prova nova `confirm_saida_militar` ou identify-TOTP | turno aberto (armeiro), sem impedimento, pessoa da reserva |
| Devolver | `DesarmamentoModal` (`militaryId`, `militaryMatricula`, `preselectedIds` = itens em posse) | prova `return` ou TOTP | turno aberto, ≥ 1 item em posse |
| Cautelar | `/reserva/cautelas?militar=<id>` (emissão) → assinaturas existentes | `sign-armeiro` + `sign-militar` (digital ou TOTP) | turno aberto, sem impedimento |

### 4.6 Estados e erros (todos com texto amigável, sem código)
| Situação | Comportamento |
|---|---|
| Leitor sem contato | Faixa âmbar + botão "Buscar por nome ou matrícula"; captura desabilitada com motivo |
| Digital não reconhecida | Mensagem amigável + "Tentar novamente" + "Buscar por nome ou matrícula" + "Cadastrar digital" (se `armeiro` puder) |
| Pessoa de **outra reserva** | "Esta pessoa não pertence à sua reserva." — **sem** revelar nome/foto/dados (§6, T2) |
| Sem digital cadastrada (busca manual) | Ficha abre com selo "Digital pendente"; ações liberadas só por código dinâmico |
| Impedimento administrativo | Alerta vermelho; **Armar** e **Cautelar** desabilitados; **Devolver** e **Registrar ocorrência** permanecem |
| Turno fechado (`SHIFT_REQUIRED`) | Botões com "Abra o turno para continuar" + atalho ao Livro |
| Identificação expirada (>10 min) | Faixa vira "Identificação expirada — identifique de novo"; ações exigem nova confirmação (que já é a regra) |
| Erro/lentidão ao carregar | Skeleton por seção; falha de uma seção **não** derruba as demais ("Não foi possível carregar esta parte. Tentar de novo") |

### 4.7 Acessibilidade e responsividade
Desktop primeiro (PC da reserva), utilizável em tablet. Alvos de toque ≥ 44 px, contraste AA, foco visível, `aria-live` para as fases do diálogo, `prefers-reduced-motion` respeitado (já no CSS das animações). Tipografia: título 2xl, corpo base — legível a 1 m (pedido explícito do dono).

## 5. Arquitetura

### 5.1 Endpoint de leitura agregada (BFF)
**`GET /api/reserva/pessoas/:id/ficha`** — `roleGuard("armeiro","admin_reserva","admin_global")`; `tenantId`/`reserveId` **sempre** da sessão (nunca do cliente), como `lib/reserve-scope.ts`.

#### 5.1.1 Contrato (resumo; `apps/shared` com Zod)
```
{
  pessoa: { id, nome_completo, nome_de_guerra, posto, matricula, unidade,
            foto_path|null, situacao: "ativo"|"impedimento_administrativo"|"pendente_biometria"|"inativo",
            totp_configurado, dedos: number[], conta_ativada },
  identificacao: { metodo: "biometria"|"busca", em: iso, valida_ate: iso } | null,
  resumo: { em_posse, cautelas_ativas, ocorrencias_abertas, solicitacoes_abertas, ultima_movimentacao_em|null },
  pendencias: [{ tipo, severidade: "critica"|"alta"|"media", titulo, descricao, aba }],
  acoes: { armar:{permitido,motivo|null}, devolver:{...}, cautelar:{...}, ocorrencia:{...} },
  em_posse: [{ lending_id, material, quantidade, desde, horas_em_posse }]
}
```
Abas de lista (`cautelas`, `movimentacoes`, `ocorrencias`) têm endpoints próprios paginados por cursor: `GET /api/reserva/pessoas/:id/{cautelas|movimentacoes|ocorrencias}?cursor=` (mesmo escopo e mesmo `auditLog` de leitura por sessão de ficha, sem duplicar por página).

#### 5.1.2 Pendências (definição fechada — o termo tem 3 significados hoje; esta spec escolhe)
Uma **pendência** é algo que *exige atenção do armeiro sobre esta pessoa agora*, calculado no servidor (regras versionadas e testadas):
1. `impedimento_administrativo` — crítica (`profiles.registration_status`).
2. **Itens em posse além do limite** — alta; limite = parâmetro de reserva com default 12 h (campo já existente? **não verificado** → decisão aberta D1).
3. **Cautela com conferência vencida** — alta (`prazo_proxima_conferencia < now` e não silenciada por `vencimento_silenciado`/`vencimento_snooze_until`, colunas em `cautelamentos.ts:325-329`).
4. **Ocorrência aberta/em análise** da pessoa — média.
5. **Solicitação remota** pendente/aprovada e pronta para retirada (`material_requests`) — média.
6. **Cadastro incompleto:** sem código dinâmico ou biometria pendente — média.
(As "pendências de turno" — `service_log_events.is_pending` — são **por turno**, não por pessoa, e ficam **fora**.)

### 5.2 Escopo, autorização e busca
- **Pertencimento à reserva:** reaproveitar `assertMilitaryBelongsToReserve` (`lendings.ts`, usado em `/batch`); falha → **404 genérico** (não 403), sem corpo com dados (T2).
- **Nunca** usar `GET /cautelamentos/history/militar/:user_id` (`cautelamentos.ts:411`, só tenant) para a ficha; a lista de cautelas usa a consulta escopada por `scopedReserveIds`.
- **Ocorrências por pessoa** exigem filtro novo por `military_id` na consulta (hoje só a lista aberta, 100 itens); a reserva continua derivada por `lending_id`/`material_type_id`, fail-closed (`ocorrencias.ts:~140`).
- **Movimentações** = `lendings` por `military_id` na reserva (**não** `GET /api/saidas`, que perde lotes — §1.4).
- **Busca por nome/matrícula:** endpoint já usado no projeto (`search-profiles`, sanitizado — `sanitizeSearchTerm`) precisa devolver **só pessoas da reserva**; se hoje é tenant-wide, ganha o filtro (tarefa F1).
- **Foto:** continua por `GET /api/profiles/:id/photo-url` (URL assinada, `no-store`); a ficha só passa `foto_path`.

### 5.3 Identificação × autorização (o ponto de segurança central)
- **Entrada A — digital:** o diálogo devolve `proof.id` (`purpose:'identify'`, `result:'success'`). A navegação é `/reserva/identificar/<matched_user_id>?p=<proof.id>`. O BFF, ao montar a ficha, valida a prova: `actor_id = chamador`, `reserve_id` = reserva da sessão, `matched_user_id = :id`, `created_at ≥ now − 10 min`, `result='success'`; então preenche `identificacao = {metodo:"biometria", em, valida_ate}`. Prova inválida/expirada/de outro ator → a ficha abre como **busca** (sem selo de identificação), sem erro técnico.
- **Entrada B — busca:** `identificacao = null`; banner "Consulta sem identificação".
- **A prova de identify não é reutilizada como autorização de ação.** Saída exige prova nova `confirm_saida_militar`; devolução exige `return`/TOTP; cautela usa as assinaturas — tudo como hoje (§1.7). Motivo: `assertProofScopeAndFreshness` amarra `purpose`; misturar quebraria o modelo de prova de uso único (`biometric-proof-consumption`).
- **Anti-abuso:** o parâmetro `p` é opaco e só *eleva a confiança exibida*; nunca concede acesso (o acesso vem de papel + reserva). Trocar `:id` mantendo `p` de outra pessoa → `matched_user_id ≠ :id` → tratado como busca.

### 5.4 Prefill dos fluxos
- **Saída:** `reserva/saidas/nova/page.tsx` passa a ler `?militar=<id>`; valida server-side (papel + pertencimento) e pré-seleciona o militar **sem** marcar identidade como verificada (a verificação continua obrigatória no fluxo — `handleMilitarSelect` já a reseta; o prefill inicial não pode pular isso).
- **Devolução:** usa as props existentes de `DesarmamentoModal`; a ficha o monta com `preselectedIds` = itens em posse (`active_lendings`).
- **Cautela:** `reserva/cautelas` lê `?militar=<id>` e pré-preenche `militar_id`/`reserve_id` no formulário de emissão; nenhuma assinatura é pré-feita.
- Parâmetros inválidos/de outra reserva → ignorados com aviso amigável ("Não foi possível selecionar esta pessoa").

### 5.5 Tempo real
`useSSERefresh("armeiro-sync", onEvent)` (`hooks/use-sse-refresh.ts`; canal `armeiro-sync` filtrado por **tenant**, `realtime.ts:58`) — a ficha filtra no cliente por `row.military_id`/`militar_id === id`, com `onEvent` estável, e **refaz** apenas o resumo/lista afetada (throttle 1/s). Mudança de `profiles` (status) via `admin-profiles-grid`. Como o canal é por tenant, o evento carrega só a linha — **a ficha nunca confia no payload do evento para exibir dado**: sempre refaz a leitura escopada (evita vazamento e divergência).

### 5.6 Auditoria de leitura (LGPD)
- `auditLog(c,{ action:"ficha.visualizada", resource_type:"profile", resource_id:<id>, reserve_id, metadata:{ via:"biometria"|"busca" } })` **uma vez por abertura** de ficha (não por aba/página). Sem conteúdo da ficha nos metadados; sem PII em logs (regra do projeto).
- Ação iniciada a partir da ficha: `metadata.origem="ficha"` nos eventos já existentes (`lending.created` etc.) — rastreabilidade ponta a ponta.
- Retenção e cadeia de hash: as do `audit_logs` existente.

### 5.7 Desempenho e índices
Ficha (1ª dobra) = **1 salto** de consultas em paralelo (`Promise.all`): pessoa+dedos, em_posse, contadores (cautelas/ocorrências/solicitações), última movimentação. Meta p95 ≤ 1,5 s (BFF→Supabase ≈ 0,2–0,5 s por consulta hoje; ver latência de 1–2 s medida em `/result`, então **nada sequencial**). Contadores com `count` exato limitado (`head:true`), listas com `limit` e cursor. Índices a verificar/criar (tarefa F1, com `get_advisors` de performance antes/depois): `lendings(tenant_id, military_id, status_legacy, issued_at desc)`, `cautelamentos(tenant_id, militar_id, status)`, `ocorrencias(tenant_id, military_id, status)`, `material_requests(tenant_id, military_id, status)`. Sem N+1 (join de material em uma consulta).

## 6. Segurança e privacidade — ameaças e mitigação
| # | Ameaça | Mitigação | Teste |
|---|---|---|---|
| T1 | IDOR: armeiro da reserva A lê ficha da reserva B trocando `:id` | pertencimento server-side; 404 genérico; escopo por sessão | integração com 2 reservas |
| T2 | Vazamento por mensagem de erro (nome/foto na negação) | 404 sem corpo útil; UI mostra só "não pertence à sua reserva" | e2e |
| T3 | `?p=` forjado para parecer identificado | `p` só eleva selo; validação completa da prova; nunca concede acesso | unit do validador |
| T4 | Ação sem confirmação por "já identificado" | ação sempre abre o fluxo com confirmação; testes de contrato dos 3 fluxos | e2e |
| T5 | Enumeração de pessoas pela busca | busca escopada à reserva, rate limit, mínimo 3 caracteres, sanitização | integração |
| T6 | Payload de SSE vaza dado de outra pessoa | ficha ignora payload e refaz leitura escopada | unit |
| T7 | Raspagem da ficha por sessão comprometida | rate limit (60/min/usuário), auditoria por abertura, sem export | integração |
| T8 | Foto/URL assinada em cache | `no-store` (já existente), URL de vida curta | manual/e2e |
| T9 | Registro de leitura sem trilha | `ficha.visualizada` obrigatório (falha de auditoria não bloqueia a leitura, mas gera `logger.error` + alerta no Nexus, padrão do projeto) | unit |

Papéis: `armeiro`, `admin_reserva`, `admin_global` (mesmo conjunto de `/lendings/identify`); `auditor` **fora** desta fase (decisão D3); `superadmin` excluído (Nexus-only).

## 7. Testes
- **Unit (BFF):** agregador de pendências (cada regra, borda de limite, silêncio de vencimento); validador da prova de identificação (ator, reserva, usuário, TTL, resultado); montagem de `acoes` (matriz de bloqueios).
- **Integração (BFF, com banco):** 2 reservas × 2 armeiros — IDOR em `/ficha`, `/cautelas`, `/movimentacoes`, `/ocorrencias`; pessoa sem digital; impedimento; contadores consistentes com listas; `auditLog` criado 1×/abertura.
- **Web (vitest):** faixa de identificação (contagem, expiração), estados de erro por seção, barra de ações com motivos, ausência de termos técnicos (varredura de textos), `armeiro-sync` filtrado por pessoa.
- **E2E (Playwright, com simulador):** painel mostra os dois cards; identificar → ficha → *Devolver* pré-preenchido; busca por matrícula; pessoa de outra reserva; leitor sem contato. Medição de cliques (C1).
- **Regressão:** `DesarmamentoModal`, saída e cautela continuam idênticos sem `?militar=`.

## 8. Fases de entrega (cada uma com a cadeia de qualidade do CLAUDE.md: TDD → Playwright → revisão sênior → segurança)
- **F1 — Fundação de dados:** endpoint `/ficha` (sem abas de lista), `auditLog`, índices, testes de IDOR, filtro da busca. *Sem UI nova.*
- **F2 — Painel + página + ficha (leitura):** dois cards, `/reserva/identificar`, ficha com cabeçalho, alertas, resumo, abas (endpoints paginados), tempo real.
- **F3 — Ações:** `?militar=` em saída e cautela, devolução via ficha, barra de ações com bloqueios e motivos.
- **F4 — Acabamento:** limpeza de jargão no console do leitor, "últimas identificações", métricas de C1/C3 em produção, ajustes de UX pós-uso real.
Cada fase é mergeável e reversível isoladamente; nenhuma exige migration destrutiva (só índices).

## 9. Riscos e decisões abertas
| # | Item | Proposta | Dono |
|---|---|---|---|
| D1 | Limite de "tempo em posse" para pendência | parâmetro por reserva, default 12 h; validar com o dono | dono do sistema |
| D2 | Ocorrências por pessoa: coluna `military_id` existe em `ocorrencias`? | confirmar no schema em F1; se não, derivar via `lending_id` | implementação F1 |
| D3 | `auditor` pode ver a ficha? | fora nesta fase; reavaliar com a política de auditoria | dono do sistema |
| D4 | Notificações da pessoa na ficha | fora (não existe leitura de terceiros; criar exigiria política LGPD) | futuro |
| R1 | Latência do BFF (1–2 s por consulta em `/result`) | paralelismo + índices + medição contínua; se p95 > 1,5 s, cache curto por sessão de ficha | F1/F4 |
| R2 | Canal SSE é por tenant | filtro no cliente + releitura escopada (§5.5) | F2 |
| R3 | `saidas.ts` perde lotes | ficha usa `lendings` direto; corrigir/retirar `saidas.ts` é outra tarefa | fora |
| R4 | `GET /history/militar/:user_id` é tenant-only | não usar; registrar como achado separado de segurança | backlog |

## 10. Definition of Done (por fase)
1. Testes da seção 7 correspondentes verdes (unit, integração, web, e2e) + `tsc` limpo.
2. Playwright: fluxo real validado no navegador antes de qualquer deploy (regra do projeto).
3. Revisão sênior (mandato do CLAUDE.md) sem CRÍTICO/ALTO abertos; `insecure-defaults` + `semgrep` no diff.
4. C1–C7 verificados na fase que os entrega; C3 medido em produção.
5. Varredura de textos: nenhum termo técnico novo na UI.
6. CHANGELOG atualizado; spec e DoD refletem o as-built.

## 11. Arquivos afetados (previsão)
- **BFF:** `apps/bff/src/routes/ficha.ts` (novo), `apps/bff/src/lib/ficha-pendencias.ts` (novo, puro/testável), `apps/bff/src/lib/identification-proof.ts` (validador), `apps/bff/src/routes/profiles.ts` (busca escopada), `apps/bff/src/index.ts` (montagem), testes em `__tests__/`; `supabase/migrations/*_ficha_indices.sql` (índices).
- **Shared:** schemas Zod da ficha em `packages/shared`.
- **Web:** `reserva/page.tsx` (cards), `reserva/identificar/page.tsx` e `[id]/page.tsx` (novos) + componentes `components/reserva/ficha/*`, `reserva/saidas/nova/page.tsx` (`?militar=`), `reserva/cautelas/_cautelas-client.tsx` (`?militar=`), `reserva/biometria/_biometric-console-client.tsx` (textos), `components/biometric/biometric-capture-dialog.tsx` (devolver `proof.id` em identify — já devolve; formalizar contrato).
