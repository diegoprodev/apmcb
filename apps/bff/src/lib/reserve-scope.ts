import { supabase } from "../services/supabase";
import { logger } from "./logger";
import { MATRIX_ROLES } from "./reserve-staff";
import type { Role } from "../types/hono";

// Achado real (SP9.5, 2026-09-18, canário pós-GO-LIVE via Playwright contra
// prod): várias rotas de LISTAGEM do BFF (cautelamentos, material_requests,
// lendings, service_handovers, service_shifts, document_signatures) filtravam
// só por `tenant_id` — o BFF usa a service role key (services/supabase.ts), que
// BYPASSA TODA A RLS do Postgres construída no épico de isolamento por
// reserva (SP1-SP10). A RLS só protege chamadas diretas via PostgREST com o
// JWT do usuário; o caminho real que a UI usa (BFF) precisa replicar o mesmo
// confinamento manualmente. Sem isso, qualquer armeiro/admin_reserva via de
// uma reserva via TODOS os dados do tenant inteiro, de qualquer reserva —
// confirmado ao vivo: armeiro ativo em APMCB via uma cautela de CFAP na
// tela real. Este módulo centraliza o padrão canônico (§4.2 do spec-mãe)
// pra nunca mais duplicar/esquecer a lógica em rota nova.
//
// Regra: matriz (admin_global/auditor SEM active_reserve_id) vê o tenant
// inteiro; qualquer outro papel (incluindo admin_global/auditor EM modo
// filial) fica confinado à reserva ativa da sessão.

function isMatrizRole(role: Role | null | undefined): boolean {
  // MATRIX_ROLES inclui "superadmin" (Nexus-only, nunca chega nestas rotas
  // de dado operacional de tenant — H-RBAC canônico do projeto). admin_global
  // e auditor são os únicos papéis operacionais que podem estar em matriz.
  return role != null && MATRIX_ROLES.has(role);
}

/**
 * Resolve o(s) reserve_id(s) que o ator autenticado pode enxergar, pra
 * aplicar `.in("reserve_id", ids)` (ou `.eq(...)` quando só 1) numa query
 * de listagem. Nunca lê reserve_id do payload/query do CLIENTE — sempre da
 * sessão (`c.get("reserveId")`, já resolvido em profiles.active_reserve_id).
 *
 * Retorna [] quando o ator não tem nenhuma reserva visível (matriz sem
 * reservas no tenant, ou filial sem active_reserve_id) — callers devem
 * tratar lista vazia como "nenhum resultado", nunca como "sem filtro".
 */
export async function scopedReserveIds(
  role: Role | null | undefined,
  reserveId: string | null,
  tenantId: string | null,
): Promise<string[]> {
  if (isMatrizRole(role) && !reserveId) {
    if (!tenantId) return [];
    const { data, error } = await supabase.from("reserves").select("id").eq("tenant_id", tenantId);
    if (error) {
      logger.error("reserve_scope.scoped_reserve_ids.query_failure", { tenantId, error: error.message });
      return [];
    }
    return (data ?? []).map((r) => r.id as string);
  }
  return reserveId ? [reserveId] : [];
}

/** true quando o ator está em modo matriz (vê o tenant inteiro sem reserva ativa). */
export function isMatriz(role: Role | null | undefined, reserveId: string | null): boolean {
  return isMatrizRole(role) && !reserveId;
}

/**
 * Checagem de acesso por-ID (não listagem): dado um recurso já carregado
 * (tenant_id já validado pelo caller) com seu `resourceReserveId`, decide se
 * o ator da sessão pode acessá-lo. Matriz (admin_global/auditor sem reserva
 * ativa) sempre pode, dado que o tenant já bate; qualquer outro papel
 * (incluindo admin_global/auditor EM modo filial) só se a reserva ativa da
 * sessão for a mesma do recurso — nunca a reserva que o CLIENTE alega.
 */
export function canAccessResourceReserve(
  role: Role | null | undefined,
  activeReserveId: string | null,
  resourceReserveId: string | null,
): boolean {
  if (isMatriz(role, activeReserveId)) return true;
  return activeReserveId != null && activeReserveId === resourceReserveId;
}

/**
 * Checagem por-ALVO (pessoa) para ações de staff sobre o cadastro de alguém
 * (edição, situação, código dinâmico): o alvo precisa ter vínculo com a
 * reserva ativa do ator. Matriz (admin_global/auditor sem reserva ativa)
 * alcança o tenant inteiro — o tenant do alvo já tem de ter sido validado.
 *
 * Três estados, para o caller não confundir queda do banco com "não
 * encontrado" (o operador veria um 404 falso durante uma instabilidade).
 *
 * Ignora a flag reserve_isolation_enabled de propósito, como scopedReserveIds:
 * o BFF usa service role e confina sempre (SP9.5). Num tenant com a flag
 * desligada, a RLS de profiles mostra outras reservas na lista, mas a escrita
 * continua confinada — divergência aceita e documentada.
 *
 * Achado real (2026-09-30): PATCH /profiles/:id/status e PATCH /profiles/:id
 * conferiam só o tenant — um armeiro da reserva B derrubava o impedimento de
 * um militar da reserva A; um admin_reserva de B rebaixava armeiro de A.
 */
export async function targetReserveAccess(params: {
  role: Role | null | undefined;
  activeReserveId: string | null;
  tenantId: string;
  targetId: string;
  /** Logger da requisição (com requestId). Sem ele, cai no logger base. */
  log?: { error: (obj: Record<string, unknown>, msg: string) => void };
}): Promise<"allowed" | "denied" | "error"> {
  const { role, activeReserveId, tenantId, targetId, log } = params;
  if (isMatriz(role, activeReserveId)) return "allowed";
  if (!activeReserveId) return "denied";
  const { data, error } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", targetId)
    .eq("reserve_id", activeReserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    // Único registro da falha (o caller só responde 503) — com requestId
    // quando o logger da requisição é passado.
    if (log) log.error({ error: error.message, targetId, activeReserveId }, "reserve_scope.target_query_failure");
    else logger.error("reserve_scope.target_query_failure", { error: error.message, targetId, activeReserveId });
    return "error";
  }
  return data ? "allowed" : "denied";
}
