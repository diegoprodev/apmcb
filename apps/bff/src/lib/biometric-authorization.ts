import { supabase } from "../services/supabase";
import { STAFF_RESERVE_ROLES } from "./reserve-staff";
import type { Role } from "../types/hono";

// Importa o singleton `supabase` diretamente (mesmo padrão já usado em
// biometric.ts/biometric-simulator.ts/biometric-proof-service.ts neste
// projeto — não injeta o client como parâmetro). Os testes de integração
// desta spec rodam contra as ROTAS reais (via fetch ao BFF, mesmo padrão já
// usado em biometric-bridge-phase1b.spec.ts), não contra estas funções
// isoladas — testar via HTTP real cobre autorização + wiring de uma vez.

async function reserveBelongsToTenant(reserveId: string, tenantId: string) {
  const { data } = await supabase
    .from("reserves")
    .select("id")
    .eq("id", reserveId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

// Achado real (não estava no plano unify original — biometric.ts tinha este
// filtro por causa do SP2, biometric-simulator.ts nunca teve): filtrar por
// STAFF_RESERVE_ROLES é obrigatório aqui. Sem isso, uma membership 'usuario'
// do ator NESSA reserva (ele foi militar lá antes de virar armeiro/
// admin_reserva noutra) autoriza operação de staff nela — o `role` da
// sessão já garante que o ator É armeiro/admin_reserva EM ALGUM LUGAR, mas
// não garante que é staff especificamente NESSA reserva sendo consultada.
async function hasReserveMembership(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", userId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .in("role", STAFF_RESERVE_ROLES)
    .maybeSingle();
  return !!data;
}

// Usada só por GET /devices — mais fraca que actorCanAccessChallenge de
// propósito: essa rota não carrega um document_id específico (é consultada
// ANTES de qualquer challenge existir), então a prova de legitimidade
// possível aqui é "este militar tem alguma cautela ativa nesta reserva",
// não "esta cautela específica é dele". Não expõe nada sensível de
// terceiros — a resposta é status/modelo/nome de um leitor físico, não
// dado de pessoa nenhuma.
async function usuarioHasActiveCautelaInReserve(userId: string, reserveId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("cautelamentos")
    .select("id")
    .eq("militar_id", userId)
    .eq("reserve_id", reserveId)
    .eq("tenant_id", tenantId)
    .eq("status", "ativa")
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function actorCanAccessChallenge(params: {
  userId: string;
  role: Role;
  tenantId: string;
  reserveId: string;
  purpose: string;
  expectedUserId: string | null;
  documentId: string | null;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId, purpose, expectedUserId, documentId } = params;

  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") {
    // Autoatendimento — só pode tocar no PRÓPRIO purpose de assinatura de
    // cautela, só mirando a si mesmo, só numa cautela que é sua de verdade
    // (a checagem de posse da cautela substitui a checagem de reserve
    // membership, que um usuario nunca tem).
    if (purpose !== "sign_cautela_militar") return false;
    if (expectedUserId !== userId) return false;
    if (!documentId) return false;

    const { data } = await supabase
      .from("cautelamentos")
      .select("id")
      .eq("id", documentId)
      .eq("militar_id", userId)
      .eq("reserve_id", reserveId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return !!data;
  }
  return false;
}

export async function actorCanAccessReserveDevices(params: {
  userId: string; role: Role; tenantId: string; reserveId: string;
}): Promise<boolean> {
  const { userId, role, tenantId, reserveId } = params;
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  if (role === "usuario") return usuarioHasActiveCautelaInReserve(userId, reserveId, tenantId);
  return false;
}

// Assinatura e comportamento IDÊNTICOS à função hoje duplicada em
// biometric.ts/biometric-simulator.ts — só centralizada aqui. NÃO é
// substituída pelas duas funções acima: elas cobrem só os 4 call sites que
// precisam abrir exceção pra `usuario` (POST /challenges, GET
// /challenges/:id/result, GET /devices, POST /simulator/challenges/:id/
// complete) — os outros 11 call sites reais (9 em biometric.ts, 2 em
// biometric-simulator.ts) continuam usando exatamente este comportamento,
// só importado do módulo novo em vez de definido localmente em cada
// arquivo.
export async function actorCanAccessReserve(
  userId: string, role: Role, tenantId: string, reserveId: string,
): Promise<boolean> {
  if (role === "admin_global") return reserveBelongsToTenant(reserveId, tenantId);
  if (role === "admin_reserva" || role === "armeiro") return hasReserveMembership(userId, reserveId, tenantId);
  return false;
}

export { reserveBelongsToTenant };
