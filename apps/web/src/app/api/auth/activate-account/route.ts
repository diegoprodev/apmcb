
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey(): string {
  try {
    const cfEnv = getCloudflareContext().env as Record<string, string | undefined>;
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

// POST /api/auth/activate-account
// Called from /auth/confirmar-conta after user sets their first password.
// Uses service_role to mark account_activated_at (bypasses RLS).
export async function POST() {
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
