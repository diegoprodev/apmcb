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
