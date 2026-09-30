import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard";
import type { Context } from "hono";
import { supabase } from "../services/supabase";
import { scopedReserveIds, isMatriz } from "../lib/reserve-scope";
import type { HonoVariables } from "../types/hono";

export const dashboardRoutes = new Hono<{ Variables: HonoVariables }>();

// R-06 (docs/auditoria/EVIDENCE_R06.md): estas rotas usam a service role —
// RLS não protege. Todo agregado precisa de tenant (sempre) e de reserva
// (sempre que o ator não está em matriz). Regra de lib/reserve-scope.ts:
// admin_global/auditor SEM reserva ativa = matriz (tenant inteiro); qualquer
// outro caso fica confinado à reserva ativa da sessão. `requestedReserveId`
// (query do cliente) é só uma SELEÇÃO dentro do escopo autorizado, nunca
// autorização. Sem tenant, ou sem reserva quando ela é exigida → 403.
type DashboardScope = { tenantId: string; reserveIds: string[] | null }; // null = tenant inteiro (matriz)
type CountResult = { count: number | null; error: { message: string } | null };

async function resolveDashboardScope(
  c: Context<{ Variables: HonoVariables }>,
  requestedReserveId: string | undefined,
): Promise<{ ok: true; scope: DashboardScope } | { ok: false; res: Response }> {
  const role = c.get("role");
  const tenantId = c.get("tenantId");
  const reserveId = c.get("reserveId");
  const requested = requestedReserveId || undefined; // "?reserve_id=" vazio = sem seleção
  const deny = (reason: string, message: string) => {
    c.get("log").warn({ userId: c.get("userId"), role, tenantId, reserveId, requestedReserveId: requested, reason, path: c.req.path }, "dashboard.scope.denied");
    return { ok: false as const, res: c.json({ error: message }, 403) };
  };

  if (!tenantId) return deny("no_tenant", "Tenant não identificado na sessão");
  if (!requested && isMatriz(role, reserveId)) return { ok: true, scope: { tenantId, reserveIds: null } };
  const allowed = await scopedReserveIds(role, reserveId, tenantId);
  if (requested) {
    if (!allowed.includes(requested)) return deny("reserve_not_allowed", "Sem acesso a esta reserva");
    return { ok: true, scope: { tenantId, reserveIds: [requested] } };
  }
  if (allowed.length === 0) return deny("no_active_reserve", "Reserva ativa não identificada na sessão");
  return { ok: true, scope: { tenantId, reserveIds: allowed } };
}

// Aplica .in("reserve_id", …) quando o escopo é de reserva; matriz mantém só o tenant.
// (Q sem constraint estrutural: inferir `.in` sobre os builders do
// supabase-js estoura o limite de instanciação do tsc.)
function byReserve<Q>(query: Q, scope: DashboardScope): Q {
  if (!scope.reserveIds) return query;
  return (query as unknown as { in(column: string, values: string[]): Q }).in("reserve_id", scope.reserveIds);
}

// profiles não tem reserve_id: em escopo de reserva, conta só quem tem
// reserve_memberships numa reserva do escopo (join !inner, contagem no banco —
// sem lista de IDs na URL e sem o teto de linhas do PostgREST).
async function countProfiles(
  scope: DashboardScope,
  apply: (q: ReturnType<typeof profilesCountQuery>) => ReturnType<typeof profilesCountQuery>,
): Promise<CountResult> {
  let q = apply(profilesCountQuery(scope));
  if (scope.reserveIds) q = q.in("reserve_memberships.reserve_id", scope.reserveIds);
  const { count, error } = await q;
  return { count, error };
}
function profilesCountQuery(scope: DashboardScope) {
  return supabase
    .from("profiles")
    .select(scope.reserveIds ? "id, reserve_memberships!inner(reserve_id)" : "id", { count: "exact", head: true })
    .eq("default_tenant_id", scope.tenantId);
}

