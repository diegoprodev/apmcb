# Fase 6-B — Livro Digital de Serviço

> **⚠ REGRA ABSOLUTA — LER ANTES DE QUALQUER AÇÃO:**
>
> ```
> ╔══════════════════════════════════════════════════════════════════════╗
> ║                                                                      ║
> ║           FINALIZADO NÃO É ENTREGUE.                                ║
> ║                                                                      ║
> ║  Cada tarefa desta spec só pode ser marcada como concluída após:    ║
> ║  implementar + testar + validar + rodar E2E + evidência gerada.     ║
> ║                                                                      ║
> ║  DoD canônica: docs/enterprise/07-canonical-definition-of-done.md   ║
> ║  Prevalece sobre qualquer outra definição de "pronto".               ║
> ║                                                                      ║
> ╚══════════════════════════════════════════════════════════════════════╝
> ```
>
> **DoD Canônica:** `../07-canonical-definition-of-done.md`
> **Harness ID:** PH-6B
> **Premissa:** Fase 6 concluída — `service_handovers` existe, armeiro-suite passando (AR01-AR23)

---

## Objetivo

Transformar o ato pontual de "passagem de serviço" em um **Livro Digital de Serviço completo**: registro imutável e em tempo real de tudo que ocorre sob responsabilidade de um armeiro durante seu turno.

Diferença fundamental:
- **Fase 6 (existente):** transação de troca entre dois armeiros — snapshot + assinatura dupla.
- **Fase 6-B (esta fase):** linha do tempo contínua de eventos durante o turno, com hash chain, pendências, navegação histórica, acesso por papel e exportação auditável.

O Livro Digital é o argumento de governança mais forte do sistema: prova imutável de responsabilidade, rastreável por qualquer autoridade externa sem acesso ao banco.

---

## Por Que Esta Fase Existe (Argumento de Governança)

| Problema real | Solução |
|---|---|
| "O armeiro diz que devolveu, mas não há registro" | Cada devolução gera evento imutável com hash |
| "Quem estava de serviço quando o item sumiu?" | Turno ativo em `service_shifts` — rastreável a qualquer momento |
| "O relatório da passagem não mostra tudo" | PDF do turno contém linha do tempo completa, não só snapshot |
| "Auditoria externa precisa verificar sem acesso ao sistema" | Hash chain verificável offline com SHA-256 |
| "O comandante não sabe quem está de serviço agora" | Dashboard admin com livros ativos em tempo real |

---

## Escopo

### Banco de dados
- Nova tabela `service_shifts` — turno ativo do armeiro
- Nova tabela `service_log_events` — linha do tempo com hash chain
- Triggers automáticos em `cautelamentos`, `saida_diarias`, `ocorrencias`
- RLS: armeiro vê só seus turnos; admin_reserva vê sua reserva; admin_global vê tudo

### BFF
- 7 endpoints em `apps/bff/src/routes/shifts.ts`
- Geração de PDF do turno com hash chain em `apps/bff/src/lib/pdf/shift-pdf.ts`
- Hook interno para registrar eventos automaticamente

### Frontend
- `/reserva/livro` — turno atual do armeiro (linha do tempo + filtros + pendências)
- `/reserva/livro/historico` — turnos anteriores do próprio armeiro
- `/admin/livros` — admin_reserva: todos os livros ativos da reserva
- `/admin/livros/[shift_id]` — detalhe de qualquer turno (admin)
- Badge de pendências no sidebar do armeiro (real-time)

### Testes E2E
- Suite `livro-suite` — LDS01–LDS20

---

## Fora do Escopo

- ❌ Assinatura eletrônica dos eventos individuais (eventos são hasheados, não assinados)
- ❌ Alertas push de pendência crítica (Fase 7 dashboard)
- ❌ Integração com escala de serviço (futuro)
- ❌ Reconhecimento facial no início do turno (futuro)
- ❌ API pública de verificação de hash (Fase 10 hardening)

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 6 concluída — `service_handovers` existe | `\d service_handovers` no psql |
| P2 | armeiro-suite AR01-AR23 passando | `npx playwright test --project=armeiro-suite` |
| P3 | `cautelamentos`, `saida_diarias`, `ocorrencias` existem | Fase 5 concluída |
| P4 | `audit_events` com hash chain existe | Fase 3 concluída |
| P5 | BFF com `authMiddleware` + `roleGuard` funcional | Qualquer endpoint autenticado respondendo |

---

