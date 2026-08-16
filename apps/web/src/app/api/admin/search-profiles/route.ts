export const runtime = "edge";
// Resposta depende do role do caller (cookies()) — sem isso o Next pode
// cachear e servir a resposta/autorização de um usuário para outro.
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { allowedRoles } from "@/lib/invite-ceiling";

async function getCallerRole(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
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
  const supabase = createServerClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  if (id) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at, role")
      .eq("id", id)
      .in("role", targetRoles)
      .maybeSingle();
    return NextResponse.json(data ? [data] : []);
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at, role")
    .or(`nome_completo.ilike.%${q}%,matricula.ilike.%${q}%`)
    .in("role", targetRoles)
    .limit(8);

  return NextResponse.json(data ?? []);
}
