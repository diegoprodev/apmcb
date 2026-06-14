export const runtime = "edge";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    const fromCf = cfEnv.SUPABASE_SERVICE_ROLE_KEY;
    if (fromCf) return fromCf;
  } catch {}
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
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
    if (role !== "admin" && role !== "master") {
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

    // Master só pode provisionar militares (não admin nem master)
    if (role === "master" && userRole !== "military") {
      return NextResponse.json({ error: "Armeiro só pode criar login para militares" }, { status: 403 });
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

    const notifTitle = "Acesso ao sistema criado";
    const notifBody = method === "magic_link"
      ? "Seu acesso ao APMCB foi provisionado. Verifique seu e-mail para ativar a conta."
      : "Seu acesso ao APMCB foi criado com senha temporária. Faça login para continuar.";

    // Notifica o novo usuário que seu acesso foi criado
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "account_created",
      title: notifTitle,
      body: notifBody,
      metadata: { method, created_by_role: role },
    }).maybeSingle();

    // Trigger PWA push via BFF (fire-and-forget — non-fatal)
    const bffUrl = process.env.BFF_URL ?? process.env.NEXT_PUBLIC_BFF_URL ?? "";
    const internalSecret = process.env.INTERNAL_API_SECRET ?? "";
    if (bffUrl && internalSecret) {
      fetch(`${bffUrl}/api/push/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ user_id: userId, title: notifTitle, body: notifBody, url: "/cadete" }),
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, user_id: userId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
