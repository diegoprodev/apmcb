export const runtime = "edge";
// Resposta é por-usuário (cookies() via getCallerUser) — sem isso o Next pode
// cachear e servir a resposta de um usuário para outro.
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

async function getCallerUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { user, supabase };
}

export async function GET() {
  try {
    const { user, supabase } = await getCallerUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, read_at, created_at, metadata")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const unread_count = (data ?? []).filter((n) => !n.read_at).length;
    return NextResponse.json({ notifications: data ?? [], unread_count });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
