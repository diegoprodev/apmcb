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

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

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

// POST /api/auth/update-password { password }
// Chamado por /auth/update-password após o link de recuperação de senha.
// Mesmo motivo do /api/auth/activate-account: os cookies sb-* são HttpOnly,
// então o client component não tem sessão legível para chamar auth.updateUser()
// diretamente. Lê a sessão via cookies do next/headers (servidor) e usa o
// service role para definir a nova senha.
export async function POST(request: Request) {
  try {
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
      console.error("[POST /api/auth/update-password] falha ao definir senha", pwdError);
      return NextResponse.json({ error: "Não foi possível atualizar sua senha" }, { status: 500 });
    }

    // Revoga todas as sessões/refresh tokens do usuário (scope "global") — o
    // fluxo antigo (client-side supabase.auth.updateUser() + signOut()) fazia
    // isso implicitamente. Sem isso, a sessão de um eventual invasor (cenário
    // típico de "esqueci a senha": conta comprometida) sobreviveria à troca de
    // senha até expirar naturalmente. Best-effort: falha aqui não deve impedir
    // o usuário de saber que a senha JÁ foi trocada com sucesso.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      await adminClient().auth.admin.signOut(session.access_token, "global").catch((err) => {
        console.error("[POST /api/auth/update-password] falha ao revogar sessões antigas", err);
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[POST /api/auth/update-password]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
