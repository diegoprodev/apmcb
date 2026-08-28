# Enterprise Spec — Ciclo de Vida da Cautela (Prazo, Vencimento, Cancelamento, Edição, Histórico, Compartilhamento)

> **Data:** 2026-08-28
> **Fase:** Cautela Permanente — Gestão de Ciclo de Vida Completo
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling
> **Depende de:** fix `cautela-signatures-required-for-return` (2026-08-28, já em produção — devolução/substituição agora exigem as 2 assinaturas)
> **Revisão adversarial (2026-08-28), 3 rodadas**: 6.5/10 → 8/10 → 7.5/10 (cada rodada corrigiu os
> achados da anterior e a releitura completa achou algo novo — padrão esperado, não sinal de que a
> spec está piorando). Total: 3 CRÍTICOS + 6 ALTOS + 2 MÉDIOS + 2 BAIXOS encontrados e corrigidos
> nesta versão. Os 2 últimos ALTOS (3ª rodada) foram corrigidos mas **ainda sem verificação
> independente de uma 4ª rodada** — ver §9 para o registro completo. Nenhuma rodada chegou a
> 9.5/10; não declarar esta spec "enterprise-grade" até uma rodada fechar sem achado novo.

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

### 2.3 Notificações — mecanismo de entrega já funcional, MAS o componente do sino precisa de mudança sim

`notification-bell.tsx` já escuta o canal SSE `"notifications"` (`useSSERefresh("notifications",
handleNotificationEvent)`) e busca `GET /api/notifications` — a *entrega* de uma linha nova não
precisa de mudança nenhuma, isso está correto.