// `ocorrencias` não tem tenant_id nem reserve_id. Mesma regra de
// routes/ocorrencias.ts: tenant pelo militar (join !inner); reserva pela
// lending (lendings.reserve_id é NOT NULL) e, só quando não há lending, pelo
// material_type. Ocorrência sem nenhum dos dois fica fora da contagem de
// reserva (fail-closed). Duas contagens no banco, disjuntas por lending_id.
async function countOpenOcorrencias(scope: DashboardScope): Promise<CountResult> {
  const MILITARY = "military:profiles!ocorrencias_military_id_fkey!inner(default_tenant_id)";
  const open = ["aberta", "em_analise"];
  if (!scope.reserveIds) {
    const { count, error } = await supabase.from("ocorrencias")
      .select(`id, ${MILITARY}`, { count: "exact", head: true })
      .eq("military.default_tenant_id", scope.tenantId)
      .in("status", open);
    return { count, error };
  }
  const [viaLending, viaType] = await Promise.all([
    supabase.from("ocorrencias")
      .select(`id, ${MILITARY}, lending:lendings!inner(reserve_id)`, { count: "exact", head: true })
      .eq("military.default_tenant_id", scope.tenantId)
      .in("status", open)
      .in("lending.reserve_id", scope.reserveIds),
    supabase.from("ocorrencias")
      .select(`id, ${MILITARY}, material_type:material_types!inner(reserve_id)`, { count: "exact", head: true })
      .eq("military.default_tenant_id", scope.tenantId)
      .in("status", open)
      .is("lending_id", null)
      .in("material_type.reserve_id", scope.reserveIds),
  ]);
  const error = viaLending.error ?? viaType.error;
  if (error) return { count: null, error };
  return { count: (viaLending.count ?? 0) + (viaType.count ?? 0), error: null };
}

// Métrica que falhou vira 0 no painel — mas sempre deixa rastro no log (CLAUDE.md).
type MetricOutcome = PromiseSettledResult<{ error: { message: string } | null }> | { error: { message: string } | null };
function logMetricFailures(c: Context<{ Variables: HonoVariables }>, results: Record<string, MetricOutcome>) {
  for (const [metric, r] of Object.entries(results)) {
    const err = "status" in r ? (r.status === "rejected" ? String(r.reason) : r.value.error?.message) : r.error?.message;
    if (err) c.get("log").error({ metric, error: err, path: c.req.path }, "dashboard.metric.failure");
  }
}

