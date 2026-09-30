export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { PassagensClient } from "./_client";

// Papéis que a página atende (os mesmos de antes, sem superadmin: o BFF nunca
// lhe deu passagens de tenant).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

// R-34 / R-37 lote 4 (docs/auditoria/EVIDENCE_R37_BATCH4.md): antes autorizava
// por `profiles.role` e escolhia a reserva por `reserve_memberships[0]`, lidos
// direto do Supabase — o Modo Usuário (D-02) era ignorado e o casco de staff ia
// para o navegador. Agora a autorização é o papel EFETIVO da sessão do BFF e a
// reserva vem de GET /api/reserves/active. A listagem e a criação continuam
// sendo feitas pelo cliente no BFF (GET/POST /api/handovers), que já confina
// por sessão/tenant/reserva; o write path não foi alterado. O Supabase só é
// usado aqui para Auth (sessão e JWT que o cliente já enviava como Bearer).
export default async function PassagensPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(session.user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/reserva");

  const reserve = await fetchActiveReserve();

  return (
    <PassagensClient
      token={session.access_token}
      role={role}
      reserveId={reserve?.id ?? null}
    />
  );
}

// Reserva ativa da SESSÃO (com membership no par usuário+reserva e tenant).
// Qualquer falha deixa a reserva indefinida (criar passagem desabilitado; a
// listagem continua confinada pelo BFF) e registra o motivo.
async function fetchActiveReserve(): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/reserves/active`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn("[reserva/passagens] BFF recusou /api/reserves/active", { status: res.status, requestId: res.headers.get("x-request-id") });
      return null;
    }
    const body = (await res.json().catch(() => null)) as { reserve?: { id?: unknown } | null } | null;
    const id = body?.reserve?.id;
    return typeof id === "string" ? { id } : null;
  } catch (err) {
    console.warn("[reserva/passagens] falha ao consultar /api/reserves/active", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
