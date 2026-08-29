# Enterprise Spec — Alertas de Vencimento Unificados (Cautela + Validade de Material)

> **Data:** 2026-08-29
> **Fase:** Extensão do ciclo de vida da cautela (`cautela-lifecycle-enterprise.md`, já em
> produção) + reativação do sistema de validade de material
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling
> **Decisões já confirmadas com o dono do produto** (perguntas fechadas antes de escrever esta
> spec): backfill de cautelas existentes = 90 dias a partir de hoje; configuração de janela de
> alerta é por RESERVA (não por tenant); cautela e validade de material compartilham 1 mecanismo
> de configuração unificado.
> **Revisão adversarial (2026-08-29)**: 1ª rodada achou 2 CRÍTICOS verificados no banco real (AVU-04
> permitia configurar dias fora do CHECK constraint de `material_validity_alert_events`, o que
> abortaria o cron inteiro silenciosamente; AVU-08 removia o escopo por reserva do endpoint
> existente, virando uma ação sem limite de tenant contra 49 tenants/17 reservas reais — violação
> de Privilege Ceiling) + 2 MÉDIOS (materiais com `reserve_id` nulo ficam fora do sistema, sem
> documentação; ambiguidade na contagem exata de dias do snooze). Nota 6/10. Todos corrigidos
> nesta versão — ver §9.

---

## 1. Contexto e Motivação

Pedido do usuário (verbatim, consolidado):

> "como reativar e fazer o alerta de validade funcionar no sistema? [...] cautela e[x]istente deve
> ganhar retroativo a janela de vencimento deve ser configurável pelo admin da reserva. ele escolhe
> o tipo de alerta ok. ou seja é personalizável. e se vencida deve alertar todo dia com opção de
> adiar pro mais dia personalizável para armeiro etc... ou não mostrar!"

Quatro pedidos:
1. **Reativar o alerta de validade de material** — sistema já existe no código mas nunca dispara em produção (`docs/enterprise/specs/cautela-lifecycle-enterprise.md` §2.2 já documentou isso).
2. **Backfill retroativo**: cautelas já existentes sem `prazo_devolucao_data` ganham um prazo agora.
3. **Janela de alerta configurável pelo admin da reserva** — tanto pra cautela quanto pra material, unificado.
4. **"Vencida" alerta todo dia** (hoje é a cada 3 dias) **+ opção de adiar (snooze) por N dias personalizável, ou silenciar de vez**.

---

## 2. Estado Atual — Diagnóstico (leitura de código/schema real, não hipótese)

### 2.1 Por que o alerta de validade de material está morto (confirmado na spec anterior, revalidado aqui)

`POST /api/arsenal/validity-alerts/run` (`arsenal.ts:431`) só roda quando um `admin_reserva`
chama manualmente — `grep "validity-alerts/run"` em `apps/web/src` → 0 ocorrências, nenhuma tela
chama. **Achado NOVO nesta spec**: mesmo que alguém chamasse manualmente, a notificação criada
(`type: "material_validity_warning"`, linha 491) **nunca aparece corretamente no sino** —
`grep "material_validity_warning"` em `notification-bell.tsx` → **0 ocorrências**: o tipo não está
no union `NotificationType`, não está em nenhum dos 3 `Record` (ícone/cor/fundo) nem tem `case` em
`resolveNotificationRoute` — exatamente a mesma classe de bug (4 lugares fechados por tipo) já
encontrada e corrigida 2x para os tipos de cautela. Notificação chegaria com ícone `undefined` e
sem navegação ao clicar.

**Achado NOVO — bug de fuso horário no cálculo, nunca corrigido porque o endpoint nunca rodou de
verdade**: `today.setHours(0, 0, 0, 0)` (linha 437) zera a hora no fuso do PROCESSO Node (o VPS,
provavelmente UTC), não em horário de Brasília — mesma classe de bug já corrigida em
`cautelamentos.ts:379` e em toda a spec anterior. Como o endpoint nunca roda em produção, esse bug
nunca se manifestou, mas seria reintroduzido se o endpoint fosse simplesmente "reativado" sem
correção.

### 2.2 O que já existe e deve ser reaproveitado (não recriado)

