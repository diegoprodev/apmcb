export const runtime = "edge";

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/runtime-env";

/**
 * Upgrades sb-* cookies from non-HttpOnly (set by browser SDK after signInWithPassword /
 * setSession) to HttpOnly by re-issuing them from the server side.
 *
 * Called immediately after login/exchange so the JWT window in non-HttpOnly storage
 * is narrowed to the duration of a single roundtrip (~100 ms).
 */
export async function GET() {
  const cookieStore = await cookies();
  const res = NextResponse.json({ ok: true });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
          });
        });
      },
    },
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  // Re-issue the session through setAll to stamp HttpOnly on every sb-* cookie chunk.
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  return res;
}