**Achado CRÍTICO da revisão adversarial**: a versão anterior desta spec afirmava "não precisa de
nenhuma mudança no componente do sino" — **falso**. `notification-bell.tsx` tem `type
NotificationType` como union **fechada** (16 literais) e **3** `Record<NotificationType, ...>`
indexados por esse tipo (`TYPE_ICON`, `TYPE_DOT`, `TYPE_ICON_BG`), mais um `switch` em
`resolveNotificationRoute` com `default: return null`. Sem adicionar `cautela_vencendo`/
`cautela_vencida` a esses 4 pontos, a notificação chega no sino com ícone `undefined`/cor
`undefined` (círculo vazio) e clicar nela não navega pra lugar nenhum. Corrigido: CAULC-02 passa a
incluir, além da migration do enum Postgres, a mudança em `notification-bell.tsx`: (a) adicionar
os 2 literais a `NotificationType`; (b) 1 entrada em cada um dos 3 `Record` (ícone sugerido:
`Clock`/`AlertTriangle`, mesma família já usada por `material_validity_warning`/
`armament_expired`); (c) 1 `case` em `resolveNotificationRoute` navegando para
`/reserva/cautelas?status=ativa` (ou `/efetivo/minhas-cautelas` quando o destinatário for o
militar — checar `role` disponível no componente ou no payload da notificação).

`notifications.type` é um enum Postgres (nome real confirmado via `pg_enum`:
**`notification_type_enum`**, não `notification_type` como uma versão anterior desta spec
supôs — corrigido em CAULC-02) — precisa de 2 valores novos.

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

**Achado ALTO da 3ª rodada de revisão adversarial**: colunas novas numa tabela não bastam — o
endpoint que o frontend de fato consome (`GET /api/cautelamentos`, `cautelamentos.ts` linhas
~223-256, chamado por `_cautelas-client.tsx`) tem um `SELECT` explícito por nome de coluna
(`id, status, motivo_emissao, condicao_emissao, data_emissao, prazo_proxima_conferencia,
armeiro_signature_id, militar_signature_id, movement_id, item, militar, armeiro`) — colunas
novas **não aparecem automaticamente** nesse retorno. Sem atualizar esse SELECT, CAULC-15 (aba
"Vencidas") ficaria sempre vazia em silêncio (`c.prazo_devolucao_data` sempre `undefined`),
mesmo com cautelas de fato vencidas no banco — um bug de spec incompleta, não de implementação.
**Passo obrigatório**: `GET /api/cautelamentos` passa a incluir `prazo_devolucao_data,
prazo_devolucao_tipo, cancelada_por, cancelada_em, motivo_cancelamento` no SELECT (os 2 últimos
grupos também são necessários pra exibir o resultado do cancelamento, CAULC-04, no mesmo
componente).

### CAULC-02 — Migration: novos tipos de notificação (+ mudança no frontend, achado CRÍTICO — ver §2.3)

Nome real do enum confirmado via `pg_enum`/`information_schema` na revisão adversarial:
**`notification_type_enum`** (a versão anterior desta spec usava `notification_type`, incorreto).

```sql
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'cautela_vencendo';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'cautela_vencida';
```

**Achado ALTO da revisão adversarial — restrição real do Postgres**: um valor de enum recém
adicionado via `ADD VALUE` **não pode ser usado (nem em `INSERT`, nem em comparação) dentro da
mesma transação** em que foi criado — Postgres recusa com `unsafe use of new value of enum type`
se isso acontecer. Isto significa:

1. **Esta migration (CAULC-02) precisa ser seu próprio arquivo de migration**, aplicada e
   **commitada** (cada migration do Supabase já roda como sua própria transação — não agrupar o
   `ALTER TYPE` na mesma migration que já insere ou compara esses valores).
2. A function de CAULC-08 (que faz `INSERT INTO notifications (..., type, ...) VALUES (...,
   'cautela_vencendo', ...)`) só pode ser criada/aplicada numa migration **posterior e separada**
   — a ordem de execução em §7 (passo 1 = migrations, incluindo CAULC-02; passo 7 = function de
   CAULC-08) já reflete isso, mas fica dito aqui explicitamente para quem for implementar não
   agrupar os dois num único arquivo por parecer "mais limpo".

Junto com a migration SQL, CAULC-02 inclui a mudança em `notification-bell.tsx` descrita em
§2.3 (3 `Record` + 1 `case` de rota) — sem ela, a notificação chega, mas ilegível/sem ação.

### CAULC-03 — BFF: `POST /api/cautelamentos` aceita `prazo_devolucao_tipo`

**Achado CRÍTICO da revisão adversarial**: a versão anterior desta spec afirmava que `date-fns`
"já está disponível no projeto" — **falso**, verificado em `apps/bff/package.json` (dependências:
`@hono/zod-validator, @pdf-lib/fontkit, @supabase/supabase-js, @types/web-push, hono,
iron-session, otplib, pdf-lib, pino, qrcode, sharp, web-push, zod` — sem `date-fns`, e não está
instalado nem transitivamente). Corrigido: **sem dependência nova**, usar `Date` nativo do
Node/V8, que já lida corretamente com rollover de mês/ano:

**Achado ALTO da 2ª rodada de revisão adversarial**: a 1ª correção deste bloco (usar `Date`
nativo em vez de `date-fns`) resolveu o problema de dependência, mas reintroduziu — sem querer —
a mesma classe de bug de fuso horário que este MESMO ARQUIVO já documenta e corrige em outro
lugar (`cautelamentos.ts:375-379`, checagem de `validade_item`): comparar/computar uma coluna
`date` pura usando `Date` local (que carrega meia-noite UTC) erra o dia perto da virada, no
horário de Brasília. `calcularPrazoDevolucao` original recebia/devolvia `Date`; corrigido para
trabalhar inteiramente com strings `"yyyy-mm-dd"` em horário de Brasília, exatamente o idioma já
estabelecido naquela linha — nunca com `Date` bruto:

```ts
// Mesmo padrão já estabelecido em cautelamentos.ts:379 (checagem de validade_item):
// SEMPRE strings "yyyy-mm-dd" em horário de Brasília pra qualquer coisa que vire uma
// coluna `date` pura — nunca `Date` bruto, que carrega meia-noite UTC e erra o dia
// perto da virada (~3h de diferença, UTC-3).
function hojeBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Aritmética de calendário sobre a string, usando um Date ancorado em UTC só como
// ferramenta de cálculo (sempre getUTC*/setUTC*, nunca getters locais — evita que o
// fuso do processo Node reintroduza a mesma deriva por outro caminho).
function addDiasCalendario(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

// Mesmo bug clássico de overflow do `setMonth` (31/jan + 1 mês = 3/mar, não existe
// 31/fev) — trava o dia em 1 antes de avançar o mês, clampa pro último dia real depois.
function addMesesCalendarioClamped(dataISO: string, meses: number): string {
  const [y, m, d] = dataISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + meses);
  const diasNoMesDestino = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, diasNoMesDestino));
  return dt.toISOString().slice(0, 10);
}