## Arquivos Permitidos

> **⚠ Cada arquivo modificado deve passar `pnpm typecheck` antes do commit.**
> **Referência: `../07-canonical-definition-of-done.md` — critérios G11, G12, G13.**

### BFF
| Arquivo | Ação | Justificativa |
|---|---|---|
| `apps/bff/src/routes/shifts.ts` | CRIAR | 7 endpoints do livro digital |
| `apps/bff/src/lib/pdf/shift-pdf.ts` | CRIAR | PDF do turno com hash chain |
| `apps/bff/src/lib/shift-events.ts` | CRIAR | Helper para registrar eventos automáticos |
| `apps/bff/src/index.ts` | MODIFICAR | Registrar `shiftsRoutes` |
| `apps/bff/src/routes/cautelamentos.ts` | MODIFICAR | Chamar `logShiftEvent` após emissão/devolução |
| `apps/bff/src/routes/saidas.ts` | MODIFICAR | Chamar `logShiftEvent` após saída autorizada |
| `apps/bff/src/routes/ocorrencias.ts` | MODIFICAR | Chamar `logShiftEvent` após ocorrência |

### Frontend
| Arquivo | Ação | Justificativa |
|---|---|---|
| `apps/web/src/app/(dashboard)/reserva/livro/page.tsx` | CRIAR | Turno atual — server component |
| `apps/web/src/app/(dashboard)/reserva/livro/_livro-client.tsx` | CRIAR | Linha do tempo client |
| `apps/web/src/app/(dashboard)/reserva/livro/historico/page.tsx` | CRIAR | Turnos anteriores |
| `apps/web/src/app/(dashboard)/admin/livros/page.tsx` | CRIAR | Dashboard admin — livros ativos |
| `apps/web/src/app/(dashboard)/admin/livros/[shift_id]/page.tsx` | CRIAR | Detalhe admin de turno |
| `apps/web/src/app/(dashboard)/reserva/page.tsx` | MODIFICAR | Badge pendências + link para livro |

### Testes
| Arquivo | Ação |
|---|---|
| `apps/web/e2e/livro-digital.spec.ts` | CRIAR |
| `apps/web/e2e/setup/armeiro-auth.setup.ts` | Reusar (já existe) |
| `apps/web/playwright.config.ts` | MODIFICAR — adicionar `livro-suite` |

