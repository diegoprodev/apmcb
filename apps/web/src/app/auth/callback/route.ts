// Troca código/token por sessão e seta cookies sb-* por-usuário — sem isso o
// Next pode cachear e servir a sessão de um usuário (Google OAuth/magic link/
// recovery) para outro. Mesma causa raiz do incidente de session-bleed em
// /api/auth/upgrade-session.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_NEXT_PATHS = [
  "/efetivo", "/admin", "/reserva", "/nexus", "/perfil",
  "/auth/update-password", "/auth/confirmar-conta",
];

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = !!error;
    if (!error) {
      return handlePostAuth(supabase, origin, next);
    }
  }

  if (!exchangeError && token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      return handlePostAuth(supabase, origin, next);
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
