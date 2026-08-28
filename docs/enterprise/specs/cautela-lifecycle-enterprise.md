# Enterprise Spec — Ciclo de Vida da Cautela (Prazo, Vencimento, Cancelamento, Edição, Histórico, Compartilhamento)

> **Data:** 2026-08-28
> **Fase:** Cautela Permanente — Gestão de Ciclo de Vida Completo
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling
> **Depende de:** fix `cautela-signatures-required-for-return` (2026-08-28, já em produção — devolução/substituição agora exigem as 2 assinaturas)

---

## 1. Contexto e Motivação

Pedido do usuário (verbatim, consolidado de uma única mensagem com múltiplos pontos):

> "TAMBÉM QUERO NA CAUTELA A OPÇÃO DE TEMPO DE CAUTELA PERSONALIZADO — 15 DIAS, 30 DIAS 90 DIAS
> 6 MESES, 1 ANO, INDETERMINADO, E QUANDO ATINGIR PRÓXIMO DA DATA [...] APARECER NOTIFICAÇÃO NO
> SINO TANTO DO USUÁRIO TANTO DO ARMEIRO COM ADMIN RESERVA SOBRE ESSA CAUTELA, OU SEJA (VENCIDA)
> CRIE UMA NOVA ABA DAS EXISTENTES [...] TAMBÉM NÃO VI A OPÇÃO DE EDITAR CAUTELA EXISTENTE, COMO
> IREI SUBSTITUIR? COMO ISSO FICARÁ RASTREÁVEL [...] TAMBÉM NÃO VI A OPÇÃO DE CANCELAR CAUTELA
> [...] DEVE TER UM BOTÃO 3 PONTINHOS [...] COM OPÇÕES [...] EDITAR CAUTELA, CANCELAR CAUTELA,
> ABRIR CAUTELA E HISTÓRICO DE TUDO QUE OCORREU DESDE A ABERTURA [...] E TB A OPÇÃO DE
> COMPARTILHAR CAUTELA AO CLICAR ABRE FLUXO PARA ENVIAR PELO WHATSAPP OU BAIXAR PDF. PARA
> CANCELAR DEVE TER MOTIVO."

Cinco pedidos distintos, tratados juntos porque compartilham a mesma superfície de UI (o menu de
3 pontinhos) e o mesmo objeto de domínio (`cautelamentos`):

1. **Prazo personalizável** de devolução (hoje não existe — só existe `prazo_proxima_conferencia`, que é outra coisa, ver §2.1).
2. **Notificação de vencimento** no sino, para militar + armeiro + admin_reserva.
3. **Nova sub-aba** para cautelas vencidas/vencendo.
4. **Edição/substituição** de cautela existente, com rastreabilidade.
5. **Cancelamento** com motivo obrigatório.
6. **Menu de 3 pontinhos** por cautela: Editar, Cancelar, Abrir, Histórico completo, Compartilhar (WhatsApp/PDF).

---

## 2. Estado Atual — Diagnóstico (achados de leitura de código e schema real, não hipóteses)

### 2.1 Schema de `cautelamentos` hoje (confirmado via MCP `information_schema.columns` + `pg_constraint`)

```
id, tenant_id, reserve_id, item_id, militar_id, armeiro_id,
condicao_emissao, condicao_devolucao, motivo_emissao,
data_emissao, data_devolucao, data_ultima_conferencia,
prazo_proxima_conferencia (date, nullable),
data_substituicao, substituido_por (fk→cautelamentos), substitui (fk→cautelamentos),
status (text, CHECK ANY['ativa','devolvida','substituida','em_revisao','cancelada']),
motivo_devolucao, militar_signature_id, armeiro_signature_id,
document_hash, pdf_storage_path, created_at, updated_at, movement_id
```

Três achados que mudam o desenho desta spec:

