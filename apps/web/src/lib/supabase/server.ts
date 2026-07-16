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
                // "lax", não "strict" — este setAll roda a cada refresh
                // automático de token do SDK Supabase (getUser() em qualquer
                // Server Component), então praticamente toda navegação pode
                // re-setar estes cookies. Achado real de produção 2026-07-16:
                // WebKit em modo PWA standalone no iOS não persiste de forma
                // confiável cookies Strict — sessão sobrevivia à reabertura
                // do ícone mas morria segundos depois. Mesmo fix aplicado em
                // apmcb_session (BFF) e upgrade-session/route.ts.
                sameSite: "lax",
              })
            );
          } catch {}
        },
      },
    }
  );
}
