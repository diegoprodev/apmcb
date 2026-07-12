export const runtime = "edge";
// Resposta depende do role do caller (cookies()) — sem isso o Next pode
// cachear e servir a resposta/autorização de um usuário para outro.
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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

// Roles pesquisáveis por este endpoint — whitelist explícita para não virar
// um lookup genérico de qualquer role (ex: superadmin) a partir do param.
const SEARCHABLE_ROLES = new Set(["usuario", "armeiro"]);

// GET /api/admin/search-profiles?q=<query>
// Returns profiles matching name or matricula for operational RBAC to look up existing militaries
// GET /api/admin/search-profiles?id=<uuid>
// Exact lookup by id — usado para hidratar um filtro selecionado (ex: AsyncComboBox)
// após reload da página, quando só o id está disponível (na URL) e não o nome.
// GET /api/admin/search-profiles?role=armeiro&q=<query>
// Busca por armeiro em vez de usuario (ex: filtro "Armeiro" no Histórico do
// Livro Digital) — default continua "usuario" para não quebrar os callers
// existentes (relatórios, cautelas, saídas).
export async function GET(req: NextRequest) {
  const role = await getCallerRole();
  if (!role || !["admin_global", "admin_reserva", "armeiro", "auditor"].includes(role)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requestedRole = req.nextUrl.searchParams.get("role")?.trim() ?? "";
  // armeiro não pode buscar outros armeiros (só admin_reserva/admin_global/
  // auditor, que já são os únicos papéis que enxergam esse filtro na UI do
  // Histórico do Livro Digital) — evita que um armeiro comum liste colegas
  // via chamada direta à API.
  const canSearchArmeiro = role !== "armeiro";
  const targetRole = SEARCHABLE_ROLES.has(requestedRole) && (requestedRole !== "armeiro" || canSearchArmeiro)
    ? requestedRole
    : "usuario";

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
      .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at")
      .eq("id", id)
      .eq("role", targetRole)
      .maybeSingle();
    return NextResponse.json(data ? [data] : []);
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto, unidade, email, invite_sent_at, account_activated_at")
    .or(`nome_completo.ilike.%${q}%,matricula.ilike.%${q}%`)
    .eq("role", targetRole)
    .limit(8);

  return NextResponse.json(data ?? []);
}