- **`status='cancelada' JÁ EXISTE no CHECK constraint** (`cautelamentos_status_check`), mas **zero
  código no repositório** (`grep '"cancelada"'` em `apps/bff/src` → 0 ocorrências) jamais escreve
  esse valor. É um valor previsto no schema e nunca implementado — não uma migration nova.
- **`prazo_proxima_conferencia` NÃO é o campo que o usuário pediu.** É uma data de reconferência
  periódica de custódia (ex: reconfirmar a cada 90 dias que o material continua com o militar),
  já usada em `createSchema` na emissão. O pedido do usuário é um **prazo de devolução
  obrigatória** — um conceito diferente, sem coluna própria hoje. Este spec introduz colunas
  novas (§4.1), não reaproveita `prazo_proxima_conferencia`.
- **`POST /api/cautelamentos/:id/substitute` já existe** (`cautelamentos.ts` linha ~971),
  completo com rastreabilidade bidirecional (`substitui`/`substituido_por`, nova cautela criada,
  antiga marcada `status='substituida'`) — mas **nenhuma tela do frontend o chama** (`grep
  "substitute"` em `apps/web/src` → 0 ocorrências). O backend da resposta ao pedido #4 já existe;
  falta só a UI. (Também recebeu, nesta mesma sessão, o mesmo guard de 2 assinaturas que
  `/return` — ver commit `fix(cautelas) CRITICO x2`.)

### 2.2 Por que o padrão de "notificação de vencimento" já existente no projeto NÃO deve ser copiado

Existe um precedente aparentemente análogo — `material_validity_warning` (validade de item,
ex: colete) — mas ao investigar como ele dispara, ele **não é automático em produção**:
`POST /api/arsenal/validity-alerts/run` (`arsenal.ts` linha ~431) é um endpoint que só roda
quando **chamado manualmente** por um `admin_reserva` (`roleGuard("admin_reserva")`), e
`grep "validity-alerts/run"` em `apps/web/src` → **0 ocorrências**: nenhuma tela do frontend o
chama. Ou seja, o único precedente de "notificação por proximidade de data" deste projeto está,
na prática, **morto em produção** — nunca dispara sozinho. Copiar esse padrão para a notificação
de vencimento de cautela reproduziria o mesmo problema (feature que existe no código mas nunca
roda). Este spec usa, em vez disso, o único mecanismo de agendamento que **de fato já funciona
em produção** neste projeto: `pg_cron` (extensão já habilitada, com 2 jobs reais rodando —
`revoked_sessions` cleanup e `biometric_bridge` nonce cleanup, ambos via `SELECT cron.schedule(...)`
direto no Postgres) — ver §4.3.

### 2.3 Notificações — mecanismo de entrega já funcional (reaproveitar, não recriar)

`notification-bell.tsx` já escuta o canal SSE `"notifications"` (`useSSERefresh("notifications",
handleNotificationEvent)`) e busca `GET /api/notifications`. Qualquer linha nova inserida em
`notifications` (para o `user_id` certo) já aparece no sino automaticamente — mesmo mecanismo
usado por `ocorrencia_aberta`, `armament_expired`, etc. **Não precisa de nenhuma mudança no
componente do sino** — só inserir as linhas certas. `notifications.type` é um enum Postgres
(`USER-DEFINED`, 24 valores confirmados via `pg_enum`, nenhum relacionado a cautela) — precisa de
2 valores novos (§4.1).

### 2.4 Histórico — a infraestrutura de auditoria já existe, falta só uma rota de leitura

Toda mutação de cautela (emissão, devolução) já grava em `service_log_events` via
`logShiftEvent()` (`subjectId: cautela.id, subjectType: "cautelamento"`), numa cadeia de hash
(`log_shift_event_atomic`, `SECURITY DEFINER`, encadeia `event_hash`/`prev_hash` por turno) —
a mesma tabela que alimenta o Livro Digital de Serviço. **Não existe hoje nenhum endpoint GET que
filtre esses eventos por `subject_id`** — o histórico "de tudo que ocorreu desde a abertura"
pedido pelo usuário é, na prática, uma **query nova sobre uma tabela que já tem os dados**, não
um sistema de auditoria novo. Eventos existentes hoje: `cautela_emitida`, `cautela_devolvida`.
Faltam: `cautela_assinada` (armeiro/militar — hoje as rotas de assinatura não geram evento de
Livro Digital, só atualizam a coluna), `cautela_cancelada`, `cautela_editada`.

### 2.5 Compartilhamento — nenhum precedente no projeto

`grep -rl "wa.me\|whatsapp"` em `apps/web/src` → 0 ocorrências. Esta é a primeira feature de
compartilhamento externo do produto. Restrição técnica real (não contornável): links `wa.me/...`
só aceitam **texto** — não existe parâmetro de URL para anexar um arquivo. Um PDF não pode ser
"enviado pelo WhatsApp" com 1 clique via link — as opções realistas são (a) `navigator.share()`
(Web Share API) com o PDF como `File`, que abre o *seletor nativo* do SO/navegador (inclui
WhatsApp entre as opções, mas não é exclusivo dele) — suportado em Chrome/Safari mobile e a
maioria dos desktops modernos, **não** suportado no Firefox desktop nem em navegadores muito
antigos; ou (b) baixar o PDF + abrir um link `wa.me` com um texto padrão (sem o arquivo anexado,
usuário anexa manualmente depois). Esta spec implementa os dois como opções separadas no mesmo
menu (§4.6), com fallback automático quando `navigator.share` não suporta arquivos.

---

## 3. Decisões de Design (assumidas — validar com o dono do produto na revisão desta spec)

| Decisão | Escolha assumida | Alternativa descartada e por quê |
|---|---|---|
| Onde mora o prazo | Colunas novas em `cautelamentos` (`prazo_devolucao_tipo`, `prazo_devolucao_data`) | Reaproveitar `prazo_proxima_conferencia` — semântica diferente (reconferência periódica ≠ prazo de devolução obrigatória); misturar os dois quebraria o comportamento já existente de quem usa reconferência hoje |
| Cálculo do prazo | `prazo_devolucao_data` calculada no **momento da emissão** (`data_emissao + N dias`), persistida (não recalculada em toda leitura) | Calcular só no `tipo` (enum) sem persistir a data — mais simples, mas complica a query de "vencidas" (teria que recalcular em SQL toda vez) e não sobrevive a mudança de fuso/regra de negócio futura |
| `indeterminado` | `prazo_devolucao_tipo='indeterminado'`, `prazo_devolucao_data=NULL` — nunca entra na verificação de vencimento | Forçar uma data arbitrária distante — poluiria a aba "Vencidas" eventualmente e é semanticamente errado (indeterminado = sem prazo, não = prazo muito longo) |
| Quando notificar | 2 gatilhos: **"vencendo"** (N dias antes, configurável, default 7 dias) e **"vencida"** (no dia seguinte ao vencimento, e a cada 3 dias enquanto continuar `ativa` e vencida — não spam diário) | Notificar só uma vez no vencimento — o usuário pediu explicitamente "vencida" como um estado contínuo visível, não um evento único que se perde no sino |
| Quem recebe a notificação | Militar (dono) + armeiro que emitiu + **todos** os `admin_reserva` da mesma reserva (via `reserve_memberships`) | Só o armeiro que emitiu — se ele estiver de folga/afastado por semanas, ninguém saberia; `admin_reserva` é o papel de supervisão que já recebe outras notificações administrativas (`arsenal_request`, etc.) |
| Cancelar exige as 2 assinaturas? | **Não** — cancelamento é para desfazer uma cautela **antes ou durante** o processo (ex: erro de cadastro, mudança de decisão), inclusive sem nenhuma assinatura ainda. Distinto de devolver/substituir (que pressupõe que a custódia de fato ocorreu). | Exigir assinatura tornaria impossível cancelar uma cautela emitida por engano antes do militar assinar — justamente o caso de uso mais comum de cancelamento |
| Editar o quê | Só campos **não-estruturais**: `motivo_emissao`, `prazo_devolucao_tipo/data`, `prazo_proxima_conferencia`. **Trocar item ou militar não é "editar", é "substituir"** (endpoint já existe, `/substitute`) | Permitir editar `item_id`/`militar_id` diretamente violaria a cadeia de custódia (a cautela original "muda de identidade" sem deixar rastro de que era outra pessoa/material antes) — pedir para usar `/substitute` preserva o rastro que o próprio usuário pediu ("como isso ficará rastreável") |
| Cancelamento com assinatura já completa | **Bloqueado** — uma cautela com as 2 assinaturas é um documento de custódia já formalizado; para encerrá-la, o caminho é devolver (ou substituir), não cancelar | Cancelar um documento já assinado por ambas as partes apagaria uma prova de custódia real, mesma classe de problema do bug corrigido em `/return` |

---

## 4. Requisitos

### CAULC-01 — Migration: colunas de prazo e cancelamento em `cautelamentos`

```sql
ALTER TABLE public.cautelamentos
  ADD COLUMN IF NOT EXISTS prazo_devolucao_tipo text
    CHECK (prazo_devolucao_tipo IN ('15_dias','30_dias','90_dias','6_meses','1_ano','indeterminado')),
  ADD COLUMN IF NOT EXISTS prazo_devolucao_data date,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

