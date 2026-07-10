export const runtime = 'edge';
// Troca código/token por sessão e seta cookies sb-* por-usuário — sem isso o
// Next pode cachear e servir a sessão de um usuário (Google OAuth/magic link/
// recovery) para outro. Mesma causa raiz do incidente de session-bleed em
// /api/auth/upgrade-session.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

const ALLOWED_NEXT_PATHS = [
  "/efetivo", "/admin", "/reserva", "/nexus", "/perfil",
  "/auth/update-password", "/auth/confirmar-conta",
];

// Cria a iron-session no BFF (apmcb_session) — sem isso, logins via Google
// OAuth/magic link nunca ganham sessão de BFF e não conseguem usar nenhuma
// rota autenticada do BFF (saídas, cautelas, etc.). Mesmo padrão de
// login/page.tsx e auth/exchange/page.tsx.
//
// IMPORTANTE: este fetch roda no SERVIDOR (Route Handler), não no browser —
// `credentials: "include"` não tem efeito nenhum aqui (não existe cookie jar
// de navegador nesse contexto). O Set-Cookie que o BFF retorna só existe na
// Response deste fetch; precisa ser lido via getSetCookie() e reaplicado
// manualmente na Response que este Route Handler devolve ao browser, senão
// o cookie é criado no BFF mas nunca chega no usuário.
async function exchangeWithBff(accessToken: string, refreshToken: string): Promise<string[]> {
  if (!BFF_URL) return [];
  try {
    const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (res.ok && setCookies.length === 0) {
      // getSetCookie() pode não existir/funcionar em algum runtime — se o BFF
      // respondeu OK mas não capturamos nenhum cookie, é sinal direto de
      // regressão silenciosa (mesma classe de bug que motivou este código).
      console.error("[auth/callback] exchangeWithBff: BFF respondeu OK mas getSetCookie() não retornou nada");
    }
    return setCookies;
  } catch {
    // Segue mesmo se o BFF falhar — usuário loga normalmente via Supabase,
    // só fica sem funcionalidades que exigem o BFF até logar de novo.
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const supabaseError = searchParams.get("error");
  const supabaseErrorCode = searchParams.get("error_code");
  if (supabaseError || supabaseErrorCode) {
    const reason = supabaseErrorCode ?? supabaseError ?? "auth_error";
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, origin));
  }

  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "invite" | "magiclink" | "recovery" | "email" | null;

  // Validate next param against whitelist to prevent open redirect
  const rawNext = searchParams.get("next") ?? "/";
  const next = ALLOWED_NEXT_PATHS.some((p) => rawNext === p || rawNext.startsWith(p + "/"))
    ? rawNext
    : "/";

  const supabase = await createClient();
  let exchangeError: boolean = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = !!error;
    if (!error && data.session) {
      const bffSetCookies = await exchangeWithBff(data.session.access_token, data.session.refresh_token);
      const response = await handlePostAuth(supabase, origin, next);
      bffSetCookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
      return response;
    }
  }

  if (!exchangeError && token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error && data.session) {
      const bffSetCookies = await exchangeWithBff(data.session.access_token, data.session.refresh_token);
      const response = await handlePostAuth(supabase, origin, next);
      bffSetCookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
      return response;
    }
  }

  return NextResponse.redirect(new URL("/auth/error", origin));
}

async function handlePostAuth(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origin: string,
  next: string
): Promise<NextResponse> {
  if (next === "/auth/update-password") {
    return NextResponse.redirect(new URL("/auth/update-password", origin));
  }

  if (next === "/auth/confirmar-conta") {
    return NextResponse.redirect(new URL("/auth/confirmar-conta", origin));
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, registration_status")
      .eq("id", user.id)
      .single();

    if (profile) {
      return NextResponse.redirect(new URL(roleRedirect(profile.role, profile.registration_status), origin));
    }
  }

  return NextResponse.redirect(new URL(next === "/" ? "/login" : next, origin));
}

function roleRedirect(role: string, _status: string): string {
  switch (role) {
    case "admin_global":  return "/admin";
    case "superadmin":    return "/admin";
    case "admin_reserva": return "/reserva";
    case "armeiro":       return "/reserva";
    case "auditor":       return "/nexus";
    default:              return "/efetivo";
  }
}