### Database
| Arquivo | Ação |
|---|---|
| `supabase/migrations/YYYYMMDDNNNNNN_service_shifts.sql` | CRIAR |

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/handovers.ts` | Fase 6 — não regredir |
| `supabase/migrations/20260620000006*.sql` | Handover migration — não alterar |
| `apps/web/src/components/ui/*.tsx` | Design system — não alterar |
| `apps/web/e2e/armeiro-flow.spec.ts` | Suite AR já concluída — não regredir |

---

## Migration

> **⚠ Antes de aplicar: confirmar com `supabase db diff`. Após aplicar: verificar RLS.**
> **Referência: `../07-canonical-definition-of-done.md` — etapa 6 do ciclo obrigatório.**

**Arquivo:** `supabase/migrations/YYYYMMDDNNNNNN_service_shifts.sql`

```sql
-- ═══════════════════════════════════════════════════════════
-- Fase 6-B: Livro Digital de Serviço
-- ═══════════════════════════════════════════════════════════

-- 1. Turno de serviço do armeiro
CREATE TABLE IF NOT EXISTS service_shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  reserve_id    uuid NOT NULL REFERENCES reserves(id),
  armeiro_id    uuid NOT NULL REFERENCES profiles(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,                         -- null = turno ativo
  handover_id   uuid REFERENCES service_handovers(id), -- vincula ao encerramento
  opening_snapshot jsonb NOT NULL DEFAULT '{}',       -- estado do arsenal no início
  closing_snapshot jsonb,                              -- estado ao encerrar
  pending_count int NOT NULL DEFAULT 0,               -- pendências abertas (cached)
  status        text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'encerrado', 'encerrado_sem_passagem')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Eventos da linha do tempo (hash chain)
CREATE TABLE IF NOT EXISTS service_log_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      uuid NOT NULL REFERENCES service_shifts(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  happened_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL CHECK (event_type IN (
    'turno_assumido',
    'cautela_emitida',
    'cautela_devolvida',
    'saida_autorizada',
    'saida_devolvida',
    'ocorrencia_registrada',
    'solicitacao_aprovada',
    'solicitacao_negada',
    'inventario_divergencia',
    'turno_encerrado',
    'evento_manual'
  )),
  actor_id      uuid NOT NULL REFERENCES profiles(id),
  subject_id    uuid,           -- ID do cautelamento/saida/ocorrencia envolvida
  subject_type  text,           -- 'cautelamento' | 'saida_diaria' | 'ocorrencia'
  description   text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}',
  resolved_at   timestamptz,    -- null = pendência aberta (se event_type pendente)
  is_pending    boolean NOT NULL DEFAULT false,  -- marca pendências que bloqueiam encerramento
  prev_hash     text,           -- hash do evento anterior na chain
  event_hash    text GENERATED ALWAYS AS (
    encode(
      sha256(
        (id::text || shift_id::text || happened_at::text ||
         event_type || description || COALESCE(prev_hash, 'genesis'))::bytea
      ),
      'hex'
    )
  ) STORED
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_shifts_tenant        ON service_shifts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_reserve       ON service_shifts(reserve_id);
CREATE INDEX IF NOT EXISTS idx_shifts_armeiro       ON service_shifts(armeiro_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status        ON service_shifts(status);
CREATE INDEX IF NOT EXISTS idx_log_events_shift     ON service_log_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_log_events_type      ON service_log_events(event_type);
CREATE INDEX IF NOT EXISTS idx_log_events_time      ON service_log_events(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_events_pending   ON service_log_events(shift_id, is_pending)
  WHERE is_pending = true AND resolved_at IS NULL;

-- 4. RLS
ALTER TABLE service_shifts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_log_events ENABLE ROW LEVEL SECURITY;

-- Armeiro vê só seus próprios turnos
CREATE POLICY "armeiro_own_shifts" ON service_shifts
  FOR ALL USING (armeiro_id = auth.uid());

-- Admin_reserva vê turnos da sua reserva
CREATE POLICY "admin_reserva_shifts" ON service_shifts
  FOR SELECT USING (
    reserve_id IN (
      SELECT reserve_id FROM reserve_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Tenant isolation
CREATE POLICY "tenant_isolation_shifts" ON service_shifts
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_log_events" ON service_log_events
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- Eventos: imutáveis — não permite UPDATE nem DELETE (auditoria)
CREATE RULE no_update_log_events AS ON UPDATE TO service_log_events DO INSTEAD NOTHING;
CREATE RULE no_delete_log_events AS ON DELETE TO service_log_events DO INSTEAD NOTHING;
```

---

## Endpoints

> **⚠ Cada endpoint criado deve ter: `roleGuard`, validação Zod no body, e `logShiftEvent` onde aplicável.**
> **Referência: `../07-canonical-definition-of-done.md` — critérios G05, G09, G10.**

| Método | Path | Roles | Ação |
|---|---|---|---|
| `POST` | `/api/shifts/open` | armeiro | Abre turno + snapshot inicial |
| `GET` | `/api/shifts/active` | armeiro | Retorna turno ativo do usuário logado |
| `GET` | `/api/shifts/:id/events` | armeiro, admin_reserva, admin_global | Lista eventos (filtros: tipo, is_pending) |
| `GET` | `/api/shifts/:id/pending` | armeiro, admin_reserva | Pendências abertas do turno |
| `POST` | `/api/shifts/:id/log` | armeiro | Registra evento manual (ocorrência) |
| `POST` | `/api/shifts/:id/close` | armeiro | Encerra turno + snapshot final |
| `GET` | `/api/shifts/:id/pdf` | armeiro, admin_reserva, admin_global | PDF com hash chain |
| `GET` | `/api/shifts` | admin_reserva, admin_global | Lista turnos (filtros: status, armeiro_id, from, to) |

### Schema Zod obrigatório por endpoint

```typescript
// POST /api/shifts/open
const OpenShiftSchema = z.object({
  reserve_id: z.string().uuid(),
  observacao_abertura: z.string().max(500).optional(),
});

// POST /api/shifts/:id/log
const LogEventSchema = z.object({
  description: z.string().min(1).max(1000),
  event_type: z.enum(["ocorrencia_registrada", "evento_manual"]),
  is_pending: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

// POST /api/shifts/:id/close
const CloseShiftSchema = z.object({
  observacao_encerramento: z.string().max(500).optional(),
  handover_id: z.string().uuid().optional(), // vincula à passagem formal
});
```

---

## Integração Automática de Eventos

> **⚠ Esta é a peça central do Livro Digital. Cada ação do turno deve gerar um evento automaticamente.**
> **Nenhuma ação pode ser adicionada manualmente retroativamente — o hash chain impede.**

O helper `apps/bff/src/lib/shift-events.ts` deve ser chamado por todos os routes que geram eventos:

```typescript
// apps/bff/src/lib/shift-events.ts
export async function logShiftEvent(params: {
  actorId: string;
  tenantId: string;
  eventType: ServiceLogEventType;
  description: string;
  subjectId?: string;
  subjectType?: string;
  isPending?: boolean;
  metadata?: Record<string, unknown>;
}) {
  // 1. Encontrar turno ativo do ator
  const { data: shift } = await supabase
    .from("service_shifts")
    .select("id")
    .eq("armeiro_id", params.actorId)
    .eq("status", "ativo")
    .single();

  if (!shift) return; // Armeiro não tem turno ativo — silently skip

  // 2. Buscar hash do último evento (para encadear)
  const { data: lastEvent } = await supabase
    .from("service_log_events")
    .select("event_hash")
    .eq("shift_id", shift.id)
    .order("happened_at", { ascending: false })
    .limit(1)
    .single();

  // 3. Inserir novo evento com prev_hash
  await supabase.from("service_log_events").insert({
    shift_id: shift.id,
    tenant_id: params.tenantId,
    event_type: params.eventType,
    actor_id: params.actorId,
    subject_id: params.subjectId,
    subject_type: params.subjectType,
    description: params.description,
    metadata: params.metadata ?? {},
    is_pending: params.isPending ?? false,
    prev_hash: lastEvent?.event_hash ?? null,
  });
}
```

**Pontos de integração obrigatórios:**

| Route | Trigger | event_type | is_pending |
|---|---|---|---|
| `POST /api/cautelamentos` | Cautela emitida | `cautela_emitida` | false |
| `POST /api/cautelamentos/:id/devolver` | Devolução | `cautela_devolvida` | false |
| `POST /api/saidas` | Saída autorizada | `saida_autorizada` | false |
| `POST /api/saidas/:id/devolver` | Item devolvido | `saida_devolvida` | false |
| `POST /api/ocorrencias` | Ocorrência | `ocorrencia_registrada` | true |
| `POST /api/shifts/:id/log` | Manual | `evento_manual` | (param) |

---

## Interface de Usuário

> **⚠ Toda tela deve seguir o design system existente.**
> **Referência: `../07-canonical-definition-of-done.md` — critério G03 + Regra de UI Consistency Canônica.**

### `/reserva/livro` — Turno Atual do Armeiro

**Layout:** Sidebar esquerda com filtros + área principal com linha do tempo.

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔴 TURNO ATIVO   Ten. Silva · APMCB · 28/06 08:00              │
│ ⏱ 6h 42min em serviço  │  ⚠ 2 pendências abertas              │
├────────────┬─────────────────────────────────────────────────────┤
│  FILTROS   │  LINHA DO TEMPO             [Registrar Ocorrência] │
│            │                                                     │
│ ○ Todos    │  08:00  ◉ Assumiu o serviço                        │
│ ○ Cautelas │  08:45  🔫 Cautela emitida: PT-0042 → Cb. João     │
│ ○ Saídas   │  09:12  📤 Saída autorizada: FA-0011 → Patrulha    │
│ ○ Devoluç. │  10:30  ✅ Devolução: PT-0042 ← Cb. João          │
│ ○ Ocorrên. │  11:00  ⚠ Ocorrência: Fuzil com trava — PENDENTE  │
│ ○ Pendênc. │  13:45  📱 Solicitação: Cb. Maria → aprovada       │
│            │  15:00  🔴 Inventário: item #003 não localizado    │
│            │         ↑ PENDÊNCIA ABERTA — bloqueia encerramento │
│            │                                                     │
│            │         [Passar Serviço →]                         │
└────────────┴─────────────────────────────────────────────────────┘
```

**Regras UX:**
- Badge `⚠ N pendências` no header e no sidebar: atualiza via polling (30s) ou Supabase Realtime
- Botão "Passar Serviço" fica vermelho pulsando quando há pendências (não bloqueia, mas alerta)
- Cada evento tem ícone por tipo, timestamp relativo ("há 2h") + absoluto no hover
- Eventos `is_pending = true` têm fundo amarelo; eventos `resolved_at != null` têm fundo verde-claro

### `/reserva/livro/historico` — Turnos Anteriores

- Lista de turnos encerrados do próprio armeiro (paginado, 10 por página)
- Card por turno: data, duração, n° de eventos, n° de pendências resolvidas
- Click → detalhe do turno encerrado (read-only)

### `/admin/livros` — Dashboard Admin (admin_reserva/admin_global)

- Grid de cards: um por armeiro com turno ativo
- Cada card: nome do armeiro, horário de início, n° de eventos, n° de pendências
- Badge vermelho se pendência > 2h sem resolução
- Click → `/admin/livros/[shift_id]` — detalhe completo

### `/admin/livros/[shift_id]` — Detalhe Admin

- Mesmo layout de `/reserva/livro` mas read-only
- Botão "Exportar PDF" (chama `GET /api/shifts/:id/pdf`)
- Breadcrumb: Livros de Serviço → [Nome Armeiro] → Turno [data]

---

## PDF do Turno

> **⚠ PDF deve conter hash chain verificável. Sem isso, o critério G10 (fluxo sensível testado) falha.**

**Estrutura do PDF:**

```
LIVRO DIGITAL DE SERVIÇO
─────────────────────────────────────────────────────
Armeiro: Ten. Silva (mat. 000002)
Reserva: Academia de Polícia Militar — APMCB
Período: 28/06/2026 08:00 → 28/06/2026 16:00 (8h)
─────────────────────────────────────────────────────
SNAPSHOT DE ABERTURA
  Itens em estoque: 127
  Cautelas ativas: 3
  Solicitações pendentes: 0

LINHA DO TEMPO
  08:00  TURNO ASSUMIDO
         Hash: 3f4a9b...  |  Anterior: genesis
  08:45  CAUTELA EMITIDA — Pistola PT-0042 → Cb. João
         Hash: 7d2e1c...  |  Anterior: 3f4a9b...
  11:00  OCORRÊNCIA — Fuzil com trava travada [PENDENTE]
         Hash: a9f3b2...  |  Anterior: 7d2e1c...

SNAPSHOT DE ENCERRAMENTO
  Itens em estoque: 127
  Cautelas ativas: 3
  Pendências resolvidas: 2/2

INTEGRIDADE
  Hash final do turno: e7b4a1...
  Algoritmo: SHA-256
  Verificação offline: sha256(id + shift_id + happened_at + type + desc + prev_hash)
─────────────────────────────────────────────────────
Assinado digitalmente pelo sistema em 28/06/2026 16:00
```

---

## Harness E2E — Suite `livro-suite`

> **⚠ CADA TESTE ABAIXO SÓ PODE SER MARCADO COMO PASSANDO APÓS:**
> **1. Implementação completa da funcionalidade testada**
> **2. `pnpm typecheck` sem erros**
> **3. Build passando**
> **4. Execução real com `npx playwright test --project=livro-suite` — 0 falhas**
>
> **Referência absoluta: `../07-canonical-definition-of-done.md`**

### Bloco A — Turno (LDS01–LDS04)

```typescript
// LDS01: Armeiro abre turno
test("LDS01 — POST /api/shifts/open cria turno ativo", async ({ page }) => {
  // Chamar BFF, verificar status 201, shift.status = "ativo"
  // Verificar que /reserva/livro exibe "TURNO ATIVO"
});

// LDS02: Turno ativo aparece na UI
test("LDS02 — /reserva/livro mostra header com turno ativo", async ({ page }) => {
  // Navegar para /reserva/livro, verificar heading "TURNO ATIVO"
  // Verificar horário de início visível
});

// LDS03: Evento turno_assumido registrado automaticamente
test("LDS03 — abrir turno gera evento turno_assumido na linha do tempo", async ({ page }) => {
  // Verificar que primeiro item da timeline é "Assumiu o serviço"
  // Verificar que event_hash não é null
});

// LDS04: prev_hash do primeiro evento é null (genesis)
test("LDS04 — primeiro evento do turno tem prev_hash genesis", async () => {
  // GET /api/shifts/:id/events, verificar que events[0].prev_hash === null
});
```

### Bloco B — Linha do Tempo (LDS05–LDS08)

```typescript
// LDS05: Emitir cautela gera evento na timeline
test("LDS05 — cautela emitida aparece na linha do tempo do turno", async ({ page }) => {
  // Emitir cautela via UI, navegar para /reserva/livro
  // Verificar evento "cautela_emitida" na timeline
});

// LDS06: Hash chain — prev_hash do evento N = event_hash do evento N-1
test("LDS06 — hash chain íntegra: prev_hash[n] === event_hash[n-1]", async () => {
  // GET /api/shifts/:id/events (com múltiplos eventos)
  // Para cada par de eventos, verificar encadeamento
});

// LDS07: Filtro "Cautelas" exibe apenas eventos cautela_*
test("LDS07 — filtro Cautelas exibe só eventos de cautela", async ({ page }) => {
  // Clicar no filtro "Cautelas"
  // Verificar que todos os itens visíveis são cautela_emitida ou cautela_devolvida
  // Verificar que saida_autorizada não aparece
});

// LDS08: Filtro "Pendências" exibe só eventos is_pending sem resolved_at
test("LDS08 — filtro Pendências exibe só eventos não resolvidos", async ({ page }) => {
  // Clicar no filtro "Pendências"
  // Verificar que evento com resolved_at não aparece
});
```

### Bloco C — Pendências (LDS09–LDS11)

```typescript
// LDS09: Badge de pendências visível no header
test("LDS09 — badge de pendências exibe contagem correta", async ({ page }) => {
  // Navegar para /reserva/livro com N pendências abertas
  // Verificar que badge mostra "N pendências"
});

// LDS10: Ocorrência registrada cria pendência
test("LDS10 — registrar ocorrência cria pendência na timeline", async ({ page }) => {
  // Clicar "Registrar Ocorrência", preencher e confirmar
  // Verificar que evento aparece com fundo amarelo (is_pending)
  // Verificar que badge incrementou
});

// LDS11: Encerrar turno com pendência exibe alerta (não bloqueia)
test("LDS11 — botão Passar Serviço exibe alerta com pendências abertas", async ({ page }) => {
  // Com pendência aberta, clicar "Passar Serviço"
  // Verificar alerta ou badge pulsando
  // Verificar que fluxo de passagem ainda pode ser iniciado
});
```

### Bloco D — Controle de Acesso (LDS12–LDS14)

```typescript
// LDS12: Armeiro não acessa turno de outro armeiro
test("LDS12 — armeiro não vê turno de outro armeiro (403)", async () => {
  // GET /api/shifts/:id com id de outro armeiro
  // Verificar 403 ou 404
});

// LDS13: admin_reserva acessa livro de qualquer armeiro da sua reserva
test("LDS13 — admin_reserva vê turno de armeiro da sua reserva", async ({ page }) => {
  // Login como admin_reserva, navegar para /admin/livros
  // Verificar que turno do armeiro aparece
});

// LDS14: admin_global vê todos os livros ativos
test("LDS14 — admin_global vê livros de qualquer reserva", async ({ page }) => {
  // Login como admin_global, navegar para /admin/livros
  // Verificar cards de livros ativos
});
```

### Bloco E — Encerramento e PDF (LDS15–LDS18)

```typescript
// LDS15: Encerrar turno gera evento turno_encerrado
test("LDS15 — POST /api/shifts/:id/close encerra turno e gera evento", async ({ page }) => {
  // Clicar "Passar Serviço", confirmar encerramento
  // Verificar shift.status = "encerrado"
  // Verificar último evento = turno_encerrado
});

// LDS16: Turno encerrado é read-only
test("LDS16 — turno encerrado não permite novos eventos", async () => {
  // POST /api/shifts/:id/log com shift encerrado
  // Verificar 422
});

// LDS17: PDF gerado contém todos os eventos do turno
test("LDS17 — GET /api/shifts/:id/pdf retorna 200 com content-type PDF", async ({ page }) => {
  // Navegar para /admin/livros/:shift_id, clicar "Exportar PDF"
  // Verificar download com content-type application/pdf
});

// LDS18: PDF contém hash chain verificável
test("LDS18 — PDF inclui event_hash no conteúdo", async ({ page }) => {
  // Baixar PDF, verificar que contém hashes SHA-256
});
```

### Bloco F — Histórico (LDS19–LDS20)

```typescript
// LDS19: /reserva/livro/historico lista turnos anteriores do próprio armeiro
test("LDS19 — /reserva/livro/historico exibe turnos encerrados", async ({ page }) => {
  // Navegar para /reserva/livro/historico
  // Verificar que pelo menos um turno encerrado aparece
  // Verificar campos: data, duração, n° de eventos
});

// LDS20: Admin vê badge de pendência crítica (> 2h)
test("LDS20 — admin vê alerta quando pendência tem > 2h sem resolução", async ({ page }) => {
  // Login como admin_reserva, navegar para /admin/livros
  // Verificar badge vermelho no card com pendência antiga
});
```

---

## Ordem de Implementação

> **⚠ Cada etapa só começa após a anterior estar completamente validada.**
> **"Completamente validada" = `pnpm typecheck` + E2E dos testes da etapa passando.**
> **DoD de referência: `../07-canonical-definition-of-done.md`.**

```
Etapa 1 — Migration
  ├── Criar supabase/migrations/YYYYMMDD_service_shifts.sql
  ├── Aplicar via psql ou MCP
  ├── Verificar RLS: armeiro vê só seus turnos
  └── ✅ Validação: tabelas existem, RLS ativa

Etapa 2 — BFF Core
  ├── Criar apps/bff/src/lib/shift-events.ts (logShiftEvent)
  ├── Criar apps/bff/src/routes/shifts.ts (POST open, GET active, GET events)
  ├── Registrar em index.ts
  └── ✅ Validação: typecheck + LDS01-LDS04 passando

Etapa 3 — Integração de Eventos Automáticos
  ├── Modificar cautelamentos.ts → chamar logShiftEvent
  ├── Modificar saidas.ts → chamar logShiftEvent
  ├── Modificar ocorrencias.ts → chamar logShiftEvent
  └── ✅ Validação: LDS05-LDS06 passando (hash chain íntegra)

Etapa 4 — Frontend Armeiro
  ├── Criar /reserva/livro/page.tsx (server)
  ├── Criar /reserva/livro/_livro-client.tsx (timeline + filtros)
  ├── Criar /reserva/livro/historico/page.tsx
  └── ✅ Validação: LDS07-LDS11 passando

Etapa 5 — Frontend Admin
  ├── Criar /admin/livros/page.tsx (dashboard)
  ├── Criar /admin/livros/[shift_id]/page.tsx (detalhe)
  └── ✅ Validação: LDS12-LDS14 passando

Etapa 6 — Encerramento e PDF
  ├── Criar apps/bff/src/lib/pdf/shift-pdf.ts
  ├── Completar POST /api/shifts/:id/close
  ├── Completar GET /api/shifts/:id/pdf
  └── ✅ Validação: LDS15-LDS18 passando

Etapa 7 — Validação Final
  ├── Rodar suite completa: npx playwright test --project=livro-suite
  ├── Rodar regressão: npx playwright test --project=armeiro-suite
  ├── pnpm typecheck (web + bff)
  ├── pnpm --filter web build
  └── ✅ Validação: LDS01-LDS20 passando, 0 falhas, 0 erros de tipo
```

---

## Definition of Done desta Fase

> **Esta seção é vinculante. Não existe "quase pronto". Cada linha deve ser verdadeira.**
> **DoD canônica completa: `../07-canonical-definition-of-done.md`**

### 1. Critérios Funcionais
- [ ] LDS01: Armeiro abre turno, status = "ativo"
- [ ] LDS02: `/reserva/livro` exibe turno ativo com header correto
- [ ] LDS03: Abrir turno gera evento `turno_assumido` na timeline
- [ ] LDS04: Primeiro evento tem `prev_hash = null` (genesis)
- [ ] LDS05: Emitir cautela gera evento `cautela_emitida` automaticamente
- [ ] LDS06: Hash chain íntegra — `prev_hash[n] === event_hash[n-1]`
- [ ] LDS07: Filtro "Cautelas" filtra corretamente
- [ ] LDS08: Filtro "Pendências" exibe só eventos não resolvidos
- [ ] LDS09: Badge de pendências exibe contagem correta
- [ ] LDS10: Ocorrência cria pendência com fundo amarelo
- [ ] LDS11: Botão "Passar Serviço" alerta com pendências abertas
- [ ] LDS12: Armeiro não acessa turno de outro armeiro (403/404)
- [ ] LDS13: admin_reserva vê turno de qualquer armeiro da sua reserva
- [ ] LDS14: admin_global vê livros de qualquer reserva
- [ ] LDS15: Encerrar turno gera evento `turno_encerrado`
- [ ] LDS16: Turno encerrado rejeita novos eventos (422)
- [ ] LDS17: PDF retorna 200 com content-type correto
- [ ] LDS18: PDF contém hashes SHA-256 verificáveis
- [ ] LDS19: `/reserva/livro/historico` lista turnos encerrados
- [ ] LDS20: Admin vê badge de pendência crítica (> 2h)

### 2. Critérios Técnicos
- [ ] `pnpm --filter web build` — sem erros
- [ ] `pnpm typecheck` (web + bff) — sem erros
- [ ] `pnpm lint` — sem erros
- [ ] Migration aplicada — tabelas existem no Supabase
- [ ] RLS ativa em `service_shifts` e `service_log_events`
- [ ] RULE SQL impede UPDATE/DELETE em `service_log_events`

### 3. Critérios de Segurança
- [ ] Nenhum turno de outro armeiro acessível sem permissão
- [ ] `roleGuard` em todos os 8 endpoints
- [ ] Zod validation em todos os bodies (POST /open, /log, /close)
- [ ] Hash chain não manipulável após inserção (RULE SQL)
- [ ] PDF não expõe dados de outro tenant

### 4. Critérios de Regressão
- [ ] armeiro-suite (AR01-AR23): 0 falhas
- [ ] livro-suite (LDS01-LDS20): 0 falhas
- [ ] `pnpm test:e2e --project=chromium` — smoke passando

### 5. Evidências Obrigatórias
- [ ] Output de terminal: `X passed (Xs)` da `livro-suite`
- [ ] Output de `pnpm typecheck` sem erros
- [ ] Screenshot de `/reserva/livro` com turno ativo e timeline
- [ ] Screenshot de `/admin/livros` com livros ativos
- [ ] Relatório final em `docs/enterprise/reports/phase-6b-final-report.md`

---

## Checklist de Reprovação Automática

**Se qualquer item abaixo for verdadeiro → fase REPROVADA:**

| # | Condição | Verificação |
|---|---|---|
| REP01 | Build falhou | `next build` com erro |
| REP02 | Typecheck falhou | `tsc --noEmit` com erros |
| REP03 | Qualquer LDS falhando | Suite `livro-suite` com falhas |
| REP04 | armeiro-suite regrediram | AR01-AR23 com falhas |
| REP05 | Armeiro acessa turno de outro | LDS12 falhando |
| REP06 | Hash chain quebrada | LDS06 falhando |
| REP07 | PDF sem hashes | LDS18 falhando |
| REP08 | Evento pode ser alterado | UPDATE em service_log_events possível |
| REP09 | endpoint sem roleGuard | Acesso sem auth retorna 200 |
| REP10 | Relatório final ausente | `reports/phase-6b-final-report.md` não existe |

---

## Template do Relatório Final

**Gerar em:** `docs/enterprise/reports/phase-6b-final-report.md`

Seguir template completo de `../07-canonical-definition-of-done.md` → seção "Relatório Final Obrigatório por Fase", com:
- Fase: 6-B
- Nome: Livro Digital de Serviço
- Testes: LDS01-LDS20
- Suite: `livro-suite`

---

## Prompt de Loop para Implementação

```
/loop Fase 6-B — Livro Digital de Serviço. 
Projeto: c:\projetos\apmcb. 
Spec: docs/enterprise/phases/phase-6b-livro-digital-servico.md. 
DoD canônica (OBRIGATÓRIA): docs/enterprise/07-canonical-definition-of-done.md. 
FINALIZADO NÃO É ENTREGUE.

Ordem de execução:
1. Etapa 1: Migration (service_shifts + service_log_events + RLS + RULE) → validar RLS
2. Etapa 2: BFF core (shift-events.ts + shifts.ts: open/active/events) → LDS01-LDS04
3. Etapa 3: Integração automática (cautelamentos/saidas/ocorrencias → logShiftEvent) → LDS05-LDS06
4. Etapa 4: Frontend armeiro (/reserva/livro + historico) → LDS07-LDS11
5. Etapa 5: Frontend admin (/admin/livros + detalhe) → LDS12-LDS14
6. Etapa 6: Encerramento + PDF → LDS15-LDS18 + LDS19-LDS20
7. Etapa 7: Validação final — livro-suite 0 falhas + armeiro-suite 0 falhas + build + report

A cada etapa: tsc --noEmit + E2E dos testes da etapa + commit + push.
Parar quando LDS01-LDS20 passarem com 0 falhas e relatório gerado.
```

---

*Fase 6-B — Livro Digital de Serviço — v1.0 — 2026-06-28*
*DoD canônica: `../07-canonical-definition-of-done.md` — prevalece sobre qualquer outra definição.*
*FINALIZADO NÃO É ENTREGUE.*