-- prazo_devolucao_data só faz sentido quando o tipo não é indeterminado nem nulo
ALTER TABLE public.cautelamentos
  ADD CONSTRAINT cautelamentos_prazo_devolucao_data_chk
    CHECK (
      (prazo_devolucao_tipo IS NULL) OR
      (prazo_devolucao_tipo = 'indeterminado' AND prazo_devolucao_data IS NULL) OR
      (prazo_devolucao_tipo <> 'indeterminado' AND prazo_devolucao_data IS NOT NULL)
    );

-- Índice parcial para a query de vencimento (só cautelas ativas com prazo definido)
CREATE INDEX IF NOT EXISTS idx_cautelamentos_prazo_devolucao_ativa
  ON public.cautelamentos (prazo_devolucao_data)
  WHERE status = 'ativa' AND prazo_devolucao_data IS NOT NULL;
```

`prazo_devolucao_tipo` nullable (não `NOT NULL DEFAULT`) — cautelas já existentes ficam sem
prazo definido (equivalente a "indeterminado" na prática, sem precisar de backfill; ver §6
pergunta 1).

### CAULC-02 — Migration: novos tipos de notificação

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'cautela_vencendo';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'cautela_vencida';
```

(Nome do enum a confirmar via `\d notifications` — inferido de `udt_name`; usar o nome real na
migration.)

