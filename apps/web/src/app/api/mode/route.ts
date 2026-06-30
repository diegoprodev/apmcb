export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

// Opções de cookie que o Next.js seta no domínio apmcb.pmpb.online.
// Sem "domain" explícito para não vazar para outros subdomínios.
const MODE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 60 * 8, // 8h — mesma validade do iron-session
};

export async function POST(req: NextRequest) {
  const { mode } = await req.json() as { mode: "usuario" | "staff" };

  // Lê o Bearer token enviado pelo cliente (header.tsx passa o JWT do Supabase)
  // Edge runtime não lê cookies de sessão Supabase de forma confiável
  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  // Proxy para o BFF (server-side — sem restrição CORS/cookie de domínio cruzado)
  const bffRes = await fetch(`${BFF_URL}/api/session/mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ mode }),
  });

  if (!bffRes.ok) {
    const err = await bffRes.json().catch(() => ({}));
    return NextResponse.json(err, { status: bffRes.status });
  }

  const data = await bffRes.json() as { originalRole?: string; roleLabel?: string };
  const cookieStore = await cookies();

  if (mode === "usuario") {
    const label = data.roleLabel ?? data.originalRole ?? "";
    cookieStore.set("apmcb_mode", "usuario", MODE_OPTS);
    cookieStore.set("apmcb_role_info", `${data.originalRole ?? ""}:${label}`, MODE_OPTS);
  } else {
    cookieStore.delete("apmcb_mode");
    cookieStore.delete("apmcb_role_info");
  }

  return NextResponse.json({ ok: true, ...data });
}
