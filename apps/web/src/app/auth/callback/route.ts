export const runtime = 'edge';
// Troca código/token por sessão e seta cookies sb-* por-usuário — sem isso o
// Next pode cachear e servir a sessão de um usuário (Google OAuth/magic link/
// recovery) para outro. Mesma causa raiz do incidente de session-bleed em
// /api/auth/upgrade-session.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const COOKIE_DOMAIN =
  process.env.NODE_ENV === "production" ? ".apmcb.pmpb.online" : undefined;

const ALLOWED_NEXT_PATHS = [
  "/efetivo", "/admin", "/reserva", "/nexus", "/perfil",
  "/auth/update-password", "/auth/confirmar-conta",
];

type BffExchangeResult = {
  sessionConfirmed: boolean;
  setCookies: string[];
};

type MagicLinkFailure =
  | "missing_token"
  | "invalid"
  | "expired_or_used"
  | "verify_failed"
  | "bff_session_failed";

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
async function exchangeWithBff(
  accessToken: string,
  refreshToken: string,
): Promise<BffExchangeResult> {
  if (!BFF_URL) return { sessionConfirmed: false, setCookies: [] };
  try {
    const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const sessionConfirmed =
      res.ok && setCookies.some((cookie) => hasActiveApmcbSessionCookie(cookie));
    return { sessionConfirmed, setCookies };
  } catch {
    return { sessionConfirmed: false, setCookies: [] };
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const requestId = crypto.randomUUID();

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
      const bffExchange = await exchangeWithBff(
        data.session.access_token,
        data.session.refresh_token,
      );
      const response = await handlePostAuth(supabase, origin, next);
      bffExchange.setCookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
      return response;
    }
  }

  if (!exchangeError && type === "email") {
    if (!token_hash) {
      return magicLinkError(origin, requestId, "missing_token");
    }

    let verification: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
    try {
      verification = await supabase.auth.verifyOtp({
        token_hash,
        type: "email",
      });
    } catch {
      return magicLinkError(origin, requestId, "verify_failed");
    }

    if (verification.error || !verification.data.session) {
      return magicLinkError(
        origin,
        requestId,
        classifyMagicLinkVerifyFailure(verification.error),
      );
    }

    const bffExchange = await exchangeWithBff(
      verification.data.session.access_token,
      verification.data.session.refresh_token,
    );

    if (!bffExchange.sessionConfirmed) {
      const supabaseCookieNames = await rollbackMagicLinkSessions(
        supabase,
        request,
      );
      const response = magicLinkError(
        origin,
        requestId,
        "bff_session_failed",
      );
      expireApmcbSession(response);
      expireSupabaseSessions(response, supabaseCookieNames);
      return response;
    }

    const response = await handlePostAuth(supabase, origin, next);
    bffExchange.setCookies.forEach((cookie) =>
      response.headers.append("Set-Cookie", cookie),
    );
    return response;
  }

  if (!exchangeError && token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error && data.session) {
      const bffExchange = await exchangeWithBff(
        data.session.access_token,
        data.session.refresh_token,
      );
      const response = await handlePostAuth(supabase, origin, next);
      bffExchange.setCookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
      return response;
    }
  }

  return NextResponse.redirect(new URL("/auth/error", origin));
}

function hasActiveApmcbSessionCookie(cookie: string): boolean {
  const [nameValue, ...attributes] = cookie.split(";");
  const separator = nameValue.indexOf("=");
  if (separator < 0) return false;

  const name = nameValue.slice(0, separator).trim();
  const value = nameValue.slice(separator + 1).trim();
  const deletesCookie = attributes.some(
    (attribute) => attribute.trim().toLowerCase() === "max-age=0",
  );

  return name === "apmcb_session" && value.length > 0 && !deletesCookie;
}

function classifyMagicLinkVerifyFailure(error: { code?: string } | null): MagicLinkFailure {
  if (error?.code === "otp_expired") return "expired_or_used";

  if (
    error?.code === "validation_failed" ||
    error?.code === "bad_json" ||
    error?.code === "invalid_request"
  ) {
    return "invalid";
  }

  return "verify_failed";
}

function magicLinkError(
  origin: string,
  requestId: string,
  category: MagicLinkFailure,
): NextResponse {
  console.warn("[auth/callback] Magic Link não concluído", {
    requestId,
    category,
  });
  return NextResponse.redirect(
    new URL(`/auth/error?reason=magic_link_${category}`, origin),
  );
}

async function rollbackMagicLinkSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  request: Request,
): Promise<string[]> {
  const priorBffCookie = getApmcbSessionCookie(request);
  const supabaseCookieNames = await getSupabaseSessionCookieNames();

  await Promise.all([
    (async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // Melhor esforço: a resposta continua removendo a sessão local.
      }
    })(),
    (async () => {
      if (!BFF_URL || !priorBffCookie) return;
      try {
        await fetch(`${BFF_URL}/api/auth/logout`, {
          method: "POST",
          headers: { cookie: priorBffCookie },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Melhor esforço: o Set-Cookie de expiração ainda remove a sessão local.
      }
    })(),
  ]);

  return supabaseCookieNames;
}

async function getSupabaseSessionCookieNames(): Promise<string[]> {
  try {
    const cookieStore = await cookies();
    return cookieStore
      .getAll()
      .map(({ name }) => name)
      .filter((name) =>
        /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i.test(name),
      );
  } catch {
    return [];
  }
}

function getApmcbSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "apmcb_session" && value.length > 0) {
      return `${name}=${value}`;
    }
  }

  return null;
}

function expireApmcbSession(response: NextResponse): void {
  response.cookies.set({
    name: "apmcb_session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  });
}

function expireSupabaseSessions(
  response: NextResponse,
  cookieNames: string[],
): void {
  for (const name of new Set(cookieNames)) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
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
      return NextResponse.redirect(new URL(roleRedirect(profile.role), origin));
    }
  }

  return NextResponse.redirect(new URL(next === "/" ? "/login" : next, origin));
}

function roleRedirect(role: string): string {
  switch (role) {
    case "admin_global":  return "/admin";
    case "superadmin":    return "/admin";
    case "admin_reserva": return "/reserva";
    case "armeiro":       return "/reserva";
    case "auditor":       return "/nexus";
    default:              return "/efetivo";
  }
}
