
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { SaidasClient, type LendingRow } from "./_saidas-client";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

// Mesmos papéis do roleGuard de GET /api/lendings (BFF).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

type ActiveReserve = { id: string; nome: string; logo_url: string | null };

// R-34 / R-37 lote 3 (docs/auditoria/EVIDENCE_R37_BATCH3.md): antes lia
// `lendings` e `reserve_memberships` direto do Supabase com o JWT do usuário —
// o RLS decide por profiles.role e ignora o Modo Usuário (D-02). Agora:
// autorização pelo papel EFETIVO da sessão do BFF; saídas de GET /api/lendings
// e reserva ativa de GET /api/reserves/active, ambos com sessão, tenant e
// reserva aplicados no banco antes do limite (C_HYBRID). Nada de Supabase
// direto nesta página. As ações de escrita (devolução biométrica) já passam
// pelo BFF e não mudaram.
export default async function SaidasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; limit?: string }>;
}) {
  const { status, limit: limitParam } = await searchParams;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10") || 10, 10), 30);

  const user = await getSessionUser();
  if (!user) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/");

  // Só para nome do armeiro e canal de realtime (tenant do próprio perfil);
  // não autoriza nada.
  const profile = await getSessionProfile(user.id);

  const statusFilter = status === "ativo" || status === "devolvido" ? status : undefined;
  const [raw, reserve] = await Promise.all([fetchLendings(limit + 1, statusFilter), fetchActiveReserve()]);

  const hasMore = raw.length > limit;
  const pagedSaidas = hasMore ? raw.slice(0, limit) : raw;

  return (
    <>
    {profile?.default_tenant_id && <RealtimeArmeiroSync tenantId={profile.default_tenant_id} />}
    <SaidasClient
      saidas={pagedSaidas}
      currentStatus={status ?? ""}
      role={role}
      hasMore={hasMore}
      reserveName={reserve?.nome}
      reserveId={reserve?.id}
      armeiroName={profile?.nome_completo ?? undefined}
      tenantLogoUrl={reserve?.logo_url ?? undefined}
    />
    </>
  );
}

// Toda negação/falha deixa rastro no log. 401 (sessão do BFF expirou entre as
// chamadas) → login; 403 (papel caiu) → home; demais falhas → lista vazia,
// como a leitura antiga, mas agora com log.
async function fetchLendings(limit: number, status: "ativo" | "devolvido" | undefined): Promise<LendingRow[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (status) qs.set("status", status);
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}/api/lendings?${qs}`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("[reserva/saidas] falha ao consultar /api/lendings", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  const requestId = res.headers.get("x-request-id");
  if (res.status === 401) {
    console.warn("[reserva/saidas] BFF recusou /api/lendings", { status: 401, requestId });
    redirect("/login");
  }
  if (res.status === 403) {
    console.warn("[reserva/saidas] BFF negou /api/lendings", { status: 403, requestId });
    redirect("/");
  }
  if (!res.ok) {
    console.warn("[reserva/saidas] BFF recusou /api/lendings", { status: res.status, requestId });
    return [];
  }
  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    console.warn("[reserva/saidas] resposta inesperada de /api/lendings", { requestId });
    return [];
  }
  return (body as Array<Record<string, unknown>>).filter((r) => r && typeof r.id === "string").map(toLendingRow);
}

// Reserva ativa (nome/logo) só existe com membership nela; qualquer falha deixa
// a reserva indefinida (captura biométrica da devolução desabilitada, como
// antes quando não havia membership) e registra o motivo.
async function fetchActiveReserve(): Promise<ActiveReserve | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/reserves/active`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn("[reserva/saidas] BFF recusou /api/reserves/active", { status: res.status, requestId: res.headers.get("x-request-id") });
      return null;
    }
    const body = (await res.json().catch(() => null)) as { reserve?: ActiveReserve | null } | null;
    const r = body?.reserve;
    return r && typeof r.id === "string" ? { id: r.id, nome: r.nome, logo_url: r.logo_url ?? null } : null;
  } catch (err) {
    console.warn("[reserva/saidas] falha ao consultar /api/reserves/active", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Só os campos que o cliente usa (o BFF devolve `select *` e embeds maiores).
function toLendingRow(r: Record<string, unknown>): LendingRow {
  const mt = r.material_type as Record<string, unknown> | null | undefined;
  const m = r.military as Record<string, unknown> | null | undefined;
  const a = r.master as Record<string, unknown> | null | undefined;
  return {
    id: r.id as string,
    quantidade: r.quantidade as number,
    status_legacy: r.status_legacy as string,
    issued_at: r.issued_at as string,
    returned_at: (r.returned_at as string | null) ?? null,
    local: (r.local as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    auth_mode: (r.auth_mode as string | null) ?? null,
    movement_id: (r.movement_id as string | null) ?? null,
    material_type: mt ? { nome: mt.nome as string, categoria: mt.categoria as string } : null,
    military: m
      ? {
          id: m.id as string, nome_completo: m.nome_completo as string, matricula: m.matricula as string,
          posto: (m.posto as string | null) ?? null, foto_url: (m.foto_url as string | null) ?? null,
        }
      : null,
    master: a ? { nome_completo: a.nome_completo as string, matricula: a.matricula as string } : null,
  };
}
