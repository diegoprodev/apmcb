import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
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

      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/auth/error", origin));
}

function roleRedirect(role: string, status: string): string {
  if (role === "admin") return "/admin";
  if (role === "master") return "/armeiro";
  if (status === "complete") return "/cadete";
  return "/registro-pendente";
}
