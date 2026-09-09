export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

// TEMPORÁRIO — achar por que notify-email vê INTERNAL_EMAIL_SECRET vazio.
// Só presença (boolean) + nomes de chave; nenhum valor. Remover após.
const has = (v: unknown) => typeof v === "string" && v.length > 0;

export async function GET() {
  const out: Record<string, unknown> = {};
  try {
    const env = getRequestContext().env as Record<string, unknown>;
    out.ctx = "ok";
    out.keys = Object.keys(env).sort();
    out.present = {
      INTERNAL_EMAIL_SECRET: has(env.INTERNAL_EMAIL_SECRET),
      SUPABASE_SERVICE_ROLE_KEY: has(env.SUPABASE_SERVICE_ROLE_KEY),
      SUPABASE_ANON_KEY: has(env.SUPABASE_ANON_KEY),
      NEXT_PUBLIC_BFF_URL: has(env.NEXT_PUBLIC_BFF_URL),
      NEXT_PUBLIC_SUPABASE_URL: has(env.NEXT_PUBLIC_SUPABASE_URL),
      BFF_URL: has(env.BFF_URL),
    };
    out.internalEmailSecretLen =
      typeof env.INTERNAL_EMAIL_SECRET === "string" ? env.INTERNAL_EMAIL_SECRET.length : null;
  } catch (e) {
    out.ctx = e instanceof Error ? e.message : String(e);
  }
  out.proc = {
    INTERNAL_EMAIL_SECRET: has(process.env.INTERNAL_EMAIL_SECRET),
    NEXT_PUBLIC_BFF_URL: has(process.env.NEXT_PUBLIC_BFF_URL),
  };
  return NextResponse.json(out);
}