// Achado ALTO da 3ª rodada de revisão adversarial: a §3 declara que o prazo é calculado "no
// momento da EMISSÃO" (data_emissao + N dias) — mas esta função, sem o 2º parâmetro, sempre
// usaria "hoje" como âncora. Isso está correto quando chamada na EMISSÃO (hoje == data_emissao),
// mas CAULC-05 reaproveita esta mesma função pra RECALCULAR o prazo ao editar uma cautela dias/
// semanas depois — sem o parâmetro, editar recalcularia a partir do dia da EDIÇÃO, não da
// emissão original, violando a própria regra da §3 (exemplo concreto: cautela emitida 01/01,
// editada 15/01 pra "90_dias" — deveria dar 01/04, não 15/04). `dataBase` default é
// `hojeBrasilia()` pra manter CAULC-03 (emissão) sem precisar passar nada.
function calcularPrazoDevolucao(tipo: string | undefined, dataBase: string = hojeBrasilia()): string | null {
  if (!tipo || tipo === "indeterminado") return null;
  switch (tipo) {
    case "15_dias": return addDiasCalendario(dataBase, 15);
    case "30_dias": return addDiasCalendario(dataBase, 30);
    case "90_dias": return addDiasCalendario(dataBase, 90);
    case "6_meses": return addMesesCalendarioClamped(dataBase, 6);
    case "1_ano": return addMesesCalendarioClamped(dataBase, 12); // ano bissexto: só afeta 29/fev, mesma função resolve
    default: return null;
  }
}
```

Retorna string `"yyyy-mm-dd"` pronta pra inserir direto na coluna `date` via supabase-js — sem
round-trip por `Date`/`toISOString()` completo, que reintroduziria a ambiguidade de fuso.

`cautelamentos.ts`, `createSchema`: adicionar `prazo_devolucao_tipo: z.enum([...]).optional()`.
No handler de criação, chamar `calcularPrazoDevolucao(body.prazo_devolucao_tipo)` (sem 2º
argumento — âncora é "hoje", que na emissão é a própria `data_emissao`). Em CAULC-05 (edição),
chamar `calcularPrazoDevolucao(body.prazo_devolucao_tipo, dataEmissaoBrasiliaStr)`, onde
`dataEmissaoBrasiliaStr` é a `data_emissao` (coluna `timestamptz`) da cautela **convertida pra
string `"yyyy-mm-dd"` em horário de Brasília** — `new Date(data_emissao).toLocaleDateString(
"en-CA", {timeZone:"America/Sao_Paulo"})`, nunca um `.slice(0,10)` ingênuo do ISO (que
reintroduziria a mesma classe de bug de fuso que esta correção existe pra eliminar).

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
    // 6. UPDATE status='cancelada', motivo_cancelamento, cancelada_por, cancelada_em —
    //    Achado MÉDIO de code review: a proteção contra corrida real usada em /return e
    //    /substitute é a COMBINAÇÃO .eq("id", id).eq("tenant_id", tenantId)
    //    .eq("status", "ativa") no MESMO .update(), seguida de .select("id").single() —
    //    se 0 linhas voltarem (outra requisição já mudou o status entre o SELECT do passo 2
    //    e este UPDATE), responder 409 "Cautela não encontrada ou já alterada", não assumir
    //    sucesso. Replicar exatamente essa combinação aqui, não só ".eq(status,ativa)" solto.
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
    // requireActiveShift + SELECT (id, tenant_id, status, data_emissao, ...) + 404/tenant/status="ativa"
    // Se prazo_devolucao_tipo veio no body: recalcula prazo_devolucao_data via
    // calcularPrazoDevolucao(tipo, dataEmissaoBrasiliaStr) — âncora é a data_emissao ORIGINAL
    // da cautela (já lida no SELECT acima), convertida pra "yyyy-mm-dd" em horário de Brasília,
    // NUNCA "hoje" (achado ALTO de code review — reusar a função sem o 2º argumento aqui
    // recalcularia a partir da data da edição, não da emissão, contradizendo a regra da §3)
    // UPDATE combinando .eq("id",id).eq("tenant_id",tenantId).eq("status","ativa") no mesmo
    // .update() + .select("id").single() — mesma proteção contra corrida detalhada em CAULC-04,
    // 409 se 0 linhas afetadas
    // logShiftEvent: "cautela_editada", description listando os campos alterados (antes→depois)
  }
);
```