### CAULC-03 — BFF: `POST /api/cautelamentos` aceita `prazo_devolucao_tipo`

`cautelamentos.ts`, `createSchema`: adicionar `prazo_devolucao_tipo: z.enum([...]).optional()`.
No handler, calcular `prazo_devolucao_data` a partir de `data_emissao` + mapa fixo
(`{15_dias: 15, 30_dias: 30, 90_dias: 90, 6_meses: 180, 1_ano: 365}` dias — usar `date-fns`
`addDays`/`addMonths`/`addYears` já disponível no projeto, não aritmética de dias corridos para
`6_meses`/`1_ano`, que erraria em anos bissextos). `indeterminado` ou ausente → ambos `NULL`.

### CAULC-04 — BFF: `POST /:id/cancel` (endpoint novo)

```ts
cautelamentosRoutes.post(
  "/:id/cancel",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({ motivo: z.string().min(5).max(500) })),
  async (c) => {
    // 1. requireActiveShift (mesmo padrão de /return e /substitute)
    // 2. SELECT cautela (id, status, tenant_id, item_id, armeiro_signature_id, militar_signature_id)
    // 3. 404 se não achar / tenant errado
    // 4. 422 se status !== "ativa"
    // 5. 422 SIGNATURES_COMPLETE se armeiro_signature_id && militar_signature_id
    //    ("Cautela já assinada por ambas as partes — use Devolver, não Cancelar.")
    // 6. UPDATE status='cancelada', motivo_cancelamento, cancelada_por, cancelada_em
    //    .eq("status","ativa") — mesma proteção contra corrida de /return e /substitute já usam
    // 7. Libera o item (status_operacional volta a 'disponivel', current_holder_user_id=null,
    //    active_cautelamento_id=null) — mesmo bloco de material_items de /return
    // 8. Notifica o militar (cautela cancelada, com o motivo)
    // 9. logShiftEvent: eventType "cautela_cancelada", description com o motivo
  }
);
```

### CAULC-05 — BFF: `PATCH /:id` (edição — endpoint novo, campos não-estruturais só)

