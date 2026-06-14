export const runtime = "edge";

/**
 * POST /api/admin/militares
 *
 * Cadastra um militar no sistema SEM criar credenciais de login.
 * Cria um auth.users interno (e-mail fake não-entregável) + profile.
 * O acesso ao sistema é provisionado separadamente via POST /api/admin/users.
 */

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  // process.env works in local dev; CF Pages edge bindings need getRequestContext
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    const key = cfEnv.SUPABASE_SERVICE_ROLE_KEY;
    if (key) return key;
  } catch {}
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY not configured. Add this secret in CF Pages Dashboard → Settings → Environment Variables."
  );
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
  return createSupabaseClient(getSupabaseUrl(), getServiceRoleKey(), {
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
      nome_completo: string;
      matricula: string;
      posto?: string | null;
      role?: string;
      unidade?: string | null;
      telefone?: string | null;
    };

    const { nome_completo, matricula, posto, unidade, telefone } = body;
    const userRole = body.role ?? "military";

    if (!nome_completo || !matricula) {
      return NextResponse.json(
        { error: "nome_completo e matricula são obrigatórios" },
        { status: 400 }
      );
    }

    const supabase = adminClient();

    // Cria uma conta auth interna com e-mail não-entregável.
    // O militar NÃO recebe e-mail e NÃO pode fazer login com essas credenciais.
    // O acesso real é provisionado depois via POST /api/admin/users.
    const internalEmail = `${matricula.toLowerCase().replace(/\W/g, "")}.interno@apmcb.sistema`;

    const { data, error: authError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { nome_completo, matricula, internal: true },
    });
    if (authError) throw authError;

    const userId = data.user.id;

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: userId,
      email: null,
      nome_completo,
      matricula,
      posto: posto ?? "cadete",
      role: userRole as "admin" | "master" | "military",
      registration_status: "pending_biometric",
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