**Fora de escopo desta rota** (documentado, não esquecido): trocar `item_id`/`militar_id`.
Continua exigindo `/substitute`.

### CAULC-06 — BFF: eventos de Livro Digital para assinatura, cancelamento e edição (gap encontrado em §2.4)

**Achado CRÍTICO da revisão adversarial**: `apps/bff/src/lib/shift-events.ts` define
`ShiftEventType` como union TypeScript **fechada** (`"turno_assumido" | "cautela_emitida" |
"cautela_devolvida" | "saida_autorizada" | "saida_devolvida" | "ocorrencia_registrada" |
"solicitacao_aprovada" | "solicitacao_negada" | "inventario_divergencia" | "turno_encerrado" |
"evento_manual"`) — a versão anterior desta spec mandava usar `"cautela_cancelada"`,
`"cautela_editada"`, `"cautela_assinada"` como se já coubessem nesse tipo. Não cabem: `tsc
--noEmit` falharia. **Passo obrigatório, antes de qualquer chamada `logShiftEvent` com esses
literais**: estender o union em `shift-events.ts` com os 3 novos valores.

Depois disso: `POST /:id/sign-armeiro` e `/:id/sign-militar` (rotas já existentes) passam a chamar
`logShiftEvent({ eventType: "cautela_assinada", description: "Assinatura do armeiro/militar
registrada", ... })` — sem isso, o histórico pedido pelo usuário ("tudo que ocorreu desde a
abertura") teria um buraco exatamente no evento mais importante depois da emissão. `/:id/cancel`
(CAULC-04) usa `"cautela_cancelada"`; `PATCH /:id` (CAULC-05) usa `"cautela_editada"`.

### CAULC-07 — BFF: `GET /:id/historico` (endpoint novo)

Query em `service_log_events` por `subject_id = :id AND subject_type = 'cautelamento'`,
**mais** os eventos de qualquer cautela na cadeia de substituição (`substitui`/`substituido_por`,
seguindo os 2 ponteiros recursivamente até `NULL` — uma cautela substituída 2x forma uma corrente
de até N elos) — o usuário pediu explicitamente "se foi substituída". Ordenado por
`happened_at ASC`. Tenant-scoped (`eq("tenant_id", tenantId)`, mesmo padrão de toda rota deste
arquivo). Retorna também os metadados já estruturados de cada evento (ator, quando, descrição).

### CAULC-08 — Postgres function + pg_cron: geração de notificação de vencimento

Nova função `SECURITY DEFINER` (mesmo padrão de `log_shift_event_atomic` — `SET search_path =
public, pg_temp`, ver v32; achado BAIXO da revisão adversarial: a versão anterior citava também
`fn_check_reserve_org_unit_tenant` como exemplo de `SECURITY DEFINER`, mas essa função só tem
`search_path` fixo, não é `SECURITY DEFINER` — removida a citação incorreta):

```sql
CREATE OR REPLACE FUNCTION public.check_cautelas_vencimento()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
BEGIN
  -- Achado ALTO da 2ª rodada de revisão adversarial: a sessão do pg_cron roda em
  -- UTC (confirmado via current_setting('TimeZone') = 'UTC' no projeto real) —
  -- CURRENT_DATE aqui seria a data em UTC, não em Brasília, mesma classe de bug já
  -- corrigida em cautelamentos.ts:379 pro caminho da aplicação. v_hoje é a data em
  -- horário de Brasília, comparada como `date` contra prazo_devolucao_data (também
  -- calculado em horário de Brasília, CAULC-03) — os dois lados do "<"/"=" agora
  -- estão no mesmo referencial de fuso.
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- "Vencendo" (7 dias antes) — 1 notificação por cautela, nunca duplicada
  -- (tabela de controle cautela_vencimento_alert_events, mesmo padrão de
  -- material_validity_alert_events — 1 linha por (cautela_id, tipo_alerta),
  -- UNIQUE constraint evita duplicata mesmo se o cron rodar 2x)
  -- WHERE prazo_devolucao_data = v_hoje + 7 ...
  ...
  -- "Vencida" (a partir do dia seguinte, repetido a cada 3 dias enquanto
  -- status='ativa' — checa se já notificou nas últimas 72h antes de inserir de novo)
  -- WHERE prazo_devolucao_data < v_hoje ...
  ...
END;
$$;

-- Achado ALTO da revisão adversarial: '0 8 * * *' rodaria às 8h UTC, não 8h de Brasília —
-- confirmado via `SHOW timezone`/`current_setting('cron.timezone')` no projeto real: o banco e
-- o pg_cron rodam em UTC/GMT, não America/Recife. 8h BRT (UTC-3) = 11h UTC. A versão anterior
-- desta spec tinha esse erro (dizia "08:00, horário de expediente" mas rodaria às 5h da manhã).
SELECT cron.schedule(
  'cautelas-vencimento-diario',
  '0 11 * * *',  -- 11h UTC = 8h America/Recife (UTC-3) — horário de expediente de fato
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

**Correção da revisão adversarial**: a versão anterior desta spec listava as abas como "Todas/
Ativa/Devolvidas/Em revisão/Substituídas" (inferido só do screenshot do usuário, sem checar o
código). Conferido em `_cautelas-client.tsx` (linha ~590): são **4**, não 5 —
`["ativa","devolvida","substituida"]` + "Todas". **Não existe aba "Em revisão" hoje**, mesmo o
status existindo no CHECK constraint (ver nota sobre `em_revisao` abaixo).

Nova aba **"Vencidas"** — filtro client-side (não precisa de coluna computada nem de round-trip
novo ao servidor). **Achado ALTO da 2ª rodada de revisão adversarial**: a versão anterior
comparava `new Date(c.prazo_devolucao_data) < hoje` — mesma classe de bug de fuso do CAULC-03,
`new Date()` sobre um `date` puro carrega meia-noite UTC. Corrigido pra comparação de **string**
(`prazo_devolucao_data` já vem como `"yyyy-mm-dd"` do banco), mesmo idioma de `hojeBrasilia()`
(CAULC-03): `c.status === 'ativa' && c.prazo_devolucao_data && c.prazo_devolucao_data <
hojeBrasilia()`. Badge de contagem na aba (mesmo padrão visual já usado nas outras abas, se
existir contagem hoje — confirmar ao implementar).

**Nota sobre `status='em_revisao'` (achado MÉDIO da revisão adversarial, não tratado como bug
desta spec)**: o status existe no CHECK constraint e tem badge/label prontos em pelo menos 2
componentes do frontend, mas **nenhuma rota do BFF jamais o escreve** (`grep "em_revisao"` em
`apps/bff/src` → 0 ocorrências) — é inalcançável em produção hoje, de forma pré-existente e não
relacionada a este pedido. CAULC-04/05 restringem cancelar/editar a `status==='ativa'`, o que já
exclui `em_revisao` (correto, ainda que por acidente de ele ser inalcançável) — registrado aqui
para não ser confundido com uma omissão nova desta spec.

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
- `CAULC13` — cautela emitida em 01/01 com prazo "indeterminado", editada em 15/01 pra "90_dias" → `prazo_devolucao_data` = 01/04 (90 dias da EMISSÃO original), não 15/04 (90 dias da edição) — achado da 3ª rodada de revisão adversarial (CAULC-05).
- `CAULC14` — cautela vencida de fato (prazo no passado) aparece na aba "Vencidas" logo após emitida — cobre o achado de que `GET /api/cautelamentos` precisa devolver `prazo_devolucao_data` no payload (achado da 3ª rodada, CAULC-01/CAULC-15).
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

1. **Migration CAULC-01** (colunas de prazo/cancelamento em `cautelamentos`) — arquivo próprio.
2. **Migration CAULC-02** (`ALTER TYPE ... ADD VALUE`) — **arquivo separado da migration
   anterior E de qualquer coisa que use os valores novos** (restrição de transação do Postgres,
   ver CAULC-02) + tabela de controle do cron (`cautela_vencimento_alert_events`, CAULC-08).
3. BFF: estender `ShiftEventType` em `shift-events.ts` com os 3 literais novos (CAULC-06,
   pré-requisito de tudo que chama `logShiftEvent` com eles).
4. BFF: `calcularPrazoDevolucao()` (CAULC-03, SSOT) + `POST /` aceita prazo.
5. BFF: `/:id/cancel` (CAULC-04) — endpoint mais isolado, sem dependência dos outros.
6. BFF: `PATCH /:id` edição (CAULC-05) — reaproveita `calcularPrazoDevolucao()` do passo 4.
7. BFF: eventos de assinatura no Livro Digital (CAULC-06, parte 2) — pré-requisito do histórico.
8. BFF: `GET /:id/historico` (CAULC-07).
9. BFF: function `check_cautelas_vencimento()` + `pg_cron` (CAULC-08) — só depois que a
   migration CAULC-02 (passo 2) já foi commitada.
10. Frontend: `notification-bell.tsx` — estender `NotificationType` + os 3 `Record` + rota
    (CAULC-02, parte 2 — sem isso a notificação chega ilegível).
11. Frontend: menu de 3 pontinhos + dialogs de Cancelar/Editar/Histórico (CAULC-09..12).
12. Frontend: seletor de prazo na emissão (CAULC-13).
13. Frontend: Compartilhar (CAULC-14).
14. Frontend: aba "Vencidas" (CAULC-15).
15. E2E suite completa (CAULC01..12).
16. Code review sênior obrigatório (≥9.5) + CHANGELOG + validação visual Playwright (script standalone, nunca `npx playwright test`).

---

## 8. Definition of Done

- [ ] Migrations aplicadas e verificadas via MCP (colunas, constraint, índice, enum em migration própria, tabela de controle)
- [ ] `ShiftEventType` estendido com os 3 literais novos ANTES de qualquer `logShiftEvent` usá-los
- [ ] `notification-bell.tsx` atualizado (tipo + 3 `Record` + rota) — notificação legível e clicável, não só entregue
- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] `/:id/cancel` recusa cautela já assinada por ambas as partes (CAULC06)
- [ ] `/:id/cancel` e `PATCH /:id` protegidos contra corrida — `.eq("id",id).eq("tenant_id",tenantId).eq("status","ativa")` no mesmo update + 409 se 0 linhas afetadas (não só `.eq("status","ativa")` solto)
- [ ] `calcularPrazoDevolucao()` testado com data de emissão em dia 29/30/31 (rollover de mês) e 29/fev (ano bissexto)
- [ ] Cron roda no horário de Brasília correto (`'0 11 * * *'` = 8h BRT, banco em UTC) e é idempotente (CAULC03) — testado chamando a function diretamente, não esperando o schedule real
- [ ] Histórico mostra a cadeia completa de substituições (CAULC10)
- [ ] Menu de 3 pontinhos com todos os itens condicionados corretamente ao estado
- [ ] Compartilhar funciona com e sem suporte a `navigator.share` de arquivo
- [ ] E2E suite `CAULC01..12` criada e passando
- [ ] Code review sênior ≥9.5/10, sem CRÍTICO/ALTO pendente
- [ ] CHANGELOG atualizado

---

## 9. Registro de Revisão Adversarial (2026-08-28) — transparência

A 1ª versão desta spec foi submetida a uma revisão adversarial (mesmo rigor de code review,
verificando cada alegação factual contra o repositório e o banco reais, não aceitando "achado" de
bandeja) e recebeu **nota 6.5/10 — não enterprise-grade**. Achados e correção nesta versão:

| # | Severidade | Achado | Corrigido em |
|---|---|---|---|
| 1 | CRÍTICO | `date-fns` não existe no projeto (spec afirmava o contrário) | CAULC-03 (`Date` nativo + `addMonthsClamped`) |
| 2 | CRÍTICO | `ShiftEventType` é union fechada, não continha os 3 eventos novos | CAULC-06 + Ordem de Execução passo 3 |
| 3 | CRÍTICO | `notification-bell.tsx` precisa de mudança (spec dizia que não) | §2.3 + CAULC-02 + Ordem de Execução passo 10 |
| 4 | ALTO | Cron `'0 8 * * *'` roda 5h da manhã em Brasília (banco em UTC) | CAULC-08 (`'0 11 * * *'`) |
| 5 | ALTO | Restrição do Postgres sobre usar enum recém-criado na mesma transação, não mencionada | CAULC-02 (migration própria, explícito) |
| 6 | MÉDIO | Abas citadas (5, com "Em revisão") não batem com o código real (4) | CAULC-15 |
| 7 | MÉDIO | `status='em_revisao'` nunca escrito por nenhuma rota, não discutido | CAULC-15 (nota) |
| 11 | ALTO | **(achado na 2ª rodada, depois da 1ª correção)** `calcularPrazoDevolucao` e o filtro "Vencidas" usavam `Date` bruto — mesma classe de bug de fuso que `cautelamentos.ts:379` já documenta e corrige (meia-noite UTC ≠ meia-noite Brasília) — a 1ª correção do achado #1 trocou `date-fns` por `Date` nativo mas não aplicou o idioma de fuso já estabelecido no arquivo | CAULC-03 (strings `"yyyy-mm-dd"` + `hojeBrasilia()`), CAULC-15 (comparação de string), CAULC-08 (`v_hoje` via `AT TIME ZONE 'America/Sao_Paulo'` na function SQL) — **confirmado correto na 3ª rodada com query real no Supabase** |
| 12 | ALTO | **(achado na 3ª rodada)** `GET /api/cautelamentos` não seleciona `prazo_devolucao_data`/`prazo_devolucao_tipo` — aba "Vencidas" (CAULC-15) ficaria sempre vazia em silêncio, mesmo com cautelas vencidas de fato no banco | CAULC-01 (SELECT explícito documentado) + E2E `CAULC14` |
| 13 | ALTO | **(achado na 3ª rodada)** `calcularPrazoDevolucao` sempre usava "hoje" como âncora — reaproveitada em CAULC-05 (editar prazo de cautela já emitida), recalcularia a partir da data da EDIÇÃO, contradizendo a própria regra da §3 ("calculado no momento da emissão") | CAULC-03 (2º parâmetro `dataBase`) + CAULC-05 (passa `data_emissao` original, convertida corretamente pra horário de Brasília) + E2E `CAULC13` |
| 8 | MÉDIO | Proteção contra corrida resumida vagamente ("mesma de /return") sem repetir a combinação exata | CAULC-04/05 (combinação explícita) |
| 9 | BAIXO | `fn_check_reserve_org_unit_tenant` citada como `SECURITY DEFINER` (não é) | Removida a citação incorreta |
| 10 | BAIXO | Nome do enum de notificação (`notification_type` vs real `notification_type_enum`) | CAULC-02 |

Confirmado correto pela revisão (não mudou): schema de `cautelamentos`, `status='cancelada'`
nunca escrito, `/:id/substitute` órfão de UI, `validity-alerts/run` morto em produção, os 2 jobs
`pg_cron` reais citados, enum de notificações (24 valores, nenhum de cautela), ausência de
precedente WhatsApp, schema de `service_log_events`.