// GET /api/dashboard/command — 13 métricas de exceção para admin_global / admin_reserva
// Achado real do usuário (2026-08-29): "Solicitações SSA pendentes" (aqui e no
// card "SSA Pendentes" do painel Comando) contava material_requests — pedido
// REMOTO do MILITAR por armamento, despachado diretamente pelo armeiro
// (/reserva/solicitacoes), sem aprovação de admin_reserva/admin_global. O
// card linkava pra /admin/arsenal/solicitacoes, que mostra um domínio
// DIFERENTE (admin_approval_requests — pedido do ARMEIRO por material/
// categoria, esse sim aprovado por admin_reserva/admin_global) — card
// contava uma coisa e levava pra outra. Removido: admin_global/admin_reserva
// não gerenciam despacho de SSA, é operação do dia a dia do armeiro.
dashboardRoutes.get(
  "/command",
  roleGuard("admin_global", "admin_reserva"),
  async (c) => {
    const resolved = await resolveDashboardScope(c, c.req.query("reserve_id"));
    if (!resolved.ok) return resolved.res;
    const { scope } = resolved;
    const tenantId = scope.tenantId;

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
      ocorrenciasAbertas,
      semTotp,
      movimentacoes24h,
      passagensAtraso,
      passagensSemEntrante,
    ] = await Promise.allSettled([
      // 1. Cautelas ativas (cautelamentos)
      byReserve(supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "ativa"),

      // 2. Itens cautelados com validade vencida
      byReserve(supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "ativa")
        .lt("validade_item", now),

      // 3. Cautelas sem conferência há 90d+
      byReserve(supabase.from("cautelamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "ativa")
        .or(`data_ultima_conferencia.is.null,data_ultima_conferencia.lt.${ninetyDaysAgo}`),

      // 4. Saídas de turno ativas (material_items)
      byReserve(supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status_operacional", "em_saida"),

      // 5. Saídas ativas além do turno esperado (lendings > 24h)
      byReserve(supabase.from("lendings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "ativo")
        .lt("issued_at", twentyFourHoursAgo),

      // 6. Itens disponíveis
      byReserve(supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status_operacional", "disponivel"),

      // 7. Itens em manutenção
      byReserve(supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status_operacional", "manutencao"),

      // 8. Itens extraviados
      byReserve(supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status_operacional", "extraviado"),

      // 9. Itens sem identificador principal
      byReserve(supabase.from("material_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .is("identificador_principal", null),

      // 10. Ocorrências abertas
      countOpenOcorrencias(scope),

      // 11. Militares sem TOTP (usando totp_secrets)
      countProfiles(scope, (q) => q.eq("role", "usuario").eq("totp_configured", false)),

      // 12. Movimentações audit_events nas últimas 24h
      byReserve(supabase.from("audit_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .gte("created_at", twentyFourHoursAgo),

      // 13. Passagens em atraso (service_handovers)
      byReserve(supabase.from("service_handovers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "vencido"),

      // 14. Passagens sem entrante há 2h+
      byReserve(supabase.from("service_handovers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId), scope)
        .eq("status", "aguardando_atribuicao")
        .lt("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()),
    ]);

    logMetricFailures(c, {
      cautelas_ativas: cautelasAtivas, cautelas_com_item_vencido: cautelasVencidas,
      cautelas_sem_conferencia_90d: cautelasSemConferencia, saidas_ativas: saidasAtivas,
      saidas_com_atraso: saidasAtraso, itens_disponiveis: itensDisponiveis,
      itens_em_manutencao: itensManutencao, itens_extraviados: itensExtraviados,
      itens_sem_identificador: itensSemId, ocorrencias_abertas: ocorrenciasAbertas,
      usuarios_sem_totp: semTotp, movimentacoes_24h: movimentacoes24h,
      passagens_em_atraso: passagensAtraso, passagens_sem_entrante: passagensSemEntrante,
    } as Record<string, MetricOutcome>);

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
      ocorrencias_abertas:         safe(ocorrenciasAbertas as PromiseSettledResult<{ count: number | null }>),
      usuarios_sem_totp:           safe(semTotp as PromiseSettledResult<{ count: number | null }>),
      movimentacoes_24h:           safe(movimentacoes24h as PromiseSettledResult<{ count: number | null }>),
      passagens_em_atraso:         safe(passagensAtraso as PromiseSettledResult<{ count: number | null }>),
      passagens_sem_entrante:      safe(passagensSemEntrante as PromiseSettledResult<{ count: number | null }>),
      reserve_id:                  scope.reserveIds?.length === 1 ? scope.reserveIds[0] : null,
      generated_at:                generatedAt,
    });
  }
);

dashboardRoutes.get("/stats", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  // R-06: antes não tinha filtro nenhum (agregava todos os tenants). Não
  // aceita seleção de reserva pelo cliente — o escopo vem só da sessão.
  const resolved = await resolveDashboardScope(c, undefined);
  if (!resolved.ok) return resolved.res;
  const { scope } = resolved;

  const [activeCount, pendingCount, materialsResult, profilesCount] =
    await Promise.all([
      byReserve(supabase
        .from("lendings")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", scope.tenantId), scope)
        .eq("status_legacy", "ativo"),
      countProfiles(scope, (q) => q.eq("registration_status", "pending_biometric")),
      byReserve(supabase.from("material_availability").select("*").eq("tenant_id", scope.tenantId), scope),
      countProfiles(scope, (q) => q.eq("role", "usuario")),
    ]);

  logMetricFailures(c, {
    total_armados: activeCount, cadastros_pendentes: pendingCount,
    materiais: materialsResult, total_militares: profilesCount,
  });

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
  roleGuard("admin_global", "admin_reserva", "armeiro", "auditor", "usuario"),
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
