import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash } from "node:crypto";
import { supabase } from "../services/supabase";
import { roleGuard } from "../middleware/role-guard";
import { logShiftEvent } from "../lib/shift-events";
import { validateSelfTotp, validateSelfBiometric } from "../lib/shift-auth";
import { logger } from "../lib/logger";
import type { HonoVariables } from "../types/hono";

export const shiftsRoutes = new Hono<{ Variables: HonoVariables }>();

// ── Schemas Zod ──────────────────────────────────────────────────────────────

const AuthModeSchema = z.enum(["totp", "biometria"]);

const OpenShiftSchema = z.object({
  reserve_id: z.string().uuid(),
  observacao_abertura: z.string().max(500).optional(),
  auth_mode: AuthModeSchema,
  totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
}).refine(
  (d) => d.auth_mode !== "totp" || !!d.totp_token,
  { message: "totp_token obrigatório quando auth_mode é totp", path: ["totp_token"] }
);

const LogEventSchema = z.object({
  description: z.string().min(1).max(1000),
  event_type: z.enum(["ocorrencia_registrada", "evento_manual"]),
  is_pending: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

const CloseShiftSchema = z.object({
  observacao_encerramento: z.string().max(500).optional(),
  handover_id: z.string().uuid().optional(),
  auth_mode: AuthModeSchema,
  totp_token: z.string().length(6).regex(/^\d{6}$/).optional(),
}).refine(
  (d) => d.auth_mode !== "totp" || !!d.totp_token,
  { message: "totp_token obrigatório quando auth_mode é totp", path: ["totp_token"] }
);

// ── POST /api/shifts/open — Abrir turno ──────────────────────────────────────

shiftsRoutes.post(
  "/open",
  roleGuard("armeiro"),
  zValidator("json", OpenShiftSchema),
  async (c) => {
    const userId   = c.get("userId");
    let tenantId   = c.get("tenantId");
    const { reserve_id, observacao_abertura, auth_mode, totp_token } = c.req.valid("json");

    // Se tenantId não está na sessão, resolve via reserve (fallback)
    if (!tenantId) {
      const { data: reserve } = await supabase
        .from("reserves")
        .select("tenant_id")
        .eq("id", reserve_id)
        .maybeSingle();
      tenantId = reserve?.tenant_id ?? null;
    }
    if (!tenantId) {
      return c.json({ error: "Tenant não encontrado para esta reserva" }, 400);
    }

    // reserve_id vem do body — sem essa checagem, qualquer armeiro autenticado
    // poderia abrir turno (e, com ele, ler snapshot de armamento e logar eventos)
    // numa reserva de OUTRO tenant, ou mesmo de outra reserva do próprio tenant
    // à qual não pertence. Mesmo escopo que já restringe a UI via
    // GET /api/profiles/me/reserves — aqui é reforçado no servidor.
    const { data: membership } = await supabase
      .from("reserve_memberships")
      .select("reserve_id, reserves!inner(tenant_id)")
      .eq("user_id", userId)
      .eq("reserve_id", reserve_id)
      .eq("reserves.tenant_id", tenantId)
      .maybeSingle();
    if (!membership) {
      return c.json({ error: "Você não pertence a esta reserva." }, 403);
    }

    // Verificar se já existe turno ativo — antes de consumir o TOTP, para não
    // queimar o código do armeiro numa tentativa que sempre resultaria em 409.
    const { data: existing } = await supabase
      .from("service_shifts")
      .select("id")
      .eq("armeiro_id", userId)
      .eq("status", "ativo")
      .maybeSingle();

    if (existing) {
      return c.json({ error: "Já existe um turno ativo. Encerre-o antes de abrir outro." }, 409);
    }

    // Bloqueia turno duplicado NA MESMA RESERVA por um armeiro diferente — o
    // arsenal físico é único por reserva, então dois armeiros não podem estar
    // simultaneamente "de plantão" na mesma sala. Também checado antes do TOTP
    // pelo mesmo motivo do check acima (não queimar o código à toa).
    const { data: reserveActive } = await supabase
      .from("service_shifts")
      .select("id, started_at, armeiro:profiles!service_shifts_armeiro_id_fkey(nome_completo, matricula, posto)")
      .eq("reserve_id", reserve_id)
      .eq("status", "ativo")
      .maybeSingle();

    if (reserveActive) {
      const armeiroInfo = Array.isArray(reserveActive.armeiro) ? reserveActive.armeiro[0] : reserveActive.armeiro;
      return c.json({
        error: "RESERVE_SHIFT_ACTIVE",
        message: "Esta reserva já tem um turno ativo com outro armeiro.",
        armeiro: armeiroInfo ?? null,
        started_at: reserveActive.started_at,
      }, 409);
    }

    // Validar autenticação do armeiro (TOTP ou biometria)
    const authResult = auth_mode === "totp"
      ? await validateSelfTotp(userId, totp_token!)
      : await validateSelfBiometric(userId);

    if (!authResult.ok) {
      return c.json({ error: authResult.error }, authResult.status);
    }

    // Gerar snapshot de abertura
    const snapshot = await generateOpeningSnapshot(tenantId, reserve_id);

    const { data: shift, error } = await supabase
      .from("service_shifts")
      .insert({
        tenant_id: tenantId,
        reserve_id,
        armeiro_id: userId,
        opening_snapshot: snapshot,
        status: "ativo",
      })
      .select("*")
      .single();

    if (error || !shift) {
      // 23505 = unique_violation — fecha a janela de corrida entre os SELECTs acima
      // e este INSERT (dois armeiros clicando "Assumir Turno" ao mesmo tempo na
      // mesma reserva, ou o mesmo armeiro em duas abas). Os índices únicos parciais
      // (uq_shifts_armeiro_ativo / uq_shifts_reserve_ativo) são a barreira real —
      // os SELECTs acima só existem para dar uma mensagem amigável no caso comum.
      if (error?.code === "23505") {
        return c.json({
          error: "RESERVE_SHIFT_ACTIVE",
          message: "Conflito ao abrir turno — outro armeiro abriu um turno nesta reserva (ou você já tem um turno ativo) no mesmo instante. Recarregue a página.",
        }, 409);
      }
      c.get("log").error({ code: error?.code, error: error?.message, reserve_id }, "shift.open.persist_failure");
      return c.json({ error: "Não foi possível abrir o turno. Tente novamente." }, 500);
    }

    // Registrar evento de abertura — shiftId explícito (não depender da
    // busca por status='ativo', que pode pegar o turno errado sob
    // concorrência real: E2E manual + CI rodando ao mesmo tempo contra o
    // mesmo armeiro fixture já reproduziu isso em produção).
    await logShiftEvent({
      shiftId:     shift.id,
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   "turno_assumido",
      description: observacao_abertura
        ? `Turno assumido. ${observacao_abertura}`
        : "Turno assumido.",
    });
    c.get("log").info({ shiftId: shift.id, reserve_id, armeiro_id: userId }, "shift.open");

    return c.json({ ok: true, shift }, 201);
  }
);

// ── GET /api/shifts/active — Turno ativo do usuário logado ──────────────────

shiftsRoutes.get(
  "/active",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const userId = c.get("userId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select(`
        *,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("armeiro_id", userId)
      .eq("status", "ativo")
      .maybeSingle();

    return c.json({ shift: shift ?? null });
  }
);

// ── GET /api/shifts/:id/events — Eventos do turno ───────────────────────────

shiftsRoutes.get(
  "/:id/events",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");
    const { type, pending_only } = c.req.query();

    // Verificar acesso ao turno
    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, tenant_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    let query = supabase
      .from("service_log_events")
      .select(`
        id, happened_at, event_type, description, metadata,
        is_pending, resolved_at, prev_hash, event_hash,
        actor:profiles!service_log_events_actor_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("shift_id", shiftId)
      .order("happened_at", { ascending: true });

    if (type) query = query.eq("event_type", type);
    if (pending_only === "true") {
      query = query.eq("is_pending", true).is("resolved_at", null);
    }

    const { data: events, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    return c.json({ events: events ?? [] });
  }
);

// ── GET /api/shifts/:id/pending — Pendências abertas ────────────────────────

shiftsRoutes.get(
  "/:id/pending",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, tenant_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const { data: pending } = await supabase
      .from("service_log_events")
      .select("id, happened_at, event_type, description, metadata")
      .eq("shift_id", shiftId)
      .eq("is_pending", true)
      .is("resolved_at", null)
      .order("happened_at", { ascending: true });

    return c.json({ pending: pending ?? [], count: (pending ?? []).length });
  }
);

// ── POST /api/shifts/:id/log — Registrar evento manual ──────────────────────

shiftsRoutes.post(
  "/:id/log",
  roleGuard("armeiro"),
  zValidator("json", LogEventSchema),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const tenantId = c.get("tenantId");
    const body     = c.req.valid("json");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, status")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.armeiro_id !== userId) return c.json({ error: "Acesso negado" }, 403);
    if (shift.status !== "ativo") return c.json({ error: "Turno não está ativo" }, 422);

    await logShiftEvent({
      shiftId,
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   body.event_type,
      description: body.description,
      isPending:   body.is_pending,
      metadata:    body.metadata,
    });

    return c.json({ ok: true });
  }
);

// ── POST /api/shifts/:id/close — Encerrar turno ─────────────────────────────

shiftsRoutes.post(
  "/:id/close",
  roleGuard("armeiro"),
  zValidator("json", CloseShiftSchema),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const tenantId = c.get("tenantId");
    const { observacao_encerramento, handover_id, auth_mode, totp_token } = c.req.valid("json");

    // Verificar propriedade do turno ANTES de consumir o TOTP/biometria (fail fast sem custo de auth)
    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, status, reserve_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.armeiro_id !== userId) return c.json({ error: "Acesso negado" }, 403);
    if (shift.status !== "ativo") return c.json({ error: "Turno já encerrado" }, 422);

    // Validar autenticação do armeiro apenas após confirmar propriedade do turno
    const authResult = auth_mode === "totp"
      ? await validateSelfTotp(userId, totp_token!)
      : await validateSelfBiometric(userId);

    if (!authResult.ok) {
      return c.json({ error: authResult.error }, authResult.status);
    }

    const closingSnapshot = await generateOpeningSnapshot(tenantId, shift.reserve_id as string);

    const { error: closeErr } = await supabase.from("service_shifts").update({
      status:           "encerrado",
      ended_at:         new Date().toISOString(),
      closing_snapshot: closingSnapshot,
      handover_id:      handover_id ?? null,
    }).eq("id", shiftId);

    if (closeErr) {
      c.get("log").error({ code: closeErr.code, error: closeErr.message, shiftId }, "shift.close.persist_failure");
      return c.json({ error: "Não foi possível encerrar o turno. Tente novamente." }, 500);
    }

    // shiftId explícito — CRÍTICO aqui: o UPDATE acima já mudou o status
    // deste turno para 'encerrado', então a busca por status='ativo' (usada
    // quando shiftId não é passado) nunca mais encontraria este turno. Sem
    // isso, o evento turno_encerrado nunca era gravado — bug real confirmado
    // em produção (100% dos encerramentos, silenciosamente).
    await logShiftEvent({
      shiftId,
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   "turno_encerrado",
      description: observacao_encerramento
        ? `Turno encerrado. ${observacao_encerramento}`
        : "Turno encerrado.",
    });
    c.get("log").info({ shiftId, armeiro_id: userId }, "shift.close");

    return c.json({ ok: true });
  }
);

// ── GET /api/shifts — Listar turnos (admin) ──────────────────────────────────

shiftsRoutes.get(
  "/",
  // "armeiro" incluído: a aba "Histórico" do próprio Livro Digital (Fase D)
  // consome este endpoint para o turno do próprio armeiro — sem isso, 403.
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const role     = c.get("role");
    const userId   = c.get("userId");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 403);

    const { status, armeiro_id, from, to, q, limit: limitParam } = c.req.query();

    // Paginação real (não só slice no client): limit vem da UI no padrão
    // 10/20/30 (Histórico do Livro Digital) — default 50 preserva o
    // comportamento anterior para quem não manda o param (ex: /admin/livros).
    const limit = Math.min(Math.max(parseInt(limitParam ?? "50", 10) || 50, 1), 100);

    // armeiro_id é NOT NULL em service_shifts — "!inner" nunca reduz o
    // resultado sozinho, mas habilita filtrar por coluna do embed (nome do
    // armeiro) via PostgREST sem uma segunda query desescopada de tenant.
    let query = supabase
      .from("service_shifts")
      .select(`
        id, status, started_at, ended_at, pending_count,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey!inner(id, nome_completo, matricula, posto),
        service_log_events(count)
      `)
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      // Busca 1 a mais que o limite pedido só para saber se há próxima página
      // (mesmo truque de apps/web .../reserva/saidas/page.tsx) — evita um
      // SELECT count(*) adicional.
      .limit(limit + 1);
    if (status) query = query.eq("status", status);
    // Filtro de período é por SOBREPOSIÇÃO com o intervalo, não só por
    // started_at: um turno aberto antes de `from` e encerrado (ou ainda
    // ativo) dentro do intervalo pedido também "aconteceu" nesse período.
    // Filtrar só por started_at (bug original) escondia da lista turnos de
    // plantões que atravessam a virada do dia — ex: turno aberto 09/07 e
    // encerrado 11/07 desaparecia de um filtro "período: 11/07 a 11/07".
    //
    // from/to são interpolados direto num filtro PostgREST (.or/.lte) — igual
    // a outras rotas do BFF (arsenal.ts, categories.ts, nexus.ts) — então
    // valida o formato yyyy-mm-dd antes: sem isso, um valor arbitrário na
    // query string poderia injetar cláusulas extras na expressão .or().
    const isDateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (to && isDateOnly(to)) {
      // `to` é uma data pura (yyyy-mm-dd) no fuso de Brasília (UTC-3) — sem
      // offset explícito, o Postgres (timestamptz, sessão em UTC) interpretava
      // "fim do dia" 3h adiantado, cortando turnos que começam entre 21h e
      // 23h59 de Brasília no dia final do filtro.
      query = query.lte("started_at", `${to}T23:59:59.999-03:00`);
    }
    if (from && isDateOnly(from)) {
      // Mesmo motivo: meia-noite de Brasília, não UTC — sem offset, turnos
      // encerrados entre 21h e 23h59 de Brasília do dia ANTERIOR ao início do
      // filtro entravam indevidamente no resultado.
      query = query.or(`ended_at.gte.${from}T00:00:00.000-03:00,ended_at.is.null`);
    }

    // Privilege ceiling: armeiro só vê os próprios turnos, ignora armeiro_id/q da query.
    if (role === "armeiro") {
      query = query.eq("armeiro_id", userId);
    } else {
      if (armeiro_id) query = query.eq("armeiro_id", armeiro_id);
      if (q) query = query.ilike("armeiro.nome_completo", `%${q}%`);

      // Acesso administrativo a turnos de terceiros é sensível — audita a consulta.
      // Fire-and-forget: não bloqueia a listagem por um insert de auditoria.
      supabase.from("audit_logs").insert({
        actor_id: userId,
        action: "shift.list.admin_access",
        resource_type: "service_shifts",
        resource_id: null,
        metadata: { role, status: status ?? null, armeiro_id: armeiro_id ?? null, q: q ?? null, from: from ?? null, to: to ?? null },
      }).then(({ error }) => {
        if (error) logger.error("shifts.list.audit_failure", { actor_id: userId, error: error.message });
      });
    }

    const { data: shifts, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    const hasMore = (shifts ?? []).length > limit;
    const pageRows = hasMore ? (shifts ?? []).slice(0, limit) : (shifts ?? []);

    // pending_count real, calculado ao vivo — substitui a coluna
    // service_shifts.pending_count, que nunca é escrita em lugar nenhum do
    // código (achado do spec de redesign do Livro Digital, seção 4.3: o
    // dashboard admin sempre mostrava 0). Uma única query agregada extra
    // (não N+1) cobrindo todos os turnos da página de uma vez.
    const shiftIds = pageRows.map((s) => s.id);
    const pendingCountByShiftId = new Map<string, number>();
    if (shiftIds.length > 0) {
      const { data: pendingRows, error: pendingError } = await supabase
        .from("service_log_events")
        .select("shift_id")
        .eq("tenant_id", tenantId)
        .eq("is_pending", true)
        .is("resolved_at", null)
        .in("shift_id", shiftIds);
      if (pendingError) {
        logger.error("shifts.list.pending_count_failure", { error: pendingError.message });
      } else {
        for (const row of pendingRows ?? []) {
          pendingCountByShiftId.set(row.shift_id, (pendingCountByShiftId.get(row.shift_id) ?? 0) + 1);
        }
      }
    }

    const shiftsWithCount = pageRows.map((s) => {
      const { service_log_events, pending_count: _staleColumn, ...rest } = s as typeof s & { service_log_events: { count: number }[] };
      return {
        ...rest,
        evento_count: service_log_events?.[0]?.count ?? 0,
        pending_count: pendingCountByShiftId.get(s.id) ?? 0,
      };
    });

    return c.json({ shifts: shiftsWithCount, has_more: hasMore });
  }
);

// ── GET /api/shifts/:id — Detalhe de turno ──────────────────────────────────

shiftsRoutes.get(
  "/:id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select(`
        *,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    return c.json({ shift });
  }
);

// ── GET /api/shifts/:id/pdf — Exportar Livro em PDF ─────────────────────────

shiftsRoutes.get(
  "/:id/pdf",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select(`
        id, status, started_at, ended_at, opening_snapshot, closing_snapshot, tenant_id, armeiro_id,
        reserve:reserves(nome, acronym),
        armeiro:profiles!service_shifts_armeiro_id_fkey(nome_completo, matricula, posto)
      `)
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const { data: events } = await supabase
      .from("service_log_events")
      .select(`
        happened_at, event_type, description, event_hash, prev_hash,
        actor:profiles!service_log_events_actor_id_fkey(nome_completo, matricula)
      `)
      .eq("shift_id", shiftId)
      .order("happened_at", { ascending: true });

    const raw = shift as unknown as Record<string, unknown>;
    const reserve = Array.isArray(raw["reserve"]) ? raw["reserve"][0] : raw["reserve"];
    const armeiro = Array.isArray(raw["armeiro"]) ? raw["armeiro"][0] : raw["armeiro"];

    const eventsForPdf = (events ?? []).map((e) => {
      const eraw = e as unknown as Record<string, unknown>;
      const actor = Array.isArray(eraw["actor"]) ? eraw["actor"][0] : eraw["actor"];
      const actorObj = actor as { nome_completo?: string; matricula?: string } | null;
      return {
        happened_at: e.happened_at,
        event_type: e.event_type,
        description: e.description,
        event_hash: e.event_hash,
        prev_hash: e.prev_hash,
        actor_nome: actorObj?.nome_completo ?? null,
        actor_matricula: actorObj?.matricula ?? null,
      };
    });

    try {
      const { generateLivroPdf } = await import("../lib/pdf/livro-pdf");
      const pdfBytes = await generateLivroPdf({
        id: shift.id,
        status: shift.status,
        started_at: shift.started_at,
        ended_at: shift.ended_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reserve: reserve as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        armeiro: armeiro as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        opening_snapshot: shift.opening_snapshot as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        closing_snapshot: shift.closing_snapshot as any,
        events: eventsForPdf,
      });

      c.header("Content-Type", "application/pdf");
      c.header("Content-Disposition", `attachment; filename="livro-${shiftId.slice(0, 8)}.pdf"`);
      return c.body(Buffer.from(pdfBytes));
    } catch (err) {
      logger.error("shifts.pdf.generation_failure", {
        shift_id: shiftId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: "Falha ao gerar PDF do turno" }, 500);
    }
  }
);

// ── GET /api/shifts/:id/csv — Exportar eventos do Livro em CSV ──────────────

shiftsRoutes.get(
  "/:id/csv",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, tenant_id, armeiro_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const { data: events } = await supabase
      .from("service_log_events")
      .select(`
        happened_at, event_type, description, event_hash, prev_hash,
        actor:profiles!service_log_events_actor_id_fkey(nome_completo, matricula)
      `)
      .eq("shift_id", shiftId)
      .order("happened_at", { ascending: true });

    // Neutraliza CSV/Formula Injection (OWASP CWE-1236): campos que começam
    // com =, +, -, @ ou tab/CR são interpretados como fórmula pelo Excel/
    // LibreOffice ao abrir o arquivo. description e nome são texto livre.
    const csvEscape = (v: string) => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = "happened_at,event_type,actor_nome,actor_matricula,description,event_hash,prev_hash";
    const rows = (events ?? []).map((e) => {
      const raw = e as unknown as Record<string, unknown>;
      const actor = Array.isArray(raw["actor"]) ? raw["actor"][0] : raw["actor"];
      const actorObj = actor as { nome_completo?: string; matricula?: string } | null;
      return [
        e.happened_at,
        e.event_type,
        actorObj?.nome_completo ?? "",
        actorObj?.matricula ?? "",
        e.description,
        e.event_hash,
        e.prev_hash ?? "",
      ].map((f) => csvEscape(String(f))).join(",");
    });
    const csv = [header, ...rows].join("\n");

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="livro-${shiftId.slice(0, 8)}.csv"`);
    return c.body(csv);
  }
);

// ── Helper: snapshot de abertura/encerramento ────────────────────────────────

async function generateOpeningSnapshot(
  tenantId: string | null,
  reserveId: string
): Promise<Record<string, unknown>> {
  const [itemsRes, cautelasRes, saidasRes] = await Promise.all([
    supabase
      .from("material_items")
      .select("status_operacional, material_type:material_types(nome, categoria)")
      .eq("reserve_id", reserveId),
    supabase
      .from("cautelamentos")
      .select("id")
      .eq("reserve_id", reserveId)
      .eq("status", "ativa"),
    supabase
      .from("lendings")
      .select("id")
      .eq("reserve_id", reserveId)
      .eq("status", "aberta"),
  ]);

  const items = itemsRes.data ?? [];
  const byStatus: Record<string, number> = {};
  for (const item of items) {
    byStatus[item.status_operacional] = (byStatus[item.status_operacional] ?? 0) + 1;
  }

  return {
    generated_at:       new Date().toISOString(),
    total_itens:        items.length,
    por_status:         byStatus,
    cautelas_ativas:    (cautelasRes.data ?? []).length,
    saidas_abertas:     (saidasRes.data ?? []).length,
  };
}
