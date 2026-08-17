export const runtime = "edge";
// Defesa em profundidade: POST não é cacheado por semântica HTTP padrão, mas a
// detecção automática de "usa cookies() logo é dinâmico" já se provou não
// confiável neste adaptador (ver commit e059f7f).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const BFF_URL =
  process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

// POST /api/arsenal/material-photo — proxy fino para o BFF (POST /api/arsenal/
// material-photo), que agora processa a foto via Sharp (mesmo padrão de
// /api/profiles/photo) antes de gravar no bucket privado material-photos com
// o client de service role. Antes desta mudança, esta rota fazia o upload
// DIRETO ao Storage com os bytes brutos do cliente (até 5 MiB, sem
// compressão nem cap de dimensão) — o mesmo bug de custo de egress já
// corrigido para fotos de perfil em 2026-07-27 (ver CHANGELOG), só que ainda
// não corrigido aqui. O motivo de precisar de um proxy nunca mudou: storage.
// objects tem RLS "TO authenticated" nesse bucket, e o client Supabase do
// browser não tem sessão legível (sb-* é HttpOnly) pra autenticar upload
// direto — mas agora, além disso, o Sharp e o client de service role só
// existem no BFF, nunca no client/edge. Mesmo mecanismo de CSRF do proxy de
// foto de perfil (busca o token antes de repassar o multipart).
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

  const response = await fetch(`${BFF_URL}/api/arsenal/material-photo`, {
    method: "POST",
    headers: {
      cookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": request.headers.get("content-type") ?? "",
    },
    body: request.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  // Passa o payload do BFF adiante sem remapear campos — { photo_url,
  // photo_storage_path } é exatamente o formato que os dois callers web
  // (_material-dialog.tsx, _registrar-ocorrencia-dialog.tsx) já esperam.
  const payload = await response.json().catch(() => ({
    error: "Erro ao enviar foto",
  }));
  return NextResponse.json(payload, { status: response.status });
}
