export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// DIAGNÓSTICO TEMPORÁRIO — remover antes do merge. Reproduz o que os routes
// que estão dando 500 fazem (createServerClient) e captura a mensagem de erro
// + presença (boolean, nunca valor) das env vars.
function has(v: unknown) {
  return typeof v === "string" && v.length > 0;
}

export async function GET() {
  const out: Record<string, unknown> = {
    proc: {
      NEXT_PUBLIC_SUPABASE_URL: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: has(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SUPABASE_URL: has(process.env.SUPABASE_URL),
      SUPABASE_ANON_KEY: has(process.env.SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  };

  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const env = getRequestContext().env as Record<string, unknown>;
    out.cf = {
      ctx: "ok",
      NEXT_PUBLIC_SUPABASE_URL: has(env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: has(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SUPABASE_URL: has(env.SUPABASE_URL),
      SUPABASE_ANON_KEY: has(env.SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: has(env.SUPABASE_SERVICE_ROLE_KEY),
    };
  } catch (e) {
    out.cf = { ctx: e instanceof Error ? e.message : String(e) };
  }

  try {
    const { cookies } = await import("next/headers");
    const cs = await cookies();
    out.cookies = cs.getAll().length;
  } catch (e) {
    out.cookies = e instanceof Error ? e.message : String(e);
  }

  try {
    const { createServerClient } = await import("@supabase/ssr");
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const sb = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    out.createServerClient = "ok";
    try {
      const r = await sb.auth.getUser();
      out.getUser = { hasData: !!r.data, hasUser: !!r.data?.user, err: r.error?.message ?? null };
    } catch (e) {
      out.getUser = "THREW: " + (e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    out.createServerClient = "THREW: " + (e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json(out);
}
