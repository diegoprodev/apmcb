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

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

// SP2 (Task 6 + achado ALTO A3 do review): busca os user_ids STAFF da
// reserva-alvo via BFF (service_role), não pela sessão do caller. A policy
// reserve_memberships_select (`user_id = auth.uid() OR reserve_id IN
// auth_admin_reserve_ids()`) não cobre admin_global — a query direta via
// createServerClient (RLS-bound) devolvia SEMPRE vazio pra ele, virando um
// no-op silencioso justamente pro papel que mais usa a tela de estrutura.
async function fetchReserveStaffIds(reserveId: string, cookieHeader: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${BFF_URL}/api/reserves/${reserveId}/staff-ids`, {
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) {
      console.error("[GET /api/admin/search-profiles] staff-ids falhou", { reserveId, status: res.status });
      return new Set();
    }
    const body = (await res.json()) as { user_ids?: string[] };
    return new Set(body.user_ids ?? []);
  } catch (err) {
    console.error("[GET /api/admin/search-profiles] staff-ids erro de rede", { reserveId, err: String(err) });
    return new Set();
  }
}

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
  // Achado MÉDIO do review (M6): quando há exclusão por reserva, filtrar
  // DEPOIS de um .limit(8) pode devolver lista vazia mesmo havendo elegíveis
  // — se os 8 primeiros matches forem todos staff da reserva. Busca com folga
  // (24) só nesse caso, filtra, então corta pra 8.
  const fetchLimit = excludeReserveId ? 24 : 8;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at, role")
    .or(`nome_completo.ilike.%${term}%,matricula.ilike.%${term}%,email.ilike.%${term}%`)
    .in("role", targetRoles)
    .limit(fetchLimit);

  if (error) {
    console.error("[GET /api/admin/search-profiles] busca falhou", { error: error.message });
    return NextResponse.json({ error: "Erro ao buscar" }, { status: 500 });
  }

  const hits = data ?? [];
  if (excludeReserveId && hits.length > 0) {
    const staffIds = await fetchReserveStaffIds(excludeReserveId, req.headers.get("cookie") ?? "");
    return NextResponse.json(hits.filter((h) => !staffIds.has(h.id)).slice(0, 8));
  }

  return NextResponse.json(hits);
}
