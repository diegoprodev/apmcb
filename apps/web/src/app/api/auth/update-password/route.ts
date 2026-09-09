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
import { sendTransactionalEmail } from "@/lib/notify-email";
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

    // Aviso de segurança "sua senha foi alterada" (Fase 1). Fire-and-forget via
    // BFF → Resend; nunca bloqueia nem falha esta resposta. No runtime edge,
    // registra em ctx.waitUntil para o trabalho não ser descartado após o return.
    const emailDone = sendTransactionalEmail("password_changed", user.id, {
      quando: new Date().toLocaleString("pt-BR", { timeZone: "America/Recife" }),
    }, "security");
    try {
      getRequestContext().ctx.waitUntil(emailDone);
    } catch {
      void emailDone;
    }

    // Boas-vindas (Fase 2) — só na PRIMEIRA vez que a conta é ativada. Claim
    // atômico em profiles.welcome_email_sent_at: só o request que ganhar a
    // linha (IS NULL → now()) dispara o e-mail; um reset de senha de conta já
    // ativa não redispara (a migration fez backfill das contas já ativas).
    // Fire-and-forget como o password_changed acima.
    //
    // Trade-off conhecido: o claim é feito ANTES do envio. Se o orquestrador
    // suprimir por EMAIL_DAILY_CAP (lifecycle, default 60/dia), o welcome é
    // perdido para esse militar — mas ele acabou de entrar (já viu a
    // notificação "Seja bem-vindo" do sino) e welcome não é bulk. Se um dia
    // virar bulk, a resposta é o tier pago do Resend (plano D14a), não
    // complicar o claim aqui.
    const welcomeDone = (async () => {
      try {
        const { data: claimed, error: claimErr } = await adminClient()
          .from("profiles")
          .update({ welcome_email_sent_at: new Date().toISOString() })
          .eq("id", user.id)
          .is("welcome_email_sent_at", null)
          .select("id");
        if (claimErr) {
          console.error("[POST /api/auth/update-password] claim welcome falhou", claimErr.message);
          return;
        }
        if (claimed && claimed.length > 0) {
          await sendTransactionalEmail("welcome", user.id, {}, "lifecycle");
        }
      } catch (err) {
        console.error("[POST /api/auth/update-password] welcome falhou", err instanceof Error ? err.message : err);
      }
    })();
    try {
      getRequestContext().ctx.waitUntil(welcomeDone);
    } catch {
      void welcomeDone;
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[POST /api/auth/update-password]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
