export const runtime = "edge";
// Sem isso, Next.js pode servir uma resposta cacheada (com Set-Cookie de OUTRO
// usuário) para requisições subsequentes — a detecção automática de "usa
// cookies() logo é dinâmico" não é confiável neste adaptador. Causa raiz
// confirmada do incidente de session-bleed cross-user.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/runtime-env";

/**
 * Upgrades sb-* cookies from non-HttpOnly (set by browser SDK after signInWithPassword /
 * setSession) to HttpOnly by re-issuing them from the server side.
 *
 * Called imediatamente após login/exchange, com os tokens recém-emitidos passados
 * explicitamente no body (não lidos de cookies) — achado de incidente real de produção
 * (2026-07-20): a versão anterior (GET, sem body) lia a sessão via cookies() +
 * getSession(), o que falha sempre que o NAVEGADOR JÁ TINHA um cookie sb-* httpOnly de
 * um login anterior. JS não consegue sobrescrever um cookie httpOnly (document.cookie
 * é bloqueado silenciosamente para esse nome) — signInWithPassword() no cliente parecia
 * ter sucesso, mas o cookie antigo/expirado continuava sendo o único enviado ao servidor,
 * getSession() falhava, devolvia 401, e o login travava (usuário via redirect de volta
 * pro /login sem nenhum erro visível). Passar os tokens explicitamente no POST elimina
 * essa dependência: o servidor sempre PODE sobrescrever um cookie httpOnly via
 * Set-Cookie (só JS é bloqueado, não o servidor), então setSession() com os tokens
 * frescos sempre substitui corretamente o cookie antigo, não importa o que já estava lá.
 */
export async function POST(request: Request) {
  const { access_token, refresh_token } = await request.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "access_token e refresh_token obrigatórios" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      // Não precisa ler cookies de entrada — setSession() abaixo já recebe os
      // tokens frescos diretamente, sem depender do que o navegador já tinha.
      getAll: () => [],
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            // "lax", não "strict" — mesma causa raiz do fix em apmcb_session
            // (apps/bff/src/lib/session.ts): WebKit em modo PWA standalone no
            // iOS tem histórico de não persistir de forma confiável cookies
            // Strict setados via fetch() (não navegação de página completa) —
            // exatamente como aqui. Achado real de produção 2026-07-16: sessão
            // sobrevivia à reabertura do ícone (cookie ainda lido no primeiro
            // request) mas morria segundos depois, batendo com getUser()
            // falhando por essas cookies terem sido descartadas pelo WebKit.
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        });
      },
    },
  });

  try {
    // decodeJWT() do SDK faz JSON.parse fora de try/catch próprio — um
    // access_token com estrutura base64url válida mas payload corrompido
    // lança SyntaxError puro (não AuthError), que setSession() relança sem
    // tratar. Sem este try/catch, isso vira 500 genérico em vez do 401
    // limpo — achado de code review, mesma rota que já causou incidente.
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  return res;
}
