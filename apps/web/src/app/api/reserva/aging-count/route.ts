export const runtime = "edge";
// Resposta é por-usuário/tenant (cookies() via getCallerUser) — sem isso o
// Next pode cachear e servir a contagem de um tenant para outro.
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/runtime-env";
import { agingAlertCutoffISO, RESERVE_STAFF_ROLES } from "@/lib/aging";

// Contagem de saídas (lendings) em aberto há 24h+ — mesmo corte cumulativo de
// lib/aging.ts, para o indicador da navbar (achado 2026-09-22: alerta é
// exclusivo de saídas, nunca de cautela — "não misture as bolas"). Só
// armeiro/admin_reserva/admin_global operam saídas; demais papéis (militar,
// superadmin sem tenant) recebem count:0 sem consultar o banco.
export async function GET() {
  try {
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
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !RESERVE_STAFF_ROLES.includes(profile.role)) {
      return NextResponse.json({ count: 0 });
    }

    const { count, error } = await supabase
      .from("lendings")
      .select("id", { count: "exact", head: true })
      .eq("status_legacy", "ativo")
      .lte("issued_at", agingAlertCutoffISO());

    if (error) throw error;

    return NextResponse.json({ count: count ?? 0 });
  } catch (err: unknown) {
    // Achado BAIXO de review (2026-09-29): sem log aqui, uma falha de query
    // não deixa rastro nenhum — o cliente só vê 500, ninguém no BFF/Nexus
    // sabe que aconteceu.
    console.error("[aging-count] falha ao consultar contagem", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