- **`material_types.validity_alert_days`** (`integer[]`) — já é um "tipo de alerta configurável"
  por material, editável no cadastro (`arsenal.ts:210,345,658`, fallback hoje hardcoded
  `[365, 180, 90]` quando vazio, linha 466). O pedido do usuário ("admin escolhe o tipo de
  alerta") já está parcialmente resolvido aqui — falta só o **fallback vindo de uma configuração
  real da reserva**, não um literal no código.
- **`material_validity_alert_events`** — já tem `UNIQUE (material_item_id, alert_days,
  validade_item)` (confirmado via `pg_indexes`) — dedup real já existe, ao contrário do que a
  spec de cautela precisou criar do zero. Reaproveitar como está.
- **Padrão de settings por reserva já estabelecido**: `reserves.allow_remote_requests` (boolean) +
  `reserves.remote_allowed_categories` (array) — colunas diretas em `reserves`, editadas via
  `PATCH /api/reserves/:id/settings` (`reserves.ts:111`), UI num card pequeno em
  `reserva/page.tsx` (`ReserveRemoteAccessToggle`, componente próprio). Esta spec segue o MESMO
  padrão pras 2 configurações novas — nenhuma tabela nova de "settings" genérica.
- **Padrão de cron que de fato funciona**: `pg_cron` + function `SECURITY DEFINER`, exatamente
  como `check_cautelas_vencimento()` (já em produção, ver spec anterior) — não HTTP/endpoint.

### 2.3 Cautela: onde está hoje o hardcode que vira configurável

`check_cautelas_vencimento()` (migration `20260829000000_...`): `AND c.prazo_devolucao_data =
v_hoje + 7` (janela "vencendo" fixa em 7 dias) e `AND e.created_at > now() - interval '3 days'`
(cadência "vencida" fixa em 3 dias). Ambos precisam virar parâmetros vindos de `reserves`.

---

## 3. Decisões de Design

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde mora a config | Colunas novas em `reserves` (`cautela_alert_dias_antes int[]`, `material_validity_alert_dias_padrao int[]`) | Mesmo padrão já usado (`allow_remote_requests`), sem tabela nova |
| Cautela: 1 dia ou vários? | Array (como material) — ex: `{15,7,3}` | "Unificar" implica mesmo formato; admin pode querer avisar em mais de um marco, mesma UX de material |
| Fallback quando reserva não configurou | `{7}` pra cautela, `{365,180,90}` pra material (mesmo default hoje hardcoded) | Comportamento atual preservado pra quem não mexer em nada |
| "Vencida" — cadência | Todo dia (query sem o filtro de 3 dias — dedupe fica só por `alerta_dia`, que já é diário) | Pedido explícito do usuário |
| Snooze | Por cautela: `vencimento_snooze_until date` — cron pula cautelas com essa data `>= hoje` | Granularidade por cautela (não por reserva) — faz sentido individualmente, cada custódia tem sua urgência |
| Silenciar | Por cautela: `vencimento_silenciado boolean DEFAULT false` — cron nunca mais gera alerta pra essa cautela enquanto true | "ou não mostrar" — permanente até reativação manual (sem endpoint de "reativar" nesta entrega — mudar direto no dado não é exposto na UI de propósito, ver §6) |
| Quem pode adiar/silenciar | `armeiro`, `admin_reserva`, `admin_global` (mesmo roleGuard de `/return`/`/cancel`) | Pedido do usuário diz "personalizável para armeiro" — mas silenciar permanentemente é uma decisão de gestão, admin_reserva/global também fazem sentido |
| Backfill de cautelas existentes | 90 dias a partir de **hoje** (não da emissão original) | Decisão confirmada com o usuário — evita uma leva inteira virando "vencida" no dia seguinte à migração |
| Retirar o endpoint antigo? | Não remover — vira um wrapper fino chamando a MESMA function SQL via RPC (botão "verificar agora" continua útil pro admin_reserva) | SSOT: 2 lugares com a mesma lógica de novo seria repetir o erro que já causou o bug de fuso original |

---

## 4. Requisitos

### AVU-01 — Migration: colunas de configuração em `reserves`

```sql
ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS cautela_alert_dias_antes integer[] NOT NULL DEFAULT '{7}',
  ADD COLUMN IF NOT EXISTS material_validity_alert_dias_padrao integer[] NOT NULL DEFAULT '{365,180,90}';
```

### AVU-02 — Migration: snooze/silenciar por cautela

```sql
ALTER TABLE public.cautelamentos
  ADD COLUMN IF NOT EXISTS vencimento_snooze_until date,
  ADD COLUMN IF NOT EXISTS vencimento_silenciado boolean NOT NULL DEFAULT false;
```

### AVU-03 — Migration: backfill de cautelas existentes sem prazo

Roda 1 vez, na própria migration (não na function do cron — isso é histórico, não um caso
recorrente):

```sql
UPDATE public.cautelamentos
   SET prazo_devolucao_tipo = 'indeterminado_backfill_90d', -- ver nota abaixo
       prazo_devolucao_data = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 90
 WHERE status = 'ativa' AND prazo_devolucao_data IS NULL;
```

**Nota de design**: `prazo_devolucao_tipo` tem CHECK restrito aos 6 valores conhecidos
(`15_dias`...`indeterminado`) — um backfill não pode inventar um 7º valor sem migrar o CHECK
também. Duas opções: (a) estender o CHECK com um valor `'backfill_90d'` só pra rastrear que foi
atribuído automaticamente (mais rastreável, mas mexe no enum de novo); (b) gravar
`prazo_devolucao_tipo = '90_dias'` mesmo (o valor real já existe, semanticamente idêntico — só
"perde" a informação de que foi um backfill automático, não uma escolha do armeiro). **Esta spec
recomenda (b)** — mais simples, sem migração de CHECK extra, e a distinção "foi backfill" não tem
nenhum consumidor identificado (nenhuma tela pergunta "isso foi automático?"). Ajustar o SQL
acima pra `prazo_devolucao_tipo = '90_dias'` antes de aplicar.

### AVU-04 — BFF: `PATCH /api/reserves/:id/settings` aceita os 2 campos novos

`reserves.ts:134`, estender o body tipado e a validação (mesmo padrão de `allow_remote_requests`):
`cautela_alert_dias_antes?: number[]`, `material_validity_alert_dias_padrao?: number[]`.

**Achado CRÍTICO da revisão adversarial**: `material_validity_alert_events` tem `CHECK
(alert_days = ANY (ARRAY[90, 180, 365]))` (confirmado via `pg_constraint`) — a validação original
desta spec ("array de inteiros positivos, não vazios") permitiria configurar, por exemplo,
`{60, 30}`, e o primeiro material que batesse num desses dias faria o `INSERT` de AVU-07 violar o
CHECK (erro `23514`) **dentro do loop da function do cron**, sem `EXCEPTION` isolando por
iteração — abortando `check_material_validade_vencimento()` inteira, silenciosamente, todo dia,
reintroduzindo exatamente o "existe no código mas nunca funciona de verdade" que esta spec existe
para consertar. `material_validity_alert_dias_padrao` (o default da RESERVA) fica restrito ao
MESMO conjunto fechado que `material_types.validity_alert_days` já usa hoje
(`MATERIAL_VALIDITY_ALERT_DAYS = [365, 180, 90]`, `apps/web/src/lib/material-metadata.ts`) — não
altera o CHECK do banco (mudar essa constraint seria uma decisão de produto maior, fora de
escopo): `z.array(z.union([z.literal(90), z.literal(180), z.literal(365)])).min(1)`. Já
`cautela_alert_dias_antes` não tem constraint equivalente no banco — mantém a validação genérica
original (inteiros positivos, `1..365`, não vazio).

### AVU-05 — Frontend: card de configuração em `reserva/page.tsx`

Novo componente `reserve-alert-settings-card.tsx`, mesmo padrão visual de
`ReserveRemoteAccessToggle` — 2 campos de "tags de números" (ex: chips removíveis `7`, `+ adicionar`)
pra cada um dos 2 arrays, salvando via `PATCH /api/reserves/:id/settings`.

### AVU-06 — Postgres function: `check_cautelas_vencimento()` usa a config da reserva

Reescrever os 2 loops pra ler `reserves.cautela_alert_dias_antes` em vez do literal `7`, e
remover o filtro de 3 dias do ramo "vencida" (agora diário — dedupe só por `alerta_dia`, que já
é 1 linha por dia via o `UNIQUE INDEX` existente). Adicionar ao `WHERE` de ambos os ramos:
`AND NOT c.vencimento_silenciado AND (c.vencimento_snooze_until IS NULL OR c.vencimento_snooze_until < v_hoje)`.

```sql
-- Ramo "vencendo" — antes: c.prazo_devolucao_data = v_hoje + 7
-- Depois: junta com reserves pra pegar os dias configurados, um alerta por
-- marco que bater (mesmo padrão de material_validity_alert_days).
FOR v_cautela IN
  SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
         c.prazo_devolucao_data, mt.nome AS material_nome, r.cautela_alert_dias_antes
    FROM cautelamentos c
    JOIN material_items mi ON mi.id = c.item_id
    JOIN material_types mt ON mt.id = mi.material_type_id
    JOIN reserves r ON r.id = c.reserve_id
   WHERE c.status = 'ativa'
     AND NOT c.vencimento_silenciado
     AND (c.vencimento_snooze_until IS NULL OR c.vencimento_snooze_until < v_hoje)
     AND c.prazo_devolucao_data - v_hoje = ANY(r.cautela_alert_dias_antes)
LOOP
  -- resto igual, só troca o "7" fixo do corpo pelo dia real que bateu
  -- (c.prazo_devolucao_data - v_hoje), pra mensagem dizer o número certo
```

### AVU-06.1 — BFF: `PATCH /:id` (edição) reseta o silenciamento ao mudar o prazo

Requisito, não pergunta em aberto (movido de §6 pergunta 1): se o prazo de devolução for editado
(`prazo_devolucao_tipo`/`prazo_devolucao_data` mudam de fato — reaproveita a mesma checagem de
igualdade de CAULC-05), o handler também seta `vencimento_silenciado = false` e
`vencimento_snooze_until = null` no mesmo `updateData`. Sem isso, um armeiro que silenciou uma
cautela há meses (achando que resolveria de outro jeito) e depois edita o prazo pra estender a
custódia ficaria com o alerta permanentemente mudo sem perceber — o próprio ato de mexer no prazo
é o sinal natural de "quero voltar a ser avisado sobre isso".

### AVU-07 — Postgres function nova: `check_material_validade_vencimento()`

Porta a lógica de `POST /api/arsenal/validity-alerts/run` pra SQL puro, corrigindo o bug de fuso
(usa `v_hoje` em horário de Brasília, não `new Date()` do processo Node) e usando
`material_types.validity_alert_days` com fallback pra
`reserves.material_validity_alert_dias_padrao` (não mais o literal `[365,180,90]`).

**Achado CRÍTICO da revisão adversarial — parâmetro de escopo, não removido**: a versão anterior
desta spec não tinha nenhum parâmetro, processando todos os tenants/reservas de uma vez sempre —
correto pro `pg_cron` (roda como job de plataforma), mas o endpoint (AVU-08) reaproveitaria a
MESMA function pra um botão "verificar agora" de 1 `admin_reserva` de 1 reserva só. Sem parâmetro,
esse botão passaria a processar as **17 reservas de 49 tenants reais** (confirmado via MCP) de
uma vez, cada clique — violação de Privilege Ceiling. Fix: `p_reserve_id uuid DEFAULT NULL` —
`NULL` (cron) processa tudo; um valor real (endpoint) restringe a `mt.reserve_id = p_reserve_id`.

**Achado MÉDIO da revisão adversarial — `material_types.reserve_id` é nullable (17 materiais reais
hoje têm `NULL`)**: o `JOIN reserves` abaixo continua `INNER` de propósito — esses materiais já
ficam fora do alerta HOJE (o endpoint morto atual também os ignora, mesmo filtro), então isso não
é uma regressão introduzida por esta spec, é um gap pré-existente que "reativar o sistema" não se
propõe a resolver (associar `reserve_id` a esses materiais é uma limpeza de dado separada, fora
de escopo — ver §6).

```sql
CREATE OR REPLACE FUNCTION public.check_material_validade_vencimento(p_reserve_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
  v_item record;
  v_recipient uuid;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  FOR v_item IN
    SELECT mi.id, mi.tenant_id, mi.current_holder_user_id, mi.validade_item,
           mt.nome AS material_nome, mt.reserve_id,
           COALESCE(NULLIF(mt.validity_alert_days, '{}'), r.material_validity_alert_dias_padrao) AS alert_days
      FROM material_items mi
      JOIN material_types mt ON mt.id = mi.material_type_id
      JOIN reserves r ON r.id = mt.reserve_id
     WHERE mi.validade_item IS NOT NULL
       AND (p_reserve_id IS NULL OR mt.reserve_id = p_reserve_id)
       AND (mi.validade_item - v_hoje) = ANY(
             COALESCE(NULLIF(mt.validity_alert_days, '{}'), r.material_validity_alert_dias_padrao)
           )
  LOOP
    INSERT INTO material_validity_alert_events (tenant_id, reserve_id, material_item_id, alert_days, validade_item)
    VALUES (v_item.tenant_id, v_item.reserve_id, v_item.id, (v_item.validade_item - v_hoje), v_item.validade_item)
    ON CONFLICT (material_item_id, alert_days, validade_item) DO NOTHING;

    IF FOUND THEN
      FOR v_recipient IN
        SELECT rm.user_id FROM reserve_memberships rm
         WHERE rm.reserve_id = v_item.reserve_id AND rm.role IN ('admin_reserva', 'armeiro')
        UNION
        SELECT v_item.current_holder_user_id WHERE v_item.current_holder_user_id IS NOT NULL
      LOOP
        INSERT INTO notifications (user_id, tenant_id, type, title, body, metadata)
        VALUES (
          v_recipient, v_item.tenant_id, 'material_validity_warning',
          'Validade de material próxima',
          format('%s vence em %s dia(s) (%s)', v_item.material_nome, (v_item.validade_item - v_hoje), to_char(v_item.validade_item, 'DD/MM/YYYY')),
          jsonb_build_object('material_item_id', v_item.id)
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- Sem argumento => p_reserve_id = NULL => processa TODAS as reservas de
-- TODOS os tenants (papel de plataforma do cron, correto pra este caller).
SELECT cron.schedule(
  'material-validade-vencimento-diario',
  '5 11 * * *',  -- 11h05 UTC = 8h05 Brasília — 5min depois do cron de cautela, evita contenção
  $$SELECT public.check_material_validade_vencimento()$$
);
```

**Confirmado via MCP antes de escrever esta versão**: `material_types.validity_alert_days` é
`NOT NULL DEFAULT '{}'::integer[]` — nunca `NULL` em produção, sempre array (vazio quando sem
override). `NULLIF(mt.validity_alert_days, '{}')` é o tratamento correto e suficiente.

### AVU-08 — BFF: `POST /api/arsenal/validity-alerts/run` vira wrapper fino da function

Substitui o corpo inteiro do handler por `await supabase.rpc("check_material_validade_vencimento",
{ p_reserve_id: reserveId })` — **sempre passa o `reserveId` do contexto da sessão** (mesma
variável que o endpoint já lê hoje, `arsenal.ts:432`), preservando o escopo por reserva que o
endpoint atual já tem (achado CRÍTICO da revisão adversarial, corrigido — ver nota de parâmetro
em AVU-07). Elimina a lógica duplicada (SSOT) e corrige o bug de fuso automaticamente (a function
já usa `v_hoje` correto). Resposta simplificada (a function não retorna contagem hoje — se o botão
"verificar agora" precisar mostrar quantos alertas foram criados, a function precisaria retornar
`TABLE`/contagem; fora de escopo desta entrega, manter resposta genérica `{ ok: true }`).

### AVU-09 — Frontend: `notification-bell.tsx` ganha `material_validity_warning`

Mesma correção já aplicada 2x pra cautela: adicionar o tipo em `NotificationType`, nos 3 `Record`
(ícone sugerido: `Clock`/`CalendarClock`, mesma família de cautela_vencendo), e 1 `case` em
`resolveNotificationRoute` — destino: `/reserva/arsenal?highlight=<material_item_id>` pra staff
(a tela de gestão de material), sem uma rota equivalente clara pro militar dono (`current_holder_user_id`
recebe a notificação mas não há tela "meus materiais com validade" — mesmo tipo de gap já
documentado pra `ocorrencia_resolvida` no mesmo arquivo; retornar `null` nesse caso, documentado).

### AVU-10 — BFF: `POST /:id/vencimento-snooze` (endpoint novo em `cautelamentos.ts`)

```ts
const snoozeSchema = z.object({
  dias: z.number().int().min(1).max(365).optional(),
  silenciar: z.boolean().optional(),
}).refine(b => b.dias !== undefined || b.silenciar !== undefined, { message: "Informe dias ou silenciar" });

cautelamentosRoutes.post("/:id/vencimento-snooze", roleGuard("armeiro","admin_reserva","admin_global"), zValidator("json", snoozeSchema), async (c) => {
  // requireActiveShift, SELECT (id, tenant_id, status), 404/tenant/status="ativa"
  // body.silenciar === true → vencimento_silenciado = true, vencimento_snooze_until = null
  // body.dias → vencimento_snooze_until = hojeBrasilia() + dias, vencimento_silenciado = false
  //   (mesma função addDiasCalendario já existente em cautelamentos.ts, SSOT)
  //
  // Achado MÉDIO da revisão adversarial — semântica exata de "adiar N dias", documentada
  // pra não ficar ambígua: clicando HOJE (T) "adiar 7 dias" → vencimento_snooze_until = T+7.
  // O cron (AVU-06) pula a cautela enquanto vencimento_snooze_until >= v_hoje — ou seja,
  // suprime o alerta em T+1, T+2, ..., T+7 (7 dias corridos, contados a partir de AMANHÃ) e
  // volta a alertar em T+8. Isto é DELIBERADO (não off-by-one): "adiar 7 dias" conta os 7
  // próximos dias, não hoje (hoje o admin já está ciente, é por isso que está adiando).
  // UPDATE .eq("id",id).eq("tenant_id",tenantId).eq("status","ativa") + 409 se 0 linhas
  // logShiftEvent: reaproveita "cautela_editada" (não é um evento novo — é uma edição de
  //   metadado de vencimento, mesma categoria semântica) com descrição específica
});
```

### AVU-11 — Frontend: ação de adiar/silenciar na cautela vencida

Na aba "Vencidas" (`_cautelas-client.tsx`) e no dialog de detalhe, quando `isCautelaVencida(c)`:
botão "Adiar alerta" (dropdown com opções 3/7/15/30 dias, chamando `vencimento-snooze` com
`dias`) e "Não mostrar mais" (chama com `silenciar: true`, com confirmação — é permanente até
alguém mexer no banco diretamente, não expor "reativar" nesta entrega).

---

## 5. E2E Tests — IDs propostos

- `AVU01` — reserva sem configuração explícita usa os defaults (`{7}` cautela, `{365,180,90}` material).
- `AVU02` — admin_reserva configura `cautela_alert_dias_antes = {15,7,3}` — cron gera 3 alertas "vencendo" em dias diferentes pra mesma cautela, cada um só 1x.
- `AVU03` — backfill: cautela ativa criada antes desta migration, sem prazo, recebe `prazo_devolucao_data = hoje+90` após a migration rodar.
- `AVU04` — cautela vencida gera notificação "vencida" TODOS os dias (não só a cada 3), até ser devolvida/adiada/silenciada.
- `AVU05` — adiar 7 dias → cron não gera "vencida" nova por 7 dias, mesmo cautela continuando vencida.
- `AVU06` — silenciar → cron nunca mais gera "vencida" pra essa cautela, mesmo depois do snooze expirar.
- `AVU07` — `POST /api/arsenal/validity-alerts/run` chama a mesma function do cron (RPC), mesmo resultado de rodar o cron manualmente.
- `AVU08` — notificação `material_validity_warning` no sino tem ícone/rota corretos (não mais órfã).
- `AVU09` — material com `validity_alert_days` próprio ignora o default da reserva; material sem override usa o default da reserva.

---

## 6. Perguntas Abertas (menores — não bloqueiam início da implementação)

1. Silenciar é permanente sem UI de "reativar" nesta entrega (fora isso, editar o prazo já
   reativa automaticamente — ver AVU-06.1) — precisa de um botão explícito "reativar alerta"
   mesmo sem editar nada mais? Recomendação: aceitável ficar de fora por ora, é um caso raro
   (silenciar por engano e não querer editar mais nada).
2. `POST /validity-alerts/run` (AVU-08) não retorna contagem — se o admin_reserva precisar de
   feedback ("gerou 3 alertas"), a function precisaria de `RETURNS TABLE`/contagem. Fica pra uma
   iteração futura se for pedido.
3. **(Explicitada pela revisão adversarial — antes só implícita na tabela §3)** `POST /:id/
   vencimento-snooze` (AVU-10) exclui `"usuario"` do `roleGuard` — o militar dono da cautela NÃO
   pode adiar/silenciar o próprio alerta, só armeiro/admin_reserva/admin_global. O pedido original
   do usuário ("personalizável para armeiro etc") sugere que a intenção já era essa, mas o
   próprio código já dá ao militar acesso à SUA cautela em outros contextos (`GET /:id/pdf`,
   `GET /:id/historico`, ambos com `roleGuard(...,"usuario")` + checagem de posse). Recomendação:
   manter a exclusão — adiar/silenciar é uma decisão sobre COMO A RESERVA GERENCIA o próprio
   controle de custódia, não uma preferência pessoal do militar sobre o que ele vê.

---

## 7. Ordem de Execução

1. AVU-01/02 (migrations de colunas) — arquivos separados por tabela, sem problema de transação (não são enums).
2. AVU-03 (backfill) — migration própria, depois de AVU-01 existir.
3. AVU-04 (BFF settings) + AVU-05 (frontend card).
4. AVU-06 (function de cautela atualizada) + AVU-06.1 (PATCH /:id reseta silenciamento).
5. AVU-07 (function nova de material) + AVU-08 (endpoint vira wrapper).
6. AVU-09 (notification-bell.tsx).
7. AVU-10 (endpoint de snooze) + AVU-11 (UI).
8. E2E suite (AVU01..09).
9. Code review sênior + CHANGELOG + validação visual.

---

## 8. Definition of Done

- [ ] Migrations aplicadas e verificadas via MCP
- [ ] Backfill confirmado: 0 cautelas ativas com `prazo_devolucao_data IS NULL` após a migration
- [ ] `check_cautelas_vencimento()` e `check_material_validade_vencimento()` lêem config real da reserva, não literais
- [ ] `PATCH /:id` (edição) reseta `vencimento_silenciado=false` ao mudar o prazo
- [ ] `notification-bell.tsx` sem tipo órfão (`material_validity_warning` com ícone/rota)
- [ ] `POST /validity-alerts/run` chama a mesma RPC do cron (sem lógica duplicada)
- [ ] `tsc --noEmit` limpo em `apps/bff` e `apps/web`
- [ ] E2E suite `AVU01..09` criada e passando
- [ ] Code review sênior sem CRÍTICO/ALTO pendente
- [ ] CHANGELOG atualizado

---

## 9. Registro de Revisão Adversarial (2026-08-29) — transparência

1ª rodada, nota 6/10. Achados e correção nesta versão:

| # | Severidade | Achado | Corrigido em |
|---|---|---|---|
| 1 | CRÍTICO | AVU-04 permitia configurar `material_validity_alert_dias_padrao` fora do `CHECK (alert_days = ANY(ARRAY[90,180,365]))` de `material_validity_alert_events` — abortaria `check_material_validade_vencimento()` inteira, todo dia, silenciosamente | AVU-04 (validação restrita ao mesmo conjunto fechado) |
| 2 | CRÍTICO | AVU-08 removia o escopo por reserva do endpoint atual — botão "verificar agora" de 1 reserva passaria a processar as 17 reservas de 49 tenants reais de uma vez (Privilege Ceiling) | AVU-07 (`p_reserve_id` parâmetro, `NULL`=cron/todas, valor real=endpoint/escopado) + AVU-08 (endpoint sempre passa `reserveId`) |
| 3 | MÉDIO | `material_types.reserve_id` nullable (17 materiais reais hoje) ficam fora do INNER JOIN, sem documentação | Documentado explicitamente em AVU-07 como gap pré-existente (não regressão), não expandido |
| 4 | MÉDIO | Semântica exata de "adiar N dias" ambígua (contar a partir de hoje ou de amanhã?) | AVU-10 (exemplo concreto documentado — 7 dias suprimidos a partir de amanhã, não hoje) |

Confirmado correto pela revisão (não mudou): as 10 alegações factuais verificadas (schema de
`material_types`/`material_validity_alert_events`/`reserves`, sintaxe SQL de `date - date =
ANY(int[])` e `UNION` dentro de `FOR` em PL/pgSQL — ambos testados ao vivo via MCP —,
compatibilidade do backfill com o CHECK de prazo, ponto de inserção real em `PATCH /:id`).