```ts
cautelamentosRoutes.patch(
  "/:id",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    motivo_emissao: z.string().min(3).max(500).optional(),
    prazo_devolucao_tipo: z.enum([...]).optional().nullable(),
    prazo_proxima_conferencia: z.string().optional().nullable(),
  }).refine(b => Object.keys(b).length > 0, { message: "Nenhum campo para atualizar" })),
  async (c) => {
    // requireActiveShift + 404/tenant/status="ativa" (mesmo padrão)
    // Recalcula prazo_devolucao_data se prazo_devolucao_tipo mudou (mesma lógica de CAULC-03)
    // UPDATE .eq("status","ativa") — mesma proteção contra corrida
    // logShiftEvent: "cautela_editada", description listando os campos alterados (antes→depois)
  }
);
```

**Fora de escopo desta rota** (documentado, não esquecido): trocar `item_id`/`militar_id`.
Continua exigindo `/substitute`.

### CAULC-06 — BFF: eventos de Livro Digital para assinatura (gap encontrado em §2.4)

`POST /:id/sign-armeiro` e `/:id/sign-militar` (rotas já existentes) passam a chamar
`logShiftEvent({ eventType: "cautela_assinada", description: "Assinatura do armeiro/militar
registrada", ... })` — sem isso, o histórico pedido pelo usuário ("tudo que ocorreu desde a
abertura") teria um buraco exatamente no evento mais importante depois da emissão.

### CAULC-07 — BFF: `GET /:id/historico` (endpoint novo)

Query em `service_log_events` por `subject_id = :id AND subject_type = 'cautelamento'`,
**mais** os eventos de qualquer cautela na cadeia de substituição (`substitui`/`substituido_por`,
seguindo os 2 ponteiros recursivamente até `NULL` — uma cautela substituída 2x forma uma corrente
de até N elos) — o usuário pediu explicitamente "se foi substituída". Ordenado por
`happened_at ASC`. Tenant-scoped (`eq("tenant_id", tenantId)`, mesmo padrão de toda rota deste
arquivo). Retorna também os metadados já estruturados de cada evento (ator, quando, descrição).

### CAULC-08 — Postgres function + pg_cron: geração de notificação de vencimento

Nova função `SECURITY DEFINER` (mesmo padrão de `log_shift_event_atomic`,
`fn_check_reserve_org_unit_tenant`, etc. — `SET search_path = public, pg_temp`, ver v32):

```sql
CREATE OR REPLACE FUNCTION public.check_cautelas_vencimento()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- "Vencendo" (7 dias antes) — 1 notificação por cautela, nunca duplicada
  -- (tabela de controle cautela_vencimento_alert_events, mesmo padrão de
  -- material_validity_alert_events — 1 linha por (cautela_id, tipo_alerta),
  -- UNIQUE constraint evita duplicata mesmo se o cron rodar 2x)
  ...
  -- "Vencida" (a partir do dia seguinte, repetido a cada 3 dias enquanto
  -- status='ativa' — checa se já notificou nas últimas 72h antes de inserir de novo)
  ...
END;
$$;

SELECT cron.schedule(
  'cautelas-vencimento-diario',
  '0 8 * * *',  -- 08:00 diariamente (horário de expediente, não madrugada)
  $$SELECT public.check_cautelas_vencimento()$$
);
```

Tabela de controle nova (`cautela_vencimento_alert_events`) — mesmo raciocínio de
`material_validity_alert_events`: sem ela, rodar o cron 2x no mesmo dia (deploy, retry) duplicaria
notificações no sino de todo mundo.

### CAULC-09 — Frontend: menu de 3 pontinhos por cautela

Novo componente `_cautela-actions-menu.tsx`, reaproveitando `DropdownMenu` (`@/components/ui/
dropdown-menu`, já usado em `sidebar.tsx`) — substitui os botões soltos hoje espalhados nos 3
pontos de renderização (tabela/cards/dialog). Itens, condicionados ao estado da cautela (mesma
lógica de `canReturnCautela` já extraída):

- **Abrir** — sempre visível, abre o dialog de detalhe já existente.
- **Editar** — visível se `status==='ativa'`.
- **Cancelar** — visível se `status==='ativa' && !canReturnCautela(c)` (não permite cancelar já
  assinada por ambos — regra da tabela de decisões §3).
- **Devolver** — visível se `canReturnCautela(c)` (regra já existente, sem mudança).
- **Histórico** — sempre visível.
- **Compartilhar** — sempre visível.

### CAULC-10 — Frontend: dialog de Cancelar (motivo obrigatório)

Mesmo padrão visual de `Dialog` + `Textarea` já usado no dialog de Devolver
(`motivo_devolucao`), `min(5)` caracteres client-side espelhando o schema do BFF (CAULC-04).

### CAULC-11 — Frontend: dialog de Editar

Formulário com os 3 campos de CAULC-05 — reaproveita o `Select` de prazo (mesmo componente da
emissão, CAULC-13).

### CAULC-12 — Frontend: dialog de Histórico

Timeline vertical simples (ponto + linha conectando eventos, um `<li>` por evento de
`GET /:id/historico`) — ícone por `event_type` (reaproveitar mapeamento de ícone já usado em
`reserva/livro` para os mesmos `event_type`, SSOT: não inventar um segundo mapeamento
ícone→evento).

### CAULC-13 — Frontend: seletor de prazo no formulário de emissão

`_cautelas-client.tsx`, formulário "Nova Cautela": `<Select>` com as 6 opções do enum
(15/30/90 dias, 6 meses, 1 ano, indeterminado), default `indeterminado` (não força prazo em quem
não precisa). Mostra a data calculada resultante ao lado (preview client-side com a mesma tabela
de dias do BFF, só para feedback visual — o servidor recalcula e é a fonte de verdade).

### CAULC-14 — Frontend: menu Compartilhar

Dialog com 2 opções (ver §2.5 sobre a limitação técnica real do WhatsApp):

- **"Enviar"** — se `navigator.share` existir e `navigator.canShare({files:[...]})` retornar
  `true` (baixa o PDF via `fetch` do endpoint já existente, monta um `File`, chama
  `navigator.share({files, title, text})` — abre o seletor nativo do SO, que inclui WhatsApp
  quando instalado). Se `navigator.share` não suportar arquivos (Firefox desktop, navegadores
  antigos): abre `https://wa.me/?text=<resumo da cautela + aviso de que o PDF será baixado
  separadamente>` E dispara o download do PDF ao mesmo tempo (mesmo botão, 2 ações).
- **"Baixar PDF"** — reaproveita o `downloadPdf(c)` já existente no componente, sem mudança.

### CAULC-15 — Frontend: nova sub-aba "Vencidas"

`_cautelas-client.tsx` já tem abas por `filterStatus` (Todas/Ativa/Devolvidas/Em revisão/
Substituídas, inferido do primeiro screenshot do usuário). Nova aba **"Vencidas"** — filtro
client-side (não precisa de coluna computada nem de round-trip novo ao servidor):
`c.status === 'ativa' && c.prazo_devolucao_data && new Date(c.prazo_devolucao_data) < hoje`.
Badge de contagem na aba (mesmo padrão visual já usado nas outras abas, se existir contagem
hoje — confirmar ao implementar).

---

## 5. E2E Tests — IDs propostos

- `CAULC01` — emitir cautela com prazo "30 dias" → `prazo_devolucao_data` = emissão + 30 dias, persistida e exibida corretamente.
- `CAULC02` — emitir com "indeterminado" → `prazo_devolucao_data` NULL, nunca aparece em "Vencidas".
- `CAULC03` — cron de vencimento (chamado diretamente via `execute_sql` em teste, não esperando o schedule real) gera exatamente 1 notificação "vencendo" por cautela elegível, para militar+armeiro+admin_reserva da reserva — 0 duplicatas ao rodar 2x seguidas.
- `CAULC04` — cautela vencida aparece na aba "Vencidas"; ao devolver, some da aba (mesmo antes do cron rodar de novo).
- `CAULC05` — cancelar cautela sem nenhuma assinatura → sucesso, item volta a `disponivel`, notificação ao militar.
- `CAULC06` — cancelar cautela com as 2 assinaturas → 422, mensagem orienta a usar "Devolver".
- `CAULC07` — cancelar sem motivo (ou motivo < 5 caracteres) → 400, formulário não submete.
- `CAULC08` — editar `motivo_emissao` de cautela ativa → persistido, evento `cautela_editada` no histórico com antes/depois.
- `CAULC09` — editar cautela não-ativa (devolvida/cancelada) → 422.
- `CAULC10` — histórico de uma cautela substituída 2x mostra os eventos das 3 cautelas da corrente, em ordem cronológica.
- `CAULC11` — menu de 3 pontinhos: "Cancelar" some quando ambas as assinaturas existem; "Devolver" só aparece nesse caso (regressão do fix já em produção).
- `CAULC12` — compartilhar: em ambiente sem `navigator.share` de arquivo, abre `wa.me` E baixa o PDF.

---

## 6. Perguntas Abertas (decisão do dono do produto antes de implementar)

1. **Cautelas já existentes (antes desta feature)**: ficam com `prazo_devolucao_tipo=NULL`
   (tratadas como "sem prazo definido", nunca aparecem em "Vencidas", nunca notificam) — aceitável,
   ou é necessário definir um prazo padrão retroativo para elas (ex: "indeterminado" explícito)?
   Recomendação desta spec: deixar `NULL` sem prazo, sem backfill — atribuir um prazo retroativo
   arbitrário a cautelas já em andamento seria uma decisão de negócio que este código não pode
   tomar sozinho.
2. **Janela de "vencendo"**: 7 dias antes é um chute razoável, mas é o número certo? Deveria ser
   configurável por tenant/reserva (como já é `validity_alert_days` para validade de material),
   ou fixo é suficiente pra esta 1ª entrega?
3. **Cadência de "vencida"**: a cada 3 dias é arbitrário — o usuário quer notificação **contínua**
   (todo dia enquanto vencida) ou só teve a intenção de "avisar que venceu" (1 vez)? Isso muda o
   desenho do cron significativamente (idempotência por dia vs. por evento único).
4. **`admin_reserva` recebe TODAS as notificações de vencimento da reserva, sempre?** Em uma
   reserva grande, isso pode virar ruído — vale um filtro (ex: só depois de N dias vencida, se o
   armeiro ainda não resolveu)?
5. **Cancelamento de cautela em lote** (`movement_id` — várias cautelas da mesma operação): o
   pedido do usuário fala de 1 cautela por vez. Cancelar deveria ter uma variante "cancelar o lote
   inteiro" espelhando como emissão/devolução já tratam lote, ou fica só individual nesta entrega?

---

## 7. Ordem de Execução

1. Migrations (CAULC-01, CAULC-02) + tabela de controle do cron (§4, CAULC-08)
2. BFF: `POST /` aceita prazo (CAULC-03)
3. BFF: `/:id/cancel` (CAULC-04) — endpoint mais isolado, sem dependência dos outros
4. BFF: `PATCH /:id` edição (CAULC-05)
5. BFF: eventos de assinatura no Livro Digital (CAULC-06) — pré-requisito do histórico
6. BFF: `GET /:id/historico` (CAULC-07)
7. BFF: function + pg_cron de vencimento (CAULC-08)
8. Frontend: menu de 3 pontinhos + dialogs de Cancelar/Editar/Histórico (CAULC-09..12)
9. Frontend: seletor de prazo na emissão (CAULC-13)
10. Frontend: Compartilhar (CAULC-14)
11. Frontend: aba "Vencidas" (CAULC-15)
12. E2E suite completa (CAULC01..12)
13. Code review sênior obrigatório (≥9.5) + CHANGELOG + validação visual Playwright (script standalone, nunca `npx playwright test`)

---

## 8. Definition of Done

- [ ] Migrations aplicadas e verificadas via MCP (colunas, constraint, índice, enum, tabela de controle)
- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] `/:id/cancel` recusa cautela já assinada por ambas as partes (CAULC06)
- [ ] `/:id/cancel` e `PATCH /:id` protegidos contra corrida (`.eq("status","ativa")` no update)
- [ ] Cron de vencimento idempotente (CAULC03) — testado chamando a function diretamente, não esperando o schedule real
- [ ] Histórico mostra a cadeia completa de substituições (CAULC10)
- [ ] Menu de 3 pontinhos com todos os itens condicionados corretamente ao estado
- [ ] Compartilhar funciona com e sem suporte a `navigator.share` de arquivo
- [ ] E2E suite `CAULC01..12` criada e passando
- [ ] Code review sênior ≥9.5/10, sem CRÍTICO/ALTO pendente
- [ ] CHANGELOG atualizado
