export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

async function getCallerRole(): Promise<string | null> {
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
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role ?? null;
}

function adminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  return createSupabaseClient(getSupabaseUrl(), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const role = await getCallerRole();
    if (role !== "admin") {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    const body = await req.json() as {
      email: string;
      nome_completo: string;
      matricula: string;
      posto?: string | null;
      role?: string;
      unidade?: string | null;
      telefone?: string | null;
      method: "magic_link" | "password";
      password?: string;
    };

    const { email, nome_completo, matricula, posto, unidade, telefone, method, password } = body;
    const userRole = body.role ?? "military";

    if (!email || !nome_completo || !matricula) {
      return NextResponse.json({ error: "email, nome_completo e matricula são obrigatórios" }, { status: 400 });
    }

    const supabase = adminClient();
    let userId: string;

    if (method === "magic_link") {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { nome_completo, matricula },
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://apmcb.pmpb.online"}/login`,
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      if (!password || password.length < 6) {
        return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome_completo, matricula },
      });
      if (error) throw error;
      userId = data.user.id;
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email,
      nome_completo,
      matricula,
      posto: posto ?? "cadete",
      role: userRole as "admin" | "master" | "military",
      registration_status: "complete",
      unidade: unidade ?? null,
      telefone: telefone ?? null,
    });
    if (profileError) throw profileError;

    return NextResponse.json({ success: true, user_id: userId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
