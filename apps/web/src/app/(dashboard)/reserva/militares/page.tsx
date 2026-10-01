import { getSessionUser } from "@/lib/session-profile";
import { BFF_URL, bffSessionHeaders, resolveWebSessionRole } from "@/lib/web-session";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { AdminUserToolbar } from "@/app/(dashboard)/admin/usuarios/_user-actions";
import { MilitaresTable, type MilitarRow } from "./_militares-table";

// superadmin EXCLUÍDO de propósito: é operador SaaS (Nexus-only, sem tenant) —
// H-RBAC canônico do projeto proíbe superadmin em páginas de reserva/estrutura
// de tenant (mesma regra do roleGuard de GET /api/profiles/militares).
const STAFF_ROLES = new Set(["armeiro", "admin_reserva", "admin_global"]);

type BffMilitar = Record<string, unknown> & { id: string };
type MilitaresPayload = { militares: BffMilitar[]; reserveId: string | null; reserveOptions: { id: string; nome: string }[] };

// R-34 / R-37 lote 5 (docs/auditoria/EVIDENCE_R37_BATCH5.md): antes lia
// `profiles`, `lendings`, `biometric_templates` e `reserves` direto do Supabase
// com o JWT do usuário — o RLS decide por profiles.role e ignora o Modo Usuário
// (D-02). Agora: autorização pelo papel EFETIVO da sessão do BFF e dados de
// GET /api/profiles/militares (papel, tenant e reserva da sessão, escopo no
// banco). Nada de Supabase direto nesta página. Cadastro, edição, convite e
// captura de digital (escrita) já passam pelos componentes/rotas de sempre e
// não mudaram.
export default async function ArmeiroMilitaresPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // null = sem sessão do BFF, sessão de outra identidade ou falha → nega.
  const role = await resolveWebSessionRole(user.id);
  if (!role || !STAFF_ROLES.has(role)) redirect("/");

  // Teto de privilégio pelo papel EFETIVO da sessão: admin_global cadastra
  // qualquer role permitido nesta página; admin_reserva cadastra usuario+armeiro;
  // armeiro cadastra só usuario.
  const toolbarRole = role === "admin_global" ? "admin_global" : role === "admin_reserva" ? "admin_reserva" : "armeiro";

  const payload = await fetchMilitares();

  if (!payload) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Não foi possível carregar os usuários</p>
          <p className="text-xs text-muted-foreground mt-1">Tente novamente em instantes.</p>
        </div>
      </div>
    );
  }

  const { militares: allMilitares, reserveId: activeReserveId, reserveOptions } = payload;
  const rows: MilitarRow[] = allMilitares.map((m) => ({
    id: m.id,
    nome_completo: (m.nome_completo as string | null) ?? "",
    matricula: (m.matricula as string | null) ?? "",
    posto: (m.posto as string | null) ?? null,
    foto_url: (m.foto_url as string | null) ?? null,
    email: (m.email as string | null) ?? null,
    nome_de_guerra: (m.nome_de_guerra as string | null) ?? null,
    unidade: (m.unidade as string | null) ?? null,
    telefone: (m.telefone as string | null) ?? null,
    registration_status: m.registration_status as MilitarRow["registration_status"],
    totp_configured: (m.totp_configured as boolean | null) ?? false,
    registeredFingers: Array.isArray(m.registered_fingers) ? (m.registered_fingers as number[]) : [],
    activeCount: typeof m.active_count === "number" ? m.active_count : 0,
    invite_sent_at: (m.invite_sent_at as string | null) ?? null,
    account_activated_at: (m.account_activated_at as string | null) ?? null,
    reserve_id: activeReserveId,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usuários</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {rows.length} usuário{rows.length !== 1 ? "s" : ""} cadastrado
            {rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <AdminUserToolbar callerRole={toolbarRole} activeReserveId={activeReserveId} reserveOptions={reserveOptions} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Nenhum usuário cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre usuários para gerenciar saídas de material
          </p>
        </div>
      ) : (
        <MilitaresTable
          militares={rows}
          currentUserId={user.id}
          callerRole={role === "admin_global" ? "admin" : "master"}
          editCallerRole={toolbarRole}
        />
      )}
    </div>
  );
}

// Toda negação/falha deixa rastro no log. 401 (sessão do BFF expirou entre as
// chamadas) → login; 403 (papel caiu) → home; demais falhas → null (a página
// mostra aviso de erro; nunca "nenhum usuário").
async function fetchMilitares(): Promise<MilitaresPayload | null> {
  let res: Response;
  try {
    res = await fetch(`${BFF_URL}/api/profiles/militares`, {
      headers: await bffSessionHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.warn("[reserva/militares] falha ao consultar /api/profiles/militares", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  const requestId = res.headers.get("x-request-id");
  if (res.status === 401) {
    console.warn("[reserva/militares] BFF recusou /api/profiles/militares", { status: 401, requestId });
    redirect("/login");
  }
  if (res.status === 403) {
    console.warn("[reserva/militares] BFF negou /api/profiles/militares", { status: 403, requestId });
    redirect("/");
  }
  if (!res.ok) {
    console.warn("[reserva/militares] BFF recusou /api/profiles/militares", { status: res.status, requestId });
    return null;
  }
  const body = (await res.json().catch(() => null)) as {
    militares?: unknown; reserve_id?: unknown; reserve_options?: unknown;
  } | null;
  if (!body || !Array.isArray(body.militares)) {
    console.warn("[reserva/militares] resposta inesperada de /api/profiles/militares", { requestId });
    return null;
  }
  const options = Array.isArray(body.reserve_options)
    ? (body.reserve_options as Array<{ id?: unknown; nome?: unknown }>)
        .filter((o) => typeof o?.id === "string" && typeof o?.nome === "string")
        .map((o) => ({ id: o.id as string, nome: o.nome as string }))
    : [];
  return {
    militares: (body.militares as unknown[]).filter((m): m is BffMilitar => !!m && typeof (m as { id?: unknown }).id === "string"),
    reserveId: typeof body.reserve_id === "string" ? body.reserve_id : null,
    reserveOptions: options,
  };
}
