export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".apmcb.pmpb.online" : undefined;

/**
 * Destrói a sessão (Supabase + BFF) antes de mostrar o erro de divergência
 * de identidade detectado em (dashboard)/layout.tsx. Precisa ser um Route
 * Handler — Server Components não podem mutar cookies diretamente.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Limpa apmcb_session diretamente — não dá pra confiar no Set-Cookie de
  // resposta de um fetch servidor-a-servidor pro BFF (não existe cookie jar
  // de navegador nesse contexto; ver commit que corrigiu o mesmo erro em
  // auth/callback/route.ts). cookies().delete() aqui SIM funciona: Route
  // Handlers podem mutar a Response real que volta pro browser.
  const cookieStore = await cookies();
  cookieStore.delete({ name: "apmcb_session", path: "/", ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) });

  try {
    // Melhor esforço — não propaga Set-Cookie de volta (mesma limitação server-
    // to-server), mas não custa nada tentar. /api/auth/logout é isento de CSRF.
    await fetch(`${BFF_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Segue mesmo se o BFF falhar — apmcb_session já foi removido acima.
  }

  return NextResponse.redirect(new URL("/auth/error?reason=session_mismatch", request.url));
}
