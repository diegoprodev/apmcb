
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { SolicitacoesClient } from "./_solicitacoes-client";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

// Papéis de staff que operam solicitações (mesmos do roleGuard das ações
// approve/reject/deliver de /api/ssa/requests no BFF).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

type RequestRow = Record<string, unknown> & { id: string };

// R-34 / R-37 lote 2 (docs/auditoria/EVIDENCE_R37_BATCH2.md): antes lia
// `material_requests` direto do Supabase com o JWT do usuário — o RLS decide
// por profiles.role e ignora o Modo Usuário (D-02). Agora: autorização pelo
// papel EFETIVO da sessão do BFF e dados de GET /api/ssa/requests, que aplica
// sessão, tenant e reserva no banco antes do limite (C_HYBRID). Nada de
// Supabase direto nesta página.
export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  // O BFF devolve no máximo 50 para staff: limite até 49 mantém o hasMore exato.
  const limit = Math.min(Math.max(parseInt(params?.limit ?? "20") || 20, 10), 49);
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/");

  // Só para o canal de realtime (tenant do próprio perfil), não autoriza nada.
  const profile = await getSessionProfile(user.id);

  const { rows: all, failed: requestsError } = await fetchRequests();
  const hasMore = all.length > limit;
  let requests = hasMore ? all.slice(0, limit) : all;

  // Deep-link do sino de notificações (?highlight=<id>): a solicitação alvo
  // pode estar fora da primeira página. Procura no que o BFF devolveu (já
  // escopado por sessão, tenant e reserva) — nunca numa leitura direta.
  const highlightId = /^[0-9a-f-]{36}$/i.test(params?.highlight ?? "") ? params.highlight : undefined;
  if (highlightId && !requests.some((r) => r.id === highlightId)) {
    const highlighted = all.find((r) => r.id === highlightId);
    if (highlighted) {
      requests = [highlighted, ...requests];
    } else if (!requestsError) {
      // Fora das (até 50) solicitações mais recentes do escopo do BFF: a busca
      // pontual por id era leitura direta e foi removida (limitação do lote 2).
      console.warn("[reserva/solicitacoes] highlight fora do escopo ou da janela do BFF", { highlightId });
    }
  }

  return (
    <div className="space-y-6">
      {profile?.default_tenant_id && <RealtimeArmeiroSync tenantId={profile.default_tenant_id} />}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pendências Remotas</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Solicitações de armamento — aprove, rejeite ou confirme a entrega
        </p>
      </div>
      {requestsError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar as solicitações agora (falha de conexão com o banco). Atualize a página em alguns instantes — se persistir, avise o suporte.
        </div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SolicitacoesClient initialRequests={requests as any} hasMore={hasMore} currentLimit={limit} />
    </div>
  );
}

// Toda negação/falha deixa rastro no log e aparece como aviso de erro na
// tela (nunca como "nenhuma solicitação"). 401 (sessão do BFF expirou entre
// as duas chamadas) → login.
async function fetchRequests(): Promise<{ rows: RequestRow[]; failed: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}/api/ssa/requests`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("[reserva/solicitacoes] falha ao consultar /api/ssa/requests", { error: err instanceof Error ? err.message : String(err) });
    return { rows: [], failed: true };
  }
  const requestId = res.headers.get("x-request-id");
  if (res.status === 401) {
    console.warn("[reserva/solicitacoes] BFF recusou /api/ssa/requests", { status: 401, requestId });
    redirect("/login");
  }
  if (res.status === 403) {
    // O papel caiu entre /api/session/info e a listagem: negação, não falha de banco.
    console.warn("[reserva/solicitacoes] BFF negou /api/ssa/requests", { status: 403, requestId });
    redirect("/");
  }
  if (!res.ok) {
    console.warn("[reserva/solicitacoes] BFF recusou /api/ssa/requests", { status: res.status, requestId });
    return { rows: [], failed: true };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    console.warn("[reserva/solicitacoes] resposta inesperada de /api/ssa/requests", { requestId });
    return { rows: [], failed: true };
  }
  return {
    rows: (body as RequestRow[]).filter((r) => r && typeof r.id === "string").map(toClientRow),
    failed: false,
  };
}

// Mesmo conjunto de campos que a página já entregava ao cliente (o BFF
// devolve mais — ex.: foto_url do militar, timestamps de auditoria).
function toClientRow(r: RequestRow): RequestRow {
  const military = r.military as Record<string, unknown> | null | undefined;
  const reserva = r.reserva as Record<string, unknown> | null | undefined;
  const items = (r.items as Array<Record<string, unknown>> | null | undefined) ?? [];
  return {
    id: r.id,
    status: r.status, notes: r.notes, denial_reason: r.denial_reason, armeiro_nota: r.armeiro_nota,
    remote_reason: r.remote_reason, is_external_request: r.is_external_request,
    reserve_id: r.reserve_id, tenant_id: r.tenant_id,
    cancellation_reason: r.cancellation_reason, totp_validated: r.totp_validated,
    requested_at: r.requested_at, approved_at: r.approved_at, rejected_at: r.rejected_at,
    delivered_at: r.delivered_at, cancelled_at: r.cancelled_at, expires_at: r.expires_at,
    military: military
      ? { id: military.id, nome_completo: military.nome_completo, posto: military.posto, matricula: military.matricula }
      : null,
    reserva: reserva ? { id: reserva.id, nome_completo: reserva.nome_completo } : null,
    items: items.map((i) => ({
      id: i.id, material_type_id: i.material_type_id,
      material_nome_snapshot: i.material_nome_snapshot, material_categoria_snapshot: i.material_categoria_snapshot,
      requested_quantity: i.requested_quantity, delivered_quantity: i.delivered_quantity,
    })),
  };
}
