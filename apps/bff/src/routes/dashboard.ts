import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const dashboardRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/dashboard/command — 14 métricas de exceção para admin_global / admin_reserva
dashboardRoutes.get(
  "/command",
  roleGuard("admin_global", "superadmin", "admin_reserva"),
  async (c) => {
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId"); // admin_reserva tem reserveId na sessão

    // Filtro reserva: admin_reserva só vê a sua; admin_global pode filtrar via query
    const qReserveId = c.req.query("reserve_id") ?? (role === "admin_reserva" ? reserveId : null);

    const now = new Date().toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Queries em paralelo
    const [
      cautelasAtivas,
      cautelasVencidas,
      cautelasSemConferencia,
      saidasAtivas,
      saidasAtraso,
      itensDisponiveis,
      itensManutencao,
      itensExtraviados,
      itensSemId,
      solicitacoesPendentes,
      ocorrenciasAbertas,
      semTotp,
      movimentacoes24h,
      passagensAtraso,
      passagensSemEntrante,
    ] = await Promise.allSettled([
      // 1. Cautelas ativas (cautelamentos)
      supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "ativa"),

      // 2. Itens cautelados com validade vencida
      supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "ativa")
        .lt("validade_item", now),

      // 3. Cautelas sem conferência há 90d+
      supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "ativa")
        .or(`data_ultima_conferencia.is.null,data_ultima_conferencia.lt.${ninetyDaysAgo}`),

      // 4. Saídas de turno ativas (material_items)
      supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status_operacional", "em_saida"),

      // 5. Saídas ativas além do turno esperado (lendings > 24h)
      supabase.from("lendings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "ativo")
        .lt("issued_at", twentyFourHoursAgo),

      // 6. Itens disponíveis
      supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status_operacional", "disponivel"),

      // 7. Itens em manutenção
      supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status_operacional", "manutencao"),

      // 8. Itens extraviados
      supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status_operacional", "extraviado"),

      // 9. Itens sem identificador principal
      supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .is("identificador_principal", null),

      // 10. Solicitações SSA pendentes
      supabase.from("material_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "pendente"),

      // 11. Ocorrências abertas
      supabase.from("ocorrencias")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .in("status", ["aberta", "em_analise"]),

      // 12. Militares sem TOTP (usando totp_secrets)
      supabase.from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("role", "usuario")
        .eq("totp_configured", false),

      // 13. Movimentações audit_events nas últimas 24h
      supabase.from("audit_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .gte("created_at", twentyFourHoursAgo),

      // 14. Passagens em atraso (service_handovers)
      supabase.from("service_handovers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "vencido"),

      // 15. Passagens sem entrante há 2h+
      supabase.from("service_handovers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId!)
        .eq("status", "aguardando_atribuicao")
        .lt("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
    ]);

    const safe = (r: PromiseSettledResult<{ count: number | null }>) =>
      r.status === "fulfilled" ? (r.value.count ?? 0) : 0;

    const generatedAt = new Date().toISOString();

    return c.json({
      cautelas_ativas:             safe(cautelasAtivas as PromiseSettledResult<{ count: number | null }>),
      cautelas_com_item_vencido:   safe(cautelasVencidas as PromiseSettledResult<{ count: number | null }>),
      cautelas_sem_conferencia_90d: safe(cautelasSemConferencia as PromiseSettledResult<{ count: number | null }>),
      saidas_ativas:               safe(saidasAtivas as PromiseSettledResult<{ count: number | null }>),
      saidas_com_atraso:           safe(saidasAtraso as PromiseSettledResult<{ count: number | null }>),
      itens_disponiveis:           safe(itensDisponiveis as PromiseSettledResult<{ count: number | null }>),
      itens_em_manutencao:         safe(itensManutencao as PromiseSettledResult<{ count: number | null }>),
      itens_extraviados:           safe(itensExtraviados as PromiseSettledResult<{ count: number | null }>),
      itens_sem_identificador:     safe(itensSemId as PromiseSettledResult<{ count: number | null }>),
      solicitacoes_pendentes:      safe(solicitacoesPendentes as PromiseSettledResult<{ count: number | null }>),
      ocorrencias_abertas:         safe(ocorrenciasAbertas as PromiseSettledResult<{ count: number | null }>),
      usuarios_sem_totp:           safe(semTotp as PromiseSettledResult<{ count: number | null }>),
      movimentacoes_24h:           safe(movimentacoes24h as PromiseSettledResult<{ count: number | null }>),
      passagens_em_atraso:         safe(passagensAtraso as PromiseSettledResult<{ count: number | null }>),
      passagens_sem_entrante:      safe(passagensSemEntrante as PromiseSettledResult<{ count: number | null }>),
      reserve_id:                  qReserveId ?? null,
      generated_at:                generatedAt,
    });
  }
);

dashboardRoutes.get("/stats", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const [activeCount, pendingCount, materialsResult, profilesCount] =
    await Promise.all([
      supabase
        .from("lendings")
        .select("*", { count: "exact", head: true })
        .eq("status_legacy", "ativo"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("registration_status", "pending_biometric"),
      supabase.from("material_availability").select("*"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "usuario"),
    ]);

  const lowStock = (materialsResult.data ?? []).filter(
    (m) => m.quantidade_disponivel <= 3
  );

  return c.json({
    total_armados: activeCount.count ?? 0,
    cadastros_pendentes: pendingCount.count ?? 0,
    total_militares: profilesCount.count ?? 0,
    materiais_estoque_baixo: lowStock,
    materiais: materialsResult.data ?? [],
  });
});

// ── GET /api/tenant/branding ──────────────────────────────────────
// Retorna configuração visual do tenant atual do usuário logado.
// Usado pelo layout do dashboard para injetar CSS custom properties.
dashboardRoutes.get(
  "/branding",
  roleGuard("admin_global", "superadmin", "admin_reserva", "armeiro", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data, error } = await supabase
      .from("tenant_branding")
      .select("primary_hex, secondary_hex, tenant_logo_url, reserve_logo_url")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) return c.json({ error: "Falha ao buscar branding" }, 500);

    return c.json({
      primary_hex:      data?.primary_hex      ?? "#0f172a",
      secondary_hex:    data?.secondary_hex    ?? "#3b82f6",
      tenant_logo_url:  data?.tenant_logo_url  ?? null,
      reserve_logo_url: data?.reserve_logo_url ?? null,
    });
  }
);
