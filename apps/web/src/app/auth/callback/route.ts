export const runtime = 'edge';

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  // Supabase sends errors as query params in PKCE flow (token expired, invalid, etc.)
  const supabaseError = searchParams.get("error");
  const supabaseErrorCode = searchParams.get("error_code");
  if (supabaseError || supabaseErrorCode) {
    const reason = supabaseErrorCode ?? supabaseError ?? "auth_error";
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, origin));
  }

  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "invite" | "magiclink" | "recovery" | "email" | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();
  let exchangeError: boolean = false;

  // PKCE code exchange (OAuth, magic links with PKCE)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = !!error;
    if (!error) {
      return handlePostAuth(supabase, origin, next);
    }
  }

  // OTP/token_hash fallback (invite emails, some OTP flows)
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
  // Password reset → update-password page
  if (next === "/auth/update-password") {
    return NextResponse.redirect(new URL("/auth/update-password", origin));
  }

  // Invite activation → confirmar-conta page (user sets password for the first time)
  if (next === "/auth/confirmar-conta") {
    return NextResponse.redirect(new URL("/auth/confirmar-conta", origin));
  }

  // Normal flow: resolve role and redirect
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
  if (role === "admin") return "/admin";
  if (role === "master") return "/reserva";
  return "/cadete";
}
