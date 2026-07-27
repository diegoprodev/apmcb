export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const BFF_URL =
  process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const csrfResponse = await fetch(`${BFF_URL}/api/session/csrf`, {
    headers: { cookie },
    credentials: "include",
    cache: "no-store",
  });
  if (!csrfResponse.ok) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const { csrfToken } = (await csrfResponse.json()) as {
    csrfToken: string | null;
  };
  if (!csrfToken) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 403 });
  }

  const response = await fetch(`${BFF_URL}/api/profiles/me/photo`, {
    method: "POST",
    headers: {
      cookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": request.headers.get("content-type") ?? "",
    },
    body: request.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const payload = await response.json().catch(() => ({
    error: "Erro ao enviar foto",
  }));

  if (!response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }
  const photoPath = (payload as { photoPath: string }).photoPath;
  return NextResponse.json({
    path: photoPath,
    photoPath,
    signedUrl: null,
  });
}
