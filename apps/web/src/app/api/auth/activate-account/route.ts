export const runtime = "edge";
// Defesa em profundidade: POST não é cacheado por semântica HTTP padrão, mas a
// detecção automática de "usa cookies() logo é dinâmico" já se provou não
// confiável neste adaptador (ver commit e059f7f).
export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isPasswordStrongEnough } from "@/lib/password-policy";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/runtime-env";

function getServiceRoleKey(): string {
  try {
    const cfEnv = getRequestContext().env as Record<string, string | undefined>;
    if (cfEnv.SUPABASE_SERVICE_ROLE_KEY) return cfEnv.SUPABASE_SERVICE_ROLE_KEY;
  } catch { /* not in CF Workers context */ }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key) return key;
  throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
}

function adminClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// POST /api/auth/activate-account { password }
// Chamado por /auth/confirmar-conta no primeiro login após um convite.
//
// Roda inteiramente no servidor porque o cliente Supabase do browser não é
// confiável aqui: os cookies sb-* são forçados a HttpOnly (ver lib/supabase/server.ts),
// então um client component não tem sessão legível para autenticar uma chamada
// direta a auth.updateUser(). Esta rota lê a sessão (HttpOnly) via cookies do
// next/headers — que código de servidor sempre consegue ler — e usa o service
// role para definir a senha e marcar account_activated_at, contornando a RLS.
export async function POST(request: Request) {
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
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { password?: string };
    const password = body.password;
    if (!password || !isPasswordStrongEnough(password)) {
      return NextResponse.json({ error: "Senha muito fraca — use ao menos 8 caracteres com maiúscula, número ou símbolo" }, { status: 400 });
    }

    const { error: pwdError } = await adminClient().auth.admin.updateUserById(user.id, { password });
    if (pwdError) {
      console.error("[POST /api/auth/activate-account] falha ao definir senha", pwdError);
      return NextResponse.json({ error: "Não foi possível definir sua senha" }, { status: 500 });
    }

    await adminClient()
      .from("profiles")
      .update({ account_activated_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("account_activated_at", null);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[POST /api/auth/activate-account]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
