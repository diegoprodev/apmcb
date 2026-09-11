export const runtime = "edge";
// Resposta depende do role do caller (cookies()) — sem isso o Next pode
// cachear e servir a resposta/autorização de um usuário para outro.
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { allowedRoles } from "@/lib/invite-ceiling";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/runtime-env";
import { sanitizeSearchTerm } from "@/lib/search-term";

// Mesma constante de apps/bff/src/lib/reserve-staff.ts — duplicada aqui
// porque a rota é edge e não importa do pacote apps/bff.
const STAFF_RESERVE_ROLES = ["armeiro", "admin_reserva", "auditor_reserva"];

async function getCallerRole(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role ?? null;
}

// GET /api/admin/search-profiles?q=<query>
// Returns profiles matching name or matricula for operational RBAC to look up existing militaries
// GET /api/admin/search-profiles?id=<uuid>
// Exact lookup by id — usado para hidratar um filtro selecionado (ex: AsyncComboBox)
// após reload da página, quando só o id está disponível (na URL) e não o nome.
// GET /api/admin/search-profiles?role=armeiro&q=<query>
// Busca por um papel específico (ex: filtro "Armeiro" no Histórico do Livro
// Digital) — default continua "usuario" para não quebrar os callers
// existentes (relatórios, cautelas, saídas).
// GET /api/admin/search-profiles?role=any&q=<query>
// Busca em TODOS os papéis dentro do teto de privilégio do caller — usado
// pelo fluxo "Militar já cadastrado" de _cadastrar-militar-dialog.tsx.
// Achado real de produção (2026-08-15): antes só existia o default fixo
// "usuario", então um admin_global tentando reenviar convite pra um
// admin_reserva/admin_global/auditor JÁ CADASTRADO nunca encontrava a
// própria conta na busca — nenhum papel além de usuario/armeiro era
// pesquisável, mesmo pra quem tinha teto pra gerenciá-los.
//
// Teto de privilégio via allowedRoles() (SSOT, mesma usada em canInvite) —
// não mais uma whitelist fixa de 2 papéis: cada caller só pesquisa papéis
// que ele próprio teria autoridade de convidar/gerenciar (ver
// invite-ceiling.ts). Isso já reproduz a restrição antiga "armeiro não pode
// buscar outro armeiro" automaticamente (teto de armeiro é só ["usuario"]),
// sem precisar de um caso especial dedicado.
export async function GET(req: NextRequest) {
  const role = await getCallerRole();
  if (!role || !["admin_global", "admin_reserva", "armeiro", "auditor"].includes(role)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requestedRole = req.nextUrl.searchParams.get("role")?.trim() ?? "";
  // SP2 (Task 6, F6): exclui quem já é STAFF (armeiro/admin_reserva/
  // auditor_reserva) DA RESERVA-ALVO. Elegibilidade por membership da reserva,
  // não pelo profiles.role global — um admin_reserva da reserva A não deve
  // sumir da busca quando o alvo é promovê-lo admin_reserva da reserva B.
  const excludeReserveStaff = req.nextUrl.searchParams.get("exclude_reserve_staff")?.trim() ?? "";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const excludeReserveId = UUID_RE.test(excludeReserveStaff) ? excludeReserveStaff : null;
  const ceiling = allowedRoles(role);
  const targetRoles =
    requestedRole === "any"
      ? (ceiling.length > 0 ? ceiling : ["usuario"])
      : ceiling.includes(requestedRole)
        ? [requestedRole]
        : ["usuario"];

  if (!id && q.length < 2) {
    return NextResponse.json([]);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    },
  });

  if (id) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at, role")
      .eq("id", id)
      .in("role", targetRoles)
      .maybeSingle();
    return NextResponse.json(data ? [data] : []);
  }

  // Busca por nome, matrícula OU e-mail. `q` é sanitizado (sanitizeSearchTerm)
  // antes de entrar no `.or()` — um `,`/`)` no termo injetaria condições no
  // parser do PostgREST. `profiles.email` tem índice (profiles_email_idx);
  // no volume atual a busca é seq scan sub-ms.
  const term = sanitizeSearchTerm(q);
  if (term.length < 2) {
    return NextResponse.json([]);
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at, role")
    .or(`nome_completo.ilike.%${term}%,matricula.ilike.%${term}%,email.ilike.%${term}%`)
    .in("role", targetRoles)
    .limit(8);

  if (error) {
    console.error("[GET /api/admin/search-profiles] busca falhou", { error: error.message });
    return NextResponse.json({ error: "Erro ao buscar" }, { status: 500 });
  }

  const hits = data ?? [];
  if (excludeReserveId && hits.length > 0) {
    const { data: staffRows } = await supabase
      .from("reserve_memberships")
      .select("user_id")
      .eq("reserve_id", excludeReserveId)
      .in("role", STAFF_RESERVE_ROLES)
      .in("user_id", hits.map((h) => h.id));
    const staffIds = new Set((staffRows ?? []).map((r) => r.user_id as string));
    return NextResponse.json(hits.filter((h) => !staffIds.has(h.id)));
  }

  return NextResponse.json(hits);
}
