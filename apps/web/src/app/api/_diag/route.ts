export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

// DIAGNÓSTICO TEMPORÁRIO — remover após achar a causa dos 500 em
// /api/auth/update-password, /api/auth/activate-account, /api/admin/search-profiles
// (todos usam createServerClient + env do Supabase). Retorna SÓ presença
// (boolean) e nomes de chave — nunca valores.
function present(v: unknown): boolean {
  return typeof v === "string" && v.length > 0;
}

export async function GET() {
  const out: Record<string, unknown> = {};

  // process.env (inlining de build / next-on-pages runtime shim)
  out.processEnv = {
    NEXT_PUBLIC_SUPABASE_URL: present(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    NEXT_PUBLIC_BFF_URL: present(process.env.NEXT_PUBLIC_BFF_URL),
    SUPABASE_URL: present(process.env.SUPABASE_URL),
    SUPABASE_ANON_KEY: present(process.env.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: present(process.env.SUPABASE_SERVICE_ROLE_KEY),
    INTERNAL_EMAIL_SECRET: present(process.env.INTERNAL_EMAIL_SECRET),
    INTERNAL_API_SECRET: present(process.env.INTERNAL_API_SECRET),
  };

  // getRequestContext().env (bindings de runtime do CF Pages)
  try {
    const env = getRequestContext().env as Record<string, unknown>;
    out.cfEnvContext = "ok";
    out.cfEnv = {
      NEXT_PUBLIC_SUPABASE_URL: present(env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: present(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      NEXT_PUBLIC_BFF_URL: present(env.NEXT_PUBLIC_BFF_URL),
      SUPABASE_URL: present(env.SUPABASE_URL),
      SUPABASE_ANON_KEY: present(env.SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: present(env.SUPABASE_SERVICE_ROLE_KEY),
      INTERNAL_EMAIL_SECRET: present(env.INTERNAL_EMAIL_SECRET),
      INTERNAL_API_SECRET: present(env.INTERNAL_API_SECRET),
    };
    out.cfEnvKeyNames = Object.keys(env).filter((k) => !/key|secret|token|pass/i.test(k)).sort();
  } catch (err) {
    out.cfEnvContext = err instanceof Error ? err.message : String(err);
  }

  // Reproduz o construtor que está lançando
  try {
    const { createServerClient } = await import("@supabase/ssr");
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    out.createServerClient = "ok";
  } catch (err) {
    out.createServerClient = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(out);
}
