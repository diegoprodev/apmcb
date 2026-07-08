import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "./runtime-env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                // Force HttpOnly — SSE via BFF proxy eliminates the Realtime
                // WebSocket constraint that previously required JS-readable sb-* cookies.
                httpOnly: true,
                sameSite: "strict",
              })
            );
          } catch {}
        },
      },
    }
  );
}
